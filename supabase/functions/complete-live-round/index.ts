import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type CompleteLiveRoundBody = {
  sessionId?: string;
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
    current_roast_index: 0,
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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { sessionId }: CompleteLiveRoundBody = await req.json().catch(() => ({}));

    if (!sessionId) {
      return new Response(JSON.stringify({ error: "sessionId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Idempotent: if already archived, just ensure next session exists.
    const { data: session, error: sessionError } = await supabase
      .from("roast_sessions")
      .select("id, status")
      .eq("id", sessionId)
      .maybeSingle();

    if (sessionError) throw sessionError;
    if (!session) {
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Archive the LIVE session (no-op if already archived or not LIVE).
    const { error: archiveError } = await supabase
      .from("roast_sessions")
      .update({ status: "ARCHIVED" })
      .eq("id", sessionId)
      .eq("status", "LIVE");

    if (archiveError) throw archiveError;

    // Safety: mark any remaining unused messages as used so sessions don't re-run.
    const { error: markMessagesError } = await supabase
      .from("roast_messages")
      .update({ used: true })
      .eq("session_id", sessionId)
      .eq("used", false);

    if (markMessagesError) throw markMessagesError;

    // Ensure there's a next session (OPEN) so the studio can keep looping.
    const { data: activeSessions, error: activeError } = await supabase
      .from("roast_sessions")
      .select("id")
      .in("status", ["OPEN", "LOCKED", "LIVE"])
      .limit(1);

    if (activeError) throw activeError;

    let createdSessionId: string | null = null;

    if (!activeSessions || activeSessions.length === 0) {
      const { data: personas, error: personasError } = await supabase
        .from("personas")
        .select("id, username, profile_pic_url");

      if (personasError) throw personasError;

      if (personas && personas.length > 0) {
        const persona = personas[Math.floor(Math.random() * personas.length)];
        const startTime = new Date();
        const lockTime = new Date(startTime.getTime() + 2 * 60 * 1000);

        const { data: created, error: createError } = await supabase
          .from("roast_sessions")
          .insert({
            persona_id: persona.id,
            persona_name: persona.username,
            persona_avatar: persona.profile_pic_url,
            status: "OPEN",
            start_time: startTime.toISOString(),
            lock_time: lockTime.toISOString(),
          })
          .select("id")
          .single();

        if (createError) throw createError;
        createdSessionId = created?.id ?? null;

        // Update global state to SUBMITTING with the new session
        await updateGlobalRoundState(
          supabase,
          createdSessionId,
          "SUBMITTING",
          lockTime.toISOString(),
          null
        );
      } else {
        // No personas available, set to WAITING
        await updateGlobalRoundState(supabase, null, "WAITING", null, null);
      }
    } else {
      // There's still an active session, update global state based on its status
      const activeSession = activeSessions[0];
      const { data: activeSessionData } = await supabase
        .from("roast_sessions")
        .select("*")
        .eq("id", activeSession.id)
        .single();

      if (activeSessionData) {
        let roundState: "SUBMITTING" | "LIVE" | "WAITING" = "WAITING";
        if (activeSessionData.status === "OPEN") {
          roundState = "SUBMITTING";
        } else if (activeSessionData.status === "LOCKED" || activeSessionData.status === "LIVE") {
          roundState = "LIVE";
        }

        await updateGlobalRoundState(
          supabase,
          activeSession.id,
          roundState,
          activeSessionData.lock_time,
          activeSessionData.status === "LIVE" ? new Date().toISOString() : null
        );
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        archivedSessionId: sessionId,
        createdSessionId,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    console.error("complete-live-round error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
