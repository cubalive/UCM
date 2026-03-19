'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function CreateChatbotPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [botId, setBotId] = useState('')
  const [form, setForm] = useState({
    name: '', businessName: '', industry: '',
    description: '', faq: '', products: '',
    prices: '', policies: '', greeting: '',
    color: '#0F3460', language: 'es',
  })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  async function createBot() {
    setLoading(true)
    const res = await fetch('/api/chatbots/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json() as { botId: string }
    setBotId(data.botId)
    setStep(3)
    setLoading(false)
  }

  const inputClass = "w-full px-4 py-3 rounded-xl text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500 text-sm"
  const inputStyle = { background: 'rgba(15,52,96,0.2)', border: '1px solid rgba(15,52,96,0.4)' }
  const embedCode = `<script src="https://passkal.com/chatbot.js" data-bot-id="${botId}"></script>`

  return (
    <div className="min-h-screen p-8" style={{ background: '#0F0F1A' }}>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/portal/chatbots" className="text-gray-400 hover:text-white">Chatbots</Link>
          <h1 className="text-2xl font-bold text-white">Crear chatbot</h1>
        </div>

        {step === 1 && (
          <div className="rounded-xl p-6 space-y-4" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(15,52,96,0.3)' }}>
            <h2 className="text-white font-semibold">Informacion basica</h2>
            {[
              { k: 'name', l: 'Nombre del chatbot *', p: 'Ej: Asistente de El Restaurante' },
              { k: 'businessName', l: 'Nombre del negocio *', p: 'Ej: Restaurante El Cubano' },
              { k: 'industry', l: 'Industria', p: 'Ej: Restaurante, Clinica, Ecommerce' },
              { k: 'greeting', l: 'Mensaje de bienvenida', p: 'Hola! Soy el asistente de... En que puedo ayudarte?' },
            ].map(({ k, l, p }) => (
              <div key={k}>
                <label className="block text-sm text-gray-300 mb-2">{l}</label>
                <input value={form[k as keyof typeof form]} onChange={e => set(k, e.target.value)} placeholder={p} className={inputClass} style={inputStyle} />
              </div>
            ))}
            <div>
              <label className="block text-sm text-gray-300 mb-2">Idioma</label>
              <div className="flex gap-2">
                {[{ k: 'es', l: 'Espanol' }, { k: 'en', l: 'English' }].map(({ k, l }) => (
                  <button key={k} type="button" onClick={() => set('language', k)}
                    className="flex-1 py-2 rounded-lg text-sm font-medium"
                    style={{ background: form.language === k ? '#0F3460' : 'rgba(15,52,96,0.1)', border: `1px solid ${form.language === k ? '#60a5fa' : 'rgba(15,52,96,0.3)'}`, color: form.language === k ? 'white' : '#9ca3af' }}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={() => setStep(2)} disabled={!form.name || !form.businessName}
              className="w-full py-3 rounded-xl text-white font-medium disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>
              Continuar — Agregar conocimiento
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="rounded-xl p-6 space-y-4" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(15,52,96,0.3)' }}>
            <h2 className="text-white font-semibold">Base de conocimiento del bot</h2>
            <p className="text-gray-400 text-sm">Entre mas info des, mejores respuestas dara el chatbot</p>
            {[
              { k: 'description', l: 'Que hace tu negocio?', p: 'Somos un restaurante cubano en Las Vegas especializado en...', rows: 3 },
              { k: 'faq', l: 'Preguntas frecuentes (una por linea)', p: 'Cuales son los horarios? — Abierto de 11am a 10pm\nTienen delivery? — Si, via DoorDash y UberEats', rows: 4 },
              { k: 'products', l: 'Productos/Servicios principales', p: 'Ropa Vieja $18, Picadillo $15, Lechon asado $22...', rows: 3 },
              { k: 'policies', l: 'Politicas importantes', p: 'Reservaciones con 24h de anticipacion. Cancelaciones hasta 2h antes...', rows: 3 },
            ].map(({ k, l, p, rows }) => (
              <div key={k}>
                <label className="block text-sm text-gray-300 mb-2">{l}</label>
                <textarea value={form[k as keyof typeof form]} onChange={e => set(k, e.target.value)} rows={rows} placeholder={p}
                  className={`${inputClass} resize-none`} style={inputStyle} />
              </div>
            ))}
            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="flex-1 py-3 rounded-xl text-gray-400 text-sm" style={{ background: 'rgba(15,52,96,0.1)', border: '1px solid rgba(15,52,96,0.3)' }}>Atras</button>
              <button onClick={createBot} disabled={loading}
                className="flex-[2] px-8 py-3 rounded-xl text-white font-medium disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>
                {loading ? 'Creando bot...' : 'Crear chatbot'}
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="rounded-xl p-6 space-y-6" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(52,211,153,0.3)' }}>
            <div className="text-center">
              <div className="text-5xl mb-4">🎉</div>
              <h2 className="text-2xl font-bold text-white mb-2">Chatbot creado!</h2>
              <p className="text-gray-400">Instala este codigo en tu website para activarlo</p>
            </div>
            <div className="rounded-xl p-4" style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(52,211,153,0.2)' }}>
              <p className="text-gray-400 text-xs mb-2">Agrega esto antes de {'</body>'} en tu HTML:</p>
              <code className="text-green-400 text-xs break-all">{embedCode}</code>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <button onClick={() => { navigator.clipboard.writeText(embedCode) }}
                className="py-3 rounded-xl text-sm font-medium"
                style={{ background: 'rgba(52,211,153,0.2)', border: '1px solid rgba(52,211,153,0.3)', color: '#34d399' }}>
                Copiar codigo
              </button>
              <Link href="/portal/chatbots" className="py-3 rounded-xl text-white text-sm font-medium text-center"
                style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>
                Ver mis chatbots
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
