import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Play, Pause, RotateCcw, Volume2, VolumeX, Maximize2, Minimize2, ArrowLeft, Users, Lock, Unlock } from "lucide-react";
import { SmallHost } from "./SmallHost";
import { AudioWaveformVisualizer } from "./AudioWaveformVisualizer";
import { useSessionSync } from "@/hooks/useSessionSync";
import { useRoundState } from "@/hooks/useRoundState";
import { useHostChatter } from "@/hooks/useHostChatter";

interface WatchViewProps {
  session: {
    id: string;
    persona_name: string;
    persona_avatar?: string;
    status: string;
    lock_time?: string;
    start_time?: string;
  };
  onComplete?: () => void;
  onBack?: () => void;
}

interface Message {
  id: string;
  transcript: string | null;
  audio_url: string | null;
}

type Speaker = "user" | "hostA" | "hostB";

interface DisplayItem {
  speaker: Speaker;
  text: string;
}

export function WatchView({ session, onComplete, onBack }: WatchViewProps) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentDisplay, setCurrentDisplay] = useState<DisplayItem | null>(null);
  const [currentSpeaker, setCurrentSpeaker] = useState<Speaker | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [roastNumber, setRoastNumber] = useState(0);
  const [phase, setPhase] = useState<"idle" | "intro" | "roast" | "response" | "transition">("idle");
  const [isAutoStarting, setIsAutoStarting] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [displayedText, setDisplayedText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isViewLocked, setIsViewLocked] = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  const [completeCountdown, setCompleteCountdown] = useState(3);

  // Load lock state from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('roast-studio-view-locked');
    if (saved === 'true') {
      setIsViewLocked(true);
    }
  }, []);

  // Toggle and persist lock state
  const toggleViewLock = () => {
    const newValue = !isViewLocked;
    setIsViewLocked(newValue);
    localStorage.setItem('roast-studio-view-locked', String(newValue));
  };

  // Waiting room host chatter state
  const [waitingRoomDialogue, setWaitingRoomDialogue] = useState<string | null>(null);
  const [waitingRoomSpeaker, setWaitingRoomSpeaker] = useState<"hostA" | "hostB" | null>(null);
  const waitingRoomChatterRef = useRef(false);
  const countdownWarningPlayedRef = useRef(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mountedRef = useRef(true);
  const pausedRef = useRef(false);
  const playingRef = useRef(false);
  const hostTurnRef = useRef<"A" | "B">("A");
  const containerRef = useRef<HTMLDivElement>(null);
  const hasCompletedRef = useRef(false);
  const typewriterRef = useRef<NodeJS.Timeout | null>(null);

  // Global state sync refs
  const lastProcessedIndexRef = useRef<number>(-1);
  const currentlyProcessingRef = useRef<number | null>(null);

  // Pre-generated TTS cache: stores { roastText, ttsUrl, ttsBase64, hostType } for next roast
  const pregenCacheRef = useRef<Map<number, {
    roastText: string;
    ttsUrl: string | null;
    ttsBase64: string | null;
    hostType: "A" | "B";
  }>>(new Map());

  // Round state from global synchronized state
  const { 
    endLiveRound, 
    advanceRoastIndex,
    currentRoastIndex: globalRoastIndex,
    totalRoasts: globalTotalRoasts,
    liveStartTime: globalLiveStartTime,
    roundState: globalRoundState,
    timeRemaining
  } = useRoundState();

  // Session sync for synchronized viewing (host/follower model for UI sync)
  const { isHost, playbackState, viewerCount, broadcastState } = useSessionSync({
    sessionId: session.id,
    onStateChange: (state) => {
      // Followers sync to host's state for UI display
      if (!isHost && state) {
        setCurrentIndex(state.current_index);
        setPhase(state.phase as typeof phase);
        setCurrentSpeaker(state.current_speaker as Speaker | null);
        setRoastNumber(state.roast_number);
        setIsPlaying(state.is_playing);
        hostTurnRef.current = state.host_turn as "A" | "B";
        
        if (state.current_text) {
          setCurrentDisplay({
            speaker: state.current_speaker as Speaker,
            text: state.current_text,
          });
          setDisplayedText(state.current_text);
        } else {
          setCurrentDisplay(null);
          setDisplayedText("");
        }
        
        // Play audio if follower and audio URL provided
        if (state.current_audio_url && state.audio_started_at) {
          playFollowerAudio(state.current_audio_url, state.audio_started_at);
        }
      }
    },
  });

  // Host chatter for waiting room (only active when not LIVE and countdown is running)
  // Enable chatter for hosts OR when there's an active countdown (studio page scenario)
  const isWaitingRoom = session.status !== "LIVE";
  const shouldEnableChatter = isWaitingRoom && (isHost || timeRemaining > 0);
  const { speakingHost: chatterSpeakingHost, currentText: chatterCurrentText, isPlaying: chatterIsPlaying } = useHostChatter({
    enabled: shouldEnableChatter,
    timeRemaining,
  });

  // Sync host chatter to waiting room state - keep text visible while playing
  useEffect(() => {
    if (shouldEnableChatter && chatterSpeakingHost && chatterCurrentText) {
      setWaitingRoomSpeaker(chatterSpeakingHost);
      setWaitingRoomDialogue(chatterCurrentText);
    }
    // Only clear when chatter hook clears its state (not just when audio stops)
    if (!chatterSpeakingHost && !chatterCurrentText) {
      setWaitingRoomSpeaker(null);
      setWaitingRoomDialogue(null);
    }
  }, [shouldEnableChatter, chatterSpeakingHost, chatterCurrentText]);

  // Scheduler and processed refs
  const schedulerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const liveStartTimeRef = useRef<number>(0);
  const roastProcessedRef = useRef<Set<number>>(new Set());

  // Ref for muted state to avoid stale closure issues
  const mutedRef = useRef(isMuted);
  useEffect(() => {
    mutedRef.current = isMuted;
    if (audioRef.current) {
      audioRef.current.muted = isMuted;
    }
    if (waitingAudioRef.current) {
      waitingAudioRef.current.muted = isMuted;
    }
  }, [isMuted]);

  const waitingAudioRef = useRef<HTMLAudioElement | null>(null);

  // Full state reset when session changes
  useEffect(() => {
    countdownWarningPlayedRef.current = false;
    waitingRoomChatterRef.current = false;
    setWaitingRoomDialogue(null);
    setWaitingRoomSpeaker(null);
    
    hasCompletedRef.current = false;
    playingRef.current = false;
    hostTurnRef.current = "A";
    roastProcessedRef.current.clear();
    currentlyProcessingRef.current = null;
    lastProcessedIndexRef.current = -1;
    liveStartTimeRef.current = 0;
    pregenCacheRef.current.clear();
    setMessages([]);
    setCurrentIndex(0);
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentDisplay(null);
    setCurrentSpeaker(null);
    setShowIntro(true);
    setRoastNumber(0);
    setPhase("idle");
    setIsAutoStarting(false);
    setIsTransitioning(false);
    setDisplayedText("");
    setIsTyping(false);
    setShowComplete(false);
    setCompleteCountdown(3);
    
    if (schedulerIntervalRef.current) {
      clearInterval(schedulerIntervalRef.current);
      schedulerIntervalRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    if (typewriterRef.current) {
      clearInterval(typewriterRef.current);
    }
  }, [session.id]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (typewriterRef.current) {
        clearInterval(typewriterRef.current);
      }
      if (schedulerIntervalRef.current) {
        clearInterval(schedulerIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    pausedRef.current = isPaused;
  }, [isPaused]);

  // Play audio for followers with time sync
  const playFollowerAudio = useCallback((url: string, startedAt: string) => {
    if (!mountedRef.current) return;
    
    const startTime = new Date(startedAt).getTime();
    const now = Date.now();
    const elapsed = (now - startTime) / 1000;
    
    if (elapsed > 30) {
      return;
    }
    
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    
    const audio = new Audio(url);
    audio.muted = mutedRef.current;
    audioRef.current = audio;
    
    audio.onloadedmetadata = () => {
      if (elapsed > 0 && elapsed < audio.duration) {
        audio.currentTime = elapsed;
      }
      audio.play().catch(() => {});
    };
  }, []);

  // Fetch messages and subscribe to updates
  useEffect(() => {
    fetchMessages();
    
    const channel = supabase
      .channel(`watch-messages-${session.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "roast_messages", filter: `session_id=eq.${session.id}` },
        () => fetchMessages()
      )
      .subscribe();

    // Subscribe to waiting room dialogue broadcast (for followers)
    const dialogueChannel = supabase
      .channel(`dialogue-${session.id}`)
      .on("broadcast", { event: "dialogue" }, (payload) => {
        if (!isHost && payload.payload) {
          setWaitingRoomDialogue(payload.payload.text || null);
          setWaitingRoomSpeaker(payload.payload.speaker || null);
          if (payload.payload.audioUrl && !isMuted) {
            playAudioForWaiting(payload.payload.audioUrl);
          }
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(dialogueChannel);
    };
  }, [session.id, isHost, isMuted]);

  // Auto-start when session goes LIVE (HOST ONLY)
  useEffect(() => {
    if (session.status === "LIVE" && !hasCompletedRef.current && isHost) {
      if (messages.length === 0 && !playingRef.current) {
        playingRef.current = true;
        const runNoRoasts = async () => {
          await playNoRoastsCommentary();
          if (!hasCompletedRef.current) {
            hasCompletedRef.current = true;
            // BRUTE FORCE: End round and immediately force new session
            await endLiveRound();
            // Force create a new session with different KOL
            await forceNewKOL();
          }
        };
        runNoRoasts();
        return;
      }
      
      if (messages.length > 0 && !isPlaying && !playingRef.current) {
        setIsAutoStarting(true);
        setShowIntro(false);
        const timer = setTimeout(() => {
          setIsAutoStarting(false);
          handleStart();
        }, 1500);
        return () => clearTimeout(timer);
      }
    }
  }, [session.status, messages.length, isHost, isPlaying]);

  // Handle completion countdown
  useEffect(() => {
    if (!showComplete) return;
    
    if (completeCountdown <= 0) {
      setShowComplete(false);
      if (onComplete) {
        onComplete();
      }
      return;
    }
    
    const timer = setTimeout(() => {
      setCompleteCountdown(prev => prev - 1);
    }, 1000);
    
    return () => clearTimeout(timer);
  }, [showComplete, completeCountdown, onComplete]);

  // Play "no roasts" commentary when session goes live with no messages
  const playNoRoastsCommentary = async () => {
    const noRoastDialogues = [
      [
        { speaker: "A" as const, text: `Wait... NOBODY roasted ${session.persona_name}?! Are you KIDDING me?!` },
        { speaker: "B" as const, text: `Apparently ${session.persona_name} is too boring to roast. Or everyone fell asleep.` },
      ],
    ];

    const selectedDialogue = noRoastDialogues[Math.floor(Math.random() * noRoastDialogues.length)];

    for (const line of selectedDialogue) {
      if (!mountedRef.current) break;

      const speaker = line.speaker === "A" ? "hostA" : "hostB";
      
      // Set BOTH display systems so text shows in LIVE state too
      setWaitingRoomSpeaker(speaker);
      setWaitingRoomDialogue(line.text);
      setCurrentSpeaker(speaker);
      setCurrentDisplay({ speaker, text: line.text });
      setDisplayedText(line.text);

      supabase.channel(`dialogue-${session.id}`).send({
        type: "broadcast",
        event: "dialogue",
        payload: { text: line.text, speaker, audioUrl: null },
      });

      const audioUrl = await generateTTSForWaiting(line.text, line.speaker);
      
      if (audioUrl) {
        supabase.channel(`dialogue-${session.id}`).send({
          type: "broadcast",
          event: "dialogue",
          payload: { text: line.text, speaker, audioUrl },
        });
        await playAudioForWaiting(audioUrl);
      } else {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      await new Promise(resolve => setTimeout(resolve, 600));
    }

    // Clear both display systems
    setWaitingRoomSpeaker(null);
    setWaitingRoomDialogue(null);
    setCurrentSpeaker(null);
    setCurrentDisplay(null);
    setDisplayedText("");
    
    supabase.channel(`dialogue-${session.id}`).send({
      type: "broadcast",
      event: "dialogue",
      payload: { text: null, speaker: null, audioUrl: null },
    });
  };

  const generateTTSForWaiting = async (text: string, hostType: "A" | "B"): Promise<string | null> => {
    try {
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
      if (!response.ok) return null;
      const data = await response.json();
      return `data:audio/mpeg;base64,${data.audioContent}`;
    } catch {
      return null;
    }
  };

  const playAudioForWaiting = async (url: string): Promise<void> => {
    if (!mountedRef.current) return;
    return new Promise((resolve) => {
      if (waitingAudioRef.current) {
        waitingAudioRef.current.pause();
        waitingAudioRef.current = null;
      }
      
      const audio = new Audio(url);
      audio.muted = mutedRef.current;
      waitingAudioRef.current = audio;
      
      audio.onended = () => {
        waitingAudioRef.current = null;
        resolve();
      };
      audio.onerror = () => {
        waitingAudioRef.current = null;
        resolve();
      };
      audio.play().catch(() => {
        waitingAudioRef.current = null;
        resolve();
      });
    });
  };

  // BRUTE FORCE: Create new session with different KOL immediately
  const forceNewKOL = async () => {
    console.log("[WatchView] BRUTE FORCE: Creating new KOL session...");
    try {
      // Get a random persona
      const { data: personas } = await supabase
        .from("personas")
        .select("*");
      
      if (!personas || personas.length === 0) {
        console.log("[WatchView] No personas available");
        return;
      }
      
      // Pick random persona (different from current if possible)
      let selectedPersona = personas[Math.floor(Math.random() * personas.length)];
      if (personas.length > 1) {
        const filtered = personas.filter(p => p.username !== session.persona_name);
        if (filtered.length > 0) {
          selectedPersona = filtered[Math.floor(Math.random() * filtered.length)];
        }
      }
      
      // Create new OPEN session
      const now = new Date();
      const lockTime = new Date(now.getTime() + 2 * 60 * 1000); // 2 minutes
      
      const { data: newSession, error } = await supabase
        .from("roast_sessions")
        .insert({
          persona_name: selectedPersona.username,
          persona_avatar: selectedPersona.profile_pic_url,
          persona_id: selectedPersona.id,
          status: "OPEN",
          start_time: now.toISOString(),
          lock_time: lockTime.toISOString(),
        })
        .select()
        .single();
      
      if (error) {
        console.error("[WatchView] Failed to create new session:", error);
        return;
      }
      
      console.log("[WatchView] BRUTE FORCE: New session created:", newSession.id);
      
      // Update global round state to SUBMITTING with new session
      await supabase
        .from("global_round_state")
        .update({
          round_state: "SUBMITTING",
          session_id: newSession.id,
          submit_end_time: lockTime.toISOString(),
          current_roast_index: 0,
          total_roasts: 0,
          live_start_time: null,
        })
        .eq("id", "singleton");
      
      console.log("[WatchView] BRUTE FORCE: Global state updated to SUBMITTING");
    } catch (err) {
      console.error("[WatchView] BRUTE FORCE error:", err);
    }
  };

  const fetchMessages = async () => {
    const { data } = await supabase
      .from("roast_messages")
      .select("*")
      .eq("session_id", session.id)
      .eq("used", false)
      .order("created_at", { ascending: true });

    if (data) setMessages(data);
  };

  const playAudio = async (url: string): Promise<void> => {
    if (!mountedRef.current) return;

    return new Promise((resolve) => {
      if (!mountedRef.current) { resolve(); return; }

      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }

      const audio = new Audio(url);
      audio.muted = mutedRef.current;
      audioRef.current = audio;

      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      audio.play().catch(() => resolve());
    });
  };

  const generateRoast = async (transcript: string, hostType: "A" | "B"): Promise<string> => {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-roast`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            transcript,
            personaName: session.persona_name,
            hostType,
          }),
        }
      );

      if (!response.ok) {
        return hostType === "A"
          ? `Oh WOW, that was BRUTAL! 🔥`
          : `Now that's what I call a proper roast.`;
      }

      const data = await response.json();
      return data.roast;
    } catch {
      return hostType === "A"
        ? `Oh WOW, that was BRUTAL! 🔥`
        : `Now that's what I call a proper roast.`;
    }
  };

  const generateTTS = async (text: string, hostType: "A" | "B" | "announcer"): Promise<string | null> => {
    try {
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

      if (!response.ok) return null;
      const data = await response.json();
      return `data:audio/mpeg;base64,${data.audioContent}`;
    } catch {
      return null;
    }
  };

  const markMessageUsed = async (messageId: string) => {
    await supabase
      .from("roast_messages")
      .update({ used: true })
      .eq("id", messageId);
  };

  const waitWhilePaused = async () => {
    while (pausedRef.current && mountedRef.current && playingRef.current) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };

  // Typewriter effect function
  const typeText = (text: string, speed: number = 30): Promise<void> => {
    return new Promise((resolve) => {
      setIsTyping(true);
      setDisplayedText("");
      let index = 0;
      
      if (typewriterRef.current) {
        clearInterval(typewriterRef.current);
      }
      
      typewriterRef.current = setInterval(() => {
        if (index < text.length) {
          setDisplayedText(text.slice(0, index + 1));
          index++;
        } else {
          if (typewriterRef.current) {
            clearInterval(typewriterRef.current);
          }
          setIsTyping(false);
          resolve();
        }
      }, speed);
    });
  };

  // Save exchange to database for archive replay
  const saveExchange = async (
    messageId: string,
    userTranscript: string,
    userAudioUrl: string | null,
    hostType: "A" | "B",
    hostResponse: string,
    hostAudioBase64: string | null,
    sequenceNumber: number
  ) => {
    try {
      let hostAudioUrl: string | null = null;

      // Upload host audio to storage if we have it
      if (hostAudioBase64) {
        const audioBlob = base64ToBlob(hostAudioBase64, "audio/mpeg");
        const fileName = `${session.id}/${sequenceNumber}_host${hostType}.mp3`;
        
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("host-audio")
          .upload(fileName, audioBlob, { contentType: "audio/mpeg", upsert: true });

        if (!uploadError && uploadData) {
          const { data: urlData } = supabase.storage
            .from("host-audio")
            .getPublicUrl(fileName);
          hostAudioUrl = urlData.publicUrl;
        }
      }

      // Insert exchange record
      await supabase.from("roast_exchanges").insert({
        session_id: session.id,
        message_id: messageId,
        user_transcript: userTranscript,
        user_audio_url: userAudioUrl,
        host_type: hostType,
        host_response: hostResponse,
        host_audio_url: hostAudioUrl,
        sequence_number: sequenceNumber,
      });
    } catch (err) {
      console.error("Error saving exchange:", err);
    }
  };

  // Helper to convert base64 to Blob
  const base64ToBlob = (base64: string, mimeType: string): Blob => {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
  };

  // Pre-generate roast text and TTS for a given index (runs in background)
  const pregenForIndex = useCallback(async (idx: number) => {
    if (idx >= messages.length) return;
    if (pregenCacheRef.current.has(idx)) return; // Already pre-generated
    
    const message = messages[idx];
    const userText = message.transcript || "[Voice clip]";
    
    // Determine which host will respond (based on alternation)
    // Host alternates: 0->A, 1->B, 2->A, 3->B...
    const hostType: "A" | "B" = idx % 2 === 0 ? "A" : "B";
    
    console.log(`[Pregen] Starting pre-generation for roast ${idx + 1}`);
    
    try {
      // Generate roast text
      const roastText = await generateRoast(userText, hostType);
      
      // Generate TTS
      const ttsUrl = await generateTTS(roastText, hostType);
      
      let ttsBase64: string | null = null;
      if (ttsUrl) {
        const base64Match = ttsUrl.match(/base64,(.+)$/);
        if (base64Match) {
          ttsBase64 = base64Match[1];
        }
      }
      
      // Store in cache
      pregenCacheRef.current.set(idx, {
        roastText,
        ttsUrl,
        ttsBase64,
        hostType,
      });
      
      console.log(`[Pregen] Completed pre-generation for roast ${idx + 1}`);
    } catch (err) {
      console.error(`[Pregen] Failed for roast ${idx + 1}:`, err);
    }
  }, [messages]);

  // Process a single roast at the given index
  const processRoast = useCallback(async (idx: number) => {
    if (!mountedRef.current || !playingRef.current) return;
    if (currentlyProcessingRef.current !== null) return; // Already processing one
    
    currentlyProcessingRef.current = idx;
    roastProcessedRef.current.add(idx);

    setCurrentIndex(idx);
    setRoastNumber(idx + 1);

    const message = messages[idx];
    const userText = message.transcript || "[Voice clip]";

    // Start pre-generating the NEXT roast in background (don't await)
    if (idx + 1 < messages.length) {
      pregenForIndex(idx + 1);
    }

    // Show user roast with typewriter AND play audio simultaneously
    setPhase("roast");
    setCurrentSpeaker("user");
    setCurrentDisplay({ speaker: "user", text: userText });

    // Start typewriter and audio in parallel
    const typewriterPromise = typeText(userText, 25);
    
    // Broadcast user roast state
    broadcastState({
      current_index: idx,
      phase: "roast",
      current_speaker: "user",
      current_text: userText,
      roast_number: idx + 1,
      current_audio_url: message.audio_url,
      audio_started_at: new Date().toISOString(),
    });

    let audioPromise: Promise<void>;
    if (message.audio_url) {
      audioPromise = playAudio(message.audio_url);
    } else if (message.transcript) {
      audioPromise = (async () => {
        const announcerUrl = await generateTTS(message.transcript!, "announcer");
        if (announcerUrl) {
          await playAudio(announcerUrl);
        } else {
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      })();
    } else {
      audioPromise = new Promise((resolve) => setTimeout(resolve, 3000));
    }

    // Wait for both to complete
    await Promise.all([typewriterPromise, audioPromise]);

    if (!mountedRef.current || !playingRef.current) {
      currentlyProcessingRef.current = null;
      return;
    }

    // Transition with fade
    setIsTransitioning(true);
    setPhase("transition");
    await broadcastState({ phase: "transition" });
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Check if we have pre-generated content for THIS roast's host response
    const cached = pregenCacheRef.current.get(idx);
    
    // Determine host type for this response
    const hostType: "A" | "B" = idx % 2 === 0 ? "A" : "B";
    hostTurnRef.current = hostType === "A" ? "B" : "A"; // Set next turn

    setPhase("response");
    setIsTransitioning(false);

    let roast: string;
    let ttsUrl: string | null;
    let ttsBase64: string | null = null;

    if (cached && cached.hostType === hostType) {
      // Use pre-generated content - instant!
      console.log(`[Pregen] Using cached roast for ${idx + 1}`);
      roast = cached.roastText;
      ttsUrl = cached.ttsUrl;
      ttsBase64 = cached.ttsBase64;
      pregenCacheRef.current.delete(idx); // Clear from cache
    } else {
      // Generate on-the-fly (fallback for first roast or cache miss)
      roast = await generateRoast(userText, hostType);
      ttsUrl = await generateTTS(roast, hostType);
      if (ttsUrl) {
        const base64Match = ttsUrl.match(/base64,(.+)$/);
        if (base64Match) {
          ttsBase64 = base64Match[1];
        }
      }
    }

    const hostSpeaker = hostType === "A" ? "hostA" : "hostB";
    setCurrentSpeaker(hostSpeaker);
    setCurrentDisplay({
      speaker: hostSpeaker,
      text: roast,
    });

    // Start typewriter and play audio simultaneously (TTS already generated!)
    const hostTypewriterPromise = typeText(roast, 20);
    
    // Broadcast host response state with audio
    broadcastState({
      phase: "response",
      current_speaker: hostSpeaker,
      current_text: roast,
      host_turn: hostTurnRef.current,
      current_audio_url: ttsUrl,
      audio_started_at: new Date().toISOString(),
    });
    
    const ttsPlayPromise = ttsUrl 
      ? playAudio(ttsUrl) 
      : new Promise<void>((resolve) => setTimeout(resolve, 3000));

    // Wait for both typewriter and audio to complete
    await Promise.all([hostTypewriterPromise, ttsPlayPromise]);

    // Save this exchange to database for archive replay
    await saveExchange(
      message.id,
      userText,
      message.audio_url,
      hostType,
      roast,
      ttsBase64,
      idx + 1
    );

    // Mark message as used
    await markMessageUsed(message.id);

    // Brief pause between messages
    setPhase("transition");
    await broadcastState({ phase: "transition" });
    await new Promise((resolve) => setTimeout(resolve, 400));

    currentlyProcessingRef.current = null;

    // Check if this was the last roast
    if (idx === messages.length - 1) {
      finishPlayback();
    }
  }, [messages, session.persona_name, broadcastState, pregenForIndex]);

  // Finish playback and transition to completion
  const finishPlayback = useCallback(async () => {
    if (schedulerIntervalRef.current) {
      clearInterval(schedulerIntervalRef.current);
      schedulerIntervalRef.current = null;
    }

    playingRef.current = false;
    setIsPlaying(false);
    setPhase("idle");
    setCurrentDisplay(null);
    setCurrentSpeaker(null);

    // Broadcast end state
    await broadcastState({
      is_playing: false,
      phase: "idle",
      current_speaker: null,
      current_text: null,
      current_audio_url: null,
    });

    // BRUTE FORCE: End round and immediately force new session with 2-minute timer
    if (!hasCompletedRef.current) {
      hasCompletedRef.current = true;
      await endLiveRound();
      // Force create a new session with different KOL
      await forceNewKOL();
    }
  }, [broadcastState, endLiveRound]);

  // Timestamp-based scheduler - checks every 250ms which roast should play
  const startTimestampScheduler = useCallback(() => {
    if (!isHost) {
      console.log("[Sync] Not host, skipping scheduler");
      return;
    }

    // Clear any existing scheduler
    if (schedulerIntervalRef.current) {
      clearInterval(schedulerIntervalRef.current);
    }

    // Initialize
    liveStartTimeRef.current = Date.now();
    roastProcessedRef.current.clear();
    currentlyProcessingRef.current = null;
    pregenCacheRef.current.clear();
    playingRef.current = true;

    // Pre-generate the FIRST roast immediately so it's ready when we start
    if (messages.length > 0) {
      pregenForIndex(0);
    }

    // Base delay per roast (estimated average time per roast in ms)
    const BASE_DELAY_PER_ROAST = 15000; // 15 seconds average per roast

    // Broadcast initial state
    broadcastState({
      is_playing: true,
      current_index: 0,
      phase: "roast",
    });

    // Start the 250ms interval ticker
    schedulerIntervalRef.current = setInterval(() => {
      if (!mountedRef.current || !playingRef.current) {
        if (schedulerIntervalRef.current) {
          clearInterval(schedulerIntervalRef.current);
          schedulerIntervalRef.current = null;
        }
        return;
      }

      // Check if paused
      if (pausedRef.current) return;

      const elapsed = Date.now() - liveStartTimeRef.current;

      // Find the roast that should be playing based on elapsed time
      for (let i = 0; i < messages.length; i++) {
        const offsetTime = i * BASE_DELAY_PER_ROAST;
        
        // If enough time has passed for this roast AND it hasn't been processed yet
        if (elapsed >= offsetTime && !roastProcessedRef.current.has(i)) {
          // Only start if nothing is currently processing
          if (currentlyProcessingRef.current === null) {
            console.log(`[Scheduler] Triggering roast ${i + 1}/${messages.length} at elapsed=${elapsed}ms`);
            processRoast(i);
          }
          break; // Only trigger one at a time
        }
      }

      // Check if all roasts have been processed
      if (roastProcessedRef.current.size === messages.length && currentlyProcessingRef.current === null) {
        // All done, the last processRoast will call finishPlayback
        if (schedulerIntervalRef.current) {
          clearInterval(schedulerIntervalRef.current);
          schedulerIntervalRef.current = null;
        }
      }
    }, 250);
  }, [isHost, messages, broadcastState, processRoast, pregenForIndex]);

  const handleStart = () => {
    if (messages.length === 0) return;
    setIsPlaying(true);
    setIsPaused(false);
    setCurrentIndex(0);
    hostTurnRef.current = "A";
    startTimestampScheduler();
  };

  const handleTogglePause = () => {
    if (isPaused) {
      setIsPaused(false);
      if (audioRef.current) audioRef.current.play();
    } else {
      setIsPaused(true);
      if (audioRef.current) audioRef.current.pause();
    }
  };

  const handleRestart = () => {
    // Stop scheduler and audio
    if (schedulerIntervalRef.current) {
      clearInterval(schedulerIntervalRef.current);
      schedulerIntervalRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    playingRef.current = false;
    hasCompletedRef.current = false;
    roastProcessedRef.current.clear();
    currentlyProcessingRef.current = null;
    pregenCacheRef.current.clear();
    setCurrentIndex(0);
    setCurrentDisplay(null);
    setCurrentSpeaker(null);
    setPhase("idle");
    setTimeout(() => handleStart(), 300);
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;

    if (!isFullscreen) {
      containerRef.current.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
    setIsFullscreen(!isFullscreen);
  };

  // Waiting state (OPEN or LOCKED)
  if (session.status !== "LIVE") {
    const isLocked = session.status === "LOCKED";
    
    return (
      <div className="watch-container">
        <div className="watch-glass-panel watch-waiting-room">
          {/* Ambient orbs - same as live */}
          <div className="watch-orb watch-orb-1" />
          <div className="watch-orb watch-orb-2" />
          <div className="watch-orb watch-orb-3" />

          {/* Header - matching main SessionManager header */}
          <header className="border-b-2 border-border bg-card/90 backdrop-blur-sm sticky top-0 z-50 shadow-[0_2px_0_hsl(0_0%_0%)]">
            <div className="container mx-auto px-3 py-2 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {onBack && (
                  <Button variant="ghost" size="icon" onClick={onBack} className="watch-btn-icon h-8 w-8">
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                )}
              <button 
                  onClick={() => navigate("/")}
                  className="text-lg md:text-xl font-pixel text-primary text-glow-green hover:text-secondary transition-colors tracking-wider"
                >
                  ROAST STUDIO
                </button>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-secondary text-glow-magenta font-bold">
                  {messages.length} ROASTS
                </span>
                <a 
                  href="https://twitter.com/RoastStudio" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-[10px] text-primary hover:text-secondary transition-colors"
                >
                  @RoastStudio
                </a>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={toggleViewLock} 
                  className={`h-7 w-7 ${isViewLocked ? 'text-primary' : ''}`}
                  title={isViewLocked ? "Unlock view (auto-navigate when done)" : "Lock view (stay on Watch tab when done)"}
                >
                  {isViewLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                </Button>
                <Button variant="ghost" size="icon" onClick={toggleMute} className="h-7 w-7">
                  {isMuted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                </Button>
              {/* Status badge moved to end of header for waiting room */}
              </div>
            </div>
          </header>

          {/* Main content - CSS Grid with fixed slots to prevent reflow */}
          <div className="watch-waiting-layout">
            {/* Row 1: Persona Display */}
            <div className="watch-waiting-slot-persona">
              <div className="watch-persona-display">
                <div className="watch-persona-avatar-wrapper">
                  <div className="watch-persona-avatar">
                    {session.persona_avatar ? (
                      <img
                        src={session.persona_avatar}
                        alt={session.persona_name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-5xl font-bold text-foreground">
                        {session.persona_name.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                </div>
                <h2 className="watch-persona-name">{session.persona_name}</h2>
                <span className="watch-persona-status">
                  {isLocked ? "🔒 Show starting soon" : "🎤 Taking roasts"}
                </span>
              </div>
            </div>

            {/* Row 2: Countdown */}
            <div className="watch-waiting-slot-countdown">
              <CountdownDisplay session={session} />
            </div>
            
            {/* Row 3: Status message - FIXED HEIGHT (no dialogue here anymore) */}
            <div className="watch-waiting-slot-message">
              <p className="text-muted-foreground text-center">
                {isLocked ? "Get ready! Show starting soon..." : "Submit your roasts now!"}
              </p>
            </div>

            {/* Row 4: Hosts Stage - FIXED POSITION with speech bubbles above heads */}
            <div className="watch-waiting-slot-stage">
              <div className="watch-stage watch-stage-waiting">
                <div className="watch-host-stage watch-host-stage-left">
                  <div className="watch-host-figure">
                    {/* Speech bubble above host A (anchored to the host) */}
                    {waitingRoomDialogue && waitingRoomSpeaker === "hostA" && (
                      <div className="watch-host-speech-bubble watch-host-speech-left animate-fade-in">
                        <p className="text-foreground text-center text-xs leading-snug">{waitingRoomDialogue}</p>
                      </div>
                    )}
                    <SmallHost type="hostA" isSpeaking={waitingRoomSpeaker === "hostA" && chatterIsPlaying} size="large" />
                  </div>
                  <span className="watch-host-label text-lg text-orange-400">CHAOS CARL</span>
                  <span className="watch-host-status-text">
                    {waitingRoomSpeaker === "hostA" ? "🎤 Speaking..." : "🔥 Ready to roast"}
                  </span>
                </div>

                {/* Center VS badge */}
                <div className="watch-vs-center">
                  <span className="watch-vs-text">VS</span>
                  <span className="watch-vs-sub">{session.persona_name}</span>
                </div>

                <div className="watch-host-stage watch-host-stage-right">
                  <div className="watch-host-figure">
                    {/* Speech bubble above host B (anchored to the host) */}
                    {waitingRoomDialogue && waitingRoomSpeaker === "hostB" && (
                      <div className="watch-host-speech-bubble watch-host-speech-right animate-fade-in">
                        <p className="text-foreground text-center text-xs leading-snug">{waitingRoomDialogue}</p>
                      </div>
                    )}
                    <SmallHost type="hostB" isSpeaking={waitingRoomSpeaker === "hostB" && chatterIsPlaying} size="large" />
                  </div>
                  <span className="watch-host-label text-lg text-blue-400">ROAST RONNIE</span>
                  <span className="watch-host-status-text">
                    {waitingRoomSpeaker === "hostB" ? "🎤 Speaking..." : "🧊 Cool and deadly"}
                  </span>
                </div>
              </div>
            </div>

            {/* Row 5: Call to action */}
            <div className="watch-waiting-slot-cta">
              <div className="watch-cta-box">
                <p className="text-primary animate-pulse">
                  {isLocked ? "⏳ Submissions closed" : "🎤 Drop your hottest takes below!"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // LIVE state
  return (
    <div ref={containerRef} className="watch-container">
      <div className="watch-glass-panel watch-live">
        {/* Ambient orbs */}
        <div className="watch-orb watch-orb-1" />
        <div className="watch-orb watch-orb-2" />
        <div className="watch-orb watch-orb-3" />

        {/* Header - matching main SessionManager header */}
        <header className="border-b-2 border-border bg-card/90 backdrop-blur-sm sticky top-0 z-50 shadow-[0_2px_0_hsl(0_0%_0%)]">
          <div className="container mx-auto px-3 py-2 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {onBack && (
                <Button variant="ghost" size="icon" onClick={onBack} className="watch-btn-icon h-8 w-8">
                  <ArrowLeft className="w-4 h-4" />
                </Button>
              )}
              <button 
                onClick={() => navigate("/")}
                className="text-lg md:text-xl font-pixel text-primary text-glow-green hover:text-secondary transition-colors tracking-wider"
              >
                ROAST STUDIO
              </button>
              <div className="watch-badge watch-badge-live">
                <span className="watch-badge-dot bg-destructive animate-pulse" />
                LIVE
              </div>
              {isPlaying && (
                <span className="text-[10px] text-muted-foreground font-pixel">
                  #{roastNumber} / {messages.length}
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              <span className="text-[10px] text-secondary text-glow-magenta font-bold">
                {messages.length} ROASTS
              </span>
              <a 
                href="https://twitter.com/RoastStudio" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-[10px] text-primary hover:text-secondary transition-colors"
              >
                @RoastStudio
              </a>
              {/* Pause/Reset buttons removed per user request */}
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={toggleViewLock} 
                className={`h-7 w-7 ${isViewLocked ? 'text-primary' : ''}`}
                title={isViewLocked ? "Unlock view (auto-navigate when done)" : "Lock view (stay on Watch tab when done)"}
              >
                {isViewLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
              </Button>
              <Button variant="ghost" size="icon" onClick={toggleMute} className="h-7 w-7">
                {isMuted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
              </Button>
              <Button variant="ghost" size="icon" onClick={toggleFullscreen} className="h-7 w-7">
                {isFullscreen ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
              </Button>
            </div>
          </div>
        </header>

        {/* Main stage */}
        <div className="flex-1 flex flex-col items-center justify-stretch gap-4 px-6 py-4">
          {/* Clean Persona Display */}
          <div className="watch-persona-display watch-persona-live">
            <div className="watch-persona-avatar-wrapper">
              <div className="watch-persona-avatar watch-persona-avatar-live">
                {session.persona_avatar ? (
                  <img
                    src={session.persona_avatar}
                    alt={session.persona_name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-5xl font-bold text-foreground">
                    {session.persona_name.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
            </div>
            <h2 className="watch-persona-name">{session.persona_name}</h2>
          </div>

          {/* Hosts and speech */}
          <div className="flex-1 w-full flex items-center justify-center">
            <div className="watch-stage">
              {/* Host A - Left side */}
              <div className={`watch-host-stage watch-host-stage-left ${currentSpeaker === "hostA" ? "watch-host-active" : ""}`}>
                <div className="watch-host-figure">
                  <SmallHost type="hostA" isSpeaking={currentSpeaker === "hostA"} size="large" />
                </div>
                <AudioWaveformVisualizer
                  isActive={currentSpeaker === "hostA"}
                  color="hsl(30 100% 50%)"
                  barCount={7}
                  className="mt-3"
                />
                <span className={`watch-host-label text-lg ${currentSpeaker === "hostA" ? "text-orange-400" : "text-muted-foreground"}`}>
                  CHAOS CARL
                </span>
              </div>

              {/* Speech bubble - Center */}
              <div className="watch-speech-container">
                {currentDisplay ? (
                  <div
                    className={`watch-speech-bubble watch-speech-dramatic ${
                      currentDisplay.speaker === "user"
                        ? "watch-speech-user watch-slide-up"
                        : currentDisplay.speaker === "hostA"
                        ? "watch-speech-hosta watch-slide-left"
                        : "watch-speech-hostb watch-slide-right"
                    } ${isTransitioning ? "watch-fade-out" : ""}`}
                  >
                    <div className="watch-speech-label">
                      {currentDisplay.speaker === "user"
                        ? "🎤 AUDIENCE ROAST"
                        : currentDisplay.speaker === "hostA"
                        ? "🔥 CHAOS CARL"
                        : "🧊 ROAST RONNIE"}
                    </div>
                    <p className="watch-speech-text watch-typewriter">
                      {displayedText}
                      {isTyping && <span className="watch-cursor">|</span>}
                    </p>
                    
                    {/* Speaker-specific particles */}
                    {currentDisplay.speaker === "hostA" && (
                      <div className="watch-speech-flames">
                        {[...Array(5)].map((_, i) => (
                          <div key={i} className={`watch-flame watch-flame-${i + 1}`} />
                        ))}
                      </div>
                    )}
                    {currentDisplay.speaker === "hostB" && (
                      <div className="watch-speech-frost">
                        {[...Array(5)].map((_, i) => (
                          <div key={i} className={`watch-frost watch-frost-${i + 1}`} />
                        ))}
                      </div>
                    )}
                  </div>
                ) : showComplete ? (
                  <div className="watch-speech-idle">
                    <div className="flex flex-col items-center gap-4 text-center">
                      <p className="text-6xl font-pixel text-primary animate-pulse">
                        {completeCountdown > 0 ? completeCountdown : "GO!"}
                      </p>
                      <p className="text-xl font-pixel text-secondary">
                        {isViewLocked ? "NEXT KOL INCOMING..." : "NEXT KOL"}
                      </p>
                      <p className="text-muted-foreground text-sm">
                        {isViewLocked 
                          ? "Staying on Watch tab..." 
                          : "Switching to Submit tab..."}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="watch-speech-idle">
                    {messages.length === 0 ? (
                      <div className="flex flex-col items-center gap-4 text-center">
                        <p className="text-xl font-pixel text-secondary">NO ROASTS SUBMITTED</p>
                        <p className="text-muted-foreground text-sm">
                          No one roasted {session.persona_name} this round. 😅
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Show will end shortly...
                        </p>
                      </div>
                    ) : isAutoStarting ? (
                      <div className="flex flex-col items-center gap-4">
                        <div className="watch-spinner" />
                        <p className="text-primary text-sm animate-pulse">Starting the show...</p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <div className="watch-spinner" />
                        <p className="text-muted-foreground text-sm animate-pulse">
                          {isPlaying 
                            ? "Loading next roast..." 
                            : messages.length === 0 
                              ? "Waiting for roasts..." 
                              : "Starting show..."}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Host B - Right side */}
              <div className={`watch-host-stage watch-host-stage-right ${currentSpeaker === "hostB" ? "watch-host-active" : ""}`}>
                <div className="watch-host-figure">
                  <SmallHost type="hostB" isSpeaking={currentSpeaker === "hostB"} size="large" />
                </div>
                <AudioWaveformVisualizer
                  isActive={currentSpeaker === "hostB"}
                  color="hsl(200 100% 50%)"
                  barCount={7}
                  className="mt-3"
                />
                <span className={`watch-host-label text-lg ${currentSpeaker === "hostB" ? "text-blue-400" : "text-muted-foreground"}`}>
                  ROAST RONNIE
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Progress bar */}
        {isPlaying && (
          <div className="watch-progress">
            <div
              className="watch-progress-fill"
              style={{ width: `${((currentIndex + 1) / messages.length) * 100}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// Countdown component
function CountdownDisplay({ session }: { session: { status: string; lock_time?: string; start_time?: string } }) {
  const [timeLeft, setTimeLeft] = useState<{ minutes: number; seconds: number } | null>(null);

  useEffect(() => {
    const calculateTime = () => {
      const now = new Date();
      let targetTime: Date | null = null;

      if (session.status === "OPEN" && session.lock_time) {
        targetTime = new Date(session.lock_time);
      } else if (session.status === "LOCKED" && session.start_time) {
        targetTime = new Date(session.start_time);
      }

      if (targetTime) {
        const diff = targetTime.getTime() - now.getTime();
        if (diff > 0) {
          const minutes = Math.floor(diff / 60000);
          const seconds = Math.floor((diff % 60000) / 1000);
          setTimeLeft({ minutes, seconds });
        } else {
          setTimeLeft(null);
        }
      }
    };

    calculateTime();
    const interval = setInterval(calculateTime, 1000);
    return () => clearInterval(interval);
  }, [session.status, session.lock_time, session.start_time]);

  if (!timeLeft) return null;

  return (
    <div className="watch-countdown">
      <div className="watch-countdown-block">
        <span className="watch-countdown-number">{String(timeLeft.minutes).padStart(2, "0")}</span>
        <span className="watch-countdown-label">MIN</span>
      </div>
      <span className="watch-countdown-separator">:</span>
      <div className="watch-countdown-block">
        <span className="watch-countdown-number">{String(timeLeft.seconds).padStart(2, "0")}</span>
        <span className="watch-countdown-label">SEC</span>
      </div>
    </div>
  );
}
