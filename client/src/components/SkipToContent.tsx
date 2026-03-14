/**
 * Skip to main content link for keyboard users.
 * Must be the first focusable element in the page.
 */
export function SkipToContent() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[9999] focus:bg-white focus:p-3 focus:rounded focus:shadow-lg focus:text-sm focus:text-gray-900 focus:underline focus:outline-2 focus:outline-offset-2 focus:outline-blue-600"
    >
      Skip to main content
    </a>
  );
}
