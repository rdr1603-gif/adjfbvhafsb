export function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function validateEmail(email: string): string | null {
  if (!email) return 'Ingresa tu correo electronico'
  if (email.length > 160 || !EMAIL_RE.test(email)) return 'El correo electronico no es valido'
  return null
}

export function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string' || !password) return 'Ingresa una contrasena'
  if (password.length < 8) return 'La contrasena debe tener al menos 8 caracteres'
  if (password.length > 200) return 'La contrasena es demasiado larga'
  return null
}
