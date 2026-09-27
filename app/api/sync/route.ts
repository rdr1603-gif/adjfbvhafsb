import type { PoolClient } from 'pg'
import { withTransaction } from '@/lib/db'
import { currentUserId } from '@/lib/session'
import {
  isSyncCollection,
  recordKey,
  SETTINGS_PROFILE_ID,
  type SyncApplied,
  type SyncChange,
  type SyncCollection,
  type SyncConflict,
  type SyncRecord,
  type SyncResponse,
} from '@/lib/sync-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_CHANGES_PER_REQUEST = 2000
const MAX_RECORD_BYTES = 200_000
/** Margen de solapamiento del cursor: evita perder escrituras concurrentes. */
const CURSOR_OVERLAP_MS = 2000
/** Tolerancia al comparar versiones (redondeo de milisegundos). */
const VERSION_TOLERANCE_MS = 1

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

function parseTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : new Date(time).toISOString()
}

function sanitizeChanges(input: unknown): { changes: SyncChange[]; rejected: number } {
  if (!Array.isArray(input)) return { changes: [], rejected: 0 }
  const changes: SyncChange[] = []
  let rejected = 0
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') {
      rejected += 1
      continue
    }
    const candidate = raw as Record<string, unknown>
    const collection = candidate.collection
    const id = typeof candidate.id === 'string' ? candidate.id : ''
    if (!isSyncCollection(collection) || !id || id.length > 120) {
      rejected += 1
      continue
    }
    if (collection === 'settings' && id !== SETTINGS_PROFILE_ID) {
      rejected += 1
      continue
    }
    let payload: string
    try {
      payload = stableStringify(candidate.data ?? {})
    } catch {
      rejected += 1
      continue
    }
    if (payload.length > MAX_RECORD_BYTES) {
      rejected += 1
      continue
    }
    changes.push({
      collection: collection as SyncCollection,
      id,
      data: candidate.data ?? {},
      deletedAt: parseTimestamp(candidate.deletedAt),
      baseUpdatedAt: parseTimestamp(candidate.baseUpdatedAt),
    })
    if (changes.length >= MAX_CHANGES_PER_REQUEST) break
  }
  return { changes, rejected }
}

async function readWatermark(client: PoolClient): Promise<Date> {
  const { rows } = await client.query('select clock_timestamp() as watermark')
  return rows[0].watermark as Date
}

async function pullRecords(
  client: PoolClient,
  userId: string,
  since: string | null,
  until: Date,
): Promise<SyncRecord[]> {
  const { rows } = await client.query(
    `select collection, id, data, updated_at, deleted_at
       from padelcoach.records
      where user_id = $1
        and updated_at > $2
        and updated_at <= $3
      order by updated_at asc, collection asc, id asc
      limit 20000`,
    [userId, since ? new Date(since) : new Date(0), until],
  )
  return rows.map((row) => ({
    collection: row.collection as SyncCollection,
    id: row.id,
    data: row.data,
    updatedAt: new Date(row.updated_at).toISOString(),
    deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
  }))
}

async function applyChange(
  client: PoolClient,
  userId: string,
  change: SyncChange,
): Promise<{ kind: 'applied'; updatedAt: string } | { kind: 'conflict'; server: SyncRecord }> {
  const { rows } = await client.query(
    `select collection, id, data, updated_at, deleted_at
       from padelcoach.records
      where user_id = $1 and collection = $2 and id = $3
      for update`,
    [userId, change.collection, change.id],
  )
  const payload = JSON.stringify(change.data ?? {})

  if (!rows.length) {
    const inserted = await client.query(
      `insert into padelcoach.records (user_id, collection, id, data, deleted_at)
       values ($1, $2, $3, $4::jsonb, $5)
       returning updated_at`,
      [userId, change.collection, change.id, payload, change.deletedAt],
    )
    return { kind: 'applied', updatedAt: new Date(inserted.rows[0].updated_at).toISOString() }
  }

  const server = rows[0]
  const serverMs = new Date(server.updated_at).getTime()
  const serverDeletedAt = server.deleted_at ? new Date(server.deleted_at).toISOString() : null
  const sameContent =
    stableStringify(server.data) === stableStringify(change.data ?? {}) &&
    serverDeletedAt === change.deletedAt

  // Reintento idempotente: la escritura ya esta en el servidor (respuesta perdida
  // o doble guardado). Nunca se crea un registro duplicado.
  if (sameContent) {
    return { kind: 'applied', updatedAt: new Date(server.updated_at).toISOString() }
  }

  if (change.baseUpdatedAt) {
    const baseMs = Date.parse(change.baseUpdatedAt)
    const isBasedOnServer = serverMs - baseMs <= VERSION_TOLERANCE_MS
    if (isBasedOnServer) {
      const updated = await client.query(
        `update padelcoach.records
            set data = $4::jsonb, deleted_at = $5, updated_at = clock_timestamp()
          where user_id = $1 and collection = $2 and id = $3
          returning updated_at`,
        [userId, change.collection, change.id, payload, change.deletedAt],
      )
      return { kind: 'applied', updatedAt: new Date(updated.rows[0].updated_at).toISOString() }
    }
  }

  // El servidor tiene una version mas nueva que la que el cliente conocia:
  // no se sobrescribe y se informa el conflicto. Tambien impide que una
  // sincronizacion antigua reviva un registro eliminado.
  return {
    kind: 'conflict',
    server: {
      collection: change.collection,
      id: change.id,
      data: server.data,
      updatedAt: new Date(server.updated_at).toISOString(),
      deletedAt: serverDeletedAt,
    },
  }
}

async function runSync(userId: string, since: string | null, rawChanges: unknown) {
  const { changes, rejected } = sanitizeChanges(rawChanges)
  return withTransaction(async (client) => {
    const applied: SyncApplied[] = []
    const conflicts: SyncConflict[] = []

    for (const change of changes) {
      const result = await applyChange(client, userId, change)
      const key = recordKey(change.collection, change.id)
      if (result.kind === 'applied') {
        applied.push({ key, updatedAt: result.updatedAt })
      } else {
        conflicts.push({
          collection: change.collection,
          id: change.id,
          key,
          local: change.data,
          baseUpdatedAt: change.baseUpdatedAt,
          server: {
            data: result.server.data,
            updatedAt: result.server.updatedAt,
            deletedAt: result.server.deletedAt,
          },
        })
      }
    }

    const watermark = await readWatermark(client)
    const records = await pullRecords(client, userId, since, watermark)
    const response: SyncResponse & { rejected: number } = {
      cursor: new Date(watermark.getTime() - CURSOR_OVERLAP_MS).toISOString(),
      applied,
      conflicts,
      records,
      serverTime: new Date(watermark.getTime()).toISOString(),
      rejected,
    }
    return response
  })
}

export async function GET(request: Request) {
  const userId = await currentUserId()
  if (!userId) return Response.json({ error: 'Sesion no iniciada' }, { status: 401 })

  const url = new URL(request.url)
  const since = url.searchParams.get('since')
  const cursor = since && !Number.isNaN(Date.parse(since)) ? new Date(since).toISOString() : null

  try {
    return Response.json(await runSync(userId, cursor, []))
  } catch (error) {
    console.error('sync GET fallo:', error)
    return Response.json({ error: 'No se pudo sincronizar' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const userId = await currentUserId()
  if (!userId) return Response.json({ error: 'Sesion no iniciada' }, { status: 401 })

  let body: { since?: unknown; changes?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Solicitud invalida' }, { status: 400 })
  }

  const rawSince = typeof body.since === 'string' ? body.since : null
  const cursor = rawSince && !Number.isNaN(Date.parse(rawSince)) ? new Date(rawSince).toISOString() : null

  try {
    return Response.json(await runSync(userId, cursor, body.changes))
  } catch (error) {
    console.error('sync POST fallo:', error)
    return Response.json({ error: 'No se pudo sincronizar' }, { status: 500 })
  }
}
