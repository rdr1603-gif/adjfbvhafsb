import { query } from './db'

export type UserRow = {
  id: string
  email: string | null
  email_key: string | null
  name: string
  password_hash: string | null
  pin_key: string | null
  pin_hash: string | null
  created_at: Date
}

export type NewUser = {
  name: string
  pinKey: string
  pinHash: string
  /** Opcional. El acceso es por PIN; el correo solo queda como metadato. */
  email?: string
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  // El orden es obligatorio: si hay duplicados (bases viejas sin UNIQUE), rows[0]
  // sin "order by" puede ser cualquiera y el login valida contra la fila que no
  // es. Nos quedamos siempre con la cuenta mas antigua.
  const rows = await query<UserRow>(
    `select * from padelcoach.users where email_key = $1
      order by created_at, id limit 1`,
    [email.trim().toLowerCase()],
  )
  return rows[0] ?? null
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const rows = await query<UserRow>('select * from padelcoach.users where id = $1', [id])
  return rows[0] ?? null
}

/**
 * Busca por la clave derivada del PIN (HMAC). El indice unico parcial sobre
 * pin_key hace la busqueda O(1) sin exponer el PIN.
 */
export async function findUserByPinKey(pinKey: string): Promise<UserRow | null> {
  const rows = await query<UserRow>(
    `select * from padelcoach.users where pin_key = $1
      order by created_at, id limit 1`,
    [pinKey],
  )
  return rows[0] ?? null
}

/**
 * Devuelve null si el PIN ya estaba ocupado (carrera entre dos registros).
 * `on conflict do nothing` sin destino cubre tambien el indice parcial de
 * pin_key, que Postgres no puede usar para inferir el destino del conflicto.
 */
export async function createUser(input: NewUser): Promise<UserRow | null> {
  const email = input.email?.trim() || null
  const rows = await query<UserRow>(
    `insert into padelcoach.users (email, email_key, name, password_hash, pin_key, pin_hash)
     values ($1, $2, $3, null, $4, $5)
     on conflict do nothing
     returning *`,
    [email, email ? email.toLowerCase() : null, input.name.trim(), input.pinKey, input.pinHash],
  )
  return rows[0] ?? null
}

/**
 * Cambia el PIN de una cuenta. Devuelve false si el PIN ya lo tiene otra
 * cuenta (violacion del indice unico), para que el endpoint pueda avisar.
 */
export async function updateUserPin(
  userId: string,
  pinKey: string,
  pinHash: string,
): Promise<boolean> {
  try {
    await query(
      `update padelcoach.users set pin_key = $2, pin_hash = $3 where id = $1`,
      [userId, pinKey, pinHash],
    )
    return true
  } catch (error) {
    const detail = error as { code?: string }
    // 23505 = unique_violation
    if (detail?.code === '23505') return false
    throw error
  }
}

export async function ensureProfile(userId: string): Promise<void> {
  await query(
    `insert into padelcoach.records (user_id, collection, id, data)
     values ($1, 'settings', 'profile', '{}'::jsonb)
     on conflict (user_id, collection, id) do nothing`,
    [userId],
  )
}