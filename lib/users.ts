import { query } from './db'

export type UserRow = {
  id: string
  email: string
  email_key: string
  name: string
  password_hash: string
  created_at: Date
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const rows = await query<UserRow>('select * from padelcoach.users where email_key = $1', [
    email.trim().toLowerCase(),
  ])
  return rows[0] ?? null
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const rows = await query<UserRow>('select * from padelcoach.users where id = $1', [id])
  return rows[0] ?? null
}

export async function createUser(email: string, name: string, passwordHash: string): Promise<UserRow> {
  const rows = await query<UserRow>(
    `insert into padelcoach.users (email, email_key, name, password_hash)
     values ($1, $2, $3, $4)
     returning *`,
    [email.trim(), email.trim().toLowerCase(), name.trim(), passwordHash],
  )
  return rows[0]
}

export async function ensureProfile(userId: string): Promise<void> {
  await query(
    `insert into padelcoach.records (user_id, collection, id, data)
     values ($1, 'settings', 'profile', '{}'::jsonb)
     on conflict (user_id, collection, id) do nothing`,
    [userId],
  )
}
