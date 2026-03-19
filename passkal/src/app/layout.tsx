import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'PASSKAL — AI-Powered Marketing Agency',
  description: 'Agencia de marketing digital AI-native. Diseño web, SEO, social media, apps, MMS automation y más. Las Vegas, NV.',
  keywords: 'marketing digital, AI marketing, diseño web, SEO, social media, Las Vegas',
  openGraph: {
    title: 'PASSKAL — AI-Powered Marketing Agency',
    description: 'Agencia de marketing digital AI-native. Todo lo que necesitas para dominar el marketing digital.',
    type: 'website',
    locale: 'es_US',
    siteName: 'PASSKAL',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es">
      <body style={{ fontFamily: 'Inter, system-ui, -apple-system, sans-serif' }}>{children}</body>
    </html>
  )
}
