import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

interface UserSubmission {
  id: string;
  transcript: string | null;
  session_id: string;
  session?: {
    persona_name: string;
    persona_avatar: string | null;
  };
}

export function LatestRoastsFeed() {
  const [submissions, setSubmissions] = useState<UserSubmission[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>();

  useEffect(() => {
    const fetchLatestSubmissions = async () => {
      const { data } = await supabase
        .from("roast_messages")
        .select(`
          id,
          transcript,
          session_id
        `)
        .not("transcript", "is", null)
        .order("created_at", { ascending: false })
        .limit(50);

      if (data && data.length > 0) {
        // Fetch session info for each submission
        const sessionIds = [...new Set(data.map(r => r.session_id))];
        const { data: sessions } = await supabase
          .from("roast_sessions")
          .select("id, persona_name, persona_avatar")
          .in("id", sessionIds);

        const sessionMap = new Map(sessions?.map(s => [s.id, s]) || []);

        const enrichedSubmissions = data.map(r => ({
          ...r,
          session: sessionMap.get(r.session_id) || { persona_name: "Unknown", persona_avatar: null }
        }));

        setSubmissions(enrichedSubmissions);
      }
    };

    fetchLatestSubmissions();
  }, []);

  // Auto-scroll animation
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || submissions.length === 0) return;

    let scrollPos = 0;
    const speed = 0.5; // pixels per frame

    const animate = () => {
      scrollPos += speed;
      
      // Reset when we've scrolled through half (since content is duplicated)
      if (scrollPos >= container.scrollHeight / 2) {
        scrollPos = 0;
      }
      
      container.scrollTop = scrollPos;
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [submissions]);

  if (submissions.length === 0) return null;

  // Duplicate submissions for seamless looping
  const displaySubmissions = [...submissions, ...submissions];

  return (
    <div className="hidden lg:flex flex-col fixed left-4 top-24 bottom-4 w-64 border-2 border-primary/50 bg-card/90 rounded-lg overflow-hidden z-40">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b-2 border-border bg-card shrink-0">
        <div className="w-2 h-2 bg-primary animate-pulse rounded-full" />
        <span className="text-xs text-primary uppercase tracking-wider font-bold">LATEST ROASTS</span>
      </div>

      {/* Scrolling content */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-hidden"
        style={{ scrollBehavior: 'auto' }}
      >
        <div className="space-y-2 p-3">
          {displaySubmissions.map((submission, index) => (
            <div 
              key={`${submission.id}-${index}`}
              className="flex items-start gap-2 p-2 bg-background/70 border border-border rounded-md"
            >
              {/* KOL Avatar */}
              <div className="shrink-0">
                {submission.session?.persona_avatar ? (
                  <img 
                    src={submission.session.persona_avatar} 
                    alt="" 
                    className="w-8 h-8 rounded-full object-cover border-2 border-primary/30"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-primary/20 border-2 border-primary/30" />
                )}
              </div>
              
              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className="text-[9px] text-primary font-bold truncate">
                  {submission.session?.persona_name}
                </p>
                <p className="text-[10px] text-foreground/80 line-clamp-2 leading-tight">
                  {submission.transcript}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
