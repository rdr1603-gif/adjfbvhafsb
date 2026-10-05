/**
 * Verificacion de la app en ejecucion: rutas, HTML generado, proteccion de la
 * API sin sesion y flujo completo registro -> app -> crear alumno -> calendario
 * usando el motor de sincronizacion real contra el servidor real.
 */
const BASE = process.env.BASE_URL || 'http://localhost:3111'
const path = require('node:path')
const { cleanupTestUsers } = require('./cleanup-test-users')

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

  // La app solo tiene tema claro. Si el layout declara "light dark", el
  // navegador oscurece los campos en las tablets en modo oscuro y el texto
  // queda blanco sobre el fondo blanco de los inputs.
  const colorSchemeMeta =
    (loginHtml.match(/<meta[^>]*name="color-scheme"[^>]*>/i) || [''])[0]
  check(
    'el layout declara color-scheme light (no light dark)',
    /content="light"/i.test(colorSchemeMeta) && !/light\s+dark/i.test(colorSchemeMeta),
    `meta encontrada: ${colorSchemeMeta || 'ninguna'}`,
  )

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
      body: JSON.stringify({ email: `tamper-${Date.now()}@padelcoach.test`, pin: String(Date.now()).slice(-8), name: 'T' }),
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
  // PIN de 8 digitos derivado del reloj: dos corridas no chocan entre si.
  const pin = String(Date.now()).slice(-8)
  const pinCorto = '123'
  const pinLargo = '123456789'
  const pinLibre = String((Number(pin) + 7) % 100000000).padStart(8, '0')
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
    body: JSON.stringify({ email, pin: pinCorto, name: 'x' }),
  })
  check('rechaza PIN de menos de 4 digitos', corta.status === 400, `status=${corta.status}`)
  const largo = await jarFetch('/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, pin: pinLargo, name: 'x' }),
  })
  check('rechaza PIN de mas de 8 digitos', largo.status === 400, `status=${largo.status}`)
  const mailMalo = await jarFetch('/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'no-es-correo', pin: pinLibre }),
  })
  check('rechaza correos invalidos', mailMalo.status === 400, `status=${mailMalo.status}`)
  const ok = await jarFetch('/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, pin, name: 'Profe' }),
  })
  check('acepta una cuenta valida', ok.status === 200, `status=${ok.status}`)
  const dup = await jarFetch('/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `otro-${Date.now()}@padelcoach.test`, pin }),
  })
  check('no permite dos cuentas con el mismo PIN', dup.status === 409, `status=${dup.status}`)
  const malPin = await jarFetch('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin: pinLibre }),
  })
  check('rechaza un PIN incorrecto', malPin.status === 401, `status=${malPin.status}`)
  const cambia = await jarFetch('/api/auth/pin', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin, nuevo: pinLibre }),
  })
  check('cambia el PIN con la sesion activa', cambia.status === 200, `status=${cambia.status}`)
  const pinViejo = await jarFetch('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin }),
  })
  check('el PIN viejo deja de servir', pinViejo.status === 401, `status=${pinViejo.status}`)

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

  // Las clases ahora son registros reales (requisito 2), no se arman al
  // renderizar. Esta seccion prueba que viajan a la nube con todos sus campos y
  // que un segundo dispositivo las recibe igual, sin duplicar.
  console.log('\n== 7. Las clases materializadas viajan a la nube y vuelven intactas ==')
  const base = '2026-10-06'
  const clasesReales = [
    {
      id: `rec-1::${base}`, studentId: 'nuevo-1', student: 'Carla Ruiz', date: base,
      time: '18:00', court: 'Cancha 1', duration: 60, type: 'recurrente', status: 'Realizada',
      recurrenceId: 'rec-1', cycleId: 'ciclo-1', completedAt: base, note: 'llego tarde',
    },
    {
      id: `rec-1::${iso(addDays(hoy, 2))}`, studentId: 'nuevo-1', student: 'Carla Ruiz',
      date: iso(addDays(hoy, 2)), time: '18:00', court: 'Cancha 1', duration: 60,
      type: 'recurrente', status: 'Recuperada', recurrenceId: undefined, cycleId: 'ciclo-1',
      completedAt: base, note: 'repuso la del 06', recoveredFrom: `rec-1::${base}`,
    },
  ]
  engine.enqueueDiff('classes', [], clasesReales)
  for (let i = 0; i < 12; i += 1) {
    await engine.run()
    await sleep(90)
    if (engine.getState().pending === 0) break
  }
  check('las clases reales se suben a la nube', engine.getState().pending === 0, engine.getState().message || '')

  const conClases = await (await jarFetch('/api/sync?since=' + encodeURIComponent(new Date(0).toISOString()))).json()
  const enApi = conClases.records.filter((r) => r.collection === 'classes' && !r.deletedAt)
  check('la nube guarda las dos clases', enApi.length === 2, enApi.map((r) => r.id).join(','))
  const realizada = enApi.find((r) => r.id === clasesReales[0].id)
  const recuperada = enApi.find((r) => r.id === clasesReales[1].id)
  check('el estado Realizada sobrevive', realizada?.data?.status === 'Realizada')
  check('la nota sobrevive', realizada?.data?.note === 'llego tarde')
  check('el vinculo con la mensualidad sobrevive', realizada?.data?.cycleId === 'ciclo-1')
  check('el estado Recuperada sobrevive', recuperada?.data?.status === 'Recuperada')
  check('el vinculo de recuperacion sobrevive', recuperada?.data?.recoveredFrom === clasesReales[0].id)
  check('una clase recuperada no queda atada a la regla', recuperada?.data?.recurrenceId === undefined || recuperada?.data?.recurrenceId === null)

  // Segundo dispositivo: mismo id, mismos datos, sin duplicados.
  const recibidas2 = []
  const otro = new SyncEngine(device.userId, {
    applyRemote: (records) => recibidas2.push(...records),
    onUnauthorized: () => check('la sesion sigue viva', false),
    fetchImpl: (url, init) => jarFetch(url, init),
    storage: makeStorage(),
  })
  otro.setDirtyEnabled(true)
  await otro.migrate({ students: [], cycles: [], classes: [], recurrences: [], payments: [], profile: { name: '', club: '', phone: '', fontSize: 'normal', theme: 'actual' } })
  for (let i = 0; i < 8; i += 1) {
    await otro.run()
    await sleep(90)
    if (otro.getState().pending === 0) break
  }
  // El motor no cachea los datos: los entrega por applyRemote.
  const recibidas = recibidas2.filter((r) => r.collection === 'classes' && !r.deletedAt)
  check('el segundo dispositivo recibe las clases', recibidas.length === 2, recibidas.map((c) => c.id).join(','))
  check('los ids llegan iguales', recibidas.map((c) => String(c.id)).sort().join(',') === clasesReales.map((c) => c.id).sort().join(','))
  check('la recuperacion llega completa en el otro dispositivo', recibidas.find((c) => String(c.id) === clasesReales[1].id)?.data?.status === 'Recuperada')
  check('el vinculo de recuperacion tambien llega', recibidas.find((c) => String(c.id) === clasesReales[1].id)?.data?.recoveredFrom === clasesReales[0].id)

  // Un componente con parametro simple recibe el objeto de props, no el valor.
  // Si el cuerpo lo usa como si fuera el valor, revienta en runtime y
  // TypeScript no lo ve porque todo va con `any`. Asi se cazo el fallo de
  // "Alumnos": Habit leia r.s sobre {r: fila} y reventaba al abrir la pantalla.
  console.log('\n== props de componentes ==')
  const fs = require('node:fs')
  const buff = []
  const recorrer = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) recorrer(p)
      else if (e.name.endsWith('.tsx')) buff.push(p)
    }
  }
  recorrer(path.join(__dirname, '..', 'app'))
  check('hay pantallas tsx que auditar', buff.length > 0)

  const descuadres = []
  for (const archivo of buff) {
    const src = fs.readFileSync(archivo, 'utf8')
    for (const m of src.matchAll(/const\s+([A-Z]\w*)\s*=\s*\(([^)]*)\)\s*=>/g)) {
      const params = m[2].trim()
      if (!params || params.startsWith('{') || params.startsWith('...')) continue
      const param = params.replace(/:.*$/, '').trim()
      const usos = [...src.matchAll(new RegExp(`<${m[1]}\\s([^>]*?)/?>`, 'g'))].map((u) => u[1])
      if (!usos.length) continue
      const props = new Set()
      for (const u of usos) for (const p of u.matchAll(/(?:^|\s)([A-Za-z_]\w*)\s*=/g)) props.add(p[1])
      const cuerpo = src.slice(m.index, m.index + 1500)
      const leidas = [...new Set([...cuerpo.matchAll(new RegExp(`\\b${param}\\.(\\w+)`, 'g'))].map((x) => x[1]))]
      const malas = leidas.filter((x) => !props.has(x))
      if (malas.length) {
        descuadres.push(`${path.basename(archivo)}: <${m[1]}> (${param}) lee ${param}.${malas.join(`, ${param}.`)} pero recibe {${[...props].join(', ')}}`)
      }
    }
  }
  check('ningun componente confunde el parametro con el valor del prop', descuadres.length === 0, descuadres.join(' | '))

  // limpieza
  await cleanupTestUsers(
    [],
    "email_key like 'app-%' or email_key like 'tamper-%' or email_key like 'sync-test-%' or email_key like 'sync-otro-%' or email_key like 'engine-test-%' or email_key like 'engine-otro-%' or email_key like 'dbg-%' or email_key like 'audit-%' or email_key like 'fuga-%'",
  )

  console.log(`\n================  ${passed} pruebas OK / ${failed} fallos  ================`)
  if (failures.length) {
    console.log('Fallos:')
    failures.forEach((f) => console.log(' - ' + f))
    process.exit(1)
  }
}

main().catch((e) => { console.error('ERROR:', e); process.exit(1) })
