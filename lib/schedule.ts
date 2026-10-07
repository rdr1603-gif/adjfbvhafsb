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

// --------------------------------------------------------------------------
// Calendario: etiquetas, celdas y navegacion (sin depender de React).
// --------------------------------------------------------------------------

/** Nombres completos de mes en español, indice 0 = enero. */
export const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]
export const MONTHS_ES_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

/** Encabezado de cada columna del calendario semanal: LUN, MAR, ... */
export const DAY_HEAD = ['LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB', 'DOM']

/** Franjas del calendario y del detalle del dia: 06:00 a 24:00. */
export const GRID_TIMES = Array.from({ length: 19 }, (_, i) => `${String(6 + i).padStart(2, '0')}:00`)

/**
 * Rango de la semana en palabras: "6 — 12 de octubre de 2026".
 * Si cruza de mes o de año, ambos extremos llevan su mes/año.
 */
export function weekRangeLabel(days: string[]): string {
  if (!days.length) return ''
  const a = date(days[0])
  const b = date(days[days.length - 1])
  const month = (d: Date) => MONTHS_ES[d.getMonth()].toLowerCase()
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
    return `${a.getDate()} — ${b.getDate()} de ${month(a)} de ${a.getFullYear()}`
  }
  if (a.getFullYear() === b.getFullYear()) {
    return `${a.getDate()} de ${month(a)} — ${b.getDate()} de ${month(b)} de ${a.getFullYear()}`
  }
  return `${a.getDate()} de ${month(a)} de ${a.getFullYear()} — ${b.getDate()} de ${month(b)} de ${b.getFullYear()}`
}

/** "LUN 06"; si el dia cae en otro mes que el inicio de semana, agrega "OCT". */
export function dayHeadLabel(day: string, weekStart: string): string {
  const d = date(day)
  const base = date(weekStart)
  const wd = d.getDay() || 7
  const dd = String(d.getDate()).padStart(2, '0')
  const sameMonth = d.getFullYear() === base.getFullYear() && d.getMonth() === base.getMonth()
  return sameMonth ? `${DAY_HEAD[wd - 1]} ${dd}` : `${DAY_HEAD[wd - 1]} ${dd} ${MONTHS_ES_SHORT[d.getMonth()].toUpperCase()}`
}

/** "Octubre 2026" (month es 0-based). */
export const monthTitle = (year: number, month: number) => `${MONTHS_ES[month]} ${year}`

/** Desplaza un mes calendario respetando el cambio de año. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + month + delta
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 }
}

/**
 * Celdas del mes para el calendario mensual, arrancando el lunes.
 * Devuelve 5 o 6 semanas completas (35 o 42 dias) en ISO.
 */
export function monthCells(year: number, month: number): string[] {
  const first = new Date(year, month, 1, 12)
  const lead = (first.getDay() || 7) - 1
  const daysInMonth = new Date(year, month + 1, 0, 12).getDate()
  const rows = Math.ceil((lead + daysInMonth) / 7)
  const start = addDays(first, -lead)
  return Array.from({ length: rows * 7 }, (_, i) => iso(addDays(start, i)))
}

/** Cuantas semanas se movio `day` respecto de la semana que contiene `today`. */
export function weekOffsetFor(day: string, today: string): number {
  const ws = (s: string) => date(startOfWeek(0, s))
  return Math.round((ws(day).getTime() - ws(today).getTime()) / 604800000)
}

/** Mes de una fecha ISO. */
export function monthOf(day: string): { year: number; month: number } {
  const d = date(day)
  return { year: d.getFullYear(), month: d.getMonth() }
}

/** True si la semana dada pisa el mes visible (para mantener sincronizado el mensual). */
export function monthContainsWeek(year: number, month: number, days: string[]): boolean {
  return days.some((d) => {
    const x = date(d)
    return x.getFullYear() === year && x.getMonth() === month
  })
}

// --------------------------------------------------------------------------
// Horario por dia del alumno (requisito 21).
// --------------------------------------------------------------------------

export type TrainingSlot = { day: number; time: string }

/** "1:08:00,3:07:00" -> [{day:1,time:'08:00'},{day:3,time:'07:00'}] */
export function parseTrainingSchedule(value?: string): TrainingSlot[] {
  if (!value) return []
  const seen = new Set<string>()
  const out: TrainingSlot[] = []
  String(value)
    .split(/[,;\s]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .forEach((part) => {
      const m = part.match(/^([1-7])\s*[:=]\s*(\d{1,2}):(\d{2})$/)
      if (!m) return
      const day = Number(m[1])
      const time = `${m[2].padStart(2, '0')}:${m[3]}`
      const key = `${day}:${time}`
      if (seen.has(key)) return
      seen.add(key)
      out.push({ day, time })
    })
  return out.sort((a, b) => a.day - b.day || a.time.localeCompare(b.time))
}

/** Inverso de parseTrainingSchedule, sin duplicados y ordenado. */
export function formatTrainingSchedule(slots: TrainingSlot[]): string {
  const seen = new Set<string>()
  return slots
    .filter((s) => s.day >= 1 && s.day <= 7 && /^\d{1,2}:\d{2}$/.test(s.time))
    .map((s) => ({ day: s.day, time: s.time.length === 4 ? `0${s.time}` : s.time }))
    .sort((a, b) => a.day - b.day || a.time.localeCompare(b.time))
    .filter((s) => {
      const key = `${s.day}:${s.time}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((s) => `${s.day}:${s.time}`)
    .join(',')
}

/** Etiqueta legible del horario por dia: "Lun 08:00 · Mie 07:00". */
export function trainingScheduleLabel(slots: TrainingSlot[]): string {
  return [...slots]
    .sort((a, b) => a.day - b.day || a.time.localeCompare(b.time))
    .map((s) => `${DAY_SHORT[s.day - 1] || ''} ${s.time}`.trim())
    .join(' · ')
}

export type StudentLike = {
  trainingDays?: string
  trainingTime?: string
  /** Horario distinto por dia. Si esta vacio, se usa dias + trainingTime. */
  trainingSchedule?: string
}

/**
 * Horario efectivo del alumno. Prioriza el horario por dia; si no existe,
 * reparte el `trainingTime` entre los dias seleccionados.
 */
export function studentSchedule(student: StudentLike | undefined): TrainingSlot[] {
  if (!student) return []
  const explicit = parseTrainingSchedule(student.trainingSchedule)
  if (explicit.length) return explicit
  const days = parseTrainingDays(student.trainingDays)
  const time = String(student.trainingTime || '').trim()
  if (!days.length || !/^\d{1,2}:\d{2}$/.test(time)) return []
  const norm = time.length === 4 ? `0${time}` : time
  return days.map((day) => ({ day, time: norm }))
}

/** Agrupa los dias que comparten horario: base para crear una regla por hora. */
export function scheduleGroups(slots: TrainingSlot[]): { days: number[]; time: string }[] {
  const byTime = new Map<string, Set<number>>()
  slots.forEach((s) => {
    if (!byTime.has(s.time)) byTime.set(s.time, new Set())
    byTime.get(s.time)!.add(s.day)
  })
  return [...byTime.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([time, days]) => ({ time, days: [...days].sort((a, b) => a - b) }))
}

export type RuleSpec = {
  days: number[]
  time: string
  duration?: number
  court?: string
  start: string
}

export type RuleSync = {
  /** Reglas nuevas o actualizadas (todas activas). */
  upserts: Recurrence[]
  /** Ids de reglas que quedaron inactivas porque ya no tienen horario. */
  removed: (number | string)[]
}

/**
 * Ajusta las reglas de un alumno al horario deseado sin perder ids: la regla
 * que cambia de hora/dias conserva su id (asi sus clases se mueven en vez de
 * duplicarse) y solo se crea una nueva cuando hace falta otra franja horaria.
 */
export function reconcileRules(
  current: Recurrence[],
  studentId: number | string,
  desired: RuleSpec[],
  makeId: () => number | string,
): RuleSync {
  const active = current.filter((r) => r.active && sameId(r.studentId, studentId))
  const used = new Set<number>()
  const matches: (Recurrence | undefined)[] = desired.map(() => undefined)

  desired.forEach((spec, i) => {
    const idx = active.findIndex((r, j) => !used.has(j) && r.time === spec.time)
    if (idx >= 0) {
      used.add(idx)
      matches[i] = active[idx]
    }
  })
  desired.forEach((_, i) => {
    if (matches[i]) return
    const idx = active.findIndex((_, j) => !used.has(j))
    if (idx >= 0) {
      used.add(idx)
      matches[i] = active[idx]
    }
  })

  const upserts = desired.map((spec, i): Recurrence => {
    const base = matches[i]
    const start = base?.start && base.start < spec.start ? base.start : spec.start
    return {
      id: base ? base.id : makeId(),
      studentId,
      days: [...spec.days].sort((a, b) => a - b),
      time: spec.time,
      duration: spec.duration ?? base?.duration ?? 60,
      court: spec.court ?? base?.court ?? 'Cancha 1',
      start,
      active: true,
    }
  })
  const removed = active.filter((_, j) => !used.has(j)).map((r) => r.id)
  return { upserts, removed }
}

// --------------------------------------------------------------------------
// Detalle del dia y materializacion con presupuesto compartido.
// --------------------------------------------------------------------------

/**
 * Horas configuradas para un dia de la semana: salen de las reglas activas y
 * del horario de los alumnos. Es la disponibilidad real, no inventada.
 */
export function configuredTimesFor(
  weekday: number,
  students: StudentLike[],
  recurrences: Recurrence[],
): string[] {
  const times = new Set<string>()
  recurrences.forEach((r) => {
    if (r.active && r.days.includes(weekday) && r.time) times.add(r.time)
  })
  students.forEach((s) => {
    studentSchedule(s).forEach((slot) => {
      if (slot.day === weekday && slot.time) times.add(slot.time)
    })
  })
  return [...times].sort()
}

export type DaySlotState = 'ocupada' | 'disponible' | 'sin-horario'
export type DaySlot = { time: string; state: DaySlotState; classes: ClassItem[] }

/**
 * Cronologia de un dia: cada franja 06:00–24:00 con las clases que caen en
 * ella. Una franja sin clase pero con horario configurado queda "disponible";
 * el resto es "sin-horario" (no se inventa disponibilidad).
 */
export function daySchedule(
  day: string,
  classes: ClassItem[],
  configured: string[],
  gridTimes: string[] = GRID_TIMES,
): DaySlot[] {
  const set = new Set(configured)
  return gridTimes.map((time) => {
    const mine = classes
      .filter((c) => c.date === day && c.time === time)
      .sort((a, b) => a.student.localeCompare(b.student))
    return { time, state: mine.length ? 'ocupada' : set.has(time) ? 'disponible' : 'sin-horario', classes: mine }
  })
}

export type DayCounts = {
  total: number
  realizadas: number
  programadas: number
  ausentes: number
  canceladas: number
  recuperadas: number
}

/** Contadores de un dia para los indicadores del calendario mensual. */
export function dayCounts(day: string, classes: ClassItem[]): DayCounts {
  const mine = classes.filter((c) => c.date === day)
  const count = (s: ClassStatus) => mine.filter((c) => c.status === s).length
  return {
    total: mine.length,
    realizadas: count('Realizada') + count('Recuperada'),
    programadas: count('Programada'),
    ausentes: count('Ausente'),
    canceladas: count('Cancelada'),
    recuperadas: count('Recuperada'),
  }
}

export type StudentPlanInput = {
  rules: Recurrence[]
  studentName: string
  from: string
  to: string
  /** Tope total de clases del periodo, compartido entre todas las reglas. */
  limit?: number
  cycleId?: number | string
}

/**
 * Materializa TODAS las reglas de un alumno con un presupuesto compartido.
 *
 * El problema del presupuesto por regla era que un alumno con dos horarios
 * generaba `included` clases por cada uno (el doble de lo contratado). Aqui se
 * juntan las fechas de todas las reglas, se ordenan cronologicamente y se
 * cortan al limite de la mensualidad.
 */
export function planStudent(input: StudentPlanInput): ClassItem[] {
  const { rules, studentName, from, to, limit = 0, cycleId } = input
  const candidates: { rule: Recurrence; day: string }[] = []
  for (const rule of rules) {
    if (!rule.active) continue
    const inicio = from > rule.start ? from : rule.start
    ruleDates(rule.days, inicio, to, 0).forEach((day) => candidates.push({ rule, day }))
  }
  candidates.sort((a, b) => a.day.localeCompare(b.day) || a.rule.time.localeCompare(b.rule.time))
  const chosen = limit > 0 ? candidates.slice(0, limit) : candidates
  return chosen.map(({ rule, day }) => ({
    id: classId(rule.id, day),
    studentId: rule.studentId,
    student: studentName,
    date: day,
    time: rule.time,
    court: rule.court,
    duration: rule.duration,
    type: 'recurrente' as const,
    status: 'Programada' as const,
    recurrenceId: rule.id,
    cycleId,
  }))
}