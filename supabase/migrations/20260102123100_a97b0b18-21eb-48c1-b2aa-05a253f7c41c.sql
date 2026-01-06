-- Create roast_sessions table
CREATE TABLE public.roast_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  persona_name TEXT NOT NULL,
  persona_avatar TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'LOCKED', 'LIVE', 'ARCHIVED')),
  start_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  lock_time TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create roast_messages table
CREATE TABLE public.roast_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.roast_sessions(id) ON DELETE CASCADE,
  audio_url TEXT,
  transcript TEXT,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on both tables
ALTER TABLE public.roast_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roast_messages ENABLE ROW LEVEL SECURITY;

-- Public read access for sessions (everyone can view the roast show)
CREATE POLICY "Anyone can view sessions"
ON public.roast_sessions
FOR SELECT
USING (true);

-- Public read access for messages
CREATE POLICY "Anyone can view messages"
ON public.roast_messages
FOR SELECT
USING (true);

-- Anyone can submit messages during OPEN sessions
CREATE POLICY "Anyone can submit messages to open sessions"
ON public.roast_messages
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.roast_sessions
    WHERE id = session_id AND status = 'OPEN'
  )
);

-- Enable realtime for both tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.roast_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.roast_messages;