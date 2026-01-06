import { useState, useEffect, useRef, useCallback } from "react";

const IDLE_LINES = {
  hostA: [
    "Man, I could roast people all day!",
    "Who's gonna step up next? Come on!",
    "The flames are hungry!",
    "This silence is killing me!",
    "Hey, you still there? Don't leave us hanging!",
    "I'm getting bored over here!",
    "Where's all the action at?",
  ],
  hostB: [
    "Patience. The best roasts take time to marinate.",
    "I'm analyzing the room... it's mostly empty.",
    "Statistical probability of entertainment: increasing.",
    "The calm before the storm, as they say.",
    "I've calculated we have time for exactly one awkward silence.",
    "Still waiting. My algorithms are ready.",
    "Any moment now... or not.",
  ],
};

const COUNTDOWN_ANNOUNCEMENTS: Record<number, { host: "A" | "B"; text: string }> = {
  30: { host: "A", text: "Thirty seconds! Get ready to roast!" },
  10: { host: "B", text: "Ten seconds remaining." },
  5: { host: "A", text: "Five! Four! Three! Two! One!" },
  0: { host: "B", text: "Submissions are now closed. Let the roasting begin." },
};

interface UseHostChatterOptions {
  enabled: boolean;
  timeRemaining: number;
}

interface UseHostChatterReturn {
  speakingHost: "hostA" | "hostB" | null;
  currentText: string;
  isPlaying: boolean;
}

export function useHostChatter({ enabled, timeRemaining }: UseHostChatterOptions): UseHostChatterReturn {
  const [speakingHost, setSpeakingHost] = useState<"hostA" | "hostB" | null>(null);
  const [currentText, setCurrentText] = useState<string>("");
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastIdleTimeRef = useRef<number>(0);
  const announcedTimesRef = useRef<Set<number>>(new Set());
  const isPlayingRef = useRef(false);
  const hasStartedRef = useRef(false);
  const cooldownRef = useRef(false);

  const clearSpeakingState = useCallback(() => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    setSpeakingHost(null);
    setCurrentText("");
  }, []);

  const playTTS = useCallback(async (text: string, hostType: "A" | "B") => {
    // Block if already playing or in cooldown
    if (isPlayingRef.current || cooldownRef.current) {
      console.log("[useHostChatter] Blocked - playing:", isPlayingRef.current, "cooldown:", cooldownRef.current);
      return;
    }
    
    try {
      isPlayingRef.current = true;
      setIsPlaying(true);
      setSpeakingHost(hostType === "A" ? "hostA" : "hostB");
      setCurrentText(text);

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/text-to-speech`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ text, hostType }),
        }
      );

      if (!response.ok) {
        throw new Error("TTS request failed");
      }

      const data = await response.json();
      const audioUrl = `data:audio/mpeg;base64,${data.audioContent}`;
      
      if (audioRef.current) {
        audioRef.current.pause();
      }
      
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      
      audio.onended = () => {
        clearSpeakingState();
        // Add cooldown to prevent rapid fire
        cooldownRef.current = true;
        setTimeout(() => {
          cooldownRef.current = false;
        }, 500);
      };
      
      audio.onerror = () => {
        clearSpeakingState();
      };
      
      await audio.play();
    } catch (error) {
      console.error("Host chatter TTS error:", error);
      clearSpeakingState();
    }
  }, [clearSpeakingState]);

  // Immediate first line when enabled AND timer is active
  useEffect(() => {
    if (!enabled || timeRemaining <= 0) {
      hasStartedRef.current = false;
      return;
    }

    if (!hasStartedRef.current && !isPlayingRef.current) {
      hasStartedRef.current = true;
      // Play first line immediately
      const host = Math.random() > 0.5 ? "A" : "B";
      const lines = host === "A" ? IDLE_LINES.hostA : IDLE_LINES.hostB;
      const line = lines[Math.floor(Math.random() * lines.length)];
      playTTS(line, host);
      lastIdleTimeRef.current = Date.now();
    }
  }, [enabled, timeRemaining, playTTS]);

  // Idle chatter - random lines every 12-18 seconds (only when timer is active)
  useEffect(() => {
    if (!enabled || timeRemaining <= 0) return;

    const idleInterval = setInterval(() => {
      const now = Date.now();
      // Don't interrupt if already playing
      if (isPlayingRef.current) return;
      // Wait at least 12 seconds between lines
      if (now - lastIdleTimeRef.current < 12000) return;
      
      // Skip idle chatter during countdown phase (when timer < 35 seconds and timer exists)
      const secondsRemaining = Math.floor(timeRemaining / 1000);
      if (timeRemaining > 0 && secondsRemaining <= 35) return;
      
      lastIdleTimeRef.current = now;
      
      // Alternate hosts randomly
      const host = Math.random() > 0.5 ? "A" : "B";
      const lines = host === "A" ? IDLE_LINES.hostA : IDLE_LINES.hostB;
      const line = lines[Math.floor(Math.random() * lines.length)];
      
      playTTS(line, host);
    }, 3000);

    return () => clearInterval(idleInterval);
  }, [enabled, timeRemaining, playTTS]);

  // Countdown announcements - timed precisely (only when timer is active)
  useEffect(() => {
    if (!enabled || timeRemaining <= 0) return;
    
    const secondsRemaining = Math.floor(timeRemaining / 1000);
    
    // Check each countdown threshold
    for (const [threshold, announcement] of Object.entries(COUNTDOWN_ANNOUNCEMENTS)) {
      const thresholdNum = parseInt(threshold);
      
      // Trigger when we hit the threshold (within 2 second window)
      if (
        secondsRemaining <= thresholdNum && 
        secondsRemaining > thresholdNum - 2 &&
        !announcedTimesRef.current.has(thresholdNum) &&
        !isPlayingRef.current
      ) {
        announcedTimesRef.current.add(thresholdNum);
        playTTS(announcement.text, announcement.host);
        break; // Only one announcement at a time
      }
    }
  }, [enabled, timeRemaining, playTTS]);

  // Reset state when disabled
  useEffect(() => {
    if (!enabled) {
      announcedTimesRef.current.clear();
      lastIdleTimeRef.current = 0;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      clearSpeakingState();
    }
  }, [enabled, clearSpeakingState]);

  return {
    speakingHost,
    currentText,
    isPlaying,
  };
}
