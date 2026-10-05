import { clearAttempts, clientIp, tooManyAttempts } from '@/lib/rate-limit'
import { hashPin, pinLookupKey, startSession } from '@/lib/session'
import { createUser, ensureProfile, findUserByPinKey } from '@/lib/users'
import { normalizePin, validateEmail, validatePin } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VENTANA = 60 * 60 * 1000

export async function POST(request: Request) {
  // 30 por hora y por IP: frena la fabricacion masiva de cuentas sin castigar a
  // unasalida de escuela u oficina, donde detras de una sola IP hay mucha gente.
  if (await tooManyAttempts(`register:ip:${clientIp(request)}`, 30, VENTANA)) {
    return Response.json(
      { error: 'Demasiadas cuentas creadas desde aqui. Intenta mas tarde.' },
      { status: 429 },
    )
  }

  let body: { pin?: unknown; name?: unknown; email?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Solicitud invalida' }, { status: 400 })
  }

  const pin = normalizePin(body.pin)
  const pinError = validatePin(pin)
  if (pinError) return Response.json({ error: pinError }, { status: 400 })

  // El correo ya no es parte del acceso. Sigue aceptandose como dato opcional
  // para las pruebas y para no perder el registro de cuentas ya creadas.
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  if (email) {
    const emailError = validateEmail(email)
    if (emailError) return Response.json({ error: emailError }, { status: 400 })
  }
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : ''

  const pinKey = pinLookupKey(pin)
  if (await tooManyAttempts(`register:pin:${pinKey}`, 5, VENTANA)) {
    return Response.json(
      { error: 'Ese PIN ya se uso demasiadas veces. Prueba con otro.' },
      { status: 429 },
    )
  }

  if (await findUserByPinKey(pinKey)) {
    return Response.json({ error: 'Ese PIN ya esta en uso' }, { status: 409 })
  }

  const user = await createUser({ name: name || 'Profe', pinKey, pinHash: hashPin(pin), email })
  // null = otra cuenta se adelanto entre el find y el insert.
  if (!user) {
    return Response.json({ error: 'Ese PIN ya esta en uso' }, { status: 409 })
  }
  await ensureProfile(user.id)
  await startSession(user.id)
  await clearAttempts(`register:pin:${pinKey}`)

  return Response.json({ user: { id: user.id, name: user.name } })
}