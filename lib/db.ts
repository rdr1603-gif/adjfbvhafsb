import { Pool } from 'pg'

const globalRef = globalThis as unknown as { __padelcoachPool?: Pool }

export function getPool(): Pool {
  if (!globalRef.__padelcoachPool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error('Falta la variable de entorno DATABASE_URL')
    globalRef.__padelcoachPool = new Pool({
      connectionString,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
    })
  }
  return globalRef.__padelcoachPool
}

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query(text, values)
  return result.rows as T[]
}

export async function withTransaction<T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('begin')
    const value = await fn(client)
    await client.query('commit')
    return value
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}
