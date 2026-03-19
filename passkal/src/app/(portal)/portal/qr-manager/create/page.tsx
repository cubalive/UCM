import { redirect } from 'next/navigation'
import Link from 'next/link'
import QrCreateForm from './QrCreateForm'
import { createClient } from '@/lib/supabase/server'
export default async function QrCreatePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: org } = await supabase.from('organizations').select('id').eq('owner_id', user.id).single()
  return (
    <div className="min-h-screen p-8" style={{ background: '#0F0F1A' }}>
      <div className="max-w-xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/portal/qr-manager" className="text-gray-400 hover:text-white transition-colors">← QR Manager</Link>
          <h1 className="text-2xl font-bold text-white">Crear QR Code</h1>
        </div>
        <QrCreateForm orgId={org?.id ?? ''} />
      </div>
    </div>
  )
}
