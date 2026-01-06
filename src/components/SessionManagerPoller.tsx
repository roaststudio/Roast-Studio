import { useEffect, useRef } from "react";

export function SessionManagerPoller() {
  const inFlightRef = useRef(false);

  useEffect(() => {
    const tick = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      try {
        await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/session-manager`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ source: "poller" }),
        });
      } catch {
        // swallow: this is a best-effort background poller
      } finally {
        inFlightRef.current = false;
      }
    };

    // Kick once on mount, then poll.
    tick();
    const intervalId = window.setInterval(tick, 5000);

    return () => window.clearInterval(intervalId);
  }, []);

  return null;
}
