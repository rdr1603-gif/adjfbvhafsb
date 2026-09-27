const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { Client } = require('pg')

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Falta la variable de entorno DATABASE_URL')
  const sql = readFileSync(join(__dirname, '..', 'db', 'schema.sql'), 'utf8')
  const client = new Client({ connectionString: url })
  await client.connect()
  await client.query(sql)

  const tables = await client.query(
    `select table_name from information_schema.tables
     where table_schema = 'padelcoach' order by table_name`,
  )
  const columns = await client.query(
    `select column_name, data_type from information_schema.columns
     where table_schema = 'padelcoach' and table_name = 'records' order by ordinal_position`,
  )
  console.log('migracion OK')
  console.log('tablas:', tables.rows.map((r) => r.table_name).join(', '))
  console.log('records:', columns.rows.map((r) => `${r.column_name}:${r.data_type}`).join(', '))
  await client.end()
}

main().catch((error) => {
  console.error('FALLO:', error.message)
  process.exit(1)
})
