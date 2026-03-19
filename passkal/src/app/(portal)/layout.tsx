import Link from 'next/link'

const NAV_ITEMS = [
  { href: '/portal/bookings', icon: '📅', label: 'Reservas' },
  { href: '/portal/promo-engine/calendar', icon: '🚀', label: 'Promo Engine' },
  { href: '/portal/mms', icon: '💬', label: 'MMS' },
  { href: '/portal/qr-manager', icon: '📲', label: 'QR' },
  { href: '/portal/chatbots', icon: '🤖', label: 'Chatbots' },
  { href: '/portal/consulting', icon: '💡', label: 'Consulting' },
  { href: '/portal/billing', icon: '💳', label: 'Facturación' },
  { href: '/portal/settings', icon: '⚙️', label: 'Ajustes' },
]

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex" style={{ background: '#0A0A1A' }}>
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r p-4 hidden md:block" style={{ background: 'rgba(22,33,62,0.5)', borderColor: 'rgba(15,52,96,0.3)' }}>
        <Link href="/" className="text-xl font-bold mb-8 block" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>PASSKAL</Link>
        <nav className="space-y-1">
          {NAV_ITEMS.map(({ href, icon, label }) => (
            <Link key={href} href={href} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors text-sm">
              <span>{icon}</span> {label}
            </Link>
          ))}
        </nav>
      </aside>
      {/* Main */}
      <div className="flex-1 overflow-auto">
        <header className="border-b px-6 h-14 flex items-center justify-between md:hidden" style={{ background: 'rgba(22,33,62,0.8)', borderColor: 'rgba(15,52,96,0.3)' }}>
          <Link href="/" className="text-lg font-bold" style={{ background: 'linear-gradient(135deg, #0F3460, #533483)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>PASSKAL</Link>
        </header>
        <main className="p-6">{children}</main>
      </div>
    </div>
  )
}
