import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function BookingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: org } = await supabase.from('organizations').select('id').eq('owner_id', user.id).single()
  const { data: pages } = org
    ? await supabase.from('booking_pages').select('*, booking_services(count), bookings(count)').eq('org_id', org.id)
    : { data: [] }
  const { data: recentBookings } = org
    ? await supabase.from('bookings').select('*').eq('org_id', org.id).order('created_at', { ascending: false }).limit(10)
    : { data: [] }

  const statusColors: Record<string, string> = {
    confirmed: '#34d399', pending: '#fbbf24', cancelled: '#f87171',
    completed: '#60a5fa', no_show: '#9ca3af'
  }

  return (
    <div className="min-h-screen p-8" style={{ background: '#0F0F1A' }}>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Sistema de Reservas</h1>
            <p className="text-gray-400 mt-1">Gestiona tus paginas de reservas y citas</p>
          </div>
          <Link href="/portal/bookings/create" className="px-6 py-3 rounded-xl text-white font-medium flex items-center gap-2 transition-all hover:opacity-90" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>
            + Nueva pagina de reservas
          </Link>
        </div>

        {!pages?.length ? (
          <div className="rounded-2xl p-16 text-center mb-8" style={{ background: 'rgba(22,33,62,0.6)', border: '1px dashed rgba(15,52,96,0.4)' }}>
            <div className="text-5xl mb-4">📅</div>
            <h3 className="text-white font-semibold text-lg mb-2">No tienes paginas de reservas</h3>
            <p className="text-gray-400 mb-6">Crea tu primera pagina de reservas en minutos</p>
            <Link href="/portal/bookings/create" className="px-8 py-3 rounded-xl text-white font-medium inline-block" style={{ background: '#0F3460' }}>Crear pagina</Link>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-6 mb-8">
            {pages.map((page: Record<string, unknown>) => (
              <div key={page.id as string} className="rounded-2xl p-6" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(15,52,96,0.3)' }}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-white font-bold text-lg">{page.title as string}</h3>
                    <p className="text-gray-400 text-sm">passkal.com/book/{page.slug as string}</p>
                  </div>
                  <span className="px-2 py-1 rounded-full text-xs" style={{ background: page.is_active ? 'rgba(52,211,153,0.1)' : 'rgba(156,163,175,0.1)', color: page.is_active ? '#34d399' : '#9ca3af' }}>
                    {page.is_active ? 'Activo' : 'Inactivo'}
                  </span>
                </div>
                <div className="flex gap-3">
                  <Link href={`/book/${page.slug}`} target="_blank" className="flex-1 py-2 rounded-lg text-center text-sm text-blue-400 hover:text-white transition-colors" style={{ background: 'rgba(15,52,96,0.2)', border: '1px solid rgba(15,52,96,0.3)' }}>
                    Ver pagina publica
                  </Link>
                  <Link href={`/portal/bookings/${page.id}`} className="flex-1 py-2 rounded-lg text-center text-sm text-white transition-colors" style={{ background: 'rgba(15,52,96,0.3)', border: '1px solid rgba(15,52,96,0.4)' }}>
                    Gestionar
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}

        {recentBookings && recentBookings.length > 0 && (
          <div>
            <h2 className="text-white font-semibold mb-4">Reservas recientes</h2>
            <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(15,52,96,0.3)' }}>
              <div className="divide-y" style={{ borderColor: 'rgba(15,52,96,0.2)' }}>
                {recentBookings.map((booking: Record<string, unknown>) => (
                  <div key={booking.id as string} className="px-5 py-4 flex items-center justify-between">
                    <div>
                      <p className="text-white font-medium">{booking.client_name as string}</p>
                      <p className="text-gray-400 text-sm">{booking.client_email as string} · {booking.date as string} {booking.time_slot as string}</p>
                    </div>
                    <span className="px-3 py-1 rounded-full text-xs font-medium capitalize" style={{ background: `${statusColors[booking.status as string]}20`, color: statusColors[booking.status as string] }}>
                      {booking.status as string}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
