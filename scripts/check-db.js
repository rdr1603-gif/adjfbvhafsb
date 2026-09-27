const { Client } = require('pg')

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Falta DATABASE_URL')
  const client = new Client({ connectionString: url })
  await client.connect()
  const info = await client.query('select version(), current_database(), current_user')
  console.log('conexion OK ->', info.rows[0].version.split(',')[0])
  console.log('db:', info.rows[0].current_database, '| user:', info.rows[0].current_user)
  const tables = await client.query(
    "select table_name from information_schema.tables where table_schema='public' order by 1",
  )
  console.log('tablas en public:', tables.rows.map((r) => r.table_name).join(', ') || '(ninguna)')
  await client.end()
}

main().catch((error) => {
  console.log('FALLO:', error.message)
  process.exit(1)
})
