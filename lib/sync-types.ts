export const SYNC_COLLECTIONS = [
  'students',
  'cycles',
  'classes',
  'recurrences',
  'payments',
  'settings',
] as const

export type SyncCollection = (typeof SYNC_COLLECTIONS)[number]

export const SETTINGS_PROFILE_ID = 'profile'

export type SyncRecord = {
  collection: SyncCollection
  id: string
  data: unknown
  updatedAt: string
  deletedAt: string | null
}

export type SyncChange = {
  collection: SyncCollection
  id: string
  data: unknown
  deletedAt: string | null
  /** Version que el cliente tenia cuando edito. null = nunca vio la version del servidor. */
  baseUpdatedAt: string | null
}

export type SyncApplied = { key: string; updatedAt: string }

export type SyncConflict = {
  collection: SyncCollection
  id: string
  key: string
  local: unknown
  baseUpdatedAt: string | null
  server: { data: unknown; updatedAt: string; deletedAt: string | null }
}

export type SyncResponse = {
  cursor: string
  applied: SyncApplied[]
  conflicts: SyncConflict[]
  records: SyncRecord[]
  serverTime: string
  /** Cambios recibidos que el servidor descarto por no ser validos. */
  rejected: number
}

export function recordKey(collection: string, id: string): string {
  return `${collection}:${id}`
}

export function isSyncCollection(value: unknown): value is SyncCollection {
  return typeof value === 'string' && (SYNC_COLLECTIONS as readonly string[]).includes(value)
}
