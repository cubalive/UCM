import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import BookingWidget from './BookingWidget'

export default async function PublicBookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = createAdminClient()

  const { data: page } = await supabase
    .from('booking_pages')
    .select('*, booking_services(*)')
    .eq('slug', slug)
    .eq('is_active', true)
    .single()

  if (!page) notFound()

  return <BookingWidget page={page} />
}
