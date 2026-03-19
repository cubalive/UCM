import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import MmsCreateForm from './MmsCreateForm'
export default async function MmsCreatePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: org } = await supabase.from('organizations').select('id').eq('owner_id', user.id).single()
  return (
    <div className="min-h-screen p-8" style={{ background: '#0F0F1A' }}>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/portal/mms" className="text-gray-400 hover:text-white transition-colors">← MMS</Link>
          <h1 className="text-2xl font-bold text-white">Nueva campaña MMS</h1>
        </div>
        <MmsCreateForm orgId={org?.id ?? ''} />
      </div>
    </div>
  )
}
