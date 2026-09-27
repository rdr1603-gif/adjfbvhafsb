import { createUser, ensureProfile, findUserByEmail } from '@/lib/users'
import { clearAttempts, tooManyAttempts } from '@/lib/rate-limit'
import { hashPassword, startSession } from '@/lib/session'
import { validateEmail, validatePassword } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown; name?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Solicitud invalida' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : ''
  const emailError = validateEmail(email)
  const passwordError = validatePassword(body.password)
  if (emailError) return Response.json({ error: emailError }, { status: 400 })
  if (passwordError) return Response.json({ error: passwordError }, { status: 400 })

  const key = `register:${email.toLowerCase()}`
  if (tooManyAttempts(key, 5, 60 * 60 * 1000)) {
    return Response.json(
      { error: 'Demasiados registros desde este correo. Intenta mas tarde.' },
      { status: 429 },
    )
  }

  const existing = await findUserByEmail(email)
  if (existing) {
    return Response.json({ error: 'Ya existe una cuenta con ese correo' }, { status: 409 })
  }

  const user = await createUser(email, name || email.split('@')[0], hashPassword(String(body.password)))
  await ensureProfile(user.id)
  await startSession(user.id)
  clearAttempts(key)

  return Response.json({ user: { id: user.id, email: user.email, name: user.name } })
}
