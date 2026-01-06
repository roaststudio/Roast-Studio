-- Allow anyone to create sessions (for demo purposes)
CREATE POLICY "Anyone can create sessions"
ON public.roast_sessions
FOR INSERT
WITH CHECK (true);