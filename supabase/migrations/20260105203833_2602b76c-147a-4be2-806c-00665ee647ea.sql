-- Create global_round_state table for synchronized round state across all users
CREATE TABLE public.global_round_state (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES public.roast_sessions(id) ON DELETE CASCADE,
  round_state TEXT NOT NULL DEFAULT 'WAITING' CHECK (round_state IN ('SUBMITTING', 'LIVE', 'WAITING')),
  current_roast_index INTEGER NOT NULL DEFAULT 0,
  total_roasts INTEGER NOT NULL DEFAULT 0,
  live_start_time TIMESTAMP WITH TIME ZONE,
  submit_end_time TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT unique_active_round UNIQUE (id)
);

-- Enable Row Level Security
ALTER TABLE public.global_round_state ENABLE ROW LEVEL SECURITY;

-- Everyone can read the global state (public read)
CREATE POLICY "Anyone can read global round state"
ON public.global_round_state
FOR SELECT
USING (true);

-- Only backend (service role) can update the state - we'll handle this via edge functions
-- For now, allow all updates (no auth required for this app)
CREATE POLICY "Anyone can update global round state"
ON public.global_round_state
FOR UPDATE
USING (true);

CREATE POLICY "Anyone can insert global round state"
ON public.global_round_state
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Anyone can delete global round state"
ON public.global_round_state
FOR DELETE
USING (true);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_global_round_state_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_global_round_state_updated_at
BEFORE UPDATE ON public.global_round_state
FOR EACH ROW
EXECUTE FUNCTION public.update_global_round_state_updated_at();

-- Enable realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE public.global_round_state;