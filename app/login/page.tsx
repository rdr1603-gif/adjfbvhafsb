'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Cloud, CloudOff, Lock, Mail, User } from 'lucide-react'

type Mode = 'login' | 'register'

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let active = true
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((data) => {
        if (!active) return
        if (data?.user) router.replace('/')
        else setChecking(false)
      })
      .catch(() => active && setChecking(false))
    return () => {
      active = false
    }
  }, [router])

  const submit = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const response = await fetch(`/api/auth/${mode === 'login' ? 'login' : 'register'}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(mode === 'login' ? { email, password } : { email, password, name }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data?.error || 'No se pudo completar la operacion')
        return
      }
      router.replace('/')
      router.refresh()
    } catch {
      setError('Sin conexion con el servidor. Intenta de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  if (checking) {
    return (
      <div className="overlay">
        <div className="modal" style={{ width: 'min(420px, 100%)', textAlign: 'center' }}>
          <Cloud className="auth-icon" />
          <p className="muted">Verificando tu sesion...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="overlay">
      <div className="modal auth-modal">
        <div className="modal-head">
          <div className="brand" style={{ padding: 0 }}>
            <div className="brand-mark">PP</div>
            <div>
              <strong>Profe Padel</strong>
              <span>PRO</span>
            </div>
          </div>
        </div>

        <div className="auth-intro">
          <Cloud className="auth-icon" />
          <h2>{mode === 'login' ? 'Entrar a tu cuenta' : 'Crear tu cuenta'}</h2>
          <p>
            {mode === 'login'
              ? 'Tus alumnos, clases y pagos se sincronizan entre el celular y la computadora.'
              : 'Registrate una vez y accede a los mismos datos desde cualquier dispositivo.'}
          </p>
        </div>

        <form onSubmit={submit}>
          {mode === 'register' && (
            <label>
              Tu nombre
              <span className="auth-input">
                <User />
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  placeholder="Como te llamamos"
                />
              </span>
            </label>
          )}
          <label>
            Correo electronico
            <span className="auth-input">
              <Mail />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                placeholder="profesor@correo.com"
              />
            </span>
          </label>
          <label>
            Contrasena
            <span className="auth-input">
              <Lock />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={8}
                placeholder="Minimo 8 caracteres"
              />
            </span>
          </label>

          {error && <p className="auth-error">{error}</p>}

          <button className="primary full" disabled={busy}>
            <Check /> {busy ? 'Un momento...' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}
          </button>
        </form>

        <button
          type="button"
          className="auth-switch"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login')
            setError('')
          }}
        >
          {mode === 'login' ? 'Todavia no tenes cuenta? Crear una' : 'Ya tenes cuenta? Entrar'}
        </button>

        <p className="auth-offline">
          <CloudOff />
          Los datos que ya tenes en este dispositivo se suben automaticamente al crear la cuenta.
        </p>
      </div>
    </div>
  )
}
