'use client'

import { useState } from 'react'

const TIME_SLOTS = ['9:00 AM','9:30 AM','10:00 AM','10:30 AM','11:00 AM','11:30 AM','12:00 PM','1:00 PM','1:30 PM','2:00 PM','2:30 PM','3:00 PM','3:30 PM','4:00 PM','4:30 PM','5:00 PM']

export default function BookingWidget({ page }: { page: Record<string, any> }) {
  const [step, setStep] = useState(1)
  const [selectedService, setSelectedService] = useState<Record<string, any> | null>(null)
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedTime, setSelectedTime] = useState('')
  const [form, setForm] = useState({ name: '', email: '', phone: '', notes: '' })
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const services = page.booking_services as Record<string, any>[]
  const color = (page.color_primary as string) || '#0F3460'

  async function confirm() {
    setLoading(true)
    const res = await fetch('/api/bookings/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_page_id: page.id, org_id: page.org_id,
        service_id: selectedService?.id,
        client_name: form.name, client_email: form.email,
        client_phone: form.phone, notes: form.notes,
        date: selectedDate, time_slot: selectedTime,
        duration_mins: selectedService?.duration_mins || 60,
        price: selectedService?.price,
      }),
    })
    if (res.ok) setSuccess(true)
    setLoading(false)
  }

  if (success) return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#0A0A1A' }}>
      <div className="rounded-2xl p-12 text-center max-w-md w-full" style={{ background: 'rgba(22,33,62,0.9)', border: `1px solid ${color}40` }}>
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="text-2xl font-bold text-white mb-3">Reserva confirmada!</h2>
        <p className="text-gray-400 mb-2">{form.name}, tu cita ha sido agendada para:</p>
        <div className="p-4 rounded-xl mb-6" style={{ background: `${color}15`, border: `1px solid ${color}30` }}>
          <p className="text-white font-semibold">{selectedDate} a las {selectedTime}</p>
          {selectedService && <p className="text-gray-300 text-sm mt-1">{selectedService.name as string}</p>}
        </div>
        <p className="text-gray-500 text-sm">Recibiras un email de confirmacion en {form.email}</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen p-4 md:p-8" style={{ background: '#0A0A1A' }}>
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">{page.title as string}</h1>
          {page.description ? <p className="text-gray-400">{String(page.description)}</p> : null}
        </div>

        {step === 1 && (
          <div>
            <h2 className="text-white font-semibold mb-4">Selecciona un servicio</h2>
            <div className="space-y-3">
              {services?.map(service => (
                <button key={service.id as string} onClick={() => { setSelectedService(service); setStep(2) }}
                  className="w-full p-4 rounded-xl text-left transition-all hover:scale-[1.01]"
                  style={{ background: 'rgba(22,33,62,0.8)', border: `1px solid ${color}30` }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white font-semibold">{service.name as string}</p>
                      {service.description && <p className="text-gray-400 text-sm">{service.description as string}</p>}
                      <p className="text-gray-400 text-sm mt-1">{service.duration_mins as number} minutos</p>
                    </div>
                    {service.price && <span className="text-lg font-bold" style={{ color }}>${service.price as number}</span>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="text-white font-semibold mb-4">Elige fecha y hora</h2>
            <div className="rounded-xl p-5 mb-4" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(15,52,96,0.3)' }}>
              <label className="block text-sm text-gray-300 mb-2">Fecha</label>
              <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                className="w-full px-4 py-3 rounded-xl text-white outline-none text-sm"
                style={{ background: 'rgba(15,52,96,0.2)', border: '1px solid rgba(15,52,96,0.4)', colorScheme: 'dark' }} />
            </div>
            {selectedDate && (
              <div className="rounded-xl p-5 mb-4" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(15,52,96,0.3)' }}>
                <label className="block text-sm text-gray-300 mb-3">Horario disponible</label>
                <div className="grid grid-cols-4 gap-2">
                  {TIME_SLOTS.map(slot => (
                    <button key={slot} onClick={() => setSelectedTime(slot)}
                      className="py-2 rounded-lg text-xs font-medium transition-all"
                      style={{ background: selectedTime === slot ? `${color}30` : 'rgba(15,52,96,0.1)', border: `1px solid ${selectedTime === slot ? color : 'rgba(15,52,96,0.3)'}`, color: selectedTime === slot ? 'white' : '#9ca3af' }}>
                      {slot}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="flex-1 py-3 rounded-xl text-gray-400 text-sm" style={{ background: 'rgba(15,52,96,0.1)', border: '1px solid rgba(15,52,96,0.3)' }}>Atras</button>
              <button onClick={() => setStep(3)} disabled={!selectedDate || !selectedTime}
                className="flex-[2] px-8 py-3 rounded-xl text-white font-medium disabled:opacity-50"
                style={{ background: `linear-gradient(135deg, ${color}, #533483)` }}>
                Continuar
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 className="text-white font-semibold mb-4">Tus datos de contacto</h2>
            <div className="rounded-xl p-5 space-y-4 mb-4" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(15,52,96,0.3)' }}>
              <div className="p-3 rounded-lg text-sm" style={{ background: `${color}10`, border: `1px solid ${color}20` }}>
                <p className="text-white font-medium">{selectedService?.name as string}</p>
                <p className="text-gray-400">{selectedDate} · {selectedTime} · {selectedService?.duration_mins as number} min</p>
              </div>
              {[
                { key: 'name', label: 'Nombre completo *', placeholder: 'Maria Gonzalez', type: 'text' },
                { key: 'email', label: 'Email *', placeholder: 'maria@email.com', type: 'email' },
                { key: 'phone', label: 'Telefono', placeholder: '+1 702 555 1234', type: 'tel' },
                { key: 'notes', label: 'Notas (opcional)', placeholder: 'Algo importante que debamos saber...', type: 'text' },
              ].map(({ key, label, placeholder, type }) => (
                <div key={key}>
                  <label className="block text-sm text-gray-300 mb-2">{label}</label>
                  <input type={type} value={form[key as keyof typeof form]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder={placeholder}
                    className="w-full px-4 py-3 rounded-xl text-white text-sm placeholder-gray-500 outline-none"
                    style={{ background: 'rgba(15,52,96,0.2)', border: '1px solid rgba(15,52,96,0.4)' }} />
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setStep(2)} className="flex-1 py-3 rounded-xl text-gray-400 text-sm" style={{ background: 'rgba(15,52,96,0.1)', border: '1px solid rgba(15,52,96,0.3)' }}>Atras</button>
              <button onClick={confirm} disabled={loading || !form.name || !form.email}
                className="flex-[2] px-8 py-3 rounded-xl text-white font-medium disabled:opacity-50"
                style={{ background: `linear-gradient(135deg, ${color}, #533483)` }}>
                {loading ? 'Confirmando...' : 'Confirmar reserva'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
