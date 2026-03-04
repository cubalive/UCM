import { ChevronLeft } from "lucide-react";

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-[#0a0f1e] text-gray-900 dark:text-gray-100" data-testid="page-privacy-policy">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <button
          onClick={() => window.history.back()}
          className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 mb-6 hover:underline"
          data-testid="button-back"
        >
          <ChevronLeft className="w-4 h-4" /> Back
        </button>

        <h1 className="text-3xl font-bold mb-2" data-testid="text-privacy-title">Privacy Policy</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">Last updated: March 4, 2026</p>

        <div className="space-y-6 text-sm leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold mb-2">1. Introduction</h2>
            <p>
              United Care Mobility ("UCM", "we", "our", "us") operates the UCM Driver mobile application
              and related web portals. This Privacy Policy describes how we collect, use, and protect
              your personal information when you use our services.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">2. Information We Collect</h2>
            <p className="mb-2">We collect the following categories of data:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Account Information:</strong> Name, email address, phone number, driver's license details, and vehicle information.</li>
              <li><strong>Location Data:</strong> Real-time GPS coordinates during active trips and background location when you are on shift. This is essential for trip tracking, ETA calculations, and dispatch coordination.</li>
              <li><strong>Device Information:</strong> Device model, operating system version, app version, and unique device identifiers for push notifications.</li>
              <li><strong>Usage Data:</strong> Trip history, earnings, performance metrics, and app interaction logs.</li>
              <li><strong>Communication Data:</strong> SMS messages and email correspondence related to trips and account management.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">3. How We Use Your Information</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>To facilitate non-emergency medical transportation services</li>
              <li>To track your location during active trips for dispatch and patient ETA purposes</li>
              <li>To calculate earnings and process payments</li>
              <li>To send trip notifications, dispatch alerts, and account updates</li>
              <li>To improve service quality and operational efficiency</li>
              <li>To comply with healthcare transportation regulations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">4. Location Data</h2>
            <p>
              The UCM Driver app collects location data in the foreground and background when you are
              on an active shift or trip. Background location tracking is required for accurate dispatch
              coordination, ETA updates, and trip verification. You can disable background location by
              going off-shift or revoking location permissions in your device settings, but this will
              prevent you from receiving trip assignments.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">5. Data Sharing</h2>
            <p className="mb-2">We share your information with:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Healthcare Facilities:</strong> Clinic staff see driver name, vehicle info, and real-time ETA for patient coordination.</li>
              <li><strong>Patients:</strong> Patients receive driver name and ETA via SMS and tracking links.</li>
              <li><strong>Payment Processors:</strong> Stripe processes earnings and payroll information.</li>
              <li><strong>Communication Providers:</strong> Twilio delivers SMS notifications.</li>
            </ul>
            <p className="mt-2">We do not sell your personal information to third parties.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">6. Data Security</h2>
            <p>
              We use industry-standard security measures including encrypted data transmission (TLS/SSL),
              secure authentication (JWT tokens), and access controls. All data is stored on secure,
              HIPAA-compliant infrastructure.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">7. Data Retention</h2>
            <p>
              We retain your data for as long as your account is active and as required by healthcare
              transportation regulations. Trip records are retained for a minimum of 7 years for
              compliance purposes. You may request account deletion by contacting support.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">8. Your Rights</h2>
            <p>You have the right to:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Access the personal data we hold about you</li>
              <li>Request correction of inaccurate data</li>
              <li>Request deletion of your data (subject to regulatory retention requirements)</li>
              <li>Opt out of non-essential communications</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">9. App Tracking</h2>
            <p>
              UCM Driver does not use third-party advertising trackers or analytics SDKs that track
              you across other apps or websites. We do not participate in ad networks or data broker
              programs.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">10. Contact Us</h2>
            <p>
              For privacy-related inquiries, contact us at:<br />
              Email: <a href="mailto:privacy@unitedcaremobility.com" className="text-blue-600 dark:text-blue-400 underline" data-testid="link-privacy-email">privacy@unitedcaremobility.com</a><br />
              Support: <a href="mailto:support@unitedcaremobility.com" className="text-blue-600 dark:text-blue-400 underline" data-testid="link-support-email">support@unitedcaremobility.com</a>
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">11. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy periodically. We will notify you of material changes
              via the app or email. Continued use of the app after changes constitutes acceptance.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t border-gray-200 dark:border-gray-800 text-center">
          <p className="text-xs text-gray-400">
            &copy; {new Date().getFullYear()} United Care Mobility. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
