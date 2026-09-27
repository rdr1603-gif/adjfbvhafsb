import { clearAttempts, tooManyAttempts } from '@/lib/rate-limit'
import { startSession, verifyPassword } from '@/lib/session'
import { findUserByEmail } from '@/lib/users'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Solicitud invalida' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!email || !password) {
    return Response.json({ error: 'Ingresa tu correo y contrasena' }, { status: 400 })
  }

  const key = `login:${email.toLowerCase()}`
  if (tooManyAttempts(key, 10, 15 * 60 * 1000)) {
    return Response.json(
      { error: 'Demasiados intentos fallidos. Espera unos minutos.' },
      { status: 429 },
    )
  }

  const user = await findUserByEmail(email)
  if (!user || !verifyPassword(password, user.password_hash)) {
    return Response.json({ error: 'Correo o contrasena incorrectos' }, { status: 401 })
  }

  clearAttempts(key)
  await startSession(user.id)
  return Response.json({ user: { id: user.id, email: user.email, name: user.name } })
}
