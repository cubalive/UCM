'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { nanoid } from 'nanoid'
export default function QrCreateForm({ orgId }: { orgId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [form, setForm] = useState({ title: '', destination_url: '', color_primary: '#0F3460', color_secondary: '#FFFFFF' })
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const supabase = createClient()
    const short_code = nanoid(8)
    await supabase.from('qr_codes').insert({ ...form, org_id: orgId, short_code, is_active: true })
    setSuccess(true)
    setTimeout(() => router.push('/portal/qr-manager'), 1500)
  }
  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {success && <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/30 text-green-400 text-center">✅ QR creado exitosamente</div>}
      <div className="rounded-xl p-6 space-y-4" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(15,52,96,0.3)' }}>
        <div>
          <label className="block text-sm text-gray-300 mb-2">Nombre del QR *</label>
          <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required placeholder="Ej: Menú del restaurante" className="w-full px-4 py-3 rounded-xl text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500" style={{ background: 'rgba(15,52,96,0.2)', border: '1px solid rgba(15,52,96,0.4)' }} />
        </div>
        <div>
          <label className="block text-sm text-gray-300 mb-2">URL de destino *</label>
          <input type="url" value={form.destination_url} onChange={e => setForm(f => ({ ...f, destination_url: e.target.value }))} required placeholder="https://tuempresa.com/menu" className="w-full px-4 py-3 rounded-xl text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500" style={{ background: 'rgba(15,52,96,0.2)', border: '1px solid rgba(15,52,96,0.4)' }} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-300 mb-2">Color primario</label>
            <div className="flex items-center gap-3">
              <input type="color" value={form.color_primary} onChange={e => setForm(f => ({ ...f, color_primary: e.target.value }))} className="w-12 h-10 rounded-lg cursor-pointer border-0 bg-transparent" />
              <span className="text-gray-400 text-sm">{form.color_primary}</span>
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-2">Color fondo</label>
            <div className="flex items-center gap-3">
              <input type="color" value={form.color_secondary} onChange={e => setForm(f => ({ ...f, color_secondary: e.target.value }))} className="w-12 h-10 rounded-lg cursor-pointer border-0 bg-transparent" />
              <span className="text-gray-400 text-sm">{form.color_secondary}</span>
            </div>
          </div>
        </div>
      </div>
      <button type="submit" disabled={loading || !form.title || !form.destination_url} className="w-full py-4 rounded-xl text-white font-semibold text-lg transition-all hover:opacity-90 disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>
        {loading ? 'Creando...' : '📲 Crear QR Code'}
      </button>
    </form>
  )
}
