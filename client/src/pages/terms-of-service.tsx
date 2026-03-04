import { ChevronLeft } from "lucide-react";

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-white dark:bg-[#0a0f1e] text-gray-900 dark:text-gray-100" data-testid="page-terms-of-service">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <button
          onClick={() => window.history.back()}
          className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 mb-6 hover:underline"
          data-testid="button-back"
        >
          <ChevronLeft className="w-4 h-4" /> Back
        </button>

        <h1 className="text-3xl font-bold mb-2" data-testid="text-terms-title">Terms of Service</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">Last updated: March 4, 2026</p>

        <div className="space-y-6 text-sm leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold mb-2">1. Acceptance of Terms</h2>
            <p>
              By accessing or using the UCM Driver application ("App") provided by United Care Mobility
              ("UCM", "we", "our"), you agree to be bound by these Terms of Service. If you do not
              agree to these terms, do not use the App.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">2. Service Description</h2>
            <p>
              UCM provides a platform for coordinating non-emergency medical transportation (NEMT)
              services. The App enables drivers to receive trip assignments, navigate to pickup and
              drop-off locations, track trip progress, and manage earnings.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">3. Driver Obligations</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>Maintain a valid driver's license and required certifications</li>
              <li>Keep your vehicle in safe, road-worthy condition</li>
              <li>Comply with all applicable traffic laws and regulations</li>
              <li>Treat all patients with dignity, respect, and professionalism</li>
              <li>Maintain patient confidentiality in accordance with HIPAA requirements</li>
              <li>Keep location services enabled during active shifts for safety and dispatch</li>
              <li>Report incidents, accidents, or safety concerns immediately</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">4. Account Security</h2>
            <p>
              You are responsible for maintaining the confidentiality of your account credentials.
              Do not share your login information with others. You must notify UCM immediately if
              you suspect unauthorized access to your account.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">5. Location Tracking</h2>
            <p>
              The App requires access to your device's location services to function. Location data
              is used for trip dispatch, navigation, ETA calculation, and safety verification.
              Background location tracking occurs during active shifts. You understand and consent
              to this data collection as a condition of using the platform.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">6. Earnings and Payments</h2>
            <p>
              Driver earnings are calculated based on completed trips according to the applicable rate
              schedule. Payment processing is handled through Stripe. UCM is not responsible for
              delays caused by banking institutions or payment processors. Earnings are subject to
              applicable deductions, fees, and tax obligations.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">7. Prohibited Conduct</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>Operating under the influence of drugs or alcohol</li>
              <li>Harassment or discrimination against patients or staff</li>
              <li>Tampering with location data or GPS signals</li>
              <li>Using the App for purposes other than NEMT services</li>
              <li>Sharing patient information with unauthorized parties</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">8. Termination</h2>
            <p>
              UCM may suspend or terminate your access to the App at any time for violation of these
              terms, safety concerns, or regulatory requirements. You may deactivate your account by
              contacting support.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">9. Limitation of Liability</h2>
            <p>
              UCM provides the App "as is" without warranties of any kind. UCM shall not be liable
              for indirect, incidental, special, or consequential damages arising from use of the App.
              UCM's total liability shall not exceed the amount paid to you through the platform in
              the preceding 12 months.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">10. Modifications</h2>
            <p>
              UCM reserves the right to modify these Terms at any time. Material changes will be
              communicated through the App or via email. Continued use after modifications constitutes
              acceptance of the updated terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">11. Contact</h2>
            <p>
              For questions about these Terms, contact us at:<br />
              Email: <a href="mailto:support@unitedcaremobility.com" className="text-blue-600 dark:text-blue-400 underline" data-testid="link-support-email">support@unitedcaremobility.com</a>
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
