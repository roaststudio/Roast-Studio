import { useState, useEffect, useRef, useCallback, forwardRef, type HTMLAttributes } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AudioWaveformVisualizer } from "./AudioWaveformVisualizer";
import { Button } from "@/components/ui/button";
import { Play, Pause, RotateCcw } from "lucide-react";
import { SmallHost } from "./SmallHost";

interface SessionData {
  id: string;
  persona_name: string;
  persona_avatar?: string;
  status: string;
  lock_time?: string;
  start_time?: string;
}

interface StudioViewProps {
  session: SessionData;
  onComplete?: () => void;
  isArchive?: boolean;
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
  isActive: boolean;
}

// Countdown display component - defined outside to prevent recreation on each render
interface CountdownDisplayProps extends HTMLAttributes<HTMLDivElement> {
  session: SessionData;
}

const CountdownDisplay = forwardRef<HTMLDivElement, CountdownDisplayProps>(
  ({ session, className, ...containerProps }, ref) => {
    const [timeLeft, setTimeLeft] = useState<{ minutes: number; seconds: number } | null>(null);
    const [label, setLabel] = useState("");
    
    useEffect(() => {
      const calculateTime = () => {
        const now = new Date();
        let targetTime: Date | null = null;
        let newLabel = "";
        if (session.status === "OPEN" && session.lock_time) {
          targetTime = new Date(session.lock_time);
          newLabel = "Submissions close in";
        } else if (session.status === "LOCKED" && session.start_time) {
          targetTime = new Date(session.start_time);
          newLabel = "Show starts in";
        }
        if (targetTime) {
          const diff = targetTime.getTime() - now.getTime();
          if (diff > 0) {
            const minutes = Math.floor(diff / 60000);
            const seconds = Math.floor((diff % 60000) / 1000);
            setTimeLeft({ minutes, seconds });
            setLabel(newLabel);
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
      <div ref={ref} {...containerProps} className={`flex flex-col items-center gap-4 ${className ?? ""}`}>
        <p className="text-sm text-muted-foreground uppercase tracking-widest">{label}</p>
        <div className="flex items-center justify-center gap-6 font-pixel">
          <div className="flex flex-col items-center">
            <span className="text-6xl text-primary text-glow-green countdown-pulse font-bold">
              {String(timeLeft.minutes).padStart(2, '0')}
            </span>
            <span className="text-xs text-muted-foreground uppercase mt-1">min</span>
          </div>
          <span className="text-5xl text-secondary animate-pulse">:</span>
          <div className="flex flex-col items-center">
            <span className="text-6xl text-primary text-glow-green countdown-pulse font-bold">
              {String(timeLeft.seconds).padStart(2, '0')}
            </span>
            <span className="text-xs text-muted-foreground uppercase mt-1">sec</span>
          </div>
        </div>
      </div>
    );
  }
);
CountdownDisplay.displayName = "CountdownDisplay";

// Dancing host component - defined outside to prevent recreation on each render
const DancingHost = ({ name }: { name: "carl" | "sam" }) => {
  const isChaos = name === "carl";
  return (
    <div className={`dancing-host dancing-host-${name}`}>
      <div className="dancing-host-label">
        {isChaos ? "CHAOS CARL" : "ROAST RONNIE"}
      </div>
      <div className="dancing-host-head">
        <div className="dancing-host-eye dancing-host-eye-left" />
        <div className="dancing-host-eye dancing-host-eye-right" />
        <div className="dancing-host-mouth" />
        {isChaos && <div className="dancing-host-hair" />}
        {!isChaos && <div className="dancing-host-glasses" />}
      </div>
      <div className="dancing-host-body" />
      <div className="dancing-host-arm dancing-host-arm-left" />
      <div className="dancing-host-arm dancing-host-arm-right" />
      <div className="dancing-host-leg dancing-host-leg-left" />
      <div className="dancing-host-leg dancing-host-leg-right" />
    </div>
  );
};

// Confetti particle component - defined outside to prevent recreation on each render
const ConfettiParticle = ({ index }: { index: number }) => {
  const colors = ['hsl(var(--primary))', 'hsl(var(--secondary))', 'hsl(var(--accent))', 'hsl(var(--destructive))', '#FFD700', '#FF6B6B', '#4ECDC4'];
  const color = colors[index % colors.length];
  const left = Math.random() * 100;
  const delay = Math.random() * 0.5;
  const duration = 2 + Math.random() * 2;
  const size = 8 + Math.random() * 8;
  const rotation = Math.random() * 360;
  
  return (
    <div
      className="absolute top-0 animate-confetti-fall pointer-events-none"
      style={{
        left: `${left}%`,
        animationDelay: `${delay}s`,
        animationDuration: `${duration}s`
      }}
    >
      <div
        style={{
          width: size,
          height: size * 0.6,
          backgroundColor: color,
          transform: `rotate(${rotation}deg)`,
          borderRadius: '2px'
        }}
      />
    </div>
  );
};
export function StudioView({
  session,
  onComplete,
  isArchive = false
}: StudioViewProps) {
  const [currentDisplay, setCurrentDisplay] = useState<DisplayItem | null>(null);
  const [currentSpeaker, setCurrentSpeaker] = useState<Speaker | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [displayAnimation, setDisplayAnimation] = useState<"enter" | "exit" | "idle">("idle");
  const [showConfetti, setShowConfetti] = useState(false);
  const [prevStatus, setPrevStatus] = useState(session.status);
  const [noRoastsMode, setNoRoastsMode] = useState(false);
  const [hostCommentary, setHostCommentary] = useState<string | null>(null);
  const [nextKol, setNextKol] = useState<{
    username: string;
    profile_pic_url: string | null;
  } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const processedMessagesRef = useRef<Set<string>>(new Set());
  const hostTurnRef = useRef<"A" | "B">("A");
  const hasCompletedRef = useRef(false);
  const isProcessingRef = useRef(false);
  const noRoastsCheckedRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const mountedRef = useRef(true);

  // State for waiting room host chatter
  const [waitingRoomDialogue, setWaitingRoomDialogue] = useState<string | null>(null);
  const [waitingRoomSpeaker, setWaitingRoomSpeaker] = useState<"hostA" | "hostB" | null>(null);
  const countdownWarningPlayedRef = useRef(false);
  const waitingRoomChatterRef = useRef(false);

  // Reset waiting-room one-shot refs when the session changes
  useEffect(() => {
    countdownWarningPlayedRef.current = false;
    waitingRoomChatterRef.current = false;
    setWaitingRoomDialogue(null);
    setWaitingRoomSpeaker(null);
  }, [session.id]);

  // Archive replay state
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayPaused, setReplayPaused] = useState(false);
  const [replayMessages, setReplayMessages] = useState<Message[]>([]);
  const [currentReplayIndex, setCurrentReplayIndex] = useState(0);
  const replayPausedRef = useRef(false);
  const replayActiveRef = useRef(false);

  // Cleanup on unmount - stop all audio
  useEffect(() => {
    mountedRef.current = true;
    replayActiveRef.current = false;
    return () => {
      mountedRef.current = false;
      replayActiveRef.current = false;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current = null;
      }
      isSpeakingRef.current = false;
    };
  }, []);

  // Sync replayPaused ref with state
  useEffect(() => {
    replayPausedRef.current = replayPaused;
  }, [replayPaused]);

  // Fetch archived messages for replay
  useEffect(() => {
    if (isArchive) {
      fetchReplayMessages();
    }
  }, [isArchive, session.id]);
  const fetchReplayMessages = async () => {
    const {
      data
    } = await supabase.from("roast_messages").select("*").eq("session_id", session.id).order("created_at", {
      ascending: true
    });
    if (data) {
      setReplayMessages(data);
    }
  };
  const startReplay = async () => {
    if (replayMessages.length === 0) return;
    setIsReplaying(true);
    setReplayPaused(false);
    setCurrentReplayIndex(0);
    replayActiveRef.current = true;
    hostTurnRef.current = "A";
    await playReplaySequence(0);
  };
  const toggleReplayPause = () => {
    if (replayPaused) {
      // Resume
      setReplayPaused(false);
      replayPausedRef.current = false;
    } else {
      // Pause
      setReplayPaused(true);
      replayPausedRef.current = true;
      if (audioRef.current) {
        audioRef.current.pause();
      }
    }
  };
  const restartReplay = async () => {
    // Stop current audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    isSpeakingRef.current = false;
    replayActiveRef.current = false;
    setCurrentReplayIndex(0);
    setReplayPaused(false);
    setCurrentDisplay(null);
    setCurrentSpeaker(null);

    // Brief pause before restarting
    await new Promise(resolve => setTimeout(resolve, 300));
    replayActiveRef.current = true;
    hostTurnRef.current = "A";
    await playReplaySequence(0);
  };
  const playReplaySequence = async (startIndex: number) => {
    for (let i = startIndex; i < replayMessages.length; i++) {
      if (!mountedRef.current || !replayActiveRef.current) break;

      // Wait if paused
      while (replayPausedRef.current && mountedRef.current && replayActiveRef.current) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!mountedRef.current || !replayActiveRef.current) break;
      setCurrentReplayIndex(i);
      const message = replayMessages[i];

      // Play user roast
      const userText = message.transcript || "[Voice clip]";
      await showDisplay({
        speaker: "user",
        text: userText,
        isActive: true
      });
      if (message.audio_url) {
        setCurrentSpeaker("user");
        await playAudio(message.audio_url);
      } else if (message.transcript) {
        // Use announcer voice to read text submissions
        setCurrentSpeaker("user");
        const announcerUrl = await generateTTS(message.transcript, "announcer");
        if (announcerUrl) {
          await playAudio(announcerUrl);
        } else {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } else {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      if (!mountedRef.current || !replayActiveRef.current) break;
      await hideDisplay();

      // Generate and play host response
      const hostType = hostTurnRef.current;
      hostTurnRef.current = hostType === "A" ? "B" : "A";
      const roast = await generateRoast(userText, hostType);
      if (!mountedRef.current || !replayActiveRef.current) break;
      setCurrentSpeaker(hostType === "A" ? "hostA" : "hostB");
      await showDisplay({
        speaker: hostType === "A" ? "hostA" : "hostB",
        text: roast,
        isActive: true
      });
      const ttsUrl = await generateTTS(roast, hostType);
      if (ttsUrl && mountedRef.current && replayActiveRef.current) {
        await playAudio(ttsUrl);
      } else {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      if (!mountedRef.current || !replayActiveRef.current) break;
      setCurrentSpeaker(null);
      await hideDisplay();

      // Brief pause between messages
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (mountedRef.current && replayActiveRef.current) {
      setIsReplaying(false);
      replayActiveRef.current = false;
      setCurrentDisplay(null);
      setCurrentSpeaker(null);
    }
  };

  // Detect transition to LIVE and trigger confetti
  useEffect(() => {
    if (prevStatus !== "LIVE" && session.status === "LIVE") {
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 5000);
    }
    setPrevStatus(session.status);
  }, [session.status, prevStatus]);

  // Countdown warning - trigger 5-8 seconds before timer ends
  useEffect(() => {
    if (session.status !== "OPEN" || !session.lock_time || countdownWarningPlayedRef.current) return;
    const checkCountdown = () => {
      const now = new Date().getTime();
      const lockTime = new Date(session.lock_time!).getTime();
      const diff = lockTime - now;

      // Trigger warning 6 seconds before end
      if (diff > 0 && diff <= 8000 && !countdownWarningPlayedRef.current) {
        countdownWarningPlayedRef.current = true;
        playCountdownWarning();
      }
    };
    const interval = setInterval(checkCountdown, 500);
    return () => clearInterval(interval);
  }, [session.status, session.lock_time]);

  // Waiting room periodic chatter - only starts after a delay, only plays once
  useEffect(() => {
    if (session.status !== "OPEN" || waitingRoomChatterRef.current) return;
    waitingRoomChatterRef.current = true;

    // Start chatter after 5 seconds delay
    const startTimeout = setTimeout(() => {
      if (session.status === "OPEN") {
        playWaitingRoomChatter();
      }
    }, 5000);
    return () => clearTimeout(startTimeout);
  }, [session.status]);

  // Play countdown warning a few seconds before timer ends
  const playCountdownWarning = async () => {
    const warningLines = [`WHOA WHOA WHOA! Time's almost up folks! Get those last roasts in for ${session.persona_name}! 5 seconds!`, `TICK TOCK TICK TOCK! Last chance to roast ${session.persona_name}! The clock is running out!`, `HEY! If you haven't submitted your roast yet, DO IT NOW! ${session.persona_name} is about to get it!`];
    const warning = warningLines[Math.floor(Math.random() * warningLines.length)];
    setWaitingRoomSpeaker("hostA");
    setWaitingRoomDialogue(warning);
    const audioUrl = await generateTTS(warning, "A");
    if (audioUrl) {
      await playAudio(audioUrl);
    } else {
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    setWaitingRoomSpeaker(null);
    setWaitingRoomDialogue(null);
  };

  // Play periodic chatter in the waiting room - varied intros, only plays ONCE per session
  const playWaitingRoomChatter = async () => {
    // Different intro sequences - pick one at random
    const introSequences = [[{
      speaker: "A" as const,
      text: `Welcome to the ROAST STUDIO! We're warming up for ${session.persona_name}!`
    }, {
      speaker: "B" as const,
      text: `Indeed. ${session.persona_name} has no idea what's coming. Neither do we, actually.`
    }, {
      speaker: "A" as const,
      text: `Drop your HOTTEST takes! Don't hold back!`
    }], [{
      speaker: "B" as const,
      text: `Ladies and gentlemen, welcome to the show. Tonight's victim... I mean guest... ${session.persona_name}.`
    }, {
      speaker: "A" as const,
      text: `VICTIM is right Ronnie! The roast submissions are OPEN, let's GO!`
    }], [{
      speaker: "A" as const,
      text: `YO YO YO! Chaos Carl here with my boy Roast Ronnie! We're about to DESTROY ${session.persona_name}!`
    }, {
      speaker: "B" as const,
      text: `Destroy is a strong word Carl. I prefer... constructively criticize into oblivion.`
    }], [{
      speaker: "B" as const,
      text: `Another day, another victim on the hot seat. ${session.persona_name}, you're up.`
    }, {
      speaker: "A" as const,
      text: `Send in your roasts people! The spicier the BETTER!`
    }], [{
      speaker: "A" as const,
      text: `BREAKING NEWS! ${session.persona_name} is about to get absolutely COOKED! Submit your roasts NOW!`
    }, {
      speaker: "B" as const,
      text: `This is going to be good. Or bad. For ${session.persona_name}, definitely bad.`
    }], [{
      speaker: "B" as const,
      text: `Welcome back to Roast Studio. I'm Roast Ronnie, been doing this since the Reagan era.`
    }, {
      speaker: "A" as const,
      text: `And I'm Chaos Carl! Today we're roasting ${session.persona_name}! SEND IT!`
    }]];

    // Pick a random intro sequence
    const selectedSequence = introSequences[Math.floor(Math.random() * introSequences.length)];
    for (const line of selectedSequence) {
      if (session.status !== "OPEN") break;
      setWaitingRoomSpeaker(line.speaker === "A" ? "hostA" : "hostB");
      setWaitingRoomDialogue(line.text);
      const audioUrl = await generateTTS(line.text, line.speaker);
      if (audioUrl) {
        await playAudio(audioUrl);
      } else {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Pause between lines
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    setWaitingRoomSpeaker(null);
    setWaitingRoomDialogue(null);

    // After intro, hosts stay silent - no more periodic chatter
  };
  const generateRoast = async (transcript: string, hostType: "A" | "B"): Promise<string> => {
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-roast`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`
        },
        body: JSON.stringify({
          transcript,
          personaName: session.persona_name,
          hostType
        })
      });
      if (!response.ok) {
        console.error("Failed to generate roast:", response.status);
        return hostType === "A" ? `Oh WOW, did ${session.persona_name} really just get called out like that?! 💀` : `According to my highly scientific analysis... that's a valid roast.`;
      }
      const data = await response.json();
      return data.roast;
    } catch (error) {
      console.error("Error generating roast:", error);
      return hostType === "A" ? `Oh WOW, did ${session.persona_name} really just get called out like that?! 💀` : `According to my highly scientific analysis... that's a valid roast.`;
    }
  };

  // Fetch the next KOL in queue (deterministic order based on alphabetical)
  const fetchNextKol = async () => {
    const {
      data: personas
    } = await supabase.from("personas").select("id, username, profile_pic_url").order("username", {
      ascending: true
    });
    if (!personas || personas.length === 0) return null;

    // Find current persona index and get next one
    const currentIndex = personas.findIndex(p => p.username.toLowerCase() === session.persona_name.toLowerCase());
    const nextIndex = (currentIndex + 1) % personas.length;
    return personas[nextIndex];
  };

  // Handle case when LIVE but no roasts submitted
  const handleNoRoasts = async () => {
    if (noRoastsCheckedRef.current) return;
    noRoastsCheckedRef.current = true;
    setNoRoastsMode(true);

    // Fetch next KOL
    const next = await fetchNextKol();
    setNextKol(next);

    // Pick random host to deliver the commentary
    const host = Math.random() > 0.5 ? "A" : "B";
    const noRoastLines = [`Well... this is awkward. Nobody showed up to roast ${session.persona_name}! Even the haters took a day off!`, `*crickets* Not a SINGLE roast for ${session.persona_name}? Either they're universally loved or universally... forgotten.`, `Breaking news: ${session.persona_name} is so unroastable that nobody even tried! Or maybe everyone's just scared?`, `Wow. Zero roasts. ${session.persona_name} wins by default! That's... actually kind of sad.`, `Hello? Anyone? Bueller? No roasts for ${session.persona_name}? Fine, we'll move on then!`];
    const commentary = noRoastLines[Math.floor(Math.random() * noRoastLines.length)];
    setHostCommentary(commentary);
    setCurrentSpeaker(host === "A" ? "hostA" : "hostB");

    // Generate TTS for the commentary
    const audioUrl = await generateTTS(commentary, host);
    if (audioUrl) {
      await playAudio(audioUrl);
    } else {
      await new Promise(resolve => setTimeout(resolve, 4000));
    }

    // Wait a moment then transition
    await new Promise(resolve => setTimeout(resolve, 2000));
    if (onComplete && !hasCompletedRef.current) {
      hasCompletedRef.current = true;
      onComplete();
    }
  };
  const generateTTS = async (text: string, hostType: "A" | "B" | "announcer"): Promise<string | null> => {
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/text-to-speech`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`
        },
        body: JSON.stringify({
          text,
          hostType
        })
      });
      if (!response.ok) {
        console.error("Failed to generate TTS:", response.status);
        return null;
      }
      const data = await response.json();
      return `data:audio/mpeg;base64,${data.audioContent}`;
    } catch (error) {
      console.error("Error generating TTS:", error);
      return null;
    }
  };
  const playAudio = async (audioUrl: string): Promise<void> => {
    // Don't play if component unmounted
    if (!mountedRef.current) return;

    // Wait if another audio is currently playing
    while (isSpeakingRef.current && mountedRef.current) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!mountedRef.current) return;
    isSpeakingRef.current = true;
    return new Promise(resolve => {
      if (!mountedRef.current) {
        isSpeakingRef.current = false;
        resolve();
        return;
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      const cleanup = () => {
        isSpeakingRef.current = false;
        resolve();
      };
      audio.onended = cleanup;
      audio.onerror = () => {
        console.error("Audio playback error");
        cleanup();
      };
      audio.play().catch(err => {
        console.error("Failed to play audio:", err);
        cleanup();
      });
    });
  };
  const showDisplay = async (item: DisplayItem, duration?: number) => {
    setDisplayAnimation("enter");
    setCurrentDisplay(item);
    await new Promise(resolve => setTimeout(resolve, 300));
    if (duration) {
      await new Promise(resolve => setTimeout(resolve, duration));
      setDisplayAnimation("exit");
      await new Promise(resolve => setTimeout(resolve, 300));
      setCurrentDisplay(null);
      setDisplayAnimation("idle");
    }
  };
  const hideDisplay = async () => {
    setDisplayAnimation("exit");
    await new Promise(resolve => setTimeout(resolve, 300));
    setCurrentDisplay(null);
    setDisplayAnimation("idle");
  };
  const processMessage = useCallback(async (message: Message) => {
    if (processedMessagesRef.current.has(message.id)) return;
    processedMessagesRef.current.add(message.id);
    const userText = message.transcript || "[Voice clip]";

    // Show user roast on display
    await showDisplay({
      speaker: "user",
      text: userText,
      isActive: true
    });

    // Play user audio if available, otherwise use announcer voice to read the text
    if (message.audio_url) {
      await playAudio(message.audio_url);
    } else if (message.transcript) {
      // Use announcer voice to read text submissions
      const announcerUrl = await generateTTS(message.transcript, "announcer");
      if (announcerUrl) {
        await playAudio(announcerUrl);
      } else {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } else {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    await hideDisplay();
    await new Promise(resolve => setTimeout(resolve, 500));
    const currentHost = hostTurnRef.current;
    const hostSpeaker: Speaker = currentHost === "A" ? "hostA" : "hostB";
    setCurrentSpeaker(hostSpeaker);

    // Generate AI response
    const roastText = await generateRoast(userText, currentHost);

    // Show host response on display
    await showDisplay({
      speaker: hostSpeaker,
      text: roastText,
      isActive: true
    });

    // Generate and play TTS
    const audioUrl = await generateTTS(roastText, currentHost);
    if (audioUrl) {
      await playAudio(audioUrl);
    } else {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    await hideDisplay();

    // Mark message as used
    await supabase.from("roast_messages").update({
      used: true
    }).eq("id", message.id);

    // Alternate host
    hostTurnRef.current = currentHost === "A" ? "B" : "A";
    setCurrentSpeaker(null);
  }, [session.persona_name]);

  // Play outro dialogue announcing next KOL
  const playOutroDialogue = async () => {
    const next = await fetchNextKol();
    if (!next) return;
    const outroLines = [`And that's a WRAP on ${session.persona_name}! But hold up, we're not done yet! Next up on the chopping block... ${next.username}!`, `${session.persona_name} survived! But there's no rest for the wicked... ${next.username}, you're NEXT!`, `Alright folks, ${session.persona_name}'s roast session is OVER! Coming up next... it's ${next.username}'s turn to get absolutely destroyed!`];
    const outro = outroLines[Math.floor(Math.random() * outroLines.length)];
    setCurrentSpeaker("hostB");
    setHostCommentary(outro);
    await showDisplay({
      speaker: "hostB",
      text: outro,
      isActive: true
    });
    const audioUrl = await generateTTS(outro, "B");
    if (audioUrl) {
      await playAudio(audioUrl);
    } else {
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    await hideDisplay();
    setCurrentSpeaker(null);
    setHostCommentary(null);
  };
  const processQueue = useCallback(async () => {
    if (isProcessingRef.current || hasCompletedRef.current) return;
    const unprocessedMessages = messagesRef.current.filter(msg => !processedMessagesRef.current.has(msg.id));
    if (unprocessedMessages.length === 0) return;
    isProcessingRef.current = true;
    setIsProcessing(true);
    for (const message of unprocessedMessages) {
      await processMessage(message);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    isProcessingRef.current = false;
    setIsProcessing(false);

    // Play outro before completing
    if (onComplete && !hasCompletedRef.current) {
      hasCompletedRef.current = true;
      await playOutroDialogue();
      setTimeout(() => onComplete(), 1000);
    }
  }, [processMessage, onComplete]);
  useEffect(() => {
    const loadMessages = async () => {
      const {
        data
      } = await supabase.from("roast_messages").select("*").eq("session_id", session.id).eq("used", false).order("created_at", {
        ascending: true
      }).limit(20);
      if (data && data.length > 0) {
        messagesRef.current = data as Message[];
        setHasStarted(true);
        // Only start processing if session is LIVE
        if (session.status === "LIVE") {
          processQueue();
        }
      }
    };
    loadMessages();
    const channel = supabase.channel(`messages-${session.id}`).on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "roast_messages",
      filter: `session_id=eq.${session.id}`
    }, payload => {
      const newMessage = payload.new as Message;
      if (!processedMessagesRef.current.has(newMessage.id)) {
        messagesRef.current = [...messagesRef.current, newMessage];
        setHasStarted(true);
        // Only start processing if session is LIVE
        if (session.status === "LIVE") {
          processQueue();
        }
      }
    }).subscribe();
    return () => {
      supabase.removeChannel(channel);
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, [session.id, session.status, processQueue]);

  // Start processing when session becomes LIVE
  useEffect(() => {
    if (session.status === "LIVE" && !isProcessingRef.current && !hasCompletedRef.current && messagesRef.current.length > 0) {
      processQueue();
    }
  }, [session.status, processQueue]);

  // Check for no roasts when session is LIVE
  useEffect(() => {
    if (session.status !== "LIVE") return;
    if (noRoastsCheckedRef.current) return;

    // Wait a few seconds for messages to load, then check if there are any
    const checkTimeout = setTimeout(async () => {
      if (messagesRef.current.length === 0 && !hasStarted && !isProcessingRef.current) {
        // No messages and nothing has started - trigger no roasts flow
        handleNoRoasts();
      }
    }, 5000);
    return () => clearTimeout(checkTimeout);
  }, [session.status, hasStarted]);
  const getDisplayStyles = () => {
    if (!currentDisplay) return "";
    const baseStyles = "transition-all duration-300";
    if (displayAnimation === "enter") {
      return `${baseStyles} animate-scale-in opacity-100`;
    } else if (displayAnimation === "exit") {
      return `${baseStyles} animate-scale-out opacity-0`;
    }
    return baseStyles;
  };
  const getSpeakerColor = (speaker: Speaker) => {
    switch (speaker) {
      case "user":
        return "border-primary bg-primary/10";
      case "hostA":
        return "border-orange-500 bg-orange-500/10";
      case "hostB":
        return "border-blue-500 bg-blue-500/10";
    }
  };
  const getSpeakerLabel = (speaker: Speaker) => {
    switch (speaker) {
      case "user":
        return "AUDIENCE";
      case "hostA":
        return "CHAOS CARL";
      case "hostB":
        return "ROAST RONNIE";
    }
  };

  // Components ConfettiParticle, CountdownDisplay, and DancingHost are now defined outside StudioView

  // Waiting screen with hosts - only show when session is not LIVE yet (skip for archives)
  if (session.status !== "LIVE" && !isArchive) {
    return <div className="min-h-[500px] grid grid-cols-1 md:grid-cols-[auto_minmax(0,1fr)_auto] items-center md:items-stretch gap-6 md:gap-10 px-4">
        {/* Host A (Left of the box) */}
        <div className="hidden md:flex flex-col items-center justify-end pb-6">
          <SmallHost type="hostA" isSpeaking={waitingRoomSpeaker === "hostA"} />
          <span className={`text-sm font-pixel uppercase tracking-wider mt-2 ${waitingRoomSpeaker === "hostA" ? "text-orange-400 text-glow-orange" : "text-muted-foreground"}`}>CARL</span>
        </div>

        {/* The waiting room box */}
        <div className="min-h-[500px] bg-gradient-to-b from-background via-card to-background border-2 relative overflow-hidden shadow-[4px_4px_0_hsl(0_0%_0%)] border-muted">
          {/* Scanlines */}
          <div className="absolute inset-0 scanlines pointer-events-none z-10" />

          {/* Spotlight effect */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(320_50%_20%/0.3)_0%,transparent_60%)]" />

          {/* Header bar */}
          <div className="relative z-20 text-center py-3 border-b border-border/50 bg-background/50 backdrop-blur-sm">
            <h2 className="text-xl font-pixel text-primary text-glow-green tracking-widest">
              🎙️ WAITING ROOM 🎙️
            </h2>
          </div>

          {/* Main content area */}
          <div className="relative z-20 flex flex-col items-center pt-6 pb-6 px-4">
            {/* KOL being targeted */}
            <div className="relative flex items-center justify-center mb-4">
              <div className="w-24 h-24 rounded-full border-4 border-secondary overflow-hidden bg-muted shadow-[0_0_30px_hsl(320_100%_50%/0.4)]">
                {session.persona_avatar ? <img src={session.persona_avatar} alt={session.persona_name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-3xl font-pixel text-secondary">
                    {session.persona_name.charAt(0).toUpperCase()}
                  </div>}
              </div>
              <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-destructive text-destructive-foreground px-2 py-0.5 text-[10px] font-pixel uppercase tracking-wider whitespace-nowrap">
                TARGET
              </div>
            </div>

            {/* KOL Name */}
            <p className="text-lg font-pixel text-secondary text-glow-magenta mb-4">{session.persona_name}</p>

            {/* Countdown Timer */}
            <CountdownDisplay session={session} />

            {/* Host dialogue bubble - fixed size, no green */}
            {waitingRoomDialogue && <div className="mt-6 w-full max-w-xs animate-fade-in">
                <div className={`border-2 p-4 rounded-lg relative ${waitingRoomSpeaker === "hostA" ? "bg-orange-950/50 border-orange-500/60" : "bg-blue-950/50 border-blue-500/60"}`}>
                  <div className={`absolute -top-3 left-4 px-2 py-0.5 text-[10px] font-pixel uppercase tracking-wider bg-background border ${waitingRoomSpeaker === "hostA" ? "border-orange-500 text-orange-400" : "border-blue-500 text-blue-400"}`}>
                    {waitingRoomSpeaker === "hostA" ? "CHAOS CARL" : "ROAST RONNIE"}
                  </div>
                  <p className="text-sm text-foreground leading-relaxed pt-1 line-clamp-4">
                    "{waitingRoomDialogue}"
                  </p>
                </div>
              </div>}

            {/* Submit CTA */}
            <div className="mt-6">
              <p className="text-xs text-muted-foreground animate-pulse uppercase tracking-wider">
                Submit your roasts now!
              </p>
            </div>
          </div>
        </div>

        {/* Host B (Right of the box) */}
        <div className="hidden md:flex flex-col items-center justify-end pb-6">
          <SmallHost type="hostB" isSpeaking={waitingRoomSpeaker === "hostB"} />
          <span className={`text-sm font-pixel uppercase tracking-wider mt-2 ${waitingRoomSpeaker === "hostB" ? "text-blue-400 text-glow-cyan" : "text-muted-foreground"}`}>RONNIE</span>
        </div>

        {/* Mobile fallback (below the box) */}
        <div className="md:hidden flex items-end justify-between px-2 pb-2">
          <div className="flex flex-col items-center">
            <SmallHost type="hostA" isSpeaking={waitingRoomSpeaker === "hostA"} />
            <span className={`text-sm font-pixel uppercase tracking-wider mt-2 ${waitingRoomSpeaker === "hostA" ? "text-orange-400 text-glow-orange" : "text-muted-foreground"}`}>CARL</span>
          </div>
          <div className="flex flex-col items-center">
            <SmallHost type="hostB" isSpeaking={waitingRoomSpeaker === "hostB"} />
            <span className={`text-sm font-pixel uppercase tracking-wider mt-2 ${waitingRoomSpeaker === "hostB" ? "text-blue-400 text-glow-cyan" : "text-muted-foreground"}`}>RONNIE</span>
          </div>
        </div>
      </div>;
  }

  // No roasts mode - host commentary screen
  if (noRoastsMode) {
    return <div className="min-h-[500px] bg-card border-2 border-border relative overflow-hidden shadow-[4px_4px_0_hsl(0_0%_0%)] flex flex-col items-center justify-center">
        {/* Scanlines */}
        <div className="absolute inset-0 scanlines pointer-events-none z-10" />
        
        {/* Dark overlay */}
        <div className="absolute inset-0 bg-background/80 z-5" />
        
        <div className="relative z-20 flex flex-col items-center text-center space-y-8 p-8">
          {/* Host speaking */}
          <div className="flex items-center gap-4">
            <SmallHost type={currentSpeaker === "hostA" ? "hostA" : "hostB"} isSpeaking={true} />
            <div className="text-left">
              <p className="text-xs text-secondary text-glow-magenta uppercase tracking-wider mb-1">
                {currentSpeaker === "hostA" ? "CHAOS CARL" : "ROAST RONNIE"}
              </p>
            </div>
          </div>
          
          {/* Speech bubble with commentary */}
          {hostCommentary && <div className="max-w-md bg-card border-2 border-secondary p-4 relative animate-fade-in">
              <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-0 h-0 border-l-8 border-r-8 border-b-8 border-transparent border-b-secondary" />
              <p className="text-lg font-pixel text-foreground leading-relaxed">
                {hostCommentary}
              </p>
            </div>}
          
          {/* Next KOL preview */}
          {nextKol && <div className="mt-6 animate-pulse">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">
                UP NEXT
              </p>
              <div className="flex items-center gap-3 bg-card/50 border border-primary p-3">
                {nextKol.profile_pic_url ? <img src={nextKol.profile_pic_url} alt={nextKol.username} className="w-12 h-12 object-cover border-2 border-primary" /> : <div className="w-12 h-12 bg-muted flex items-center justify-center text-xl font-pixel text-primary border-2 border-primary">
                    {nextKol.username.charAt(0).toUpperCase()}
                  </div>}
                <span className="text-xl font-pixel text-primary text-glow-green">
                  {nextKol.username}
                </span>
              </div>
            </div>}
        </div>
      </div>;
  }
  return <div className="min-h-[500px] bg-gradient-to-b from-[hsl(0_0%_5%)] via-[hsl(260_30%_8%)] to-[hsl(320_30%_8%)] relative overflow-hidden">
      {/* Confetti overlay */}
      {showConfetti && <div className="absolute inset-0 z-50 pointer-events-none overflow-hidden">
          {[...Array(50)].map((_, i) => <ConfettiParticle key={i} index={i} />)}
        </div>}

      {/* Stage lights effect */}
      <div className="absolute top-0 left-1/4 w-32 h-64 bg-gradient-to-b from-secondary/20 to-transparent blur-3xl" />
      <div className="absolute top-0 right-1/4 w-32 h-64 bg-gradient-to-b from-primary/20 to-transparent blur-3xl" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-96 bg-gradient-to-b from-accent/10 to-transparent blur-3xl" />

      {/* Header Bar - LIVE or ARCHIVE mode */}
      <div className="relative z-20 flex items-center justify-between px-4 py-2 bg-black/50 backdrop-blur-sm border-b border-white/10">
        <div className="flex items-center gap-2">
          {isArchive ? <div className="flex items-center gap-2 px-3 py-1 bg-secondary/80 rounded">
              <span className="text-secondary-foreground text-xs font-bold uppercase tracking-wider">ARCHIVE</span>
            </div> : <div className="flex items-center gap-2 px-3 py-1 bg-destructive rounded animate-pulse">
              <div className="w-2 h-2 bg-white rounded-full animate-blink" />
              <span className="text-white text-xs font-bold uppercase tracking-wider">LIVE</span>
            </div>}
        </div>
        
        {/* Replay Controls for Archive */}
        {isArchive && <div className="flex items-center gap-2">
            {!isReplaying ? <Button variant="neon" size="sm" onClick={startReplay} disabled={replayMessages.length === 0} className="text-xs">
                <Play className="w-3 h-3 mr-1" />
                {replayMessages.length > 0 ? `Play (${replayMessages.length} roasts)` : "No roasts"}
              </Button> : <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={toggleReplayPause} className="text-xs">
                  {replayPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                </Button>
                <Button variant="ghost" size="sm" onClick={restartReplay} className="text-xs">
                  <RotateCcw className="w-3 h-3" />
                </Button>
                <span className="text-xs text-muted-foreground">
                  {currentReplayIndex + 1}/{replayMessages.length}
                </span>
              </div>}
          </div>}
        
        <div className="text-xs text-muted-foreground uppercase tracking-wider">
          🔥 ROAST STUDIO
        </div>
      </div>

      {/* Main Stage Layout */}
      <div className="relative z-20 flex flex-col h-[calc(100%-44px)]">
        
        {/* Center Stage - KOL and Display */}
        <div className="flex-1 flex flex-col items-center justify-center py-4 px-4">
          
          {/* KOL Avatar with spotlight */}
          <div className="relative mb-4">
            {/* Spotlight glow */}
            <div className="absolute inset-0 -m-6 bg-gradient-radial from-secondary/30 via-secondary/10 to-transparent rounded-full blur-xl" />
            
            <div className="relative w-20 h-20 md:w-24 md:h-24 rounded-full overflow-hidden border-4 border-secondary shadow-[0_0_40px_hsl(320_100%_50%/0.5)]">
              {session.persona_avatar ? <img src={session.persona_avatar} alt={session.persona_name} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-secondary flex items-center justify-center">
                  <span className="text-2xl md:text-3xl text-secondary-foreground font-bold">
                    {session.persona_name.charAt(0)}
                  </span>
                </div>}
            </div>
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-destructive rounded text-[10px] text-white font-bold uppercase whitespace-nowrap">
              🎯 TARGET
            </div>
          </div>

          {/* KOL Name */}
          <h2 className="text-xl md:text-2xl font-pixel text-secondary text-glow-magenta uppercase tracking-wider mb-4">
            {session.persona_name}
          </h2>

          {/* Roast Display with Hosts on sides */}
          <div className="w-full max-w-2xl flex items-center justify-center gap-4">
            
            {/* Host A - Carl on LEFT */}
            <div className="flex flex-col items-center flex-shrink-0">
              <div className={`transition-all duration-300 ${currentSpeaker === "hostA" ? "scale-125 animate-bounce" : "scale-100 animate-pulse"}`} style={{
              animationDuration: currentSpeaker === "hostA" ? "0.3s" : "3s",
              transform: currentSpeaker === "hostA" ? "translateY(-4px)" : "none"
            }}>
                <SmallHost type="hostA" isSpeaking={currentSpeaker === "hostA"} />
              </div>
              <AudioWaveformVisualizer isActive={currentSpeaker === "hostA"} color="hsl(30 100% 50%)" barCount={5} className="mt-1" />
              <div className={`mt-1 px-3 py-1 rounded-full transition-all ${currentSpeaker === "hostA" ? "bg-orange-500 text-white shadow-[0_0_20px_hsl(30_100%_50%/0.8)] scale-110" : "bg-card/30 text-muted-foreground/60 border border-border/50"}`}>
                <span className="text-[10px] font-bold uppercase tracking-wider">Carl</span>
              </div>
            </div>

            {/* Roast Display Screen */}
            <div className="flex-1 max-w-md">
              <div className="relative bg-black rounded-lg border-2 border-border overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
                {/* Monitor bezel top */}
                <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30 border-b border-border/50">
                  <div className="flex gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-destructive" />
                    <div className="w-2 h-2 rounded-full bg-yellow-500" />
                    <div className="w-2 h-2 rounded-full bg-primary" />
                  </div>
                  <span className="text-[10px] text-primary uppercase font-bold">ROAST FEED</span>
                </div>
                
                {/* Screen content */}
                <div className="min-h-[140px] p-4 bg-gradient-to-b from-[hsl(120_20%_5%)] to-black">
                  {currentDisplay ? <div className={`${getDisplayStyles()}`}>
                      {/* Speaker indicator */}
                      <div className="flex items-center gap-2 mb-3">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] ${currentDisplay.speaker === "user" ? "bg-primary text-primary-foreground" : currentDisplay.speaker === "hostA" ? "bg-orange-500 text-white" : "bg-blue-500 text-white"}`}>
                          {currentDisplay.speaker === "user" ? "👤" : currentDisplay.speaker === "hostA" ? "🔥" : "🧊"}
                        </div>
                        <span className={`text-xs font-bold uppercase tracking-wider ${currentDisplay.speaker === "user" ? "text-primary" : currentDisplay.speaker === "hostA" ? "text-orange-400" : "text-blue-400"}`}>
                          {getSpeakerLabel(currentDisplay.speaker)}
                        </span>
                        {currentDisplay.isActive && <span className="ml-auto text-xs text-primary animate-pulse">● LIVE</span>}
                      </div>
                      
                      {/* Message content */}
                      <p className="text-sm md:text-base text-foreground leading-relaxed pl-8">
                        {currentDisplay.text}
                      </p>
                    </div> : <div className="flex flex-col items-center justify-center h-full py-6 gap-3">
                      <div className="w-12 h-12 rounded-full border-2 border-dashed border-primary/30 flex items-center justify-center">
                        <span className="text-2xl animate-bounce">🎤</span>
                      </div>
                      <p className="text-primary/60 text-sm uppercase tracking-wider animate-pulse">
                        {isProcessing ? "Loading roast..." : "Waiting for roasts..."}
                      </p>
                    </div>}
                </div>
              </div>
            </div>

            {/* Host B - Ronnie on RIGHT */}
            <div className="flex flex-col items-center flex-shrink-0">
              <div className={`transition-all duration-300 ${currentSpeaker === "hostB" ? "scale-125" : "scale-100"}`} style={{
              animation: currentSpeaker === "hostB" ? "none" : "pulse 4s ease-in-out infinite",
              transform: currentSpeaker === "hostB" ? "translateY(-4px) rotate(3deg)" : "none"
            }}>
                <SmallHost type="hostB" isSpeaking={currentSpeaker === "hostB"} />
              </div>
              <AudioWaveformVisualizer isActive={currentSpeaker === "hostB"} color="hsl(200 100% 50%)" barCount={5} className="mt-1" />
              <div className={`mt-1 px-3 py-1 rounded-full transition-all ${currentSpeaker === "hostB" ? "bg-blue-500 text-white shadow-[0_0_20px_hsl(200_100%_50%/0.8)] scale-110" : "bg-card/30 text-muted-foreground/60 border border-border/50"}`}>
                <span className="text-[10px] font-bold uppercase tracking-wider">Ronnie</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>;
}