/**
 * Prueba de integracion del motor de sincronizacion del cliente contra la API y
 * la base reales. Compila lib/sync-client.ts y lo ejercita con dos dispositivos
 * simulados (almacenamiento local independiente) mas un tercero.
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

// --- stubs de navegador -----------------------------------------------------
function makeStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    get length() {
      return map.size
    },
    key: (i) => [...map.keys()][i] ?? null,
  }
}

const listeners = { window: new Set(), document: new Set() }
globalThis.localStorage = makeStorage()
// navigator es un global de solo lectura en Node: hay que redefinirlo.
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true },
  configurable: true,
  writable: true,
})
globalThis.window = {
  addEventListener: (t, f) => t !== 'offline' && listeners.window.add(f),
  removeEventListener: (t, f) => listeners.window.delete(f),
}
globalThis.document = {
  hidden: false,
  addEventListener: (t, f) => listeners.document.add(f),
  removeEventListener: (t, f) => listeners.document.delete(f),
}

const { SyncEngine } = require(path.join(__dirname, '..', '.tmp-test', 'sync-client.js'))

function makeDevice(label) {
  const jar = new Map()
  const realFetch = globalThis.fetch
  const device = {
    label,
    engine: null,
    received: [],
    async api(method, url, body) {
      const headers = { 'content-type': 'application/json' }
      if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
      const response = await realFetch(BASE + url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      for (const raw of response.headers.getSetCookie?.() || []) {
        const [pair] = raw.split(';')
        const i = pair.indexOf('=')
        if (!pair.slice(i + 1)) jar.delete(pair.slice(0, i))
        else jar.set(pair.slice(0, i), pair.slice(i + 1))
      }
      return { status: response.status, body: await response.json().catch(() => ({})) }
    },
    /** fetch que usa el motor: incluye la cookie de sesion del dispositivo. */
    clientFetch(url, init = {}) {
      const headers = { ...(init.headers || {}) }
      if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
      return realFetch(BASE + url, { ...init, headers })
    },
    newEngine() {
      this.engine = new SyncEngine(device.userId, {
        // Replica app/page.tsx: al aplicar datos remotos se suspende la
        // deteccion de cambios locales y se reactiva al terminar. Si este
        // simulador no lo hiciera, no detectaria la regresion que motivo esto.
        applyRemote: (records) => {
          const resume = device.engine.suspendDirty()
          try {
            device.received.push(...records)
          } finally {
            resume()
          }
        },
        onUnauthorized: () => check(`${label}: la API no pide re-login`, false),
        fetchImpl: (url, init) => device.clientFetch(url, init),
        // Cada dispositivo tiene su propio almacenamiento local.
        storage: device.storage,
      })
      return this.engine
    },
  }
  device.storage = makeStorage()
  return device
}

const ids = (records) => new Set(records.map((r) => `${r.collection}:${r.id}`))
const live = (records) => records.filter((r) => !r.deletedAt)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Espera a que el motor termine de trabajar de verdad. */
async function settle(device, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    await device.engine.run()
    await sleep(80)
    if (device.engine.getState().pending === 0 && i >= 1) return
  }
}

/** Migra y espera a que la cola quede vacia. */
async function boot(device, data) {
  // Igual que app/page.tsx: la deteccion de cambios locales se activa una vez,
  // despues de cargar los datos guardados y antes de migrar.
  device.engine.setDirtyEnabled(true)
  await device.engine.migrate(data)
  await settle(device)
}

async function main() {
  const email = `engine-test-${Date.now()}@padelcoach.test`
  const pin = String(Date.now()).slice(-8)
  const otroPin = String((Number(pin) + 5) % 100000000).padStart(8, '0')

  const pc = makeDevice('PC')
  const movil = makeDevice('Movil')
  const tablet = makeDevice('Tablet')

  const registered = await pc.api('POST', '/api/auth/register', { email, pin, name: 'Probe' })
  check('cuenta creada', registered.status === 200, JSON.stringify(registered.body))
  const userId = registered.body.user.id
  pc.userId = movil.userId = tablet.userId = userId

  // Cada dispositivo entra por su cuenta con su propia sesion.
  for (const device of [movil, tablet]) {
    const login = await device.api('POST', '/api/auth/login', { pin })
    check(`${device.label} inicia sesion en su propio dispositivo`, login.status === 200, JSON.stringify(login.body))
  }
  check('navigator queda online', globalThis.navigator.onLine === true)

  console.log('\n== 1. Migracion: el celular sube los datos que ya tenia ==')
  pc.newEngine()
  const localData = {
    students: [
      { id: 'a-1', name: 'Ana', phone: '111', level: 'Inicial', amount: 100, due: '2026-10-01', active: true },
      { id: 'a-2', name: 'Beto', phone: '222', level: 'Inicial', amount: 100, due: '2026-10-01', active: true },
    ],
    cycles: [{ id: 'c-1', studentId: 'a-1', amount: 100, included: 8, start: '2026-09-01', end: '2026-09-30', frequency: '1', received: 0, consumed: 0 }],
    classes: [{ id: 'k-1', studentId: 'a-1', student: 'Ana', date: '2026-09-15', time: '18:00', court: 'Cancha 1', type: 'recurrente', status: 'Programada' }],
    recurrences: [{ id: 'r-1', studentId: 'a-1', days: [2], time: '18:00', start: '2026-09-01', active: true }],
    payments: [{ id: 'p-1', studentId: 'a-1', amount: 100, date: '2026-09-01', concept: 'Mensualidad' }],
    profile: { name: 'Profe', club: 'Club Norte', fontSize: 'normal', theme: 'actual' },
  }
  await boot(pc, localData)
  const enNube = await pc.api('GET', '/api/sync?since=' + encodeURIComponent(new Date(0).toISOString()))
  check('los 2 alumnos estan en la nube', ids(live(enNube.body.records)).has('students:a-1') && ids(live(enNube.body.records)).has('students:a-2'))
  check('la mensualidad esta en la nube', ids(live(enNube.body.records)).has('cycles:c-1'))
  check('la clase esta en la nube', ids(live(enNube.body.records)).has('classes:k-1'))
  check('la recurrencia esta en la nube', ids(live(enNube.body.records)).has('recurrences:r-1'))
  check('el pago esta en la nube', ids(live(enNube.body.records)).has('payments:p-1'))
  const perfil = enNube.body.records.find((r) => r.collection === 'settings')
  check('el perfil subio con el nombre del profesor', perfil?.data?.name === 'Profe', JSON.stringify(perfil?.data))
  check('no quedan cambios pendientes', pc.engine.getState().pending === 0)
  check('el estado queda al dia', pc.engine.getState().status === 'al-dia', pc.engine.getState().status)

  console.log('\n== 2. La tablet nueva descarga todo sin duplicar ==')
  tablet.newEngine()
  await boot(tablet, {
    students: [], cycles: [], classes: [], recurrences: [], payments: [],
    profile: { name: '', club: 'Mi academia', phone: '', fontSize: 'normal', theme: 'actual' },
  })
  const bajados = tablet.received.filter((r) => !r.deletedAt)
  check('la tablet recibio los 2 alumnos', ['students:a-1', 'students:a-2'].every((k) => ids(bajados).has(k)), [...ids(bajados)].join(','))
  check('la tablet recibio la clase y el pago', ids(bajados).has('classes:k-1') && ids(bajados).has('payments:p-1'))
  check('la tablet recibio el perfil del profesor', live(tablet.received).some((r) => r.collection === 'settings' && r.data?.name === 'Profe'), JSON.stringify(live(tablet.received).filter((r) => r.collection === 'settings').map((r) => r.data)))
  check('un celular nuevo NO pisa el perfil real del profesor', live(tablet.received).filter((r) => r.collection === 'settings').length === 1)
  check('no se generaron pendientes en la tablet', tablet.engine.getState().pending === 0)
  const trasMigracion = await pc.api('GET', '/api/sync?since=' + encodeURIComponent(new Date(0).toISOString()))
  check('la nube no duplico ningun registro', live(trasMigracion.body.records).length === live(enNube.body.records).length, `antes=${live(enNube.body.records).length} ahora=${live(trasMigracion.body.records).length}`)

  console.log('\n== 3. Alta en el movil llega a la tablet ==')
  movil.newEngine()
  await boot(movil, { students: [], cycles: [], classes: [], recurrences: [], payments: [], profile: {} })
  const nuevos = [{ id: 'a-3', name: 'Caro', phone: '333', level: 'Inicial', amount: 100, due: '2026-10-01', active: true }]
  movil.engine.enqueueDiff('students', [], nuevos)
  await settle(movil)
  check('el movil subio el alumno nuevo', movil.engine.getState().pending === 0)
  tablet.received = []
  await tablet.engine.run()
  check('la tablet recibio el alumno nuevo', tablet.received.some((r) => r.id === 'a-3'), tablet.received.map((r) => r.id).join(','))

  console.log('\n== 4.Modo offline: se acumulan cambios y se suben al volver ==')
  globalThis.navigator.onLine = false
  movil.engine.enqueueDiff('students', nuevos, [{ ...nuevos[0], name: 'Caro editada sin internet' }])
  movil.engine.enqueueDiff('students', [{ ...nuevos[0], name: 'Caro editada sin internet' }], [{ ...nuevos[0], name: 'Caro editada dos veces' }])
  check('el estado avisa que no hay conexion', movil.engine.getState().status === 'sin-conexion', movil.engine.getState().status)
  check('los cambios quedan en cola', movil.engine.getState().pending > 0, `pendientes=${movil.engine.getState().pending}`)
  await sleep(900)
  check('sigue en cola sin internet', movil.engine.getState().pending > 0)
  globalThis.navigator.onLine = true
  await settle(movil)
  check('al volver la senal se sube la cola', movil.engine.getState().pending === 0, movil.engine.getState().message || '')
  const nombreFinal = await pc.api('GET', '/api/sync?since=' + encodeURIComponent(new Date(0).toISOString()))
  check('la version mas recienteOffline gano', nombreFinal.body.records.find((r) => r.id === 'a-3')?.data?.name === 'Caro editada dos veces', nombreFinal.body.records.find((r) => r.id === 'a-3')?.data?.name)

  console.log('\n== 5. Las ediciones repetidas se agrupan en un solo cambio ==')
  const antesDeRepetir = movil.engine.getState().pending
  movil.engine.enqueueDiff('students', [{ ...nuevos[0], name: 'X' }], [{ ...nuevos[0], name: 'Y' }])
  check('una edicion repetida no duplica la cola', movil.engine.getState().pending === Math.max(1, antesDeRepetir), `antes=${antesDeRepetir} ahora=${movil.engine.getState().pending}`)
  await settle(movil)

  console.log('\n== 6. Borrado logico: desaparece para todos y no revive ==')
  const conA1 = await pc.api('GET', '/api/sync?since=' + encodeURIComponent(new Date(0).toISOString()))
  const alumnoA1 = conA1.body.records.find((r) => r.collection === 'students' && r.id === 'a-1')
  const conElAlumno = [alumnoA1.data, conA1.body.records.find((r) => r.id === 'a-2').data]
  movil.engine.enqueueDiff('students', conElAlumno, conElAlumno.slice(1))
  await settle(movil)
  const trasBorrado = await pc.api('GET', '/api/sync?since=' + encodeURIComponent(new Date(0).toISOString()))
  const borrado = trasBorrado.body.records.find((r) => r.collection === 'students' && r.id === 'a-1')
  check('el alumno queda marcado como eliminado', !!borrado?.deletedAt, JSON.stringify(borrado?.deletedAt))
  check('los demas alumnos siguen intactos', live(trasBorrado.body.records).filter((r) => r.collection === 'students').length === 2)
  const revivir = await tablet.api('POST', '/api/sync', {
    since: null,
    changes: [{ collection: 'students', id: 'a-1', data: alumnoA1.data, deletedAt: null, baseUpdatedAt: null }],
  })
  check('una sincronizacion vieja no lo revive', revivir.body.applied.length === 0 && revivir.body.conflicts.length === 1, JSON.stringify(revivir.body.conflicts.map((c) => c.key)))
  const sigueBorrado = await pc.api('GET', '/api/sync?since=' + encodeURIComponent(new Date(0).toISOString()))
  check('el alumno sigue eliminado', !!sigueBorrado.body.records.find((r) => r.id === 'a-1')?.deletedAt)

  console.log('\n== 7. Conflicto entre dos dispositivos ==')
  const base = (await pc.api('GET', '/api/sync?since=' + encodeURIComponent(new Date(0).toISOString()))).body.records.find((r) => r.id === 'a-2')
  pc.engine.enqueueDiff('students', [base.data], [{ ...base.data, name: 'Beto desde el PC' }])
  await settle(pc)
  const estado = pc.engine.getState()
  check('el PC no reporta conflictos en su edicion', estado.conflicts.length === 0, JSON.stringify(estado.conflicts.map((c) => c.key)))
  // El movil edita la MISMA version base que ya quedo obsoleta.
  const conflicto = await movil.api('POST', '/api/sync', {
    since: null,
    changes: [{ collection: 'students', id: 'a-2', data: { ...base.data, name: 'Beto desde el movil' }, deletedAt: null, baseUpdatedAt: base.updatedAt }],
  })
  check('el movil recibe el conflicto', conflicto.body.conflicts.length === 1, JSON.stringify(conflicto.body))
  check('el conflicto trae ambas versiones', conflicto.body.conflicts[0]?.local?.name === 'Beto desde el movil' && conflicto.body.conflicts[0]?.server?.data?.name === 'Beto desde el PC', JSON.stringify(conflicto.body.conflicts[0]))
  const ganador = await pc.api('GET', '/api/sync?since=' + encodeURIComponent(new Date(0).toISOString()))
  check('la version del servidor no fue pisada', ganador.body.records.find((r) => r.id === 'a-2')?.data?.name === 'Beto desde el PC')

  console.log('\n== 8. Resolucion manual de conflictos ==')
  pc.received = []
  pc.engine.keepServer(conflicto.body.conflicts[0])
  check('usar la version de la nube no deja nada pendiente', pc.engine.getState().pending === 0)
  check('y aplica la version del servidor en el dispositivo', pc.received.some((r) => r.id === 'a-2' && r.data?.name === 'Beto desde el PC'))
  await settle(pc)
  const finalConflicto = await pc.api('GET', '/api/sync?since=' + encodeURIComponent(new Date(0).toISOString()))
  check('el nombre final sigue siendo el del servidor', finalConflicto.body.records.find((r) => r.id === 'a-2')?.data?.name === 'Beto desde el PC')
  pc.engine.keepLocal({ ...conflicto.body.conflicts[0], local: { ...base.data, name: 'Beto version local' } })
  await settle(pc)
  const trasKeepLocal = await pc.api('GET', '/api/sync?since=' + encodeURIComponent(new Date(0).toISOString()))
  check('conservar la local la sube a la nube', trasKeepLocal.body.records.find((r) => r.id === 'a-2')?.data?.name === 'Beto version local', trasKeepLocal.body.records.find((r) => r.id === 'a-2')?.data?.name)

  console.log('\n== 9. Aislamiento del estado local entre cuentas ==')
  const otroCorreo = `engine-otro-${Date.now()}@padelcoach.test`
  const otro = makeDevice('Otro')
  await otro.api('POST', '/api/auth/register', { email: otroCorreo, pin: otroPin, name: 'Otro' })
  otro.userId = (await otro.api('GET', '/api/auth/me')).body.user.id
  otro.newEngine()
  await boot(otro, { students: [], cycles: [], classes: [], recurrences: [], payments: [], profile: { name: 'Otro', club: 'Su club' } })
  const vistaOtro = await otro.api('GET', '/api/sync?since=' + encodeURIComponent(new Date(0).toISOString()))
  check('la otra cuenta no ve alumnos ajenos', live(vistaOtro.body.records).filter((r) => r.collection !== 'settings').length === 0, live(vistaOtro.body.records).map((r) => `${r.collection}:${r.id}`).join(','))
  const store = JSON.parse(globalThis.localStorage.getItem('padelpro-sync-v1') || '{"users":{}}')
  check('la cola local se guarda separada por cuenta', Object.keys(store.users).length <= 1, Object.keys(store.users).join(','))

  console.log('\n== 10. Regresion: un dispositivo que ya descargo sigue pudiendo subir ==')
  // Va al final porque crea alumnos y las secciones anteriores cuentan alumnos.
  // La tablet se bajo todo en la migracion. Antes, aplicar esos datos remotos
  // apagaba la deteccion de cambios locales para siempre y la tablet nunca mas
  // subia nada: por eso el celular y la PC se separaban.
  const altaTablet = { id: 't-9', name: 'Dora Tablet', phone: '999', level: 'Inicial', amount: 100, due: '2026-10-01', active: true }
  tablet.engine.enqueueDiff('students', [], [altaTablet])
  check('la tablet encola un alta nueva despues de descargar', tablet.engine.getState().pending === 1, `pendientes=${tablet.engine.getState().pending}`)
  await settle(tablet)
  const trasAltaTablet = await movil.api('GET', '/api/sync?since=' + encodeURIComponent(new Date(0).toISOString()))
  check('el alta de la tablet llego a la nube', !!trasAltaTablet.body.records.find((r) => r.id === 't-9'), trasAltaTablet.body.records.map((r) => r.id).join(','))
  const descargada = trasAltaTablet.body.records.find((r) => r.id === 'a-2')
  check('el alumno descargado por la tablet existe en la nube', !!descargada, 'no se encontro students:a-2')
  const edicionTablet = { ...descargada.data, name: 'Beto editado en la tablet' }
  tablet.engine.enqueueDiff('students', [descargada.data], [edicionTablet])
  check('la tablet encola una edicion sobre un registro descargado', tablet.engine.getState().pending === 1, `pendientes=${tablet.engine.getState().pending}`)
  await settle(tablet)
  const trasEdicion = await movil.api('GET', '/api/sync?since=' + encodeURIComponent(new Date(0).toISOString()))
  check('la edicion sobre un registro descargado llego a la nube', trasEdicion.body.records.find((r) => r.id === 'a-2')?.data?.name === 'Beto editado en la tablet', trasEdicion.body.records.find((r) => r.id === 'a-2')?.data?.name)
  check('la edicion de la tablet no genero conflictos', trasEdicion.body.conflicts.length === 0)
  // La suspension de un pull no puede dejar la deteccion apagada.
  await tablet.engine.run()
  tablet.engine.enqueueDiff('students', [], [{ id: 't-10', name: 'Post pull', phone: '100', level: 'Inicial', amount: 100, due: '2026-10-01', active: true }])
  check('un pull no deja la deteccion de cambios apagada', tablet.engine.getState().pending === 1, `pendientes=${tablet.engine.getState().pending}`)
  await settle(tablet)

  // limpieza
  await cleanupTestUsers([email, otroCorreo])

  console.log(`\n================  ${passed} pruebas OK / ${failed} fallos  ================`)
  if (failures.length) {
    console.log('Fallos:')
    failures.forEach((f) => console.log(' - ' + f))
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('ERROR EN LA PRUEBA:', error)
  process.exit(1)
})
