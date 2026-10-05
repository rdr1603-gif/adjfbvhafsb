/**
 * Helper de limpieza para las pruebas de integracion.
 * Las pruebas hablan con la API por HTTP, asi que no necesitan la base para
 * nada salvo para borrar las cuentas que crearon. Si la base no esta accesible
 * desde donde se corren, avisa con el SQL exacto en vez de tumbar la suite.
 */
const { Client } = require('pg')
const { loadEnv } = require('./load-env')

function warnCleanup(extra) {
  console.warn(
    '\n[limpieza] No se pudo borrar automaticamente. Ejecuta en Supabase:' +
      `\n  delete from padelcoach.users where ${extra};\n` +
      '  delete from padelcoach.login_attempts;\n',
  )
}

/** emails: correos creados por la prueba. extra: predicado SQL adicional (string). */
async function cleanupTestUsers(emails, extra) {
  loadEnv()
  const list = (emails || []).filter(Boolean)
  const clauses = []
  if (list.length) clauses.push(`email_key = any(array[${list.map((e) => `'${e}'`).join(',')}])`)
  if (extra) clauses.push(`(${extra})`)
  if (!clauses.length) return
  const where = clauses.join(' or ')

  const url = process.env.DATABASE_URL
  if (!url) {
    console.warn('[limpieza] falta DATABASE_URL')
    return warnCleanup(where)
  }
  try {
    const client = new Client({ connectionString: url })
    await client.connect()
    await client.query(`delete from padelcoach.users where ${where}`)
    // Los contadores de login_attempts viven en la base y no se van solos con
    // la cuenta: sin esta linea, el limite por IP se acumula entre corridas y
    // la suite empieza a fallar con 429 aunque el codigo este bien.
    await client.query(`delete from padelcoach.login_attempts`)
    await client.end()
  } catch (error) {
    console.warn(`[limpieza] fallo: ${error.message}`)
    warnCleanup(where)
  }
}

module.exports = { cleanupTestUsers }