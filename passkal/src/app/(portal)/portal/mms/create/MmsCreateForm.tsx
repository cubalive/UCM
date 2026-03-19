'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
export default function MmsCreateForm({ orgId }: { orgId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [form, setForm] = useState({ name: '', objective: '', message_content: '', media_url: '' })
  const [recipients, setRecipients] = useState('')
  async function generateWithAI() {
    if (!form.objective) return
    setGenerating(true)
    try {
      const res = await fetch('/api/ai/advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Write a short SMS/MMS marketing message (max 160 chars) for this objective: ${form.objective}. Make it compelling with a clear CTA. Reply with just the message text.`,
          history: []
        })
      })
      const data = await res.json() as { response: string }
      setForm(f => ({ ...f, message_content: data.response.slice(0, 160) }))
    } finally {
      setGenerating(false)
    }
  }
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const recipientList = recipients.split('\n').filter(r => r.trim()).map(phone => ({ phone: phone.trim() }))
    const supabase = createClient()
    await supabase.from('mms_campaigns').insert({
      org_id: orgId,
      name: form.name,
      objective: form.objective || null,
      message_content: form.message_content,
      media_url: form.media_url || null,
      recipient_count: recipientList.length,
      recipient_list: recipientList,
      status: 'draft',
    })
    router.push('/portal/mms')
  }
  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="rounded-xl p-6 space-y-4" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(15,52,96,0.3)' }}>
        <div>
          <label className="block text-sm text-gray-300 mb-2">Nombre de la campaña *</label>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required placeholder="Ej: Promo Verano 2025" className="w-full px-4 py-3 rounded-xl text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500" style={{ background: 'rgba(15,52,96,0.2)', border: '1px solid rgba(15,52,96,0.4)' }} />
        </div>
        <div>
          <label className="block text-sm text-gray-300 mb-2">Objetivo (para generar con AI)</label>
          <input value={form.objective} onChange={e => setForm(f => ({ ...f, objective: e.target.value }))} placeholder="Ej: 20% de descuento este fin de semana en todos los servicios" className="w-full px-4 py-3 rounded-xl text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500" style={{ background: 'rgba(15,52,96,0.2)', border: '1px solid rgba(15,52,96,0.4)' }} />
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm text-gray-300">Mensaje *</label>
            <button type="button" onClick={generateWithAI} disabled={generating || !form.objective} className="text-xs px-3 py-1 rounded-full transition-all disabled:opacity-50" style={{ background: 'rgba(15,52,96,0.3)', color: '#60a5fa', border: '1px solid rgba(15,52,96,0.4)' }}>
              {generating ? '✨ Generando...' : '✨ Generar con AI'}
            </button>
          </div>
          <textarea value={form.message_content} onChange={e => setForm(f => ({ ...f, message_content: e.target.value.slice(0, 160) }))} required rows={4} placeholder="Escribe tu mensaje o genera con AI..." className="w-full px-4 py-3 rounded-xl text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500 resize-none" style={{ background: 'rgba(15,52,96,0.2)', border: '1px solid rgba(15,52,96,0.4)' }} />
          <p className="text-xs text-gray-500 text-right mt-1">{form.message_content.length}/160</p>
        </div>
        <div>
          <label className="block text-sm text-gray-300 mb-2">URL de imagen/media (opcional)</label>
          <input type="url" value={form.media_url} onChange={e => setForm(f => ({ ...f, media_url: e.target.value }))} placeholder="https://tuempresa.com/promo.jpg" className="w-full px-4 py-3 rounded-xl text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500" style={{ background: 'rgba(15,52,96,0.2)', border: '1px solid rgba(15,52,96,0.4)' }} />
        </div>
      </div>
      <div className="rounded-xl p-6" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(15,52,96,0.3)' }}>
        <label className="block text-sm text-gray-300 mb-2">Lista de destinatarios (un número por línea)</label>
        <textarea value={recipients} onChange={e => setRecipients(e.target.value)} rows={5} placeholder={"+17025551234\n+17025555678\n+17025559012"} className="w-full px-4 py-3 rounded-xl text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono text-sm" style={{ background: 'rgba(15,52,96,0.2)', border: '1px solid rgba(15,52,96,0.4)' }} />
        <p className="text-xs text-gray-500 mt-1">{recipients.split('\n').filter(r => r.trim()).length} números ingresados</p>
      </div>
      <button type="submit" disabled={loading || !form.name || !form.message_content} className="w-full py-4 rounded-xl text-white font-semibold text-lg transition-all hover:opacity-90 disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>
        {loading ? 'Guardando...' : '💾 Guardar campaña como borrador'}
      </button>
    </form>
  )
}
