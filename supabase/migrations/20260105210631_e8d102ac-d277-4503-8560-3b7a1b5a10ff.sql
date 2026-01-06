-- Increment global round progress when a roast message is marked used

CREATE OR REPLACE FUNCTION public.increment_global_round_progress_on_message_used()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Only act on transitions from used=false -> used=true
  IF (TG_OP = 'UPDATE') AND (OLD.used IS DISTINCT FROM NEW.used) AND (NEW.used = true) THEN
    UPDATE public.global_round_state
    SET
      current_roast_index = LEAST(total_roasts, current_roast_index + 1),
      updated_at = now()
    WHERE session_id = NEW.session_id
      AND round_state = 'LIVE';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS roast_messages_used_global_progress ON public.roast_messages;

CREATE TRIGGER roast_messages_used_global_progress
AFTER UPDATE OF used ON public.roast_messages
FOR EACH ROW
EXECUTE FUNCTION public.increment_global_round_progress_on_message_used();
