// Frontend test setup for jsdom environment
import "@testing-library/jest-dom";

// Mock matchMedia for components that use responsive queries
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Mock IntersectionObserver
class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(window, "IntersectionObserver", {
  writable: true,
  value: MockIntersectionObserver,
});

// Mock ResizeObserver
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(window, "ResizeObserver", {
  writable: true,
  value: MockResizeObserver,
});

// Suppress console errors from React during tests
const originalError = console.error;
console.error = (...args: any[]) => {
  if (
    typeof args[0] === "string" &&
    (args[0].includes("ReactDOM.render") ||
      args[0].includes("act(") ||
      args[0].includes("Warning:"))
  ) {
    return;
  }
  originalError.call(console, ...args);
};
