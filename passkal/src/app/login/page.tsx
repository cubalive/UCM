'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const supabase = useMemo(() => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
  ), [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/portal/bookings')
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4" style={{ background: 'linear-gradient(180deg, #0A0A1A 0%, #1A1A2E 100%)' }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="text-2xl font-bold inline-block" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>PASSKAL</Link>
          <h1 className="text-2xl font-bold text-white mt-6 mb-2">Iniciar Sesión</h1>
          <p className="text-gray-400 text-sm">Accede a tu portal de marketing</p>
        </div>
        <form onSubmit={handleLogin} className="rounded-2xl p-8 space-y-4" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(15,52,96,0.3)' }}>
          {error && <div className="text-red-400 text-sm text-center p-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)' }}>{error}</div>}
          <div>
            <label className="text-gray-400 text-sm mb-1 block">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full px-4 py-3 rounded-lg text-white text-sm outline-none focus:ring-2 focus:ring-blue-500/50"
              style={{ background: 'rgba(15,52,96,0.2)', border: '1px solid rgba(15,52,96,0.4)' }}
              placeholder="tu@email.com" />
          </div>
          <div>
            <label className="text-gray-400 text-sm mb-1 block">Contraseña</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
              className="w-full px-4 py-3 rounded-lg text-white text-sm outline-none focus:ring-2 focus:ring-blue-500/50"
              style={{ background: 'rgba(15,52,96,0.2)', border: '1px solid rgba(15,52,96,0.4)' }}
              placeholder="••••••••" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-3 rounded-lg text-white font-medium text-sm transition-all hover:opacity-90 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
          <p className="text-center text-gray-500 text-sm">
            ¿No tienes cuenta? <Link href="/register" className="text-blue-400 hover:underline">Regístrate</Link>
          </p>
        </form>
      </div>
    </main>
  )
}
