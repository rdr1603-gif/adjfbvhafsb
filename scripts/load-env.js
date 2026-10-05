/**
 * Carga .env.local / .env para los scripts de node.
 *
 * Los scripts se lanzan con npm run, que no carga el .env, y antes de esto
 * faltaba DATABASE_URL: la migracion se caia y la limpieza de usuarios de
 * prueba se saltaba en silencio. Las variables ya presentes en el entorno
 * (Vercel, CI, docker) mandan sobre el archivo.
 */
const fs = require('node:fs')
const path = require('node:path')

function loadEnv(root = path.join(__dirname, '..')) {
  for (const name of ['.env.local', '.env']) {
    const file = path.join(root, name)
    if (!fs.existsSync(file)) continue
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
      if (!match || line.trimStart().startsWith('#')) continue
      const value = match[2].trim().replace(/^["']|["']$/g, '')
      if (!process.env[match[1]]) process.env[match[1]] = value
    }
  }
  return process.env
}

module.exports = { loadEnv }