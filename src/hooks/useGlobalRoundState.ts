import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export type RoundState = "SUBMITTING" | "LIVE" | "WAITING";

interface GlobalRoundState {
  id: string;
  session_id: string | null;
  round_state: RoundState;
  current_roast_index: number;
  total_roasts: number;
  live_start_time: string | null;
  submit_end_time: string | null;
  updated_at: string;
}

interface UseGlobalRoundStateReturn {
  roundState: RoundState;
  currentRoastIndex: number;
  totalRoasts: number;
  liveStartTime: number | null; // Unix timestamp ms
  submitEndTime: number | null; // Unix timestamp ms
  timeRemaining: number; // ms until submit ends (for SUBMITTING state)
  sessionId: string | null;
  isLockedInStudio: boolean;
  toggleStudioLock: () => void;
  // Functions for host to update global state
  updateGlobalState: (update: Partial<Omit<GlobalRoundState, "id" | "updated_at">>) => Promise<void>;
  advanceRoastIndex: () => Promise<void>;
  endLiveRound: () => Promise<void>;
}

const STORAGE_KEY = "roast-studio-locked-in-studio";

export function useGlobalRoundState(): UseGlobalRoundStateReturn {
  const [globalState, setGlobalState] = useState<GlobalRoundState | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [isLockedInStudio, setIsLockedInStudio] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(STORAGE_KEY) === "true";
    }
    return false;
  });
  
  const mountedRef = useRef(true);

  // Toggle and persist studio lock
  const toggleStudioLock = useCallback(() => {
    setIsLockedInStudio((prev) => {
      const newValue = !prev;
      localStorage.setItem(STORAGE_KEY, String(newValue));
      return newValue;
    });
  }, []);

  // Fetch current global state
  const fetchGlobalState = useCallback(async () => {
    // Get the latest global round state
    const { data } = await supabase
      .from("global_round_state")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data && mountedRef.current) {
      setGlobalState(data as GlobalRoundState);
    } else if (mountedRef.current) {
      // No global state exists - derive from current session
      await syncFromSession();
    }
  }, []);

  // Sync global state from current session (fallback)
  const syncFromSession = useCallback(async () => {
    const { data: session } = await supabase
      .from("roast_sessions")
      .select("id, status, start_time, lock_time")
      .in("status", ["OPEN", "LOCKED", "LIVE"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!session) {
      // No active session = WAITING state
      const waitingState: Partial<GlobalRoundState> = {
        session_id: null,
        round_state: "WAITING",
        current_roast_index: 0,
        total_roasts: 0,
        live_start_time: null,
        submit_end_time: null,
      };
      
      // Upsert the global state
      await upsertGlobalState(waitingState);
      return;
    }

    // Count messages for this session
    const { count } = await supabase
      .from("roast_messages")
      .select("*", { count: "exact", head: true })
      .eq("session_id", session.id)
      .eq("used", false);

    let roundState: RoundState = "WAITING";
    if (session.status === "OPEN") {
      roundState = "SUBMITTING";
    } else if (session.status === "LOCKED" || session.status === "LIVE") {
      roundState = "LIVE";
    }

    const newState: Partial<GlobalRoundState> = {
      session_id: session.id,
      round_state: roundState,
      current_roast_index: 0,
      total_roasts: count || 0,
      submit_end_time: session.lock_time || null,
      live_start_time: session.status === "LIVE" ? new Date().toISOString() : null,
    };

    await upsertGlobalState(newState);
  }, []);

  // Upsert global state
  const upsertGlobalState = async (state: Partial<GlobalRoundState>) => {
    // Check if exists
    const { data: existing } = await supabase
      .from("global_round_state")
      .select("id")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("global_round_state")
        .update(state)
        .eq("id", existing.id);
    } else {
      await supabase.from("global_round_state").insert([state]);
    }

    await fetchGlobalState();
  };

  // Update global state
  const updateGlobalState = useCallback(
    async (update: Partial<Omit<GlobalRoundState, "id" | "updated_at">>) => {
      if (!globalState?.id) {
        console.log("[GlobalState] No global state to update");
        return;
      }

      const { error } = await supabase
        .from("global_round_state")
        .update(update)
        .eq("id", globalState.id);

      if (error) {
        console.error("[GlobalState] Update error:", error);
      }
    },
    [globalState?.id]
  );

  // Advance roast index
  const advanceRoastIndex = useCallback(async () => {
    if (!globalState) return;

    const newIndex = globalState.current_roast_index + 1;

    // Check if this was the last roast
    if (newIndex >= globalState.total_roasts) {
      // End the LIVE round
      await updateGlobalState({
        current_roast_index: newIndex,
        round_state: "WAITING",
      });
    } else {
      await updateGlobalState({
        current_roast_index: newIndex,
      });
    }
  }, [globalState, updateGlobalState]);

  // End live round
  const endLiveRound = useCallback(async () => {
    if (!globalState) return;

    console.log("[GlobalState] Ending LIVE round");
    
    // Call backend to complete the round
    if (globalState.session_id) {
      try {
        await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/complete-live-round`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ sessionId: globalState.session_id }),
        });
      } catch (err) {
        console.error("[GlobalState] Complete round error:", err);
      }
    }

    await updateGlobalState({
      round_state: "WAITING",
      current_roast_index: 0,
      total_roasts: 0,
      live_start_time: null,
    });
  }, [globalState, updateGlobalState]);

  // Initial fetch and realtime subscription
  useEffect(() => {
    mountedRef.current = true;
    fetchGlobalState();

    // Subscribe to global_round_state changes
    const globalChannel = supabase
      .channel("global-round-state-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "global_round_state" },
        (payload) => {
          console.log("[GlobalState] Received update:", payload.new);
          if (payload.new && mountedRef.current) {
            setGlobalState(payload.new as GlobalRoundState);
          }
        }
      )
      .subscribe();

    // Also subscribe to session changes to keep in sync
    const sessionChannel = supabase
      .channel("global-session-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "roast_sessions" },
        () => {
          // Re-sync when sessions change
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

  // Calculate time remaining for SUBMITTING state
  useEffect(() => {
    if (!globalState || globalState.round_state !== "SUBMITTING" || !globalState.submit_end_time) {
      setTimeRemaining(0);
      return;
    }

    const updateTimeRemaining = () => {
      const endTime = new Date(globalState.submit_end_time!).getTime();
      const now = Date.now();
      const remaining = Math.max(0, endTime - now);
      setTimeRemaining(remaining);

      // If time expired and we're still in SUBMITTING, transition to LIVE
      if (remaining <= 0 && globalState.round_state === "SUBMITTING") {
        // The backend session-manager should handle this, but we update local state
        console.log("[GlobalState] Submit time expired, transitioning to LIVE");
      }
    };

    updateTimeRemaining();
    const interval = setInterval(updateTimeRemaining, 1000);

    return () => clearInterval(interval);
  }, [globalState?.submit_end_time, globalState?.round_state]);

  // Derived values
  const roundState = globalState?.round_state || "WAITING";
  const currentRoastIndex = globalState?.current_roast_index || 0;
  const totalRoasts = globalState?.total_roasts || 0;
  const liveStartTime = globalState?.live_start_time
    ? new Date(globalState.live_start_time).getTime()
    : null;
  const submitEndTime = globalState?.submit_end_time
    ? new Date(globalState.submit_end_time).getTime()
    : null;
  const sessionId = globalState?.session_id || null;

  return {
    roundState,
    currentRoastIndex,
    totalRoasts,
    liveStartTime,
    submitEndTime,
    timeRemaining,
    sessionId,
    isLockedInStudio,
    toggleStudioLock,
    updateGlobalState,
    advanceRoastIndex,
    endLiveRound,
  };
}
