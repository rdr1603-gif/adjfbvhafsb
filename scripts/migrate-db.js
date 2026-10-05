const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { Client } = require('pg')

require('./load-env').loadEnv()

/**
 * Claves repetidas que bloquean los indices unicos.
 *
 * Importante: sin el "is not null", los NULL de una misma columna se agrupan
 * juntos y dos cuentas sin correo se reportan como duplicadas. Desde que el
 * acceso es por PIN, casi todas las cuentas nuevas tienen email_key NULL.
 */
async function findDuplicates(client) {
  const dup = async (columna) => {
    const { rows } = await client.query(
      `select ${columna} as clave, count(*)::int as cuentas,
              array_agg(id::text order by created_at, id) as ids,
              array_agg(created_at::text order by created_at, id) as creadas
         from padelcoach.users
        where ${columna} is not null
        group by ${columna}
       having count(*) > 1
        order by 1`,
    )
    return rows.map((r) => ({ columna, ...r }))
  }
  return [...(await dup('email_key')), ...(await dup('pin_key'))]
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Falta la variable de entorno DATABASE_URL')
  const sql = readFileSync(join(__dirname, '..', 'db', 'schema.sql'), 'utf8')
  const client = new Client({ connectionString: url })
  await client.connect()

  const dups = await findDuplicates(client)
  if (dups.length) {
    console.error('Claves duplicadas detectadas:')
    for (const d of dups) {
      console.error(`  ${d.columna} = ${d.clave} -> ${d.cuentas} cuentas`)
      d.ids.forEach((id, i) => console.error(`      ${id}  ${d.creadas[i]}`))
    }
    console.error('')
    console.error('No se pueden aplicar los indices unicos hasta resolverlo.')
    console.error('Para conservar la mas antigua y borrar el resto, corre en el')
    console.error('editor SQL de Supabase el bloque "resolver duplicados" que te')
    console.error('pase por chat, y despues reintenta la migracion.')
    await client.end()
    process.exit(1)
  }

  await client.query(sql)

  const tablas = await client.query(
    `select table_name from information_schema.tables
     where table_schema = 'padelcoach' order by table_name`,
  )
  const columnas = await client.query(
    `select column_name, data_type from information_schema.columns
     where table_schema = 'padelcoach' and table_name = 'records' order by ordinal_position`,
  )
  const uniques = await client.query(
    `select conrelid::regclass::text as tabla, conname
       from pg_constraint
      where connamespace = 'padelcoach'::regnamespace and contype in ('u', 'p')
      order by 1, 2`,
  )
  console.log('migracion OK')
  console.log('tablas:', tablas.rows.map((r) => r.table_name).join(', '))
  console.log('records:', columnas.rows.map((r) => `${r.column_name}:${r.data_type}`).join(', '))
  console.log('claves unicas y primarias:', uniques.rows.map((r) => `${r.tabla}.${r.conname}`).join(', '))
  await client.end()
}

main().catch((error) => {
  console.error('FALLO:', error.message)
  process.exit(1)
})
