import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { CountdownTimer } from "./CountdownTimer";
import { PersonaCard } from "./PersonaCard";
import { SubmissionForm } from "./SubmissionForm";
import { WatchView } from "./WatchView";
import { ArchiveStudioView } from "./ArchiveStudioView";
import { LatestRoastsFeed } from "./LatestRoastsFeed";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, Flame, Tv, Send, Users, Archive, Play } from "lucide-react";
import roastStudioLogo from "@/assets/roast-studio-logo.png";

interface Persona {
  id: string;
  username: string;
  twitter_handle: string | null;
  profile_pic_url: string | null;
  wallet_address: string | null;
}

interface Session {
  id: string;
  persona_name: string;
  persona_avatar: string | null;
  persona_id: string | null;
  status: string;
  start_time: string;
  lock_time: string | null;
  created_at: string;
  persona?: Persona | null;
}

export function SessionManager() {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [messageCount, setMessageCount] = useState(0);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [activeTab, setActiveTab] = useState("submit");
  const [upcomingSessions, setUpcomingSessions] = useState<Session[]>([]);
  const [archivedSessions, setArchivedSessions] = useState<Session[]>([]);
  const [selectedArchive, setSelectedArchive] = useState<Session | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionCount, setTransitionCount] = useState(3);
  const [nextKolName, setNextKolName] = useState<string | null>(null);
  

  // Keep latest session id for realtime handlers (avoids stale closures)
  const sessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    sessionIdRef.current = session?.id ?? null;
  }, [session?.id]);



  const fetchUpcomingSessions = async () => {
    const { data } = await supabase
      .from("roast_sessions")
      .select("*")
      .eq("status", "QUEUED")
      .order("created_at", { ascending: true })
      .limit(3);
    
    if (data) {
      setUpcomingSessions(data as Session[]);
    }
  };

  const fetchArchivedSessions = async () => {
    const { data } = await supabase
      .from("roast_sessions")
      .select("*")
      .eq("status", "ARCHIVED")
      .order("created_at", { ascending: false })
      .limit(20);
    
    if (data) {
      setArchivedSessions(data as Session[]);
    }
  };

  const fetchPersonas = async () => {
    const { data } = await supabase
      .from("personas")
      .select("*")
      .order("username", { ascending: true });
    
    if (data) {
      setPersonas(data);
    }
  };

  const fetchCurrentSession = async () => {
    const { data, error } = await supabase
      .from("roast_sessions")
      .select("*")
      .in("status", ["OPEN", "LOCKED", "LIVE"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      let sessionData: Session = { ...data, persona: null };
      
      // If session has persona_id, fetch the persona details
      if (data.persona_id) {
        const { data: personaData } = await supabase
          .from("personas")
          .select("*")
          .eq("id", data.persona_id)
          .maybeSingle();
        
        if (personaData) {
          sessionData.persona = personaData;
          sessionData.persona_name = personaData.username;
          sessionData.persona_avatar = personaData.profile_pic_url;
        }
      }
      setSession(sessionData);
      fetchMessageCount(data.id);
    } else {
      setSession(null);
    }
    setLoading(false);
  };

  const fetchMessageCount = async (sessionId: string) => {
    const { count } = await supabase
      .from("roast_messages")
      .select("*", { count: "exact", head: true })
      .eq("session_id", sessionId);
    
    setMessageCount(count || 0);
  };

  const createDemoSession = async () => {
    if (personas.length === 0) {
      console.error("No personas available");
      return;
    }

    const randomPersona = personas[Math.floor(Math.random() * personas.length)];
    const startTime = new Date();
    const lockTime = new Date(startTime.getTime() + 2 * 60 * 1000); // 2 minutes from now

    const { data, error } = await supabase.from("roast_sessions").insert({
      persona_name: randomPersona.username,
      persona_avatar: randomPersona.profile_pic_url,
      persona_id: randomPersona.id,
      status: "OPEN",
      start_time: startTime.toISOString(),
      lock_time: lockTime.toISOString(),
    }).select().single();

    if (data) {
      const sessionData: Session = { ...data, persona: randomPersona };
      setSession(sessionData);
    }
  };

  const handleSessionComplete = async () => {
    if (!session || personas.length === 0) return;
    
    // Archive the current session
    await supabase
      .from("roast_sessions")
      .update({ status: "ARCHIVED" })
      .eq("id", session.id);
    
    // Get list of recently roasted persona IDs (last 10 sessions)
    const { data: recentSessions } = await supabase
      .from("roast_sessions")
      .select("persona_id")
      .order("created_at", { ascending: false })
      .limit(10);
    
    const recentlyRoastedIds = new Set(
      (recentSessions || []).map(s => s.persona_id).filter(Boolean)
    );
    
    // Sort personas alphabetically
    const sortedPersonas = [...personas].sort((a, b) => a.username.localeCompare(b.username));
    
    // Find next persona that hasn't been roasted recently
    // Start from the current persona's position in the list
    let currentIndex = sortedPersonas.findIndex(p => p.id === session.persona_id);
    if (currentIndex === -1) currentIndex = 0;
    
    let nextPersona = null;
    let searchCount = 0;
    
    // Try to find someone not recently roasted
    while (searchCount < sortedPersonas.length) {
      const candidateIndex = (currentIndex + 1 + searchCount) % sortedPersonas.length;
      const candidate = sortedPersonas[candidateIndex];
      
      if (!recentlyRoastedIds.has(candidate.id)) {
        nextPersona = candidate;
        console.log(`[Session Cycle] Found fresh KOL: ${candidate.username} (not in recent ${recentlyRoastedIds.size})`);
        break;
      }
      searchCount++;
    }
    
    // If everyone was recently roasted, just go to the next one alphabetically
    if (!nextPersona) {
      const nextIndex = (currentIndex + 1) % sortedPersonas.length;
      nextPersona = sortedPersonas[nextIndex];
      console.log(`[Session Cycle] All KOLs recently roasted, cycling to: ${nextPersona.username}`);
    }
    
    console.log(`[Session Cycle] Current: ${session.persona_name} -> Next: ${nextPersona?.username}`);
    
    setNextKolName(nextPersona?.username || "???");
    setIsTransitioning(true);
    setTransitionCount(3);
    
    // Countdown then create new session
    let count = 3;
    const countdownInterval = setInterval(() => {
      count -= 1;
      if (count <= 0) {
        clearInterval(countdownInterval);
        // Create new session after countdown
        createNewSession(nextPersona);
      } else {
        setTransitionCount(count);
      }
    }, 1000);
  };

  const createNewSession = async (persona: Persona) => {
    const startTime = new Date();
    const lockTime = new Date(startTime.getTime() + 2 * 60 * 1000);

    const { data, error } = await supabase.from("roast_sessions").insert({
      persona_name: persona.username,
      persona_avatar: persona.profile_pic_url,
      persona_id: persona.id,
      status: "OPEN",
      start_time: startTime.toISOString(),
      lock_time: lockTime.toISOString(),
    }).select().single();

    if (data) {
      const sessionData: Session = { ...data, persona };
      setSession(sessionData);
      setActiveTab("submit");
    }
    setIsTransitioning(false);
  };

  // Poll the session manager to check for state transitions
  const pollSessionManager = async () => {
    try {
      await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/session-manager`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({}),
        }
      );
    } catch (error) {
      console.error("Session manager poll failed:", error);
    }
  };

  useEffect(() => {
    fetchPersonas();
    fetchCurrentSession();
    fetchUpcomingSessions();
    fetchArchivedSessions();
    
    // Initial poll
    pollSessionManager();

    // Poll session manager every 5 seconds for state transitions
    const pollInterval = setInterval(() => {
      pollSessionManager();
    }, 5000);

    // Subscribe to session changes
    const channel = supabase
      .channel("session-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "roast_sessions" },
        () => {
          fetchCurrentSession();
          fetchUpcomingSessions();
          fetchArchivedSessions();
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "roast_messages" },
        () => {
          const sessionId = sessionIdRef.current;
          if (sessionId) fetchMessageCount(sessionId);
        }
      )
      .subscribe();

    return () => {
      clearInterval(pollInterval);
      supabase.removeChannel(channel);
    };
  }, []);

  // Auto-create session when none exists
  useEffect(() => {
    if (!loading && !session && personas.length > 0) {
      createDemoSession();
    }
  }, [loading, session, personas.length]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-studio crt-effect">
        <div className="flex flex-col items-center gap-6">
          <Flame className="w-16 h-16 text-primary animate-pulse text-glow-green" />
          <p className="text-muted-foreground text-xs animate-blink">LOADING...</p>
        </div>
      </div>
    );
  }

  // Transition screen between KOLs
  if (isTransitioning) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background relative overflow-hidden">
        {/* Radial gradient background */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,hsl(320_100%_30%/0.3)_0%,transparent_70%)]" />
        
        {/* Animated rings */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-[600px] h-[600px] rounded-full border-2 border-secondary/20 animate-ping" style={{ animationDuration: '2s' }} />
          <div className="absolute w-[400px] h-[400px] rounded-full border-2 border-primary/20 animate-ping" style={{ animationDuration: '1.5s' }} />
          <div className="absolute w-[200px] h-[200px] rounded-full border-2 border-accent/20 animate-ping" style={{ animationDuration: '1s' }} />
        </div>
        
        <div className="relative z-20 text-center space-y-6">
          {/* Title */}
          <h2 className="text-3xl md:text-4xl font-pixel text-secondary tracking-wider" style={{
            textShadow: '0 0 30px hsl(320 100% 60%), 0 0 60px hsl(320 100% 60%)'
          }}>
            NEXT UP
          </h2>
          
          {/* Countdown number - big and bold */}
          <div 
            key={transitionCount}
            className="text-[150px] md:text-[200px] font-pixel text-primary leading-none animate-pulse"
            style={{
              textShadow: '0 0 40px hsl(120 100% 50%), 0 0 80px hsl(120 100% 50%), 0 0 120px hsl(120 100% 50%)'
            }}
          >
            {transitionCount}
          </div>
          
          {/* Next KOL name with glow */}
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground uppercase tracking-[0.3em]">GET READY TO ROAST</p>
            <p className="text-2xl md:text-3xl font-pixel text-accent" style={{
              textShadow: '0 0 20px hsl(180 100% 50%), 0 0 40px hsl(180 100% 50%)'
            }}>
              {nextKolName}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-studio crt-effect">
        <div className="flex flex-col items-center gap-6">
          <Flame className="w-16 h-16 text-primary animate-pulse text-glow-green" />
          <p className="text-muted-foreground text-xs animate-blink">STARTING SESSION...</p>
        </div>
      </div>
    );
  }

  // Calculate lock time
  const lockTime = session.lock_time ? new Date(session.lock_time) : new Date(new Date(session.start_time).getTime() + 2 * 60 * 1000);

  // Get display name and avatar
  const displayName = session.persona?.username || session.persona_name;
  const displayAvatar = session.persona?.profile_pic_url || session.persona_avatar;
  const twitterHandle = session.persona?.twitter_handle;

  // Get next KOLs to roast - deterministic alphabetical order
  const getNextKols = () => {
    // Sort personas alphabetically
    const sortedPersonas = [...personas].sort((a, b) => a.username.localeCompare(b.username));
    
    // Find current persona index
    const currentIndex = sortedPersonas.findIndex(
      p => p.username.toLowerCase() === session.persona_name.toLowerCase()
    );
    
    // Get next 10 KOLs in alphabetical order (wrapping around)
    const nextKols = [];
    const maxKols = Math.min(10, sortedPersonas.length - 1);
    for (let i = 1; i <= maxKols; i++) {
      const nextIndex = (currentIndex + i) % sortedPersonas.length;
      const kol = sortedPersonas[nextIndex];
      nextKols.push({
        id: kol.id,
        username: kol.username,
        profile_pic_url: kol.profile_pic_url,
      });
    }
    
    return nextKols;
  };

  const nextKols = getNextKols();

  // Render WatchView fullscreen when show tab is active OR when session is locked/live (via lock)
  const isViewLocked = typeof window !== 'undefined' && localStorage.getItem('roast-studio-view-locked') === 'true';
  
  // Auto-switch to WatchView when session is LOCKED or LIVE and view is locked
  if (activeTab === "show" || (isViewLocked && (session.status === "LOCKED" || session.status === "LIVE"))) {
    return (
      <WatchView 
        key={session.id} 
        session={session} 
        onComplete={handleSessionComplete}
        onBack={() => setActiveTab("submit")}
      />
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background relative overflow-x-hidden">
      {/* Subtle gradient overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,hsl(260_30%_15%)_0%,transparent_50%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,hsl(320_50%_10%)_0%,transparent_40%)]" />

      {/* Header */}
      <header className="border-b-2 border-border bg-card/90 backdrop-blur-sm sticky top-0 z-50 shadow-[0_2px_0_hsl(0_0%_0%)]">
        <div className="container mx-auto px-3 py-2 flex items-center justify-between">
          <button 
            onClick={() => setActiveTab("submit")} 
            className="text-lg md:text-xl font-pixel text-primary text-glow-green hover:text-secondary transition-colors tracking-wider"
          >
            ROAST STUDIO
          </button>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-secondary text-glow-magenta font-bold">
              {messageCount} ROASTS
            </span>
            <a 
              href="https://twitter.com/RoastStudio" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-[10px] text-primary hover:text-secondary transition-colors"
            >
              @RoastStudio
            </a>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="container mx-auto px-4 pt-3 relative z-10">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full flex flex-col items-center">
          <TabsList className="grid w-full max-w-md mx-auto grid-cols-3 h-8">
            <TabsTrigger value="submit" className="flex items-center gap-1 text-[10px] h-6">
              <Send className="w-3 h-3" />
              SUBMIT
            </TabsTrigger>
            <button 
              onClick={() => navigate('/studio')}
              className="flex items-center justify-center gap-1 text-[10px] h-6 px-3 rounded-md bg-secondary/20 hover:bg-secondary/30 text-secondary transition-colors"
            >
              <Tv className="w-3 h-3" />
              WATCH
            </button>
            <button 
              onClick={() => navigate('/archives')}
              className="flex items-center justify-center gap-1 text-[10px] h-6 px-3 rounded-md bg-secondary/20 hover:bg-secondary/30 text-secondary transition-colors"
            >
              <Archive className="w-3 h-3" />
              ARCHIVE
            </button>
          </TabsList>

          {/* Submit Tab Content */}
          <TabsContent value="submit" className="mt-2 w-full relative">
            {/* Latest Roasts Feed - Absolutely positioned on left */}
            <LatestRoastsFeed />

            {/* Main Content - Perfectly Centered */}
            <div className="flex justify-center">
              <div className="w-full max-w-sm space-y-2">
                {/* What do you think about sign */}
                <div className="text-center mb-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-widest">
                    What do you think about
                  </p>
                </div>
                
                {/* Persona Display - Compact */}
                <PersonaCard
                  name={displayName}
                  avatar={displayAvatar || undefined}
                  status={session.status}
                  twitterHandle={twitterHandle || undefined}
                />

                {/* Status Section - Compact */}
                <div className="text-center">
                  {/* Countdown Timer */}
                  {session.status === "OPEN" && (
                    <div className="space-y-1">
                      <p className="text-[8px] uppercase tracking-widest text-muted-foreground">
                        CLOSES IN
                      </p>
                      <CountdownTimer targetTime={lockTime} />
                    </div>
                  )}

                  {/* Locked State */}
                  {session.status === "LOCKED" && (
                    <div className="space-y-1">
                      <div className="inline-flex items-center gap-1 px-3 py-1 bg-secondary/20 border-2 border-secondary shadow-[2px_2px_0_hsl(0_0%_0%)]">
                        <span className="text-secondary text-[10px] text-glow-magenta">LOCKED</span>
                      </div>
                      <p className="text-muted-foreground text-[8px]">PREPARING TO READ ROASTS...</p>
                    </div>
                  )}

                  {/* LIVE State */}
                  {session.status === "LIVE" && (
                    <div className="space-y-1">
                      <div className="inline-flex items-center gap-1 px-3 py-1 bg-destructive/20 border-2 border-destructive shadow-[2px_2px_0_hsl(0_0%_0%)]">
                        <div className="w-2 h-2 bg-destructive animate-blink" />
                        <span className="text-destructive text-[10px]">LIVE!</span>
                      </div>
                      <p className="text-muted-foreground text-[8px]">SWITCH TO WATCH TAB</p>
                    </div>
                  )}
                </div>

                {/* Submission Form */}
                <div className="max-w-md mx-auto">
                  <SubmissionForm 
                    sessionId={session.id} 
                    disabled={session.status !== "OPEN"} 
                  />
                  
                  {/* Notice about when roasts will be read */}
                  {session.status === "OPEN" && (
                    <div className="mt-2 p-2 bg-secondary/10 border border-secondary/30 rounded text-center">
                      <p className="text-[9px] text-secondary">
                        ⏳ Roasts will be read aloud AFTER the timer ends
                      </p>
                    </div>
                  )}
                </div>

                {/* Satire Notice - Compact */}
                <div className="text-center">
                  <p className="text-[6px] text-muted-foreground max-w-xs mx-auto leading-relaxed">
                    ⚠️ PARODY ONLY. ALL ROASTS ARE SATIRICAL.
                  </p>
                </div>
              </div>
            </div>

            {/* Up Next Queue - Fixed positioned on right, full height */}
            <div className="hidden lg:flex flex-col fixed right-4 top-24 bottom-4 w-56 border-2 border-secondary/50 bg-card/90 rounded-lg overflow-hidden z-40">
              <div className="flex items-center gap-2 px-4 py-3 border-b-2 border-border bg-card shrink-0">
                <Users className="w-4 h-4 text-secondary" />
                <span className="text-xs text-secondary uppercase tracking-wider font-bold">UP NEXT</span>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                {nextKols.length > 0 ? (
                  <div className="space-y-2">
                    {nextKols.map((kol, i) => (
                      <div key={kol.id} className="flex items-center gap-2 p-2 bg-background/70 border border-border rounded-md hover:border-secondary/50 transition-colors">
                        <span className="text-xs text-secondary w-4 font-bold">{i + 1}.</span>
                        {kol.profile_pic_url && (
                          <img src={kol.profile_pic_url} alt="" className="w-8 h-8 object-cover border-2 border-border rounded" />
                        )}
                        <span className="text-[10px] text-foreground font-medium truncate">{kol.username}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No KOLs in queue</p>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

    </div>
  );
}
