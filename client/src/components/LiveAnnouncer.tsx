import { createContext, useContext, useCallback, useState, type ReactNode } from "react";

interface LiveAnnouncerContextType {
  announce: (message: string, priority?: "polite" | "assertive") => void;
}

const LiveAnnouncerContext = createContext<LiveAnnouncerContextType>({
  announce: () => {},
});

export function useLiveAnnouncer() {
  return useContext(LiveAnnouncerContext);
}

/**
 * Provides a screen-reader live region that can announce dynamic updates.
 * Wrap your app with this provider and call `announce()` to notify SR users.
 */
export function LiveAnnouncerProvider({ children }: { children: ReactNode }) {
  const [politeMessage, setPoliteMessage] = useState("");
  const [assertiveMessage, setAssertiveMessage] = useState("");

  const announce = useCallback((message: string, priority: "polite" | "assertive" = "polite") => {
    if (priority === "assertive") {
      setAssertiveMessage("");
      requestAnimationFrame(() => setAssertiveMessage(message));
    } else {
      setPoliteMessage("");
      requestAnimationFrame(() => setPoliteMessage(message));
    }
  }, []);

  return (
    <LiveAnnouncerContext.Provider value={{ announce }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        role="status"
        className="sr-only"
      >
        {politeMessage}
      </div>
      <div
        aria-live="assertive"
        aria-atomic="true"
        role="alert"
        className="sr-only"
      >
        {assertiveMessage}
      </div>
    </LiveAnnouncerContext.Provider>
  );
}
