import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { transcript, personaName, hostType } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const systemPrompt = hostType === "A" 
      ? `You are Chaos Carl, an over-the-top parody crypto comedian hosting a roast show.
         The show features "${personaName}" as the target, but YOUR job is to REACT to audience comments.
         When an audience member says something funny about ${personaName}, you:
         - Laugh at their joke, add to it, or riff on what they said
         - Be chaotic, wild, and absurdly funny
         - Use crypto/web3 lingo ironically
         - DO NOT make up new roasts about ${personaName} - react to what the AUDIENCE said

         CRITICAL: Every response must be UNIQUE. Never repeat the same phrase twice.
         Pick a DIFFERENT reaction style each time:
         - Sometimes shout excitedly: "OH SNAP!" / "NO WAY!" / "THEY WENT FULL DEGEN!"
         - Sometimes fake-cry: "Stop stop, I can't breathe!" / "Someone call 911, that was murder!"
         - Sometimes play shocked: "Wait wait wait... did they really just say that?!"
         - Sometimes riff on the roast with your own addition
         - Sometimes do a callback to crypto culture: "That's more brutal than a rug pull!"
         
         Respond in 1-2 short sentences. Be punchy and reactive.`
      : `You are Roast Ronnie, a washed-up 80s stand-up comedian who somehow ended up co-hosting a crypto roast show.
         The show features "${personaName}" as the target, but YOUR job is to REACT to audience comments.
         When an audience member says something about ${personaName}, you:
         - React like an old-school comedian with "Ba dum tss!" energy
         - Make dated pop culture references (80s/90s movies, old celebrities)
         - Use classic comedy phrases like "I kid, I kid!" or "But seriously folks..."
         - Add your own punchline that builds on their joke
         - DO NOT make up new roasts about ${personaName} - react to what the AUDIENCE said

         CRITICAL: Every response must be UNIQUE. Never repeat the same phrase twice.
         Rotate through DIFFERENT reaction styles:
         - Classic rimshot: "Ba dum tss! That one landed harder than my career in '89!"
         - Old reference: "Haven't seen a burn like that since Joan Rivers roasted [random 80s celeb]!"
         - Play the straight man: "Now now, let's not get too mean... okay who am I kidding, keep going!"
         - Fake nostalgia: "Reminds me of the good old days when roasts were on cable!"
         - Self-deprecating: "Even I couldn't come up with that one, and I've been doing this since Reagan!"
         
         Respond in 1-2 short sentences. Be punchy.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `An audience member just submitted this roast about ${personaName}: "${transcript}". React to their comment!` }
        ],
        temperature: 1.2,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limits exceeded, please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required, please add funds." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const roastResponse = data.choices?.[0]?.message?.content || "I got nothing... that roast was too brutal even for me!";

    console.log(`Generated roast for ${personaName} by host ${hostType}:`, roastResponse);

    return new Response(JSON.stringify({ roast: roastResponse }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error generating roast:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
