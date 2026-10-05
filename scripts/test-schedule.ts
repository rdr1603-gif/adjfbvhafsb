/**
 * Pruebas de la logica de agenda (lib/schedule.ts). Sin React ni red.
 * Salida: N pruebas OK / M fallos.
 */
import {
  addDays,
  applyPlan,
  calcDue,
  classDatesFrom,
  classId,
  date,
  iso,
  nextClassFor,
  parseTrainingDays,
  planClasses,
  reconcileClasses,
  reassignStudent,
  ruleDates,
  sameId,
  slotConflict,
  startOfWeek,
  studentSituation,
  studentStats,
  trainingDaysLabel,
  weekOf,
  weekdayOf,
  type ClassItem,
  type Cycle,
  type Recurrence,
} from '../lib/schedule'

let passed = 0
const failures: string[] = []
function check(name: string, condition: unknown, detail?: string) {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${name}`)
  } else {
    failures.push(`${name}${detail ? ` :: ${detail}` : ''}`)
    console.log(`  FAIL  ${name}${detail ? ` :: ${detail}` : ''}`)
  }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
function section(title: string) {
  console.log(`\n== ${title} ==`)
}

const TODAY = '2026-09-27'
const rec: Recurrence = {
  id: 'r1',
  studentId: 'a1',
  days: [2, 4],
  time: '18:00',
  duration: 60,
  court: 'Cancha 1',
  start: '2026-10-01',
  active: true,
}
const cycle: Cycle = {
  id: 'c1',
  studentId: 'a1',
  amount: 80000,
  included: 8,
  start: '2026-10-01',
  end: '2026-10-29',
  frequency: '2 clases por semana',
  received: 0,
  consumed: 0,
  absenceDeducts: false,
  cancellationDeducts: false,
  carryOver: false,
}

// ---------------------------------------------------------------- helpers
section('1. Días y fechas')
check('parsea "Martes, Jueves"', eq(parseTrainingDays('Martes, Jueves'), [2, 4]))
check('parsea "martes y jueves"', eq(parseTrainingDays('martes y jueves'), [2, 4]))
check('parsea "Miercoles"', eq(parseTrainingDays('Miercoles'), [3]))
check('soporta acentos: "Miércoles"', eq(parseTrainingDays('Miércoles'), [3]))
check('acepta 1-7 sin repetir', eq(parseTrainingDays('Lunes, Lunes, Martes'), [1, 2]))
check('texto vacío = sin días', eq(parseTrainingDays(''), []))
check('texto ilegible se ignora', eq(parseTrainingDays('cuando pueda'), []))
check('etiqueta legible', trainingDaysLabel([2, 4]) === 'Martes y Jueves', trainingDaysLabel([2, 4]))
check('lunes=1 y domingo=7', weekdayOf('2026-09-28') === 1 && weekdayOf('2026-10-04') === 7, `${weekdayOf('2026-09-28')}/${weekdayOf('2026-10-04')}`)
check('martes=2 y jueves=4', weekdayOf('2026-09-29') === 2 && weekdayOf('2026-10-01') === 4)
check('la semana arranca en lunes', startOfWeek(0, TODAY) === '2026-09-21', startOfWeek(0, TODAY))
check('semana siguiente suma 7', startOfWeek(1, TODAY) === '2026-09-28', startOfWeek(1, TODAY))
check('semana anterior resta 7', startOfWeek(-1, TODAY) === '2026-09-14', startOfWeek(-1, TODAY))
check('la semana tiene 7 días', weekOf(0, TODAY).length === 7)
check('la semana va de lunes a domingo', weekOf(0, TODAY)[0] === '2026-09-21' && weekOf(0, TODAY)[6] === '2026-09-27', weekOf(0, TODAY).join(','))
check('addDays cruza el mes', iso(addDays(date('2026-09-30'), 1)) === '2026-10-01')
check('calcDue devuelve la última clase', calcDue('2026-10-06', [2, 4], 4) === '2026-10-20', calcDue('2026-10-06', [2, 4], 4))
check('classDatesFrom respeta la cantidad', classDatesFrom('2026-10-06', [2, 4], 3).length === 3)
check('ruleDates respeta el rango', ruleDates([2, 4], '2026-10-01', '2026-10-14').length === 4, ruleDates([2,4],'2026-10-01','2026-10-14').join(','))
check('ruleDates con tope', ruleDates([2, 4], '2026-10-01', '2026-12-31', 4).length === 4)
check('sameId compares string y number', sameId('7', 7) && !sameId('7', 8) && !sameId(undefined, '7'))

// ------------------------------------------------------- generación de clases
section('2. Generación automática de clases (requisitos 3, 17, 18)')
// La mensualidad contrata 8 clases: ese limite es el que acota la generacion.
const plan1 = planClasses({ recurrence: rec, studentName: 'Juan Perez', from: '2026-10-01', to: '2026-10-29', limit: cycle.included, cycleId: 'c1' })
check('genera 8 clases para 2 días por semana', plan1.length === 8, `n=${plan1.length}`)
check('la primera clase cae en jueves 01/10', plan1[0].date === '2026-10-01' && plan1[0].time === '18:00', plan1[0].date)
check('la alternancia es martes/jueves', plan1.map((c) => weekdayOf(c.date)).join(',') === '4,2,4,2,4,2,4,2', plan1.map((c) => weekdayOf(c.date)).join(','))
check('las clases empiezan "Programada"', plan1.every((c) => c.status === 'Programada'))
check('todas apuntan al alumno', plan1.every((c) => sameId(c.studentId, 'a1') && c.student === 'Juan Perez'))
check('todas guardan la regla y el ciclo', plan1.every((c) => sameId(c.recurrenceId, 'r1') && sameId(c.cycleId, 'c1')))
check('respeta el limite de la mensualidad', planClasses({ recurrence: rec, studentName: 'X', from: '2026-10-01', to: '2026-12-31', limit: 8 }).length === 8)
check('sin limite cubre todo el rango', planClasses({ recurrence: rec, studentName: 'X', from: '2026-10-01', to: '2026-10-29' }).length === 9)
check('regla inactiva = 0 clases', planClasses({ recurrence: { ...rec, active: false }, studentName: 'X', from: '2026-10-01', to: '2026-12-31' }).length === 0)
check('sin días = 0 clases', planClasses({ recurrence: { ...rec, days: [] }, studentName: 'X', from: '2026-10-01', to: '2026-12-31' }).length === 0)

section('3. Id estable: nunca duplica (requisitos 17, 18, 28)')
const planAgain = planClasses({ recurrence: rec, studentName: 'Juan Perez', from: '2026-10-01', to: '2026-10-29', limit: cycle.included, cycleId: 'c1' })
check('dos generaciones dan los mismos ids', eq(plan1.map((c) => c.id), planAgain.map((c) => c.id)))
check('el id se deriva de regla y fecha', String(plan1[0].id) === classId('r1', '2026-10-01'), String(plan1[0].id))
const nadaNuevo = reconcileClasses(plan1, planAgain, TODAY)
check('reconciliar sobre si mismo no crea nada', nadaNuevo.length === 0, `n=${nadaNuevo.length}`)
check('reconciliar no borra lo existente', plan1.length === 8)
const desdeCero = reconcileClasses([], plan1, TODAY)
check('sobre una lista vacia agrega todas', desdeCero.length === 8)
check('dos dispositivos generan el mismo registro', planClasses({ recurrence: rec, studentName: 'Juan Perez', from: '2026-10-01', to: '2026-10-29', limit: cycle.included })[0].id === plan1[0].id)

// ------------------------------------------- cambios de días u horarios (6, 19)
section('4. Cambiar días/horario solo toca el futuro (requisitos 6, 19)')
const historicas: ClassItem[] = [
  { ...plan1[0], date: '2026-09-01', status: 'Realizada' as const },
  { ...plan1[1], date: '2026-09-03', status: 'Realizada' as const },
]
const futuroVie: ClassItem[] = plan1.filter((c) => c.date > TODAY)
const cambioHorario = planClasses({
  recurrence: { ...rec, days: [3, 5], time: '19:00' },
  studentName: 'Juan Perez',
  from: '2026-10-01',
  to: '2026-11-30',
  limit: cycle.included,
})
const fusion = applyPlan([...historicas, ...futuroVie], cambioHorario, TODAY)
check('las clases realizadas siguen intactas', historicas.every((h) => fusion.some((f) => f.id === h.id && f.date === h.date && f.status === 'Realizada')), JSON.stringify(fusion.filter((f) => f.status === 'Realizada').map((f) => f.date)))
check('no se repiten las fechas del pasado', fusion.filter((f) => f.date < TODAY).length === 2)
check('las clases futuras quedan en el horario nuevo', fusion.filter((f) => f.status === 'Programada').every((f) => f.time === '19:00'), fusion.filter((f) => f.status === 'Programada').map((f) => `${f.date} ${f.time}`).join(' '))
check('las clases futuras quedan en los dias nuevos', fusion.filter((f) => f.status === 'Programada').every((f) => [3, 5].includes(weekdayOf(f.date))))
check('se generaron las 8 clases nuevas', fusion.filter((f) => f.status === 'Programada').length === 8, `n=${fusion.filter((f) => f.status === 'Programada').length}`)
check('ninguna clase futura conserva el horario viejo', !fusion.some((f) => f.status === 'Programada' && f.time === '18:00'))
check('aplicar dos veces no cambia el resultado', eq(applyPlan(fusion, cambioHorario, TODAY).map((c) => `${c.date}${c.time}`), fusion.map((c) => `${c.date}${c.time}`)))

section('4b. Cada regla se materializa aislada (requisito 23)')
// Un alumno puede tener mas de una regla (por ejemplo si cambio de horario).
const recA: Recurrence = { ...rec, id: 'rA', days: [2], time: '18:00' }
const recB: Recurrence = { ...rec, id: 'rB', days: [4], time: '20:00' }
const planA = planClasses({ recurrence: recA, studentName: 'Juan Perez', from: '2026-10-01', to: '2026-10-29', limit: 4 })
const planB = planClasses({ recurrence: recB, studentName: 'Juan Perez', from: '2026-10-01', to: '2026-10-29', limit: 4 })
const ambas = [...planA, ...planB]
check('las dos reglas generan sus propias clases', ambas.length === 8, `n=${ambas.length}`)
const soloA = applyPlan(ambas, planA, TODAY, 'rA')
check('aplicar rA deja intactas las clases de rB', soloA.filter((c) => c.recurrenceId === 'rB').length === planB.length, `n=${soloA.filter((c) => c.recurrenceId === 'rB').length}`)
check('y conserva las clases de rA', soloA.filter((c) => c.recurrenceId === 'rA').length === planA.length)
const sinFiltro = applyPlan(ambas, planA, TODAY)
check('sin filtro de regla se perderian las de rB', sinFiltro.length < ambas.length, `${sinFiltro.length} vs ${ambas.length}`)
void ambas
const planARediseñado = planClasses({ recurrence: { ...recA, time: '21:00' }, studentName: 'Juan Perez', from: '2026-10-01', to: '2026-10-29', limit: 4 })
const trasCambio = applyPlan(ambas, planARediseñado, TODAY, 'rA')
check('al rediseñar rA, rB no se toca', trasCambio.filter((c) => c.recurrenceId === 'rB').length === planB.length)
check('rA queda en el horario nuevo', trasCambio.filter((c) => c.recurrenceId === 'rA').every((c) => c.time === '21:00'))
const historicaRealizada: ClassItem = { ...planARediseñado[0], status: 'Realizada' as const }
const conPasado = applyPlan([...ambas, historicaRealizada], planARediseñado, TODAY, 'rA')
check('una clase ya realizada de rA no se pisa', conPasado.some((c) => String(c.id) === String(historicaRealizada.id) && c.status === 'Realizada'))
const unica: ClassItem = { id: 'manual-1', studentId: 'a1', student: 'Juan Perez', date: '2026-10-07', time: '19:00', court: 'Cancha 2', duration: 60, type: 'unica', status: 'Programada' }
check('una clase suelta nunca se borra', applyPlan([...ambas, unica], planA, TODAY, 'rA').some((c) => c.id === 'manual-1'))

section('5. Estados, contadores y círculos (requisitos 8, 9, 11)')
// Las 8 clases reales de la mensualidad: 3 realizadas, 1 ausente, 4 pendientes.
const conEstados: ClassItem[] = plan1.map((c, i) => ({
  ...c,
  status: (i < 3 ? 'Realizada' : i === 3 ? 'Ausente' : 'Programada') as ClassItem['status'],
}))
const stats = studentStats(conEstados, cycle, TODAY)
check('3 realizadas', stats.done === 3, `${stats.done}`)
check('1 ausente', stats.absent === 1)
check('4 quedan programadas', stats.scheduled === 4, `${stats.scheduled}`)
check('las ausentes no descuentan por defecto', stats.used === 3, `${stats.used}`)
check('faltan 5 clases', stats.remaining === 5, `${stats.remaining}`)
check('los círculos son uno por clase contratada', stats.dots.length === 8, `${stats.dots.length}`)
check('3 círculos llenos y 5 vacíos', stats.dots.filter((d) => d.realized).length === 3 && stats.dots.filter((d) => !d.realized).length === 5)
check('el ausente queda como círculo vacío pero contado', stats.dots[3].status === 'Ausente' && !stats.dots[3].realized)
check('cada círculo trae fecha, hora y estado', !!stats.dots[0].date && !!stats.dots[0].time && !!stats.dots[0].status)
check('próxima clase = la primera programada futura', stats.next?.date === plan1[4].date, stats.next?.date)
check('el porcentaje sale de los contadores', stats.percent === Math.round((3 / 8) * 100), `${stats.percent}`)
check('sin mensualidad no se rompe', studentStats(conEstados, undefined, TODAY).contracted === 0)

const conAusenciaQueDescuenta = studentStats(conEstados, { ...cycle, absenceDeducts: true }, TODAY)
check('si la ausencia descuenta, cuenta', conAusenciaQueDescuenta.used === 4, `${conAusenciaQueDescuenta.used}`)
check('y quedan 4 restantes', conAusenciaQueDescuenta.remaining === 4)

const cancelada: ClassItem[] = [
  { ...plan1[0], status: 'Realizada' as const },
  { ...plan1[1], status: 'Cancelada' as const },
  { ...plan1[2], status: 'Programada' as const },
]
check('cancelada no descuenta por defecto', studentStats(cancelada, cycle, TODAY).used === 1)
check('cancelada cuenta si el ciclo lo dice', studentStats(cancelada, { ...cycle, cancellationDeducts: true }, TODAY).used === 2)
check('cancelada sigue visible en el historial', studentStats(cancelada, cycle, TODAY).canceled === 1)

const conRecuperada = studentStats([...cancelada, { ...plan1[2], status: 'Recuperada' as const }], cycle, TODAY)
check('una recuperada se cuenta como cumplida', conRecuperada.recovered === 1 && conRecuperada.used === 2, `rec=${conRecuperada.recovered} used=${conRecuperada.used}`)

section('6. Próxima clase y situación (requisitos 13, 20)')
check('próxima clase ignorando las canceladas', nextClassFor(cancelada, TODAY)?.status === 'Programada', nextClassFor(cancelada, TODAY)?.status ?? 'sin clase')
check('sin clases futuras no hay próxima', nextClassFor([{ ...plan1[0], status: 'Realizada' as const }], '2026-12-01') === undefined)
check('situación activa', studentSituation({ active: true }, cycle, '2026-10-05', TODAY) === 'activo')
check('situación pendiente por atraso de pago', studentSituation({ active: true }, cycle, '2026-09-20', TODAY) === 'pendiente')
check('situación pendiente por mensualidad agotada', studentSituation({ active: true }, { ...cycle, consumed: 8 }, '2026-10-05', TODAY) === 'pendiente')
check('situación inactivo manda sobre todo', studentSituation({ active: false }, cycle, '2026-10-05', TODAY) === 'inactivo')

section('7. Choques y cambio de alumno (requisitos 14, 15)')
const lote: ClassItem[] = plan1.slice(0, 3)
check('mismo alumno, misma hora y cancha = choque', slotConflict(lote, { date: plan1[0].date, time: plan1[0].time, court: plan1[0].court, studentId: 'a1' }) === 'alumno')
check('se ignora la clase que se esta moviendo', slotConflict(lote, { date: plan1[0].date, time: plan1[0].time, court: plan1[0].court, studentId: 'a1' }, plan1[0].id) === null)
check('otro horario no choca', slotConflict(lote, { date: plan1[0].date, time: '20:00', court: 'Cancha 1', studentId: 'a1' }) === null)
// Cupo lleno: cuatro alumnos distintos en el MISMO horario y cancha.
const lleno: ClassItem[] = [0, 1, 2, 3].map((i) => ({
  ...plan1[0],
  id: `lleno-${i}`,
  studentId: `otro${i}`,
  student: `Otro ${i}`,
}))
check('cupo lleno = choque', slotConflict(lleno, { date: plan1[0].date, time: plan1[0].time, court: plan1[0].court, studentId: 'nuevo' }) === 'cupo')
check('cancelada no ocupa cupo', slotConflict([{ ...lleno[0], status: 'Cancelada' as const }, ...lleno.slice(1)], { date: plan1[0].date, time: plan1[0].time, court: plan1[0].court, studentId: 'nuevo' }) === null)
check('con un lugar libre se puede', slotConflict(lleno.slice(0, 3), { date: plan1[0].date, time: plan1[0].time, court: plan1[0].court, studentId: 'nuevo' }) === null)

const claseJuan = plan1[0]
const movida = reassignStudent(claseJuan, 'a2', 'Pedro Gomez')
check('cambiar alumno no crea otra clase', movida.id === claseJuan.id)
check('el id sigue siendo el mismo', String(movida.id) === String(claseJuan.id))
check('el alumno quedo cambiado', sameId(movida.studentId, 'a2') && movida.student === 'Pedro Gomez')
check('la fecha no se altera', movida.date === claseJuan.date && movida.time === claseJuan.time)

// ------------------------------------------------------------ persistencia
section('8. Persistencia: lo serializado conserva los datos')
const serializado = JSON.parse(JSON.stringify(plan1))
check('8 clases sobreviven al round-trip', serializado.length === 8)
check('el id sigue siendo estable', serializado[0].id === plan1[0].id)
check('los estados sobreviven', serializado[0].status === 'Programada')
const recuperado = JSON.parse(JSON.stringify([{ ...plan1[0], status: 'Recuperada', recoveredFrom: 'x' }])) as ClassItem[]
check('el estado Recuperada sobrevive', recuperado[0].status === 'Recuperada')
check('el vinculo de recuperacion sobrevive', recuperado[0].recoveredFrom === 'x')

// ------------------------------------------------- materializacion y estados
section('9. Materializacion: las clases reales son idempotentes')
const regla: Recurrence = { ...rec, id: 'r9', start: '2026-09-27' }
const ciclo9: Cycle = { ...cycle, id: 'c9', included: 4, start: '2026-09-27', end: '2026-11-30' }
const plan9 = planClasses({
  recurrence: regla,
  studentName: 'Ana Diaz',
  from: '2026-09-27',
  to: '2026-11-30',
  limit: 4,
  cycleId: 'c9',
})
check('la regla genera el limite contratado', plan9.length === 4)
const m1 = applyPlan([], plan9, TODAY, 'r9')
check('la primera corrida crea las clases', m1.length === 4)
check('los ids son deterministas', m1.every((c) => c.id === classId('r9', c.date)))
const m2 = applyPlan(m1, plan9, TODAY, 'r9')
check('la segunda corrida no duplica nada', m2.length === 4)
check('los ids siguen siendo los mismos', eq(m2.map((c) => c.id), m1.map((c) => c.id)))

// Marcar como realizada y volver a materializar no debe perder el estado.
const m3 = applyPlan(
  m2.map((c) => (c.date === plan9[0].date ? { ...c, status: 'Realizada' as const } : c)),
  plan9,
  TODAY,
  'r9',
)
check('materializar de nuevo conserva el estado', m3.find((c) => c.date === plan9[0].date)?.status === 'Realizada')
check('siguen siendo 4 clases', m3.length === 4)

// Recalcular el limite de la mensualidad agrega lo que falta, sin pisar el pasado.
const plan9b = planClasses({
  recurrence: regla,
  studentName: 'Ana Diaz',
  from: '2026-09-27',
  to: '2026-11-30',
  limit: 6,
  cycleId: 'c9',
})
const m4 = applyPlan(m3, plan9b, TODAY, 'r9')
check('al ampliar el plan se agregan clases', m4.length === 6)
check('las clases viejas conservan su id', m4.filter((c) => c.id === m3[0].id).length === 1)
check('las nuevas usan el patron de id', m4.slice(4).every((c) => c.id === classId('r9', c.date)))

// Una recuperacion no debe morir cuando la regla vuelve a materializar.
const conRecuperada9: ClassItem[] = [
  ...m1.slice(1),
  { ...m1[0], id: 'recuperada-1', status: 'Recuperada' as const, recoveredFrom: String(m1[0].id), recurrenceId: undefined },
]
const m5 = applyPlan(conRecuperada9, plan9, TODAY, 'r9')
check('la clase recuperada sobrevive al resync', m5.some((c) => c.id === 'recuperada-1'))
check('la recuperada conserva su vinculo', m5.find((c) => c.id === 'recuperada-1')?.recoveredFrom === String(m1[0].id))

// Cambiar de alumno no debe generar una clase nueva para la regla.
const m6 = applyPlan(m1.map((c) => reassignStudent(c, 'otro', 'Luis Vega')), plan9, TODAY, 'r9')
check('reasignar y volver a materializar no cambia la cantidad', m6.length === 4)
check('el alumno cambiado se respeta', m6.every((c) => c.student === 'Luis Vega'))

section('10. Situacion y contadores a partir de las clases reales')
const usadas: ClassItem[] = [
  { ...plan1[0], status: 'Realizada' as const },
  { ...plan1[1], status: 'Realizada' as const },
  { ...plan1[2], status: 'Ausente' as const },
  { ...plan1[3], status: 'Recuperada' as const },
]
const stats10 = studentStats(usadas, { ...cycle, included: 8, consumed: 0 }, TODAY)
check('las realizadas se cuentan', stats10.done === 2)
check('las ausencias se cuentan', stats10.absent === 1)
check('las recuperadas se cuentan aparte', stats10.recovered === 1)
check('la recuperada consume del ciclo', stats10.used === 3)
check('las restantes se derivan del ciclo', stats10.remaining === 5)
check('la situacion usa el contador derivado', studentSituation({ active: true }, { ...cycle, included: 3, consumed: 0 }, '2026-10-05', TODAY, stats10.used) === 'pendiente')
check('con margen disponible sigue activo', studentSituation({ active: true }, { ...cycle, included: 8, consumed: 8 }, '2026-10-05', TODAY, stats10.used) === 'activo')
check('sin contador derivado sigue usando el guardado', studentSituation({ active: true }, { ...cycle, included: 2, consumed: 2 }, '2026-10-05', TODAY) === 'pendiente')

// La ausencia solo descuenta cuando la mensualidad lo pide.
const noDescuenta = studentStats([{ ...plan1[0], status: 'Ausente' as const }], { ...cycle, absenceDeducts: false }, TODAY)
const descuenta = studentStats([{ ...plan1[0], status: 'Ausente' as const }], { ...cycle, absenceDeducts: true }, TODAY)
check('la ausencia no descuenta si la regla no lo dice', noDescuenta.used === 0)
check('la ausencia descuenta cuando la regla lo dice', descuenta.used === 1)

section('11. Reconciliacion y bordes de la ventana')
const todas = ruleDates(regla.days, '2026-09-27', '2026-11-30', 0)
check('dias de la regla respetados', todas.every((d) => [2, 4].includes(weekdayOf(d))))
check('la ventana no arranca antes de la regla', todas[0] >= '2026-09-27')
// reconcileClasses devuelve solo lo que se agrego o se movio, no la lista entera.
const rec2 = reconcileClasses(m1, plan9, TODAY)
check('reconciliar sobre la misma lista no reporta cambios', rec2.length === 0)
const conPasada = m1.map((c) => (c.date === plan9[0].date ? { ...c, status: 'Realizada' as const } : c))
check('reconciliar ignora lo ya confirmado', reconcileClasses(conPasada, plan9, TODAY).length === 0)
const movida9 = m1.map((c) => (c.date === plan9[0].date ? { ...c, time: '20:00' } : c))
check('reconciliar marca solo la clase movida', eq(reconcileClasses(movida9, plan9, TODAY).map((c) => c.id), [plan9[0].id]))
check('sin limite no se corta la generacion', planClasses({ recurrence: regla, studentName: 'Ana', from: '2026-09-27', to: '2026-10-31', limit: 0 }).length > 4)
check('un limite negativo se trata como sin limite', planClasses({ recurrence: regla, studentName: 'Ana', from: '2026-09-27', to: '2026-10-31', limit: -1 }).length === planClasses({ recurrence: regla, studentName: 'Ana', from: '2026-09-27', to: '2026-10-31', limit: 0 }).length)
check('una ventana terminada antes de empezar no genera nada', planClasses({ recurrence: { ...regla, start: '2026-12-01' }, studentName: 'Ana', from: '2026-09-27', to: '2026-10-31' }).length === 0)

section('12. Borrar una clase no la deja resucitar')
// Que la app marque la clase como Cancelada en vez de borrarla: si se borra del
// arreglo, applyPlan la vuelve a crear porque el id es determinista.
const cancelada12: ClassItem[] = m1.map((c) =>
  c.date === plan9[0].date ? { ...c, status: 'Cancelada' as const } : c,
)
const m7 = applyPlan(cancelada12, plan9, TODAY, 'r9')
check('la clase cancelada no desaparece', m7.length === 4)
check('la clase cancelada sigue en su lugar', m7.some((c) => c.id === classId('r9', plan9[0].date)))
check('la clase cancelada conserva su fecha', m7.find((c) => c.id === classId('r9', plan9[0].date))?.date === plan9[0].date)
check('queda marcada como cancelada', m7.find((c) => c.id === classId('r9', plan9[0].date))?.status === 'Cancelada')
const m8 = applyPlan(m7, plan9, TODAY, 'r9')
check('materializar de nuevo no la resucita', m8.find((c) => c.id === classId('r9', plan9[0].date))?.status === 'Cancelada')
check('siguen siendo 4 clases', m8.length === 4)
check('no aparece ninguna clase nueva', m8.every((c) => cancelada12.some((old) => old.id === c.id)))

// Una clase suelta, sin regla, se puede borrar de verdad.
const suelta: ClassItem[] = [{ ...plan1[0], id: 'suelta-1', recurrenceId: undefined }]
const filtrada = suelta.filter((c) => c.id !== 'suelta-1')
check('una clase sin regla se elimina del arreglo', filtrada.length === 0)
check('no hay regla que la vuelva a crear', applyPlan(filtrada, [], TODAY, 'r9').length === 0)

// Quitar la regla (alumno dado de baja) no debe tocar las clases ya confirmadas.
const m9 = applyPlan(m2.map((c) => ({ ...c, status: 'Realizada' as const })), [], TODAY, 'r9')
check('las clases realizadas sobreviven a quitar la regla', m9.length === 4)
check('siguen marcadas como realizadas', m9.every((c) => c.status === 'Realizada'))

console.log(`\n================  ${passed} pruebas OK / ${failures.length} fallos  ================`)
if (failures.length) {
  console.log('Fallos:')
  failures.forEach((f) => console.log(' - ' + f))
  process.exit(1)
}