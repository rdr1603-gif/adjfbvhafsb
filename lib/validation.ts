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

/**
 * El PIN es el unico acceso, asi que la forma tiene que ser estricta: solo
 * digitos, de 4 a 8. Se descartan espacios y guiones para que "4 8 2 1" y
 * "4821" sean el mismo PIN.
 */
const PIN_RE = /^\d{4,8}$/

export function normalizePin(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\D/g, '')
}

export function validatePin(value: unknown): string | null {
  const pin = normalizePin(value)
  if (!pin) return 'Ingresa tu PIN'
  if (!PIN_RE.test(pin)) return 'El PIN debe tener entre 4 y 8 digitos'
  return null
}
