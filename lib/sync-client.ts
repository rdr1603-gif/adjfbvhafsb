import {
  recordKey,
  SETTINGS_PROFILE_ID,
  type SyncChange,
  type SyncCollection,
  type SyncConflict,
  type SyncRecord,
  type SyncResponse,
} from './sync-types'

const META_KEY = 'padelpro-sync-v1'
const POLL_MS = 5000
const DEBOUNCE_MS = 700
const MAX_BACKOFF_MS = 60000
const MAX_CONFLICTS = 20

export type SyncStatus =
  | 'iniciando'
  | 'sincronizando'
  | 'al-dia'
  | 'sin-conexion'
  | 'con-conflicto'
  | 'error'

export type SyncState = {
  status: SyncStatus
  pending: number
  conflicts: SyncConflict[]
  lastSyncAt: string | null
  message: string | null
}

type Meta = {
  cursor: string | null
  /** Version del servidor conocida por este dispositivo, clave "coleccion:id". */
  stamps: Record<string, string>
  /** Operaciones pendientes de subir (funciona sin conexion). */
  pending: Record<string, SyncChange>
  migratedFor: string | null
}

type MetaStore = { version: 1; users: Record<string, Meta> }

const emptyMeta = (): Meta => ({ cursor: null, stamps: {}, pending: {}, migratedFor: null })

/** Perfil tal como aparece en una app recien instalada, sin tocar por el usuario. */
export function isUntouchedProfile(profile: unknown): boolean {
  if (!profile || typeof profile !== 'object') return true
  const value = profile as Record<string, unknown>
  const club = String(value.club ?? '').trim()
  return (
    !String(value.name ?? '').trim() &&
    !String(value.phone ?? '').trim() &&
    (club === '' || club === 'Mi academia')
  )
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

function readStore(storage?: Storage): MetaStore {
  const store = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage)
  if (!store) return { version: 1, users: {} }
  try {
    const raw = store.getItem(META_KEY)
    if (!raw) return { version: 1, users: {} }
    const parsed = JSON.parse(raw) as MetaStore
    if (parsed?.version !== 1 || typeof parsed.users !== 'object') return { version: 1, users: {} }
    return parsed
  } catch {
    return { version: 1, users: {} }
  }
}

function writeStore(store: MetaStore, storage?: Storage): void {
  const target = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage)
  if (!target) return
  try {
    target.setItem(META_KEY, JSON.stringify(store))
  } catch {
    /* cuota llena: la app sigue funcionando con los datos en memoria */
  }
}

export class SyncEngine {
  private readonly userId: string
  private meta: Meta
  private state: SyncState = {
    status: 'iniciando',
    pending: 0,
    conflicts: [],
    lastSyncAt: null,
    message: null,
  }
  private listeners = new Set<(state: SyncState) => void>()
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private running = false
  private ready = false
  private failures = 0
  private dirtyEnabled = false
  private stopped = false
  private applyRemote: (records: SyncRecord[]) => void
  private onUnauthorized: () => void
  private fetchImpl?: typeof fetch
  private storage?: Storage

  constructor(userId: string, options: {
    applyRemote: (records: SyncRecord[]) => void
    onUnauthorized: () => void
    fetchImpl?: typeof fetch
    storage?: Storage
  }) {
    this.userId = userId
    this.applyRemote = options.applyRemote
    this.onUnauthorized = options.onUnauthorized
    this.fetchImpl = options.fetchImpl
    this.storage = options.storage
    const store = readStore(this.storage)
    this.meta = store.users[userId] ?? emptyMeta()
    this.publish()
  }

  private persist(): void {
    const store = readStore(this.storage)
    store.users[this.userId] = this.meta
    writeStore(store, this.storage)
  }

  private publish(patch: Partial<SyncState> = {}): void {
    this.state = { ...this.state, ...patch, pending: Object.keys(this.meta.pending).length }
    for (const listener of this.listeners) listener(this.state)
  }

  subscribe(listener: (state: SyncState) => void): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  getState(): SyncState {
    return this.state
  }

  private request(url: string, init?: RequestInit): Promise<Response> {
    if (this.fetchImpl) return this.fetchImpl(url, init)
    return globalThis.fetch(url, init)
  }

  /** Permite detectar cambios locales solo cuando la app ya esta hidratada. */
  setDirtyEnabled(enabled: boolean): void {
    this.dirtyEnabled = enabled
  }

  start(): void {
    this.stopped = false
    if (this.pollTimer) return
    const interval = this.failures > 0 ? Math.min(POLL_MS * 2 ** this.failures, MAX_BACKOFF_MS) : POLL_MS
    this.pollTimer = setInterval(() => void this.run(), interval)
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline)
      window.addEventListener('offline', this.handleOffline)
      window.addEventListener('focus', this.handleOnline)
      document.addEventListener('visibilitychange', this.handleVisibility)
    }
    void this.run()
  }

  stop(): void {
    this.stopped = true
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.pollTimer = null
    this.debounceTimer = null
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline)
      window.removeEventListener('offline', this.handleOffline)
      window.removeEventListener('focus', this.handleOnline)
      document.removeEventListener('visibilitychange', this.handleVisibility)
    }
    this.listeners.clear()
  }

  private handleOnline = () => {
    this.failures = 0
    this.schedule(0)
  }

  private handleOffline = () => {
    this.publish({ status: 'sin-conexion', message: 'Trabajando sin conexion' })
  }

  private handleVisibility = () => {
    if (!document.hidden) this.schedule(0)
  }

  private schedule(delay = DEBOUNCE_MS): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      void this.run()
    }, delay)
  }

  /** Marca cambios locales. Coalesce varias ediciones del mismo registro. */
  private setPending(key: string, next: SyncChange): void {
    const previous = this.meta.pending[key]
    const change: SyncChange = {
      collection: next.collection,
      id: next.id,
      data: next.data,
      deletedAt: next.deletedAt,
      // Se conserva la version base original: si el registro se edito dos veces
      // sin conexión, el segundo cambio sigue basandose en la ultima version
      // confirmada con el servidor.
      baseUpdatedAt: previous?.baseUpdatedAt ?? next.baseUpdatedAt ?? null,
    }
    this.meta.pending[key] = change
    this.persist()
    this.publish({ status: navigator.onLine ? 'sincronizando' : 'sin-conexion' })
    this.schedule()
  }

  enqueueProfile(previous: unknown, next: unknown): void {
    if (!this.dirtyEnabled) return
    if (stableStringify(previous) === stableStringify(next)) return
    const key = recordKey('settings', SETTINGS_PROFILE_ID)
    this.setPending(key, {
      collection: 'settings',
      id: SETTINGS_PROFILE_ID,
      data: next,
      deletedAt: null,
      baseUpdatedAt: this.meta.stamps[key] ?? null,
    })
  }

  enqueueDiff(collection: SyncCollection, previousItems: unknown[], nextItems: unknown[]): void {
    if (!this.dirtyEnabled) return
    const previousById = new Map<string, unknown>()
    for (const item of previousItems) {
      const id = (item as { id?: unknown })?.id
      if (id !== undefined && id !== null) previousById.set(String(id), item)
    }
    const nextIds = new Set<string>()
    for (const item of nextItems) {
      const rawId = (item as { id?: unknown })?.id
      if (rawId === undefined || rawId === null) continue
      const id = String(rawId)
      nextIds.add(id)
      const key = recordKey(collection, id)
      const previous = previousById.get(id)
      if (previous === undefined) {
        this.setPending(key, {
          collection,
          id,
          data: item,
          deletedAt: null,
          baseUpdatedAt: null,
        })
        continue
      }
      if (stableStringify(previous) !== stableStringify(item)) {
        this.setPending(key, {
          collection,
          id,
          data: item,
          deletedAt: null,
          baseUpdatedAt: this.meta.stamps[key] ?? null,
        })
      }
    }
    for (const [id, item] of previousById) {
      if (nextIds.has(id)) continue
      const key = recordKey(collection, id)
      this.setPending(key, {
        collection,
        id,
        data: item,
        deletedAt: new Date().toISOString(),
        baseUpdatedAt: this.meta.stamps[key] ?? null,
      })
    }
  }

  /** Resolucion manual: se conserva la version del servidor. */
  keepServer(conflict: SyncConflict): void {
    this.meta.stamps[conflict.key] = conflict.server.updatedAt
    delete this.meta.pending[conflict.key]
    this.persist()
    this.applyRemote([{
      collection: conflict.collection,
      id: conflict.id,
      data: conflict.server.data,
      updatedAt: conflict.server.updatedAt,
      deletedAt: conflict.server.deletedAt,
    }])
    this.dismissConflict(conflict.key)
  }

  /** Resolucion manual: se reintenta guardar la version local sobre la del servidor. */
  keepLocal(conflict: SyncConflict): void {
    this.meta.stamps[conflict.key] = conflict.server.updatedAt
    this.setPending(conflict.key, {
      collection: conflict.collection,
      id: conflict.id,
      data: conflict.local,
      deletedAt: null,
      baseUpdatedAt: conflict.server.updatedAt,
    })
    this.dismissConflict(conflict.key)
  }

  dismissConflict(key: string): void {
    const conflicts = this.state.conflicts.filter((c) => c.key !== key)
    this.publish({ conflicts, status: conflicts.length ? 'con-conflicto' : 'al-dia' })
  }

  /**
   * Primera sincronizacion de un dispositivo: compara los datos locales con el
   * estado completo del servidor y encola solo lo que de verdad difiere, sin
   * duplicar ni sobrescribir lo que ya esta en la nube.
   */
  migrate(localData: {
    students: unknown[]
    cycles: unknown[]
    classes: unknown[]
    recurrences: unknown[]
    payments: unknown[]
    profile: unknown
  }): Promise<void> {
    if (this.meta.migratedFor === this.userId) {
      this.ready = true
      this.schedule(0)
      return Promise.resolve()
    }
    return (async () => {
      try {
        const response = await this.request('/api/sync?since=' + encodeURIComponent(new Date(0).toISOString()), {
          credentials: 'same-origin',
        })
        if (response.status === 401) return this.onUnauthorized()
        if (!response.ok) throw new Error('sin respuesta')
        const data = (await response.json()) as SyncResponse
        this.meta.cursor = data.cursor

        const serverByKey = new Map<string, SyncRecord>()
        for (const record of data.records) serverByKey.set(recordKey(record.collection, record.id), record)

        const pull: SyncRecord[] = []
        for (const record of data.records) {
          if (record.deletedAt) continue
          this.meta.stamps[recordKey(record.collection, record.id)] = record.updatedAt
        }

        // La migracion encola con setPending de forma directa: no hace falta
        // silenciar los setters de React, y desactivarlos aqui dejaria la app
        // sin sincronizar cualquier cambio posterior.
        const localCollections = [
          'students',
          'cycles',
          'classes',
          'recurrences',
          'payments',
        ] as const
        for (const collection of localCollections) {
          this.reconcileMigration(collection, localData[collection], serverByKey, pull)
        }
        this.reconcileProfile(localData.profile, serverByKey, pull)

        this.meta.migratedFor = this.userId
        this.persist()
        this.ready = true
        this.publish({ message: 'Datos locales migrados a la nube' })
        if (pull.length) this.applyRemote(pull)
        this.schedule(0)
      } catch {
        this.ready = true
        this.schedule(3000)
      }
    })()
  }
  private reconcileMigration(
    collection: 'students' | 'cycles' | 'classes' | 'recurrences' | 'payments',
    localItems: unknown[],
    serverByKey: Map<string, SyncRecord>,
    pull: SyncRecord[],
  ): void {
    const localIds = new Set<string>()
    for (const item of localItems) {
      const rawId = (item as { id?: unknown })?.id
      if (rawId === undefined || rawId === null) continue
      const id = String(rawId)
      localIds.add(id)
      const key = recordKey(collection, id)
      const remote = serverByKey.get(key)
      if (!remote || remote.deletedAt) {
        this.setPending(key, {
          collection,
          id,
          data: item,
          deletedAt: null,
          baseUpdatedAt: null,
        })
        continue
      }
      this.meta.stamps[key] = remote.updatedAt
      if (stableStringify(remote.data) !== stableStringify(item)) {
        // El servidor tiene otra version: se trata como edicion local sobre la
        // version conocida, no como un conflicto.
        this.setPending(key, {
          collection,
          id,
          data: item,
          deletedAt: null,
          baseUpdatedAt: remote.updatedAt,
        })
      }
    }
    for (const [key, remote] of serverByKey) {
      if (!key.startsWith(`${collection}:`) || remote.deletedAt) continue
      if (!localIds.has(remote.id)) pull.push(remote)
    }
  }

  private reconcileProfile(
    profile: unknown,
    serverByKey: Map<string, SyncRecord>,
    pull: SyncRecord[],
  ): void {
    const key = recordKey('settings', SETTINGS_PROFILE_ID)
    const remote = serverByKey.get(key)
    const pushLocal = (baseUpdatedAt: string | null) =>
      this.setPending(key, {
        collection: 'settings',
        id: SETTINGS_PROFILE_ID,
        data: profile,
        deletedAt: null,
        baseUpdatedAt,
      })

    if (!remote) {
      if (!isUntouchedProfile(profile)) pushLocal(null)
      return
    }

    this.meta.stamps[key] = remote.updatedAt
    const serverIsEmpty =
      !remote.data || typeof remote.data !== 'object' || Object.keys(remote.data).length === 0

    // Un dispositivo recien instalado tiene el perfil por defecto. En ese caso
    // la nube manda: de lo contrario un celular nuevo borraria el nombre y el
    // club reales del profesor.
    if (isUntouchedProfile(profile) || serverIsEmpty) {
      if (serverIsEmpty && !isUntouchedProfile(profile)) pushLocal(remote.updatedAt)
      else if (!serverIsEmpty) pull.push(remote)
      return
    }

    if (stableStringify(remote.data) === stableStringify(profile)) pull.push(remote)
    else pushLocal(remote.updatedAt)
  }

  async run(): Promise<void> {
    // No se sincroniza hasta que la migracion decidio que hacer con los datos
    // locales: asi una descarga inicial nunca pisa lo que el usuario ya tenia.
    if (this.running || this.stopped || !this.ready) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.publish({ status: 'sin-conexion', message: 'Trabajando sin conexion' })
      return
    }
    this.running = true
    this.publish({ status: 'sincronizando' })
    try {
      const changes = Object.values(this.meta.pending)
      const hasPush = changes.length > 0
      const response = await this.request(hasPush ? '/api/sync' : `/api/sync?since=${encodeURIComponent(this.meta.cursor ?? new Date(0).toISOString())}`, {
        method: hasPush ? 'POST' : 'GET',
        credentials: 'same-origin',
        headers: hasPush ? { 'content-type': 'application/json' } : undefined,
        body: hasPush ? JSON.stringify({ since: this.meta.cursor, changes }) : undefined,
      })
      if (response.status === 401) {
        this.onUnauthorized()
        return
      }
      if (!response.ok) throw new Error(`respuesta ${response.status}`)
      const data = (await response.json()) as SyncResponse

      const justApplied = new Set<string>()
      const pull: SyncRecord[] = []
      for (const applied of data.applied) {
        this.meta.stamps[applied.key] = applied.updatedAt
        delete this.meta.pending[applied.key]
        justApplied.add(applied.key)
      }

      const conflicts: SyncConflict[] = []
      for (const conflict of data.conflicts) {
        this.meta.stamps[conflict.key] = conflict.server.updatedAt
        delete this.meta.pending[conflict.key]
        conflicts.push(conflict)
        pull.push({
          collection: conflict.collection,
          id: conflict.id,
          data: conflict.server.data,
          updatedAt: conflict.server.updatedAt,
          deletedAt: conflict.server.deletedAt,
        })
      }

      for (const record of data.records) {
        const key = recordKey(record.collection, record.id)
        if (justApplied.has(key)) continue
        if (this.meta.pending[key]) continue
        if (this.meta.stamps[key] === record.updatedAt) continue
        this.meta.stamps[key] = record.updatedAt
        pull.push(record)
      }

      this.meta.cursor = data.cursor
      this.persist()

      if (pull.length) this.applyRemote(pull)
      this.publish({
        status: conflicts.length ? 'con-conflicto' : 'al-dia',
        lastSyncAt: data.serverTime,
        message: data.rejected ? 'Se ignoraron algunos cambios no validos' : null,
      })
      this.failures = 0
    } catch (error) {
      this.failures += 1
      const offline = typeof navigator !== 'undefined' && !navigator.onLine
      this.publish({
        status: offline ? 'sin-conexion' : 'error',
        message: offline ? 'Trabajando sin conexion' : 'Reintentando sincronizar...',
      })
      this.schedule(Math.min(5000 * this.failures, MAX_BACKOFF_MS))
    } finally {
      this.running = false
    }
  }
}

export function clearUserSyncMeta(userId: string, storage?: Storage): void {
  const store = readStore(storage)
  delete store.users[userId]
  writeStore(store, storage)
}
