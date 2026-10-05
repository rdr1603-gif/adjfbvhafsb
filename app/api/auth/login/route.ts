import { clearAttempts, clientIp, tooManyAttempts } from '@/lib/rate-limit'
import { pinLookupKey, startSession, verifyPin } from '@/lib/session'
import { findUserByPinKey } from '@/lib/users'
import { normalizePin, validatePin } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VENTANA = 15 * 60 * 1000

export async function POST(request: Request) {
  // El limite por IP va primero y es el barato: corta el ataque antes de
  // derivar claves o calcular un scrypt.
  if (await tooManyAttempts(`login:ip:${clientIp(request)}`, 20, VENTANA)) {
    return Response.json(
      { error: 'Demasiados intentos. Espera unos minutos.' },
      { status: 429 },
    )
  }

  let body: { pin?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Solicitud invalida' }, { status: 400 })
  }

  const pin = normalizePin(body.pin)
  const pinError = validatePin(pin)
  if (pinError) return Response.json({ error: pinError }, { status: 400 })

  const pinKey = pinLookupKey(pin)
  // Segundo limite, por PIN: frena a quien reparte los intentos entre IPs.
  if (await tooManyAttempts(`login:pin:${pinKey}`, 10, VENTANA)) {
    return Response.json(
      { error: 'Demasiados intentos fallidos. Espera unos minutos.' },
      { status: 429 },
    )
  }

  const user = await findUserByPinKey(pinKey)
  // Mismo mensaje en ambos casos: no sirve de nada confirmar que el PIN existe.
  if (!user || !verifyPin(pin, user.pin_hash)) {
    return Response.json({ error: 'PIN incorrecto' }, { status: 401 })
  }

  await clearAttempts(`login:pin:${pinKey}`)
  await startSession(user.id)
  return Response.json({ user: { id: user.id, name: user.name } })
}