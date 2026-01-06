-- Allow clients to mark roast messages as used during LIVE sessions
-- Note: Postgres doesn't support CREATE POLICY IF NOT EXISTS

DROP POLICY IF EXISTS "Anyone can mark messages used in live sessions" ON public.roast_messages;

CREATE POLICY "Anyone can mark messages used in live sessions"
ON public.roast_messages
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.roast_sessions
    WHERE roast_sessions.id = roast_messages.session_id
      AND roast_sessions.status = 'LIVE'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.roast_sessions
    WHERE roast_sessions.id = roast_messages.session_id
      AND roast_sessions.status = 'LIVE'
  )
  AND roast_messages.used = true
);
