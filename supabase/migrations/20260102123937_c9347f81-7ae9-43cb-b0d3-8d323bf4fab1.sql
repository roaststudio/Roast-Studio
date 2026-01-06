-- Create personas table for KOLs
CREATE TABLE public.personas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT NOT NULL,
  twitter_handle TEXT,
  profile_pic_url TEXT,
  wallet_address TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.personas ENABLE ROW LEVEL SECURITY;

-- Public read access for personas
CREATE POLICY "Anyone can view personas"
ON public.personas
FOR SELECT
USING (true);

-- Add persona_id reference to roast_sessions
ALTER TABLE public.roast_sessions 
ADD COLUMN persona_id UUID REFERENCES public.personas(id);

-- Enable realtime for personas
ALTER PUBLICATION supabase_realtime ADD TABLE public.personas;