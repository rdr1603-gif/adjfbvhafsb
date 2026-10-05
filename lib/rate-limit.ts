import { query } from './db'

type Bucket = { count: number; resetAt: number }

const globalRef = globalThis as unknown as { __padelcoachRate?: Map<string, Bucket> }
const globalCalls = globalThis as unknown as { __padelcoachRateCalls?: number }

/** Cuantos intentos se cuentan entre una limpieza y otra. */
const CLEANUP_EVERY = 500

function memory(): Map<string, Bucket> {
  if (!globalRef.__padelcoachRate) globalRef.__padelcoachRate = new Map()
  return globalRef.__padelcoachRate
}

/**
 * Contador en memoria. Solo se usa si la base no responde: en Vercel cada
 * instancia tiene la suya, asi que sirve para frenar rafagas contra una misma
 * instancia, nunca como limite real.
 */
function localAttempt(key: string, windowMs: number): number {
  const now = Date.now()
  const store = memory()
  const bucket = store.get(key)
  if (!bucket || bucket.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    purgeExpired()
    return 1
  }
  bucket.count += 1
  return bucket.count
}

/** Purga las claves vencidas para que el mapa no crezca sin limite. */
function purgeExpired(): void {
  const now = Date.now()
  const store = memory()
  if (store.size <= 5000) return
  for (const [key, bucket] of store) if (bucket.resetAt <= now) store.delete(key)
}

async function purgePersisted(): Promise<void> {
  const calls = (globalCalls.__padelcoachRateCalls = (globalCalls.__padelcoachRateCalls ?? 0) + 1)
  if (calls % CLEANUP_EVERY !== 0) return
  await query('delete from padelcoach.login_attempts where reset_at <= now()')
}

/**
 * Limita intentos por clave (accion + correo) para frenar fuerza bruta.
 * El contador vive en la base porque en serverless la memoria no se comparte.
 * Si la base no responde se degrada al contador local en vez de bloquear a todos.
 */
export async function tooManyAttempts(key: string, limit: number, windowMs: number): Promise<boolean> {
  try {
    const rows = await query<{ hits: number }>(
      `insert into padelcoach.login_attempts as t (bucket, hits, reset_at)
            values ($1, 1, now() + ($2::double precision * interval '1 millisecond'))
       on conflict (bucket) do update
              set hits = case
                           when t.reset_at <= now() then 1
                           else t.hits + 1
                         end,
                  reset_at = case
                               when t.reset_at <= now()
                                 then now() + ($2::double precision * interval '1 millisecond')
                               else t.reset_at
                             end
         returning t.hits`,
      [key, windowMs],
    )
    purgePersisted().catch(() => undefined)
    return Number(rows[0]?.hits ?? 1) > limit
  } catch (error) {
    const detail = error as { code?: string; message?: string }
    const faltaMigracion = detail?.code === '42P01'
    console.error(
      faltaMigracion
        ? 'rate-limit: falta la tabla padelcoach.login_attempts. Ejecuta "pnpm db:migrate". ' +
            'Mientras tanto el limite por intento no es efectivo.'
        : `rate-limit: la base no respondio (${detail?.message}), se usa el limite local`,
      error,
    )
    return localAttempt(key, windowMs) > limit
  }
}

/** Un intento correcto borra el contador de esa clave. */
export async function clearAttempts(key: string): Promise<void> {
  memory().delete(key)
  try {
    await query('delete from padelcoach.login_attempts where bucket = $1', [key])
  } catch (error) {
    console.error('rate-limit: no se pudo limpiar el contador', error)
  }
}

/**
 * Identifica al cliente por IP para poder limitar los intentos por origen.
 * Con PIN corto, limitar solo por PIN no sirve: cada intento probado cae en un
 * cubo distinto y el contador nunca llega al tope. Sin esto, 4 digitos son
 * adivinables en minutos.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const ip = (forwarded ? forwarded.split(',')[0] : request.headers.get('x-real-ip'))?.trim()
  return ip || 'desconocido'
}