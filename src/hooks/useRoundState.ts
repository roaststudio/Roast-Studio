import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type RoundState = "SUBMITTING" | "LIVE" | "WAITING";

interface GlobalRoundStateRow {
  id: string;
  session_id: string | null;
  round_state: RoundState;
  current_roast_index: number;
  total_roasts: number;
  live_start_time: string | null;
  submit_end_time: string | null;
  updated_at: string;
}

interface UseRoundStateReturn {
  roundState: RoundState;
  timeRemaining: number; // ms
  isLockedInStudio: boolean;
  toggleStudioLock: () => void;
  currentRoundId: string | null;
  currentRoastIndex: number;
  totalRoasts: number;
  liveStartTime: number | null;
  endLiveRound: () => void;
  advanceRoastIndex: () => Promise<void>;
}

const STORAGE_KEY = "roast-studio-locked-in-studio";

async function completeLiveRoundInBackend(sessionId: string) {
  await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/complete-live-round`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify({ sessionId }),
  });
}

export function useRoundState(): UseRoundStateReturn {
  const [globalState, setGlobalState] = useState<GlobalRoundStateRow | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [isLockedInStudio, setIsLockedInStudio] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(STORAGE_KEY) === "true";
    }
    return false;
  });

  const mountedRef = useRef(true);
  const liveEndedRef = useRef(false);

  // Toggle and persist studio lock
  const toggleStudioLock = useCallback(() => {
    setIsLockedInStudio((prev) => {
      const newValue = !prev;
      localStorage.setItem(STORAGE_KEY, String(newValue));
      return newValue;
    });
  }, []);

  // Fetch global state from database
  const fetchGlobalState = useCallback(async () => {
    const { data } = await supabase
      .from("global_round_state")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data && mountedRef.current) {
      // Reset liveEndedRef when session changes
      if (globalState?.session_id !== data.session_id) {
        liveEndedRef.current = false;
      }
      setGlobalState(data as GlobalRoundStateRow);
    } else if (mountedRef.current && !data) {
      // No global state - create one from current session
      await syncFromSession();
    }
  }, [globalState?.session_id]);

  // Sync from session if no global state exists
  const syncFromSession = useCallback(async () => {
    const { data: session } = await supabase
      .from("roast_sessions")
      .select("id, status, start_time, lock_time")
      .in("status", ["OPEN", "LOCKED", "LIVE"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!session) {
      // No active session = WAITING
      setGlobalState({
        id: "",
        session_id: null,
        round_state: "WAITING",
        current_roast_index: 0,
        total_roasts: 0,
        live_start_time: null,
        submit_end_time: null,
        updated_at: new Date().toISOString(),
      });
      return;
    }

    let roundState: RoundState = "WAITING";
    if (session.status === "OPEN") {
      roundState = "SUBMITTING";
    } else if (session.status === "LOCKED" || session.status === "LIVE") {
      roundState = "LIVE";
    }

    setGlobalState({
      id: "",
      session_id: session.id,
      round_state: roundState,
      current_roast_index: 0,
      total_roasts: 0,
      live_start_time: session.status === "LIVE" ? new Date().toISOString() : null,
      submit_end_time: session.lock_time,
      updated_at: new Date().toISOString(),
    });
  }, []);

  // End LIVE round
  const endLiveRound = useCallback(() => {
    if (!globalState || globalState.round_state !== "LIVE" || liveEndedRef.current) return;

    liveEndedRef.current = true;

    if (globalState.session_id) {
      void completeLiveRoundInBackend(globalState.session_id);
    }

    // Immediately update local state
    setGlobalState((prev) =>
      prev ? { ...prev, round_state: "WAITING" } : prev
    );
    setTimeRemaining(0);
  }, [globalState]);

  // Advance roast index (update in database)
  const advanceRoastIndex = useCallback(async () => {
    if (!globalState?.id) return;

    const newIndex = globalState.current_roast_index + 1;

    // Check if this was the last roast
    if (newIndex >= globalState.total_roasts) {
      // End the round
      endLiveRound();
    } else {
      // Update in database
      await supabase
        .from("global_round_state")
        .update({ current_roast_index: newIndex })
        .eq("id", globalState.id);
    }
  }, [globalState, endLiveRound]);

  // Initial fetch and realtime subscription
  useEffect(() => {
    mountedRef.current = true;
    fetchGlobalState();

    // Subscribe to global_round_state changes
    const globalChannel = supabase
      .channel("round-state-global-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "global_round_state" },
        (payload) => {
          console.log("[RoundState] Global state update:", payload.new);
          if (payload.new && mountedRef.current) {
            const newState = payload.new as GlobalRoundStateRow;
            // Reset liveEndedRef when session changes
            if (globalState?.session_id !== newState.session_id) {
              liveEndedRef.current = false;
            }
            setGlobalState(newState);
          }
        }
      )
      .subscribe();

    // Also subscribe to session changes as backup
    const sessionChannel = supabase
      .channel("round-state-session-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "roast_sessions" },
        () => {
          fetchGlobalState();
        }
      )
      .subscribe();

    return () => {
      mountedRef.current = false;
      supabase.removeChannel(globalChannel);
      supabase.removeChannel(sessionChannel);
    };
  }, [fetchGlobalState]);

  // Calculate time remaining for SUBMITTING state (countdown to lock_time)
  useEffect(() => {
    if (!globalState) {
      setTimeRemaining(0);
      return;
    }

    const updateTimeRemaining = () => {
      if (globalState.round_state === "SUBMITTING" && globalState.submit_end_time) {
        const endTime = new Date(globalState.submit_end_time).getTime();
        const now = Date.now();
        const remaining = Math.max(0, endTime - now);
        setTimeRemaining(remaining);
      } else if (globalState.round_state === "LIVE" && globalState.live_start_time) {
        // For LIVE, show time since started (or estimate remaining)
        // The actual playback is timestamp-based, not timer-based
        setTimeRemaining(0);
      } else {
        setTimeRemaining(0);
      }
    };

    updateTimeRemaining();
    const interval = setInterval(updateTimeRemaining, 1000);

    return () => clearInterval(interval);
  }, [globalState?.round_state, globalState?.submit_end_time, globalState?.live_start_time]);

  // Derived values
  const roundState = globalState?.round_state || "WAITING";
  const currentRoundId = globalState?.session_id || null;
  const currentRoastIndex = globalState?.current_roast_index || 0;
  const totalRoasts = globalState?.total_roasts || 0;
  const liveStartTime = globalState?.live_start_time
    ? new Date(globalState.live_start_time).getTime()
    : null;

  return {
    roundState,
    timeRemaining,
    isLockedInStudio,
    toggleStudioLock,
    currentRoundId,
    currentRoastIndex,
    totalRoasts,
    liveStartTime,
    endLiveRound,
    advanceRoastIndex,
  };
}
