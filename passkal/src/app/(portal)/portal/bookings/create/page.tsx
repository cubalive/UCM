import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import CreateBookingPageForm from './CreateBookingPageForm'

export default async function CreateBookingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: org } = await supabase.from('organizations').select('id, name').eq('owner_id', user.id).single()

  return (
    <div className="min-h-screen p-8" style={{ background: '#0F0F1A' }}>
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-white mb-8">Crear pagina de reservas</h1>
        <CreateBookingPageForm orgId={org?.id ?? ''} orgName={org?.name ?? ''} />
      </div>
    </div>
  )
}
