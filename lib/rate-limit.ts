type Bucket = { count: number; resetAt: number }

const globalRef = globalThis as unknown as { __padelcoachRate?: Map<string, Bucket> }

function store(): Map<string, Bucket> {
  if (!globalRef.__padelcoachRate) globalRef.__padelcoachRate = new Map()
  return globalRef.__padelcoachRate
}

/** Limita intentos por clave (email + accion) para frenar fuerza bruta. */
export function tooManyAttempts(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const map = store()
  const bucket = map.get(key)
  if (!bucket || bucket.resetAt <= now) {
    map.set(key, { count: 1, resetAt: now + windowMs })
    if (map.size > 5000) {
      for (const [k, v] of map) if (v.resetAt <= now) map.delete(k)
    }
    return false
  }
  bucket.count += 1
  return bucket.count > limit
}

export function clearAttempts(key: string): void {
  store().delete(key)
}
