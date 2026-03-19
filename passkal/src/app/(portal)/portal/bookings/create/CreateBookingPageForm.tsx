'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { nanoid } from 'nanoid'

const INDUSTRIES = ['Restaurante', 'Clinica/Medico', 'Salon de belleza', 'Spa/Masajes', 'Consultoria', 'Fitness/Gym', 'Abogado', 'Dentista', 'Tutor', 'Fotografo', 'Otro']

export default function CreateBookingPageForm({ orgId, orgName }: { orgId: string; orgName: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({
    title: orgName, description: '', industry: '',
    color_primary: '#0F3460', timezone: 'America/Los_Angeles',
  })
  const [services, setServices] = useState([
    { name: '', description: '', duration_mins: 60, price: '' }
  ])

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  async function submit() {
    setLoading(true)
    const supabase = createClient()
    const slug = nanoid(8).toLowerCase()

    const { data: page } = await supabase.from('booking_pages').insert({
      org_id: orgId, slug, title: form.title,
      description: form.description, industry: form.industry,
      color_primary: form.color_primary, timezone: form.timezone,
    }).select().single()

    if (page) {
      const validServices = services.filter(s => s.name)
      if (validServices.length) {
        await supabase.from('booking_services').insert(
          validServices.map(s => ({
            booking_page_id: page.id,
            name: s.name,
            description: s.description,
            duration_mins: s.duration_mins,
            price: s.price ? parseFloat(s.price) : null,
          }))
        )
      }
    }
    router.push('/portal/bookings')
  }

  const inputClass = "w-full px-4 py-3 rounded-xl text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500 text-sm"
  const inputStyle = { background: 'rgba(15,52,96,0.2)', border: '1px solid rgba(15,52,96,0.4)' }

  return (
    <div className="space-y-6">
      {step === 1 && (
        <div className="rounded-xl p-6 space-y-4" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(15,52,96,0.3)' }}>
          <h2 className="text-white font-semibold">Informacion de tu pagina</h2>
          <div>
            <label className="block text-sm text-gray-300 mb-2">Nombre de tu negocio *</label>
            <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="Ej: Dr. Garcia — Consulta Medica" className={inputClass} style={inputStyle} />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-2">Descripcion</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3} placeholder="Describe brevemente tu negocio..." className={`${inputClass} resize-none`} style={inputStyle} />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-2">Industria</label>
            <div className="flex flex-wrap gap-2">
              {INDUSTRIES.map(i => (
                <button key={i} type="button" onClick={() => set('industry', i)}
                  className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                  style={{ background: form.industry === i ? 'rgba(15,52,96,0.5)' : 'rgba(15,52,96,0.1)', border: `1px solid ${form.industry === i ? '#60a5fa' : 'rgba(15,52,96,0.3)'}`, color: form.industry === i ? '#60a5fa' : '#9ca3af' }}>
                  {i}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-2">Color de marca</label>
            <div className="flex items-center gap-3">
              <input type="color" value={form.color_primary} onChange={e => set('color_primary', e.target.value)} className="w-12 h-10 rounded-lg cursor-pointer border-0 bg-transparent" />
              <span className="text-gray-400 text-sm">{form.color_primary}</span>
            </div>
          </div>
          <button onClick={() => setStep(2)} disabled={!form.title} className="w-full py-3 rounded-xl text-white font-medium transition-all hover:opacity-90 disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>
            Continuar — Agregar servicios
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="rounded-xl p-6" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(15,52,96,0.3)' }}>
            <h2 className="text-white font-semibold mb-4">Tus servicios</h2>
            {services.map((service, i) => (
              <div key={i} className="p-4 rounded-xl mb-3 space-y-3" style={{ background: 'rgba(15,52,96,0.1)', border: '1px solid rgba(15,52,96,0.3)' }}>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Nombre del servicio</label>
                    <input value={service.name} onChange={e => setServices(s => s.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder="Ej: Consulta general" className={inputClass} style={inputStyle} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Precio (USD)</label>
                    <input type="number" value={service.price} onChange={e => setServices(s => s.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} placeholder="50" className={inputClass} style={inputStyle} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Duracion (minutos)</label>
                  <div className="flex gap-2">
                    {[30, 45, 60, 90, 120].map(d => (
                      <button key={d} type="button" onClick={() => setServices(s => s.map((x, j) => j === i ? { ...x, duration_mins: d } : x))}
                        className="flex-1 py-2 rounded-lg text-xs font-medium transition-all"
                        style={{ background: service.duration_mins === d ? '#0F3460' : 'rgba(15,52,96,0.1)', border: `1px solid ${service.duration_mins === d ? '#60a5fa' : 'rgba(15,52,96,0.3)'}`, color: service.duration_mins === d ? 'white' : '#9ca3af' }}>
                        {d}m
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setServices(s => [...s, { name: '', description: '', duration_mins: 60, price: '' }])}
              className="w-full py-2 rounded-xl text-gray-400 text-sm hover:text-white transition-colors" style={{ background: 'rgba(15,52,96,0.1)', border: '1px dashed rgba(15,52,96,0.4)' }}>
              + Agregar otro servicio
            </button>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setStep(1)} className="flex-1 py-3 rounded-xl text-gray-400 text-sm" style={{ background: 'rgba(15,52,96,0.1)', border: '1px solid rgba(15,52,96,0.3)' }}>Atras</button>
            <button onClick={submit} disabled={loading} className="flex-[2] px-8 py-3 rounded-xl text-white font-medium transition-all hover:opacity-90 disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>
              {loading ? 'Creando...' : 'Crear pagina de reservas'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
