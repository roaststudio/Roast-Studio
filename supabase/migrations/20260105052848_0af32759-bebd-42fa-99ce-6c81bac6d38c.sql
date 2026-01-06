-- Create table to store complete roast exchanges for archive replay
CREATE TABLE public.roast_exchanges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES roast_sessions(id) ON DELETE CASCADE,
  message_id UUID REFERENCES roast_messages(id) ON DELETE SET NULL,
  user_transcript TEXT,
  user_audio_url TEXT,
  host_type TEXT NOT NULL CHECK (host_type IN ('A', 'B')),
  host_response TEXT NOT NULL,
  host_audio_url TEXT,
  sequence_number INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable Row-Level Security
ALTER TABLE public.roast_exchanges ENABLE ROW LEVEL SECURITY;

-- Anyone can view exchanges (for archive replay)
CREATE POLICY "Anyone can view exchanges" ON public.roast_exchanges
  FOR SELECT USING (true);

-- Allow inserts during live sessions (from edge functions or client)
CREATE POLICY "Anyone can insert exchanges" ON public.roast_exchanges
  FOR INSERT WITH CHECK (true);

-- Enable realtime for live updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.roast_exchanges;

-- Create storage bucket for host audio files
INSERT INTO storage.buckets (id, name, public)
VALUES ('host-audio', 'host-audio', true);

-- Allow public read access to host audio
CREATE POLICY "Public read access for host audio"
ON storage.objects FOR SELECT
USING (bucket_id = 'host-audio');

-- Allow inserts to host audio bucket
CREATE POLICY "Allow inserts to host audio"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'host-audio');