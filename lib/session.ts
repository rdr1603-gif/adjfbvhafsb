import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'

export const SESSION_COOKIE = 'padelcoach_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 60
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: SESSION_TTL_SECONDS,
} as const

function secret(): string {
  const value = process.env.SESSION_SECRET
  if (!value) throw new Error('Falta la variable de entorno SESSION_SECRET')
  return value
}

export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString('hex')
  const derived = scryptSync(plain, salt, 64).toString('hex')
  return `scrypt$${salt}$${derived}`
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [scheme, salt, derived] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !derived) return false
  const candidate = scryptSync(plain, salt, 64)
  const expected = Buffer.from(derived, 'hex')
  if (candidate.length !== expected.length) return false
  return timingSafeEqual(candidate, expected)
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

export function createSessionToken(userId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: userId, exp: Date.now() + SESSION_TTL_SECONDS * 1000 }),
  ).toString('base64url')
  return `${payload}.${sign(payload)}`
}

export function readSessionToken(token?: string | null): string | null {
  if (!token) return null
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null
  let expected: string
  try {
    expected = sign(payload)
  } catch {
    return null
  }
  const given = Buffer.from(signature)
  const reference = Buffer.from(expected)
  if (given.length !== reference.length || !timingSafeEqual(given, reference)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sub?: string
      exp?: number
    }
    if (!data.sub || typeof data.exp !== 'number' || data.exp < Date.now()) return null
    return data.sub
  } catch {
    return null
  }
}

export async function currentUserId(): Promise<string | null> {
  const store = await cookies()
  return readSessionToken(store.get(SESSION_COOKIE)?.value)
}

export async function startSession(userId: string): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, createSessionToken(userId), COOKIE_OPTIONS)
}

export async function endSession(): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, '', { ...COOKIE_OPTIONS, maxAge: 0 })
}
