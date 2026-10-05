/**
 * Agenda de clases: fuente unica de verdad.
 *
 * Antes el calendario armaba las clases en memoria a partir de una regla
 * (`recurrences`) cada vez que se renderizaba. Eso hacia imposible tener
 * historial real, saber cuantas clases faltan ni evitar duplicados.
 *
 * Aqui una clase es un registro con id estable: el mismo alumno, la misma
 * fecha y la misma regla generan SIEMPRE el mismo id. Por eso volver a
 * guardar el alumno o abrir la app nunca duplica nada, y el mismo registro
 * existe en el celular, en la nube y en el calendario.
 *
 * Todo el modulo es logica pura y sin dependencias de React para poder
 * probarlo por separado.
 */

export type ClassStatus = 'Programada' | 'Realizada' | 'Ausente' | 'Cancelada' | 'Recuperada'

export type ClassItem = {
  id: number | string
  studentId: number | string
  student: string
  date: string
  time: string
  court: string
  duration: number
  type: 'recurrente' | 'unica'
  status: ClassStatus
  cycleId?: number | string
  recurrenceId?: number | string
  completedAt?: string
  note?: string
  /** Si la clase es la recuperacion de otra, guarda el id de la clase original. */
  recoveredFrom?: number | string
}

export type Recurrence = {
  id: number | string
  studentId: number | string
  days: number[]
  time: string
  duration: number
  court: string
  start: string
  active: boolean
}

export type Cycle = {
  id: number | string
  studentId: number | string
  amount: number
  included: number
  start: string
  end: string
  frequency: string
  received: number
  consumed: number
  absenceDeducts: boolean
  cancellationDeducts: boolean
  carryOver: boolean
}

/** Cuantos dias hacia adelante se materializan las clases de cada alumno. */
export const HORIZON_DAYS = 120

export const date = (s: string) => new Date(`${s}T12:00:00`)

export const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export const addDays = (d: Date, n: number) => {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

/** 1 = lunes ... 7 = domingo. El calendario arranca el lunes. */
export const weekdayOf = (s: string) => date(s).getDay() || 7

export const startOfWeek = (weekOffset: number, from: string) => {
  const d = date(from)
  const wd = d.getDay() || 7
  // Sin modulo: hay que sumar o restar dias reales, o el desplazamiento se
  // envuelve y navegar dos semanas devuelve siempre la misma.
  return iso(addDays(d, -(wd - 1) + weekOffset * 7))
}

export const weekOf = (weekOffset: number, from: string) =>
  Array.from({ length: 7 }, (_, i) => iso(addDays(date(startOfWeek(weekOffset, from)), i)))

export const sameId = (a: number | string | undefined, b: number | string | undefined) =>
  a !== undefined && b !== undefined && String(a) === String(b)

/**
 * Id estable de una clase recurrent.
 *
 * Se deriva de la regla y de la fecha, no de un contador. Dos dispositivos
 * que generan el mismo lunes producen el mismo id y, al sincronizar, la
 * version se pisa en vez de duplicarse.
 */
export const classId = (recurrenceId: number | string, day: string) => `${recurrenceId}::${day}`

/** Instantes en el calendario, de 08:00 a 22:00. */
export const TIMES = Array.from({ length: 15 }, (_, i) => `${String(8 + i).padStart(2, '0')}:00`)

export const DAY_NAMES = ['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado', 'Domingo']
export const DAY_SHORT = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom']

export const stripAccents = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

/** "Lunes, Jueves" -> [1, 4] */
export function parseTrainingDays(value?: string): number[] {
  const found = new Set<number>()
  if (!value) return []
  String(value)
    .split(/[,;\s]+| y | e | y/)
    .map((p) => p.trim())
    .filter(Boolean)
    .forEach((part) => {
      const key = stripAccents(part).toLowerCase().slice(0, 3)
      const idx = DAY_SHORT.map((d) => d.toLowerCase()).indexOf(key)
      if (idx >= 0) found.add(idx + 1)
    })
  return [...found].sort((a, b) => a - b)
}

export const trainingDaysLabel = (nums: number[]) =>
  [...new Set(nums)].sort((a, b) => a - b).map((n) => DAY_NAMES[n - 1]).filter(Boolean).join(' y ')

/**
 * Fechas que le tocan a un alumno dentro de un periodo, respetando la cantidad
 * de clases contratadas de la mensualidad.
 */
export function classDatesFrom(anchor: string, dayNums: number[], count: number): string[] {
  if (!count) return []
  const set = new Set(dayNums)
  const result: string[] = []
  let cursor = date(anchor)
  let guard = 0
  while (result.length < count && guard < 800) {
    if (set.has(cursor.getDay() || 7)) result.push(iso(cursor))
    cursor = addDays(cursor, 1)
    guard += 1
  }
  return result
}

/**
 * Fechas de las clases de una regla dentro del rango indicado.
 * `maxCount` en 0 (o menor) significa "todas las del rango".
 */
export function ruleDates(
  days: number[],
  start: string,
  end: string,
  maxCount = 0,
): string[] {
  const set = new Set(days)
  const out: string[] = []
  let cursor = date(start)
  let guard = 0
  while (cursor <= date(end) && (maxCount <= 0 || out.length < maxCount) && guard < 800) {
    if (set.has(cursor.getDay() || 7)) out.push(iso(cursor))
    cursor = addDays(cursor, 1)
    guard += 1
  }
  return out
}

/** Ultima fecha de la clase que le toca a un alumno en el periodo. */
export const calcDue = (anchor: string, dayNums: number[], count: number) => {
  const ds = classDatesFrom(anchor, dayNums, count + 1)
  return ds[ds.length - 1] || anchor
}

export type PlanInput = {
  recurrence: Recurrence
  studentName: string
  /** Hasta donde se generan clases. */
  from: string
  to: string
  /** Tope de clases del periodo (included de la mensualidad). */
  limit?: number
  cycleId?: number | string
}

/**
 * Genera las clases de un alumno dentro de un rango.
 *
 * Devuelve SIEMPRE clases con el mismo id para la misma fecha, aunque se llame
 * cien veces. Quien las guarda tiene que filtrar las que ya existen.
 */
export function planClasses(input: PlanInput): ClassItem[] {
  const { recurrence, studentName, from, to, limit = 0, cycleId } = input
  if (!recurrence.active) return []
  // La ventana nunca puede empezar antes de la regla: un alumno no tiene
  // clases antes de empezar.
  const inicio = from > recurrence.start ? from : recurrence.start
  const days = ruleDates(recurrence.days, inicio, to, limit)
  return days.map((day) => ({
    id: classId(recurrence.id, day),
    studentId: recurrence.studentId,
    student: studentName,
    date: day,
    time: recurrence.time,
    court: recurrence.court,
    duration: recurrence.duration,
    type: 'recurrente' as const,
    status: 'Programada' as const,
    recurrenceId: recurrence.id,
    cycleId,
  }))
}

/**
 * Compara lo planificado con lo que ya existe y devuelve SOLO lo que se
 * agrego o se movio (los duplicados y lo que no cambio no se devuelven).
 *
 * - No agrega nada cuyo id ya este presente: por eso no hay duplicados.
 * - Las clases historicas (o ya realizadas) nunca se tocan.
 * - Si la regla cambio (dia u hora), las clases futuras que aun siguen
 *   "Programada" se actualizan con el dato nuevo; las historicas quedan
 *   intactas para no romper el historial.
 */
export function reconcileClasses(
  existing: ClassItem[],
  planned: ClassItem[],
  today: string,
): ClassItem[] {
  const byId = new Map(existing.map((c) => [String(c.id), c]))
  const added: ClassItem[] = []

  for (const next of planned) {
    const key = String(next.id)
    const prev = byId.get(key)
    if (!prev) {
      byId.set(key, next)
      added.push(next)
      continue
    }
    if (prev.date < today) continue
    if (prev.status !== 'Programada') continue
    const changed = prev.date !== next.date || prev.time !== next.time || prev.court !== next.court
    if (!changed) continue
    const moved: ClassItem = { ...prev, date: next.date, time: next.time, court: next.court }
    byId.set(key, moved)
    added.push(moved)
  }

  return added
}

/**
 * Reemplaza el conjunto completo aplicando solo lo planificado, para una
 * SOLA regla a la vez.
 *
 * - Mantiene el historial y lo ya confirmado siempre.
 * - Descarta unicamente las clases futuras "Programada" de `recurrenceId` que
 *   la regla nueva ya no contempla. Las clases de otras reglas no se tocan.
 */
export function applyPlan(
  existing: ClassItem[],
  planned: ClassItem[],
  today: string,
  recurrenceId?: number | string,
): ClassItem[] {
  const scoped = recurrenceId === undefined ? undefined : String(recurrenceId)
  const plannedIds = new Set(planned.map((c) => String(c.id)))
  const kept = existing.filter((c) => {
    if (!c.recurrenceId) return true
    if (scoped !== undefined && String(c.recurrenceId) !== scoped) return true
    if (plannedIds.has(String(c.id))) return true
    // Historial o ya confirmada: se conserva siempre.
    return c.date < today || c.status !== 'Programada'
  })
  const byId = new Map(kept.map((c) => [String(c.id), c]))
  for (const next of planned) {
    const key = String(next.id)
    const prev = byId.get(key)
    if (!prev) {
      byId.set(key, next)
      continue
    }
    if (prev.date < today || prev.status !== 'Programada') continue
    if (prev.date === next.date && prev.time === next.time && prev.court === next.court) continue
    byId.set(key, { ...prev, date: next.date, time: next.time, court: next.court })
  }
  return [...byId.values()]
}

/**
 * Una clase consume del ciclo cuando el alumno asistio, o cuando la falta o la
 * baja se descuenta segun las reglas de la mensualidad.
 */
export function consumes(cycle: Cycle | undefined, status: ClassStatus): boolean {
  if (!cycle) return false
  if (status === 'Realizada') return true
  if (status === 'Recuperada') return true
  if (status === 'Ausente') return !!cycle.absenceDeducts
  if (status === 'Cancelada') return !!cycle.cancellationDeducts
  return false
}

/**
 * Contadores del alumno derivados de sus clases reales. Nada se carga a mano.
 *
 * `contratadas` sale de la mensualidad; el resto se cuenta sobre el historial.
 */
export function studentStats(
  studentClasses: ClassItem[],
  cycle: Cycle | undefined,
  today: string,
) {
  const done = studentClasses.filter((c) => c.status === 'Realizada').length
  const recovered = studentClasses.filter((c) => c.status === 'Recuperada').length
  const absent = studentClasses.filter((c) => c.status === 'Ausente').length
  const canceled = studentClasses.filter((c) => c.status === 'Cancelada').length
  const scheduled = studentClasses.filter((c) => c.status === 'Programada').length
  const used = studentClasses.reduce((n, c) => n + (consumes(cycle, c.status) ? 1 : 0), 0)
  const contracted = cycle?.included ?? 0
  const remaining = Math.max(0, contracted - used)
  const ordered = [...studentClasses].sort((a, b) =>
    `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`),
  )
  const upcoming = ordered.filter((c) => c.status === 'Programada' && c.date >= today)

  return {
    done,
    recovered,
    absent,
    canceled,
    scheduled,
    contracted,
    used,
    remaining,
    upcoming,
    next: upcoming[0],
    percent: contracted ? Math.min(100, Math.round((used / contracted) * 100)) : 0,
    /**
     * Un circulo por clase, en orden cronologico. Se limita a lo contratado
     * para que el circulo grande sea la foto de la mensualidad, y se completa
     * con clases reales siTodavia hay mas.
     */
    dots: ordered.slice(0, Math.max(contracted, 0) || ordered.length).map((c) => ({
      id: c.id,
      date: c.date,
      time: c.time,
      status: c.status,
      note: c.note,
      court: c.court,
      recoveredFrom: c.recoveredFrom,
      realized: consumes(cycle, c.status),
      future: c.date >= today && c.status === 'Programada',
    })),
  }
}

/** Proxima clase pendiente de un alumno, tomando el calendario como fuente. */
export function nextClassFor(studentClasses: ClassItem[], today: string): ClassItem | undefined {
  return studentClasses
    .filter((c) => c.status === 'Programada' && c.date >= today)
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))[0]
}

/** Situacion del alumno: verde activo, amarillo pendiente, rojo inactivo. */
export function studentSituation(
  student: { active?: boolean } | undefined,
  cycle: Cycle | undefined,
  due: string,
  today: string,
  /** Clases ya consumidas, contadas desde las clases reales. */
  used?: number,
): 'activo' | 'pendiente' | 'inactivo' {
  if (student?.active === false) return 'inactivo'
  if (due && date(due) < date(today)) return 'pendiente'
  if (cycle && cycle.included > 0) {
    const taken = used === undefined ? cycle.consumed || 0 : used
    if (taken >= cycle.included) return 'pendiente'
  }
  return 'activo'
}

/** Cuantos alumnos caben en un horario (regla que ya usaba PadelCoach). */
export const MAX_PLAYERS_PER_SLOT = 4

/**
 * Reglas que ya usaba PadelCoach al crear una clase en un horario:
 * un alumno no puede estar dos veces en el mismo slot y el horario admite
 * hasta cuatro alumnos. Se conservan tal cual.
 */
export function slotConflict(
  classes: ClassItem[],
  candidate: { date: string; time: string; court: string; studentId: number | string },
  ignoreId?: number | string,
): 'alumno' | 'cupo' | null {
  const sameSlot = classes.filter(
    (c) =>
      String(c.id) !== String(ignoreId) &&
      c.date === candidate.date &&
      c.time === candidate.time &&
      c.court === candidate.court &&
      c.status !== 'Cancelada',
  )
  if (sameSlot.some((c) => sameId(c.studentId, candidate.studentId))) return 'alumno'
  if (sameSlot.length >= MAX_PLAYERS_PER_SLOT) return 'cupo'
  return null
}

/** Cambio de alumno en una clase: mueve el registro, no crea uno nuevo. */
export function reassignStudent(
  item: ClassItem,
  studentId: number | string,
  studentName: string,
): ClassItem {
  return { ...item, studentId, student: studentName }
}