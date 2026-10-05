'use client'

import { useState } from 'react'
import { KeyRound, X } from 'lucide-react'

/**
 * Cambio de PIN. Sin esto, olvidar el PIN deja la cuenta sin forma de entrar:
 * con 4-8 digitos el correo de recuperacion no ayuda, porque ya no hay ninguno.
 * Exige el PIN actual y avisa que las otras sesiones siguen abiertas.
 */
export default function ChangePin() {
  const [abierto, setAbierto] = useState(false)
  const [pin, setPin] = useState('')
  const [nuevo, setNuevo] = useState('')
  const [error, setError] = useState('')
  const [ok, setOk] = useState(false)
  const [busy, setBusy] = useState(false)

  const cerrar = () => {
    setAbierto(false)
    setPin('')
    setNuevo('')
    setError('')
    setOk(false)
  }

  const enviar = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const response = await fetch('/api/auth/pin', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin, nuevo }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data?.error || 'No se pudo cambiar el PIN')
        return
      }
      setOk(true)
      setPin('')
      setNuevo('')
    } catch {
      setError('Sin conexion con el servidor. Intenta de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  if (!abierto) {
    return (
      <button type="button" className="action" onClick={() => setAbierto(true)}>
        <KeyRound /> Cambiar PIN
      </button>
    )
  }

  return (
    <div className="overlay">
      <div className="modal" style={{ width: 'min(420px, 100%)' }}>
        <div className="modal-head">
          <strong>Cambiar tu PIN</strong>
          <button className="icon-btn" onClick={cerrar} aria-label="Cerrar">
            <X />
          </button>
        </div>

        {ok ? (
          <>
            <p className="muted">Listo. A partir de ahora usá el PIN nuevo.</p>
            <button className="primary full" onClick={cerrar}>
              Cerrar
            </button>
          </>
        ) : (
          <form onSubmit={enviar}>
            <label>
              PIN actual
              <span className="auth-input">
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  required
                  maxLength={8}
                  placeholder="4 a 8 digitos"
                />
              </span>
            </label>
            <label>
              PIN nuevo
              <span className="auth-input">
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={nuevo}
                  onChange={(e) => setNuevo(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  required
                  maxLength={8}
                  placeholder="4 a 8 digitos"
                />
              </span>
            </label>

            {error && <p className="auth-error">{error}</p>}

            <button className="primary full" disabled={busy}>
              {busy ? 'Un momento...' : 'Cambiar PIN'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}