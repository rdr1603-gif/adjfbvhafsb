/**
 * Verificacion de la app en ejecucion: rutas, HTML generado, proteccion de la
 * API sin sesion y flujo completo registro -> app -> crear alumno -> calendario
 * usando el motor de sincronizacion real contra el servidor real.
 */
const BASE = process.env.BASE_URL || 'http://localhost:3111'
const path = require('node:path')

let passed = 0
let failed = 0
const failures = []
function check(name, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${name}`)
  } else {
    failed += 1
    failures.push(`${name}${detail ? ` :: ${detail}` : ''}`)
    console.log(`  FAIL  ${name}${detail ? ` :: ${detail}` : ''}`)
  }
}

const makeStorage = () => {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  }
}
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true })
globalThis.window = { addEventListener() {}, removeEventListener() {} }
globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} }
const storage = makeStorage()
globalThis.localStorage = storage

const { SyncEngine } = require(path.join(__dirname, '..', '.tmp-test', 'sync-client.js'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  console.log('\n== 1. La app carga y muestra la pantalla de acceso ==')
  const loginPage = await fetch(`${BASE}/login`)
  const loginHtml = await loginPage.text()
  check('la pagina /login responde 200', loginPage.status === 200)
  check('el servidor no dibuja el formulario antes de verificar la sesion', loginHtml.includes('Verificando tu sesion'))
  check('no expone secretos de servidor en el HTML', !loginHtml.includes('postgres.') && !loginHtml.includes('SESSION_SECRET') && !loginHtml.includes('DATABASE_URL'))

  const home = await fetch(`${BASE}/`)
  check('la pagina principal responde 200', home.status === 200)
  const homeHtml = await home.text()
  check('la app no manda datos de la nube en el HTML inicial', !homeHtml.includes('padelpro-sync-v1'))
  check('la app verifica la sesion antes de mostrar datos', homeHtml.includes('Verificando'))

  console.log('\n== 2. Sin sesion, la API no entrega datos ==')
  for (const [method, pathUrl] of [['GET', '/api/sync'], ['POST', '/api/sync']]) {
    const res = await fetch(BASE + pathUrl, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'POST' ? JSON.stringify({ since: null, changes: [] }) : undefined,
    })
    check(`${method} /api/sync responde 401 sin cookie`, res.status === 401, `status=${res.status}`)
  }
  const meAnon = await fetch(`${BASE}/api/auth/me`)
  check('/api/auth/me responde 401 sin cookie', meAnon.status === 401)

  console.log('\n== 3. Cookie manipulada o firma invalida ==')
  const badCookie = await fetch(`${BASE}/api/sync`, { headers: { cookie: 'padelcoach_session=a.b' } })
  check('rechaza una cookie con firma invalida', badCookie.status === 401, `status=${badCookie.status}`)
  const noneCookie = await fetch(`${BASE}/api/sync`, { headers: { cookie: 'otra=1; padelcoach_session=' } })
  check('rechaza una cookie vacia', noneCookie.status === 401)
  const tampered = await (async () => {
    const reg = await fetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `tamper-${Date.now()}@padelcoach.test`, password: 'contrasena-larga-123', name: 'T' }),
    })
    const cookie = (reg.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ')
    const [, payload] = cookie.split('padelcoach_session=')
    const forged = Buffer.from(JSON.stringify({ sub: '00000000-0000-0000-0000-000000000000', exp: Date.now() + 99999 })).toString('base64url')
    const res = await fetch(`${BASE}/api/sync`, { headers: { cookie: `padelcoach_session=${forged}.${payload.split('.')[1]}` } })
    await fetch(`${BASE}/api/auth/logout`, { headers: { cookie } })
    return res.status
  })()
  check('rechaza un token con otro userId firmado', tampered === 401, `status=${tampered}`)

  console.log('\n== 4. Validacion en el servidor (no se confia en el cliente) ==')
  const email = `app-${Date.now()}@padelcoach.test`
  const jar = new Map()
  const jarFetch = async (url, init = {}) => {
    const headers = { ...(init.headers || {}) }
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
    const res = await fetch(BASE + url, { ...init, headers })
    for (const raw of res.headers.getSetCookie?.() || []) {
      const [pair] = raw.split(';')
      const i = pair.indexOf('=')
      if (!pair.slice(i + 1)) jar.delete(pair.slice(0, i))
      else jar.set(pair.slice(0, i), pair.slice(i + 1))
    }
    return res
  }
  const corta = await jarFetch('/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: '123', name: 'x' }),
  })
  check('rechaza contrasenas de menos de 8 caracteres', corta.status === 400)
  const mailMalo = await jarFetch('/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'no-es-correo', password: 'contrasena-larga-123' }),
  })
  check('rechaza correos invalidos', mailMalo.status === 400)
  const ok = await jarFetch('/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'contrasena-larga-123', name: 'Profe' }),
  })
  check('acepta una cuenta valida', ok.status === 200)
  const dup = await jarFetch('/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'contrasena-larga-123' }),
  })
  check('no permite dos cuentas con el mismo correo', dup.status === 409, `status=${dup.status}`)

  const colInvalida = await (await jarFetch('/api/sync', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ since: null, changes: [{ collection: 'usuarios', id: 'x', data: {} }] }),
  })).json()
  check('descarta colecciones no permitidas', colInvalida.rejected === 1, JSON.stringify(colInvalida))
  const sobre = await (await jarFetch('/api/sync', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ since: null, changes: [{ collection: 'students', id: 'z', data: { nota: 'x'.repeat(300000) } }] }),
  })).json()
  check('descarta registros demasiado grandes', sobre.rejected === 1, JSON.stringify(sobre.rejected))
  const perfilHack = await (await jarFetch('/api/sync', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ since: null, changes: [{ collection: 'settings', id: 'otro-perfil', data: {} }] }),
  })).json()
  check('no permite crear perfiles paralelos', perfilHack.rejected === 1)

  console.log('\n== 5. Flujo real: crear alumno y verlo en el calendario ==')
  const device = { userId: (await (await jarFetch('/api/auth/me')).json()).user.id, received: [] }
  const engine = new SyncEngine(device.userId, {
    applyRemote: (r) => device.received.push(...r),
    onUnauthorized: () => check('la sesion sigue viva', false),
    fetchImpl: (url, init) => jarFetch(url, init),
    storage,
  })
  engine.setDirtyEnabled(true)
  // El dispositivo arranca con el perfil por defecto, como una app nueva.
  const perfilNuevo = { name: '', club: 'Mi academia', phone: '', fontSize: 'normal', theme: 'actual' }
  await engine.migrate({ students: [], cycles: [], classes: [], recurrences: [], payments: [], profile: perfilNuevo })

  const alumno = { id: 'nuevo-1', name: 'Carla Ruiz', phone: '1133334444', level: 'Inicial', notes: '', trainingDays: 'Lunes, Jueves', trainingTime: '18:00', classesPerWeek: 1, classType: 'recurrente', amount: 80000, due: '2026-10-05', start: '2026-09-28', paymentDate: '2026-09-28', included: 8, active: true }
  const recurrente = { id: 'rec-1', studentId: 'nuevo-1', days: [1, 4], time: '18:00', duration: 60, court: 'Cancha 1', start: '2026-09-28', active: true }
  const mensualidad = { id: 'ciclo-1', studentId: 'nuevo-1', amount: 80000, included: 8, start: '2026-09-28', end: '2026-10-05', frequency: '1 clase por semana', received: 0, consumed: 0, absenceDeducts: false, cancellationDeducts: false, carryOver: false }
  engine.enqueueDiff('students', [], [alumno])
  engine.enqueueDiff('recurrences', [], [recurrente])
  engine.enqueueDiff('cycles', [], [mensualidad])
  for (let i = 0; i < 12; i += 1) {
    await engine.run()
    await sleep(90)
    if (engine.getState().pending === 0) break
  }
  check('el alumno, su mensualidad y su clase recurrente se suben', engine.getState().pending === 0, engine.getState().message || '')

  // Replicar exactamente lo que hace la app para pintar el calendario.
  const pulled = JSON.parse(storage.getItem('padelpro-sync-v1') || '{}')
  check('la cola local quedo vacia', Object.keys(pulled.users?.[device.userId]?.pending || {}).length === 0)

  const enNube = await (await jarFetch('/api/sync?since=' + encodeURIComponent(new Date(0).toISOString()))).json()
  const nombres = enNube.records.filter((r) => !r.deletedAt).map((r) => `${r.collection}:${r.id}`)
  check('el alumno esta en la nube', nombres.includes('students:nuevo-1'))
  check('la mensualidad esta en la nube', nombres.includes('cycles:ciclo-1'))
  check('la recurrencia esta en la nube', nombres.includes('recurrences:rec-1'))
  const rec = enNube.records.find((r) => r.id === 'rec-1')
  check('la recurrencia guarda los dias de la clase', JSON.stringify(rec?.data?.days) === '[1,4]', JSON.stringify(rec?.data?.days))

  console.log('\n== 6. El calendario se construye con la clase del alumno ==')
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const hoy = new Date('2026-09-28T12:00:00')
  const semana = Array.from({ length: 7 }, (_, i) => iso(addDays(hoy, i)))
  const generadas = semana.filter((d) => rec.data.days.includes(new Date(`${d}T12:00:00`).getDay() || 7) && d >= rec.data.start)
  check('la semana genera las clases del alumno', generadas.length === 2, generadas.join(','))

  // limpieza
  const { Client } = require('pg')
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  await client.query("delete from padelcoach.users where email_key like 'app-%' or email_key like 'tamper-%' or email_key like 'sync-test-%' or email_key like 'sync-otro-%' or email_key like 'engine-test-%' or email_key like 'engine-otro-%' or email_key like 'dbg-%'")
  const quedan = await client.query('select count(*)::int as n from padelcoach.users')
  await client.end()
  console.log(`  (usuarios de prueba restantes en la base: ${quedan.rows[0].n})`)

  console.log(`\n================  ${passed} pruebas OK / ${failed} fallos  ================`)
  if (failures.length) {
    console.log('Fallos:')
    failures.forEach((f) => console.log(' - ' + f))
    process.exit(1)
  }
}

main().catch((e) => { console.error('ERROR:', e); process.exit(1) })
