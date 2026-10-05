import { clearAttempts, clientIp, tooManyAttempts } from '@/lib/rate-limit'
import { currentUserId, hashPin, pinLookupKey, verifyPin } from '@/lib/session'
import { findUserById, findUserByPinKey, updateUserPin } from '@/lib/users'
import { normalizePin, validatePin } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VENTANA = 15 * 60 * 1000

/**
 * Cambia el PIN de la cuenta con la sesion activa.
 *
 * Exige el PIN actual a proposito: la sesion dura 60 dias, asi que sin esta
 * comprobacion cualquiera que se quede con el navegador abierto podria dejar la
 * cuenta bloqueada para siempre, que es justo el riesgo de un PIN corto.
 */
export async function POST(request: Request) {
  const userId = await currentUserId()
  if (!userId) return Response.json({ error: 'No has iniciado sesion' }, { status: 401 })

  if (await tooManyAttempts(`cambiarpin:ip:${clientIp(request)}`, 10, VENTANA)) {
    return Response.json(
      { error: 'Demasiados intentos. Espera unos minutos.' },
      { status: 429 },
    )
  }

  let body: { pin?: unknown; nuevo?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Solicitud invalida' }, { status: 400 })
  }

  const pin = normalizePin(body.pin)
  const nuevo = normalizePin(body.nuevo)
  const pinError = validatePin(pin)
  if (pinError) return Response.json({ error: pinError }, { status: 400 })
  const nuevoError = validatePin(nuevo)
  if (nuevoError) return Response.json({ error: nuevoError }, { status: 400 })

  const user = await findUserById(userId)
  if (!user) return Response.json({ error: 'No has iniciado sesion' }, { status: 401 })

  const pinKey = pinLookupKey(pin)
  if (await tooManyAttempts(`cambiarpin:pin:${pinKey}`, 10, VENTANA)) {
    return Response.json(
      { error: 'Demasiados intentos fallidos. Espera unos minutos.' },
      { status: 429 },
    )
  }

  if (!verifyPin(pin, user.pin_hash)) {
    return Response.json({ error: 'El PIN actual no coincide' }, { status: 401 })
  }

  const nuevaKey = pinLookupKey(nuevo)
  const ocupada = await findUserByPinKey(nuevaKey)
  if (ocupada && ocupada.id !== user.id) {
    return Response.json({ error: 'Ese PIN ya esta en uso' }, { status: 409 })
  }

  const ok = await updateUserPin(userId, nuevaKey, hashPin(nuevo))
  if (!ok) {
    return Response.json({ error: 'Ese PIN ya esta en uso' }, { status: 409 })
  }
  await clearAttempts(`cambiarpin:pin:${pinKey}`)

  return Response.json({ ok: true })
}