export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen" style={{ background: '#0A0A1A' }}>
      <main className="max-w-6xl mx-auto p-6">{children}</main>
    </div>
  )
}
