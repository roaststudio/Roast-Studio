import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Voice IDs for the hosts - unique voices that match their personalities
const VOICE_IDS = {
  hostA: "IKne3meq5aSn9XLyUdCD", // Charlie - energetic, chaotic
  hostB: "onwK4e9ZLuTAKqWW03F9", // Daniel - calm, sarcastic
  announcer: "JBFqnCBsd6RMkjVDRZzb", // George - clear, announcer-style
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text, hostType } = await req.json();
    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    
    if (!ELEVENLABS_API_KEY) {
      throw new Error("ELEVENLABS_API_KEY is not configured");
    }

    if (!text) {
      throw new Error("Text is required");
    }

    const voiceId = hostType === "announcer" 
      ? VOICE_IDS.announcer 
      : hostType === "A" ? VOICE_IDS.hostA : VOICE_IDS.hostB;

    console.log(`Generating TTS for ${hostType} with voice ${voiceId}`);

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_turbo_v2_5",
          voice_settings: {
            stability: hostType === "announcer" ? 0.8 : hostType === "A" ? 0.3 : 0.7,
            similarity_boost: 0.75,
            style: hostType === "announcer" ? 0.2 : hostType === "A" ? 0.7 : 0.3,
            use_speaker_boost: true,
            speed: hostType === "announcer" ? 1.0 : hostType === "A" ? 1.1 : 0.95,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("ElevenLabs error:", response.status, errorText);
      throw new Error(`ElevenLabs error: ${response.status}`);
    }

    const audioBuffer = await response.arrayBuffer();
    const base64Audio = base64Encode(audioBuffer);

    console.log("TTS generation successful, audio size:", audioBuffer.byteLength);

    return new Response(JSON.stringify({ audioContent: base64Audio }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error in TTS:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
