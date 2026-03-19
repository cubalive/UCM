import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function BillingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: org } = await supabase
    .from('organizations')
    .select('*')
    .eq('owner_id', user.id)
    .single()

  return (
    <div className="min-h-screen p-8" style={{ background: '#0F0F1A' }}>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/portal/dashboard" className="text-gray-400 hover:text-white transition-colors">← Dashboard</Link>
          <h1 className="text-2xl font-bold text-white">Facturación</h1>
        </div>

        <div className="rounded-xl p-6 mb-6" style={{ background: 'rgba(22,33,62,0.8)', border: '1px solid rgba(15,52,96,0.3)' }}>
          <h2 className="text-white font-semibold mb-4">Plan actual</h2>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-2xl font-bold text-white uppercase">{org?.plan ?? 'FREE'}</span>
              <p className="text-sm mt-1" style={{ color: org?.subscription_status === 'active' ? '#34d399' : '#9ca3af' }}>
                {org?.subscription_status === 'active' ? 'Activo' : 'Sin suscripción activa'}
              </p>
            </div>
            <div className="flex gap-3">
              {org?.plan === 'free' ? (
                <Link href="/pricing" className="px-6 py-3 rounded-xl text-white font-medium transition-all hover:opacity-90" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)' }}>
                  Actualizar plan →
                </Link>
              ) : (
                <Link href="/pricing" className="px-4 py-2 rounded-lg text-sm text-gray-400 border border-gray-700 hover:text-white transition-colors">
                  Cambiar plan
                </Link>
              )}
            </div>
          </div>
        </div>

        {org?.plan === 'free' && (
          <div className="rounded-xl p-6" style={{ background: 'rgba(15,52,96,0.1)', border: '1px solid rgba(15,52,96,0.3)' }}>
            <p className="text-gray-400 text-sm text-center">
              Actualiza tu plan para desbloquear todas las funciones de PASSKAL.
              <Link href="/pricing" className="text-blue-400 ml-1 hover:underline">Ver planes →</Link>
            </p>
          </div>
        )}

        {org?.stripe_customer_id && (
          <div className="rounded-xl p-5 mt-4" style={{ background: 'rgba(22,33,62,0.6)', border: '1px solid rgba(15,52,96,0.3)' }}>
            <p className="text-gray-400 text-sm">Para gestionar tu facturación, cancelar o cambiar método de pago, contáctanos en <a href="mailto:team@passkal.com" className="text-blue-400 hover:underline">team@passkal.com</a></p>
          </div>
        )}
      </div>
    </div>
  )
}
