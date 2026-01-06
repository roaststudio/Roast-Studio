import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper to update global round state
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function updateGlobalRoundState(
  supabase: any,
  sessionId: string | null,
  roundState: "SUBMITTING" | "LIVE" | "WAITING",
  submitEndTime: string | null = null,
  liveStartTime: string | null = null
) {
  // Count messages for total_roasts if session exists
  let totalRoasts = 0;
  if (sessionId) {
    const { count } = await supabase
      .from("roast_messages")
      .select("*", { count: "exact", head: true })
      .eq("session_id", sessionId)
      .eq("used", false);
    totalRoasts = count || 0;
  }

  // Get existing global state
  const { data: existing } = await supabase
    .from("global_round_state")
    .select("id")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const stateUpdate = {
    session_id: sessionId,
    round_state: roundState,
    current_roast_index: roundState === "LIVE" ? 0 : 0,
    total_roasts: totalRoasts,
    submit_end_time: submitEndTime,
    live_start_time: liveStartTime,
  };

  if (existing) {
    await supabase
      .from("global_round_state")
      .update(stateUpdate)
      .eq("id", existing.id);
    console.log(`Updated global_round_state to ${roundState} for session ${sessionId}`);
  } else {
    await supabase.from("global_round_state").insert([stateUpdate]);
    console.log(`Created global_round_state with ${roundState} for session ${sessionId}`);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const now = new Date();
    console.log("Session manager triggered at:", now.toISOString());

    // Transition OPEN sessions to LOCKED when lock_time is reached
    const { data: openSessions, error: openError } = await supabase
      .from("roast_sessions")
      .select("*")
      .eq("status", "OPEN")
      .lte("lock_time", now.toISOString());

    if (openError) throw openError;

    for (const session of openSessions || []) {
      console.log(`Transitioning session ${session.id} from OPEN to LOCKED`);
      await supabase
        .from("roast_sessions")
        .update({ status: "LOCKED" })
        .eq("id", session.id);
      
      // Update global state - still in SUBMITTING phase during LOCKED (about to go LIVE)
      // Keep showing the countdown until LIVE
    }

    // Transition LOCKED sessions to LIVE after 10 seconds
    const tenSecondsAgo = new Date(now.getTime() - 10 * 1000);
    const { data: lockedSessions, error: lockedError } = await supabase
      .from("roast_sessions")
      .select("*")
      .eq("status", "LOCKED")
      .lte("lock_time", tenSecondsAgo.toISOString());

    if (lockedError) throw lockedError;

    for (const session of lockedSessions || []) {
      console.log(`Transitioning session ${session.id} from LOCKED to LIVE`);
      await supabase
        .from("roast_sessions")
        .update({ status: "LIVE" })
        .eq("id", session.id);
      
      // Update global state to LIVE with live_start_time
      await updateGlobalRoundState(
        supabase,
        session.id,
        "LIVE",
        session.lock_time,
        now.toISOString()
      );
    }

    // Check for sessions that just became OPEN and update global state
    const { data: currentOpenSessions } = await supabase
      .from("roast_sessions")
      .select("*")
      .eq("status", "OPEN")
      .order("created_at", { ascending: false })
      .limit(1);

    if (currentOpenSessions && currentOpenSessions.length > 0) {
      const session = currentOpenSessions[0];
      // Check if global state needs updating
      const { data: globalState } = await supabase
        .from("global_round_state")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!globalState || globalState.session_id !== session.id || globalState.round_state !== "SUBMITTING") {
        await updateGlobalRoundState(
          supabase,
          session.id,
          "SUBMITTING",
          session.lock_time,
          null
        );
      }
    }

    // Check for LIVE sessions that have no more unused messages - archive them
    const { data: liveSessions, error: liveError } = await supabase
      .from("roast_sessions")
      .select("id")
      .eq("status", "LIVE");

    if (liveError) throw liveError;

    for (const session of liveSessions || []) {
      const { count } = await supabase
        .from("roast_messages")
        .select("*", { count: "exact", head: true })
        .eq("session_id", session.id)
        .eq("used", false);

      // If no messages at all or all have been used, check if session has been live for a while
      if (count === 0) {
        const { data: sessionData } = await supabase
          .from("roast_sessions")
          .select("lock_time")
          .eq("id", session.id)
          .single();

        if (sessionData?.lock_time) {
          const lockTime = new Date(sessionData.lock_time);
          const timeSinceLock = now.getTime() - lockTime.getTime();
          
          // Archive if session has been live for more than 5 minutes with no messages
          if (timeSinceLock > 5 * 60 * 1000) {
            console.log(`Archiving session ${session.id} - no more messages`);
            await supabase
              .from("roast_sessions")
              .update({ status: "ARCHIVED" })
              .eq("id", session.id);
            
            // Update global state to WAITING
            await updateGlobalRoundState(supabase, null, "WAITING", null, null);
          }
        }
      }
    }

    return new Response(JSON.stringify({ 
      success: true,
      processed: {
        openToLocked: openSessions?.length || 0,
        lockedToLive: lockedSessions?.length || 0,
      }
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Session manager error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
