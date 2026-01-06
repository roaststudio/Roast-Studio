import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Play, Pause, RotateCcw, ArrowLeft, Volume2, VolumeX, Maximize2, Minimize2 } from "lucide-react";
import { SmallHost } from "./SmallHost";
import { AudioWaveformVisualizer } from "./AudioWaveformVisualizer";

interface ArchiveStudioViewProps {
  session: {
    id: string;
    persona_name: string;
    persona_avatar?: string;
    status: string;
    created_at?: string;
  };
  onClose: () => void;
}

interface Exchange {
  id: string;
  user_transcript: string | null;
  user_audio_url: string | null;
  host_type: string;
  host_response: string;
  host_audio_url: string | null;
  sequence_number: number;
}

interface DisplayItem {
  text: string;
  speaker: "user" | "hostA" | "hostB";
}

export function ArchiveStudioView({ session, onClose }: ArchiveStudioViewProps) {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isMuted, setIsMuted] = useState(false);
  const mutedRef = useRef(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // Display state
  const [currentDisplay, setCurrentDisplay] = useState<DisplayItem | null>(null);
  const [currentSpeaker, setCurrentSpeaker] = useState<"user" | "hostA" | "hostB" | null>(null);
  const [displayedText, setDisplayedText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mountedRef = useRef(true);
  const pausedRef = useRef(false);
  const playingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const typewriterRef = useRef<NodeJS.Timeout | null>(null);

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
    };
  }, []);

  useEffect(() => {
    pausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    mutedRef.current = isMuted;
    if (audioRef.current) {
      audioRef.current.muted = isMuted;
    }
  }, [isMuted]);

  // Fetch stored exchanges for this session
  useEffect(() => {
    const fetchExchanges = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("roast_exchanges")
        .select("*")
        .eq("session_id", session.id)
        .order("sequence_number", { ascending: true });

      if (!error && data) {
        setExchanges(data);
      }
      setLoading(false);
    };

    fetchExchanges();
  }, [session.id]);

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
      audio.onerror = (e) => {
        console.error("Audio playback error:", e);
        resolve();
      };
      audio.play().catch((err) => {
        console.error("Failed to play audio:", err);
        resolve();
      });
    });
  };

  const waitWhilePaused = async () => {
    while (pausedRef.current && mountedRef.current && playingRef.current) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  };

  // Typewriter effect
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

  const playSequence = useCallback(async (startIdx: number) => {
    playingRef.current = true;
    
    for (let i = startIdx; i < exchanges.length; i++) {
      if (!mountedRef.current || !playingRef.current) break;
      await waitWhilePaused();
      if (!mountedRef.current || !playingRef.current) break;
      
      const exchange = exchanges[i];
      setCurrentIndex(i);
      
      const userText = exchange.user_transcript || "[Voice clip]";
      
      // Show user roast with typewriter
      setCurrentSpeaker("user");
      setCurrentDisplay({ speaker: "user", text: userText });
      typeText(userText, 25);
      
      // Play user audio if available
      if (exchange.user_audio_url) {
        await playAudio(exchange.user_audio_url);
      } else {
        await new Promise(resolve => setTimeout(resolve, 2500));
      }
      
      await waitWhilePaused();
      if (!mountedRef.current || !playingRef.current) break;
      
      // Transition
      setIsTransitioning(true);
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Show stored host response
      setIsTransitioning(false);
      const hostSpeaker: "hostA" | "hostB" = exchange.host_type === "A" ? "hostA" : "hostB";
      setCurrentSpeaker(hostSpeaker);
      setCurrentDisplay({ speaker: hostSpeaker, text: exchange.host_response });
      typeText(exchange.host_response, 20);
      
      // Play stored host audio
      if (exchange.host_audio_url) {
        await playAudio(exchange.host_audio_url);
      } else {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      // Brief pause between exchanges
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    
    // End of replay
    playingRef.current = false;
    setIsPlaying(false);
    setCurrentIndex(-1);
    setCurrentSpeaker(null);
  }, [exchanges]);

  const handleStart = () => {
    if (exchanges.length === 0) return;
    setCurrentDisplay(null);
    setDisplayedText("");
    setIsPlaying(true);
    setIsPaused(false);
    setCurrentIndex(0);
    playSequence(0);
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
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    playingRef.current = false;
    setCurrentDisplay(null);
    setDisplayedText("");
    setCurrentIndex(-1);
    setCurrentSpeaker(null);
    setTimeout(() => handleStart(), 300);
  };

  const toggleMute = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
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

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const sessionDate = session.created_at 
    ? new Date(session.created_at).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      })
    : 'Unknown date';

  if (loading) {
    return (
      <div className="min-h-[600px] bg-background flex items-center justify-center rounded-lg border-2 border-border">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground text-sm">Loading archive...</p>
        </div>
      </div>
    );
  }

  return (
    <div 
      ref={containerRef}
      className="min-h-[600px] bg-gradient-to-b from-background to-card rounded-lg border-2 border-border overflow-hidden flex flex-col"
    >
      {/* Header bar */}
      <header className="flex items-center justify-between px-4 py-3 border-b-2 border-border bg-card/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 hover:bg-secondary/20">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-sm font-pixel text-primary text-glow-green">
              ROAST STUDIO
            </span>
            <span className="px-2 py-0.5 text-[10px] bg-secondary/20 text-secondary border border-secondary/50 rounded uppercase">
              📼 Archive
            </span>
          </div>
          <span className="text-xs text-muted-foreground hidden sm:inline">{sessionDate}</span>
        </div>

        <div className="flex items-center gap-2">
          {isPlaying && (
            <span className="text-[10px] text-muted-foreground font-pixel px-2 py-1 bg-background/50 rounded">
              {currentIndex + 1} / {exchanges.length}
            </span>
          )}
          <span className="text-[10px] text-secondary text-glow-magenta font-bold">
            {exchanges.length} ROASTS
          </span>
          {!isPlaying ? (
            <Button
              onClick={handleStart}
              disabled={exchanges.length === 0}
              size="sm"
              className="h-8 px-4 text-xs bg-primary hover:bg-primary/90"
            >
              <Play className="w-3 h-3 mr-1.5" />
              Replay
            </Button>
          ) : (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" onClick={handleTogglePause} className="h-8 w-8">
                {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
              </Button>
              <Button variant="ghost" size="icon" onClick={handleRestart} className="h-8 w-8">
                <RotateCcw className="w-4 h-4" />
              </Button>
            </div>
          )}
          <Button variant="ghost" size="icon" onClick={toggleMute} className="h-8 w-8">
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={toggleFullscreen} className="h-8 w-8 hidden sm:flex">
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </Button>
        </div>
      </header>

      {/* Main stage */}
      <div className="flex-1 flex flex-col p-4 md:p-6 gap-4">
        {/* Persona - Featured Target */}
        <div className="flex flex-col items-center gap-2">
          <div className="relative">
            <div className="w-20 h-20 md:w-24 md:h-24 rounded-full overflow-hidden border-4 border-secondary shadow-[0_0_20px_hsl(320_100%_50%/0.4)]">
              {session.persona_avatar ? (
                <img
                  src={session.persona_avatar}
                  alt={session.persona_name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-secondary/20 flex items-center justify-center">
                  <span className="text-3xl font-bold text-foreground">
                    {session.persona_name.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
            </div>
            {isPlaying && (
              <div className="absolute -inset-2 rounded-full border-2 border-secondary/50 animate-ping" />
            )}
          </div>
          <h2 className="text-lg md:text-xl font-pixel text-secondary text-glow-magenta uppercase tracking-wider">
            {session.persona_name}
          </h2>
        </div>

        {/* Speech Bubble - Center */}
        <div className="flex-1 flex items-center justify-center">
          {currentDisplay ? (
            <div
              className={`max-w-2xl w-full p-5 md:p-6 rounded-xl border-2 transition-all duration-300 ${
                currentDisplay.speaker === "user"
                  ? "bg-accent/10 border-accent/50 shadow-[0_0_20px_hsl(180_100%_50%/0.2)]"
                  : currentDisplay.speaker === "hostA"
                  ? "bg-orange-500/10 border-orange-500/50 shadow-[0_0_20px_hsl(30_100%_50%/0.3)]"
                  : "bg-blue-500/10 border-blue-500/50 shadow-[0_0_20px_hsl(200_100%_50%/0.3)]"
              } ${isTransitioning ? "opacity-0 scale-95" : "opacity-100 scale-100"}`}
            >
              <div className={`text-[10px] uppercase tracking-widest mb-3 font-bold ${
                currentDisplay.speaker === "user"
                  ? "text-accent"
                  : currentDisplay.speaker === "hostA"
                  ? "text-orange-400"
                  : "text-blue-400"
              }`}>
                {currentDisplay.speaker === "user"
                  ? "🎤 AUDIENCE ROAST"
                  : currentDisplay.speaker === "hostA"
                  ? "🔥 CHAOS CARL"
                  : "🧊 ROAST RONNIE"}
              </div>
              <p className="text-base md:text-lg text-foreground leading-relaxed">
                {displayedText}
                {isTyping && <span className="inline-block w-0.5 h-5 bg-foreground ml-1 animate-pulse" />}
              </p>
            </div>
          ) : (
            <div className="text-center py-12">
              {exchanges.length === 0 ? (
                <div className="flex flex-col items-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-secondary/10 flex items-center justify-center">
                    <Play className="w-8 h-8 text-secondary/50" />
                  </div>
                  <p className="text-lg font-pixel text-secondary/70">NO ROASTS ARCHIVED</p>
                  <p className="text-muted-foreground text-sm">
                    This session has no saved roast data.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center border-2 border-primary/30">
                    <Play className="w-8 h-8 text-primary" />
                  </div>
                  <p className="text-lg font-pixel text-primary text-glow-green">READY TO REPLAY</p>
                  <p className="text-muted-foreground text-sm">
                    Click "Replay" to watch the roast show
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Hosts row */}
        <div className="flex items-center justify-center gap-8 md:gap-16 py-4">
          {/* Host A */}
          <div className={`flex flex-col items-center gap-2 transition-all duration-300 ${
            currentSpeaker === "hostA" ? "scale-110" : "opacity-60"
          }`}>
            <div className="relative">
              <SmallHost type="hostA" isSpeaking={currentSpeaker === "hostA"} size="small" />
              {currentSpeaker === "hostA" && (
                <div className="absolute -inset-2 rounded-full border-2 border-orange-400/50 animate-pulse" />
              )}
            </div>
            <AudioWaveformVisualizer
              isActive={currentSpeaker === "hostA"}
              color="hsl(30 100% 50%)"
              barCount={5}
            />
            <span className={`text-xs font-pixel uppercase tracking-wider ${
              currentSpeaker === "hostA" ? "text-orange-400" : "text-muted-foreground"
            }`}>
              Chaos Carl
            </span>
          </div>

          {/* VS Badge */}
          <div className="text-xl font-pixel text-muted-foreground/50">VS</div>

          {/* Host B */}
          <div className={`flex flex-col items-center gap-2 transition-all duration-300 ${
            currentSpeaker === "hostB" ? "scale-110" : "opacity-60"
          }`}>
            <div className="relative">
              <SmallHost type="hostB" isSpeaking={currentSpeaker === "hostB"} size="small" />
              {currentSpeaker === "hostB" && (
                <div className="absolute -inset-2 rounded-full border-2 border-blue-400/50 animate-pulse" />
              )}
            </div>
            <AudioWaveformVisualizer
              isActive={currentSpeaker === "hostB"}
              color="hsl(200 100% 50%)"
              barCount={5}
            />
            <span className={`text-xs font-pixel uppercase tracking-wider ${
              currentSpeaker === "hostB" ? "text-blue-400" : "text-muted-foreground"
            }`}>
              Roast Ronnie
            </span>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      {isPlaying && (
        <div className="h-1 bg-border">
          <div
            className="h-full bg-gradient-to-r from-primary to-secondary transition-all duration-300"
            style={{ width: `${((currentIndex + 1) / exchanges.length) * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}
