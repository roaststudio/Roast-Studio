-- Create table to store current session playback state for synchronized viewing
CREATE TABLE public.session_playback_state (
  session_id UUID NOT NULL PRIMARY KEY REFERENCES public.roast_sessions(id) ON DELETE CASCADE,
  host_id TEXT NOT NULL, -- Browser tab ID of the controlling host
  current_index INTEGER NOT NULL DEFAULT 0,
  phase TEXT NOT NULL DEFAULT 'idle', -- idle, intro, roast, response, transition
  current_speaker TEXT, -- user, hostA, hostB
  current_text TEXT,
  current_audio_url TEXT,
  audio_started_at TIMESTAMP WITH TIME ZONE,
  host_turn TEXT DEFAULT 'A', -- A or B
  roast_number INTEGER DEFAULT 0,
  is_playing BOOLEAN DEFAULT false,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.session_playback_state ENABLE ROW LEVEL SECURITY;

-- Anyone can view playback state
CREATE POLICY "Anyone can view playback state" 
ON public.session_playback_state 
FOR SELECT 
USING (true);

-- Anyone can create playback state (first viewer becomes host)
CREATE POLICY "Anyone can insert playback state" 
ON public.session_playback_state 
FOR INSERT 
WITH CHECK (true);

-- Anyone can update playback state (checked in app logic by host_id)
CREATE POLICY "Anyone can update playback state" 
ON public.session_playback_state 
FOR UPDATE 
USING (true);

-- Enable realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE public.session_playback_state;