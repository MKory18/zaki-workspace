-- Phase 3, step 3 of 3: the doorbell of the realtime layer.
--
-- Every change of the chat writes one row in "RealtimeEvent" (ids only, never content), inside the same
-- transaction as the change. This trigger rings the channel "zaki_rt" with the id of that row when the
-- transaction COMMITS (pg_notify is delivered at commit, so the row is visible to whoever hears it), and the
-- listener of each application process then loads the row and pushes it to the clients that may see it.
--
-- Safe to run again: the function is replaced, and the trigger is created only if it is not there yet
-- (checked in the catalog, so nothing has to be dropped).

CREATE OR REPLACE FUNCTION "zaki_rt_notify"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify('zaki_rt', NEW."id"::text);
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = '"RealtimeEvent"'::regclass
      AND tgname = 'RealtimeEvent_notify'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER "RealtimeEvent_notify"
      AFTER INSERT ON "RealtimeEvent"
      FOR EACH ROW EXECUTE FUNCTION "zaki_rt_notify"();
  END IF;
END
$$;
