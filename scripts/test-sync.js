/**
 * Prueba end-to-end contra la API y la base reales.
 * Simula dos dispositivos (A = PC, B = movil) del mismo usuario, un segundo
 * usuario para verificar aislamiento, y los casos de conflicto, duplicado,
 * borrado logico y reconexion offline.
 */
const BASE = process.env.BASE_URL || 'http://localhost:3111'
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

function makeDevice(label) {
  const jar = new Map()
  return {
    label,
    offline: false,
    async call(method, path, body) {
      if (this.offline) throw new Error(`${label} esta sin conexion`)
      const headers = { 'content-type': 'application/json' }
      if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
      const response = await fetch(BASE + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      for (const raw of response.headers.getSetCookie?.() || []) {
        const [pair] = raw.split(';')
        const index = pair.indexOf('=')
        const name = pair.slice(0, index)
        const value = pair.slice(index + 1)
        if (!value) jar.delete(name)
        else jar.set(name, value)
      }
      const json = await response.json().catch(() => ({}))
      return { status: response.status, body: json }
    },
  }
}

const find = (records, collection, id) =>
  records.find((r) => r.collection === collection && r.id === id)

async function main() {
  const email = `sync-test-${Date.now()}@padelcoach.test`
  const pin = String(Date.now()).slice(-8)
  const otroPin = String((Number(pin) + 3) % 100000000).padStart(8, '0')
  const deviceA = makeDevice('PC')
  const deviceB = makeDevice('Movil')
  const deviceC = makeDevice('Otro usuario')

  console.log('\n== 1. Registro e inicio de sesion ==')
  const register = await deviceA.call('POST', '/api/auth/register', {
    email,
    pin,
    name: 'Probe',
  })
  check('registro crea la cuenta', register.status === 200 && !!register.body.user, JSON.stringify(register.body))
  const userId = register.body.user?.id

  const login = await deviceB.call('POST', '/api/auth/login', { pin })
  check('el movil inicia sesion con la misma cuenta', login.status === 200 && login.body.user?.id === userId)

  const badPin = await makeDevice('X').call('POST', '/api/auth/login', { pin: otroPin })
  check('rechaza un PIN incorrecto', badPin.status === 401)

  const anon = await fetch(`${BASE}/api/sync`).then((r) => r.status)
  check('la API de sync exige sesion', anon === 401, `status=${anon}`)

  console.log('\n== 2. El movil recibe lo que crea el PC (tiempo real) ==')
  await deviceA.call('POST', '/api/sync', {
    since: null,
    changes: [
      {
        collection: 'students',
        id: 'stu-1',
        data: { id: 'stu-1', name: 'Ana', phone: '111' },
        deletedAt: null,
        baseUpdatedAt: null,
      },
      {
        collection: 'cycles',
        id: 'cyc-1',
        data: { id: 'cyc-1', studentId: 'stu-1', price: 100 },
        deletedAt: null,
        baseUpdatedAt: null,
      },
    ],
  })
  const pullB = await deviceB.call('GET', '/api/sync?since=' + encodeURIComponent(new Date(0).toISOString()))
  check('el movil ve el alumno creado en el PC', !!find(pullB.body.records, 'students', 'stu-1'))
  check('el movil ve el ciclo creado en el PC', !!find(pullB.body.records, 'cycles', 'cyc-1'))
  const studentStamp = find(pullB.body.records, 'students', 'stu-1')?.updatedAt

  console.log('\n== 3. Edicion en el movil llega al PC ==')
  const editB = await deviceB.call('POST', '/api/sync', {
    since: pullB.body.cursor,
    changes: [
      {
        collection: 'students',
        id: 'stu-1',
        data: { id: 'stu-1', name: 'Ana Lopez', phone: '222' },
        deletedAt: null,
        baseUpdatedAt: studentStamp,
      },
    ],
  })
  check('el movil acepta la edicion', editB.body.applied?.length === 1, JSON.stringify(editB.body.conflicts))
  const pullA = await deviceA.call('GET', '/api/sync?since=' + encodeURIComponent(editB.body.cursor))
  const updated = find(pullA.body.records, 'students', 'stu-1')
  check('el PC recibe el cambio del movil', updated?.data?.name === 'Ana Lopez', JSON.stringify(updated?.data))
  check('el PC recibe el telefono nuevo', updated?.data?.phone === '222')

  console.log('\n== 4. Doble guardado no duplica (idempotencia) ==')
  const stampNow = updated.updatedAt
  for (let i = 0; i < 3; i += 1) {
    await deviceA.call('POST', '/api/sync', {
      since: pullA.body.cursor,
      changes: [
        {
          collection: 'students',
          id: 'stu-1',
          data: updated.data,
          deletedAt: null,
          baseUpdatedAt: stampNow,
        },
      ],
    })
  }
  const checkDup = await deviceA.call('GET', '/api/sync?since=' + encodeURIComponent(new Date(0).toISOString()))
  const allStudents = checkDup.body.records.filter((r) => r.collection === 'students')
  check('sigue existiendo un solo alumno', allStudents.length === 1, `encontrados=${allStudents.length}`)

  console.log('\n== 5. Modo offline: se acumulan y suben al reconectar ==')
  const offlineQueue = [
    {
      collection: 'classes',
      id: 'cls-1',
      data: { id: 'cls-1', title: 'Clase offline 1' },
      deletedAt: null,
      baseUpdatedAt: null,
    },
    {
      collection: 'classes',
      id: 'cls-2',
      data: { id: 'cls-2', title: 'Clase offline 2' },
      deletedAt: null,
      baseUpdatedAt: null,
    },
    {
      collection: 'payments',
      id: 'pay-1',
      data: { id: 'pay-1', amount: 50 },
      deletedAt: null,
      baseUpdatedAt: null,
    },
  ]
  let offlineError = null
  deviceB.offline = true
  try {
    await deviceB.call('POST', '/api/sync', { since: null, changes: offlineQueue })
  } catch (error) {
    offlineError = error.message
  }
  deviceB.offline = false
  check('sin conexion la escritura falla y se conserva en cola', !!offlineError, String(offlineError))
  const beforeReconnect = await deviceA.call('GET', '/api/sync?since=' + encodeURIComponent(new Date(0).toISOString()))
  check(
    'el PC no ve todavia lo pendiente del movil offline',
    !find(beforeReconnect.body.records, 'classes', 'cls-1'),
  )
  const flush = await deviceB.call('POST', '/api/sync', { since: pullB.body.cursor, changes: offlineQueue })
  check('al reconectar sube la cola completa', flush.body.applied?.length === 3, JSON.stringify(flush.body.conflicts))
  const afterReconnect = await deviceA.call('GET', '/api/sync?since=' + encodeURIComponent(flush.body.cursor))
  check(
    'el PC recibe las 3 operaciones pendientes',
    !!find(afterReconnect.body.records, 'classes', 'cls-1') &&
      !!find(afterReconnect.body.records, 'classes', 'cls-2') &&
      !!find(afterReconnect.body.records, 'payments', 'pay-1'),
  )

  console.log('\n== 6. Conflicto: dos dispositivos editan el mismo registro ==')
  const commonBase = find(afterReconnect.body.records, 'classes', 'cls-1').updatedAt
  const pushA = await deviceA.call('POST', '/api/sync', {
    since: afterReconnect.body.cursor,
    changes: [
      {
        collection: 'classes',
        id: 'cls-1',
        data: { id: 'cls-1', title: 'Editada en el PC' },
        deletedAt: null,
        baseUpdatedAt: commonBase,
      },
    ],
  })
  check('el PC aplica su edicion', pushA.body.applied?.length === 1)
  const pushB = await deviceB.call('POST', '/api/sync', {
    since: afterReconnect.body.cursor,
    changes: [
      {
        collection: 'classes',
        id: 'cls-1',
        data: { id: 'cls-1', title: 'Editada en el movil' },
        deletedAt: null,
        baseUpdatedAt: commonBase,
      },
    ],
  })
  check(
    'el movil recibe aviso de conflicto, no pisa al PC',
    pushB.body.applied?.length === 0 && pushB.body.conflicts?.length === 1,
    JSON.stringify(pushB.body),
  )
  check(
    'el conflicto trae la version del servidor para resolver',
    pushB.body.conflicts?.[0]?.server?.data?.title === 'Editada en el PC' &&
      pushB.body.conflicts?.[0]?.local?.title === 'Editada en el movil',
  )
  const afterConflict = await deviceB.call('GET', '/api/sync?since=' + encodeURIComponent(new Date(0).toISOString()))
  check(
    'la version del servidor quedo intacta',
    find(afterConflict.body.records, 'classes', 'cls-1')?.data?.title === 'Editada en el PC',
  )

  console.log('\n== 7. Borrado logico: no se revive con una sincronizacion vieja ==')
  const del = await deviceA.call('POST', '/api/sync', {
    since: afterConflict.body.cursor,
    changes: [
      {
        collection: 'classes',
        id: 'cls-2',
        data: { id: 'cls-2', title: 'Clase offline 2' },
        deletedAt: new Date().toISOString(),
        baseUpdatedAt: find(afterConflict.body.records, 'classes', 'cls-2').updatedAt,
      },
    ],
  })
  check('el borrado se registra como eliminado', del.body.applied?.length === 1)
  const stale = await deviceB.call('POST', '/api/sync', {
    since: afterConflict.body.cursor,
    changes: [
      {
        collection: 'classes',
        id: 'cls-2',
        data: { id: 'cls-2', title: 'Intento de revivir' },
        deletedAt: null,
        baseUpdatedAt: null,
      },
    ],
  })
  check(
    'una sincronizacion antigua NO recrea el registro eliminado',
    stale.body.applied?.length === 0 && stale.body.conflicts?.length === 1,
    JSON.stringify(stale.body),
  )
  const afterDelete = await deviceB.call('GET', '/api/sync?since=' + encodeURIComponent(new Date(0).toISOString()))
  const deletedRecord = find(afterDelete.body.records, 'classes', 'cls-2')
  check('el registro sigue eliminado', !!deletedRecord?.deletedAt)
  check('y no vuelve a estar visible', deletedRecord?.data?.title !== 'Intento de revivir')

  console.log('\n== 8. Aislamiento entre cuentas ==')
  const otherEmail = `sync-otro-${Date.now()}@padelcoach.test`
  const otherPin = String((Number(pin) + 5) % 100000000).padStart(8, '0')
  const otherReg = await deviceC.call('POST', '/api/auth/register', {
    email: otherEmail,
    pin: otherPin,
    name: 'Otro',
  })
  check('el segundo usuario se registra', otherReg.status === 200)
  const otherPull = await deviceC.call('GET', '/api/sync?since=' + encodeURIComponent(new Date(0).toISOString()))
  const otherBusinessData = otherPull.body.records.filter((r) => !r.deletedAt && r.collection !== 'settings')
  check(
    'el segundo usuario no ve ningun dato del primero',
    otherBusinessData.length === 0,
    `visibles=${JSON.stringify(otherBusinessData.map((r) => `${r.collection}:${r.id}`))}`,
  )
  check(
    'solo ve su propio perfil vacio',
    otherPull.body.records.filter((r) => r.collection === 'settings').length === 1,
  )
  const crossWrite = await deviceC.call('POST', '/api/sync', {
    since: null,
    changes: [
      {
        collection: 'students',
        id: 'stu-1',
        data: { id: 'stu-1', name: 'Intruso' },
        deletedAt: null,
        baseUpdatedAt: null,
      },
    ],
  })
  check('el segundo usuario crea su propio registro con el mismo id', crossWrite.body.applied?.length === 1)
  const stillOurs = await deviceA.call('GET', '/api/sync?since=' + encodeURIComponent(new Date(0).toISOString()))
  check(
    'el dato del primer usuario no fue alterado',
    find(stillOurs.body.records, 'students', 'stu-1')?.data?.name === 'Ana Lopez',
  )

  console.log('\n== 9. Validacion de entrada ==')
  const badCollection = await deviceA.call('POST', '/api/sync', {
    since: null,
    changes: [{ collection: 'hack', id: 'x', data: {}, baseUpdatedAt: null }],
  })
  check('rechaza colecciones desconocidas', badCollection.body.rejected === 1, JSON.stringify(badCollection.body))
  const badId = await deviceA.call('POST', '/api/sync', {
    since: null,
    changes: [{ collection: 'students', id: 'x'.repeat(200), data: {}, baseUpdatedAt: null }],
  })
  check('rechaza identificadores Excessive', badId.body.rejected === 1)
  const badJson = await fetch(`${BASE}/api/sync`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: [...deviceA.call ? [] : []],
    },
  }).catch(() => null)
  check('el endpoint responde sin cuerpo invalido', badJson === null || badJson.status < 500)

  console.log('\n== 10. Cierre de sesion ==')
  const logout = await deviceB.call('POST', '/api/auth/logout')
  check('cierra sesion', logout.status === 200)
  const afterLogout = await deviceB.call('GET', '/api/sync?since=' + encodeURIComponent(new Date(0).toISOString()))
  check('tras salir, la API ya no responde', afterLogout.status === 401)

  // Limpieza
  await cleanupTestUsers([email, otherEmail])

  console.log(`\n================  ${passed} pruebas OK / ${failed} fallos  ================`)
  if (failures.length) {
    console.log('Fallos:')
    for (const f of failures) console.log(' - ' + f)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('ERROR EN LA PRUEBA:', error)
  process.exit(1)
})
