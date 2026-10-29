-- Private invalidation broadcasts for the diary collection. Payloads carry no
-- diary data; clients refetch through the existing RLS-protected RPCs.
BEGIN;

DO $policy$
DECLARE
  v_access_predicate text := $predicate$
    realtime.messages.extension = 'broadcast'
    AND (
      (
        (SELECT realtime.topic()) LIKE 'meetup-diary-room:%'
        AND EXISTS (
          SELECT 1 FROM public.room_members rm
          WHERE rm.roomid::text = split_part((SELECT realtime.topic()), ':', 2)
            AND rm.userid::text = (SELECT auth.uid())::text
        )
      )
      OR (
        (SELECT realtime.topic()) LIKE 'meetup-diary-user:%'
        AND split_part((SELECT realtime.topic()), ':', 2) = (SELECT auth.uid())::text
      )
    )
  $predicate$;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='realtime' AND tablename='messages' AND policyname='meetup_diary_receive_broadcasts') THEN
    EXECUTE format('CREATE POLICY meetup_diary_receive_broadcasts ON realtime.messages FOR SELECT TO authenticated USING (%s)', v_access_predicate);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='realtime' AND tablename='messages' AND policyname='meetup_diary_broadcast_membership_guard') THEN
    EXECUTE format('CREATE POLICY meetup_diary_broadcast_membership_guard ON realtime.messages AS RESTRICTIVE FOR SELECT TO authenticated USING (%s)', v_access_predicate);
  END IF;
END
$policy$;

CREATE OR REPLACE FUNCTION meetup_private.broadcast_diary_collection_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_row jsonb;
  v_old_row jsonb;
  v_diary_id uuid;
  v_room_id text;
  v_author_user_id uuid;
  v_room_visible boolean := false;
  v_target_topic text;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  IF TG_OP <> 'INSERT' THEN v_old_row := to_jsonb(OLD); END IF;

  IF TG_TABLE_NAME = 'room_meetings' THEN
    v_room_id := v_row ->> 'room_id';
    v_target_topic := 'meetup-diary-room:' || v_room_id;
  ELSIF TG_TABLE_NAME = 'meeting_diaries' THEN
    v_diary_id := (v_row ->> 'id')::uuid;
    SELECT m.room_id::text INTO v_room_id
    FROM public.room_meetings m
    WHERE m.id = (v_row ->> 'meeting_id')::uuid;
    SELECT i.auth_user_id INTO v_author_user_id
    FROM public.room_actor_identities i
    WHERE i.id = (v_row ->> 'author_identity_id')::uuid;
    v_room_visible := (v_row ->> 'status' = 'published' AND v_row ->> 'visibility' = 'room');
    IF v_old_row IS NOT NULL THEN
      v_room_visible := v_room_visible OR (v_old_row ->> 'status' = 'published' AND v_old_row ->> 'visibility' = 'room');
    END IF;
  ELSE
    v_diary_id := (v_row ->> 'diary_id')::uuid;
    SELECT m.room_id::text, (d.status = 'published' AND d.visibility = 'room'), i.auth_user_id
      INTO v_room_id, v_room_visible, v_author_user_id
    FROM public.meeting_diaries d
    JOIN public.room_meetings m ON m.id = d.meeting_id
    JOIN public.room_actor_identities i ON i.id = d.author_identity_id
    WHERE d.id = v_diary_id;
  END IF;

  IF v_room_id IS NOT NULL THEN
    IF TG_TABLE_NAME = 'room_meetings' OR TG_TABLE_NAME = 'diary_reactions' OR v_room_visible THEN
      v_target_topic := 'meetup-diary-room:' || v_room_id;
    ELSIF v_author_user_id IS NOT NULL THEN
      v_target_topic := 'meetup-diary-user:' || v_author_user_id::text;
    END IF;
  END IF;

  IF v_target_topic IS NOT NULL THEN
    BEGIN
      PERFORM realtime.send(
        payload := jsonb_build_object('table', TG_TABLE_NAME),
        event := 'collection_changed',
        topic := v_target_topic,
        private := true
      );
    EXCEPTION WHEN OTHERS THEN
      -- A Realtime outage or missing message partition must not fail diary writes.
      NULL;
    END;
  END IF;

  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION meetup_private.broadcast_diary_collection_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS meetup_diary_collection_broadcast ON public.room_meetings;
CREATE TRIGGER meetup_diary_collection_broadcast
  AFTER INSERT OR UPDATE OR DELETE ON public.room_meetings
  FOR EACH ROW EXECUTE FUNCTION meetup_private.broadcast_diary_collection_change();

DROP TRIGGER IF EXISTS meetup_diary_collection_broadcast ON public.meeting_diaries;
CREATE TRIGGER meetup_diary_collection_broadcast
  AFTER INSERT OR UPDATE OR DELETE ON public.meeting_diaries
  FOR EACH ROW EXECUTE FUNCTION meetup_private.broadcast_diary_collection_change();

DROP TRIGGER IF EXISTS meetup_diary_collection_broadcast ON public.diary_photos;
CREATE TRIGGER meetup_diary_collection_broadcast
  AFTER INSERT OR UPDATE OR DELETE ON public.diary_photos
  FOR EACH ROW EXECUTE FUNCTION meetup_private.broadcast_diary_collection_change();

DROP TRIGGER IF EXISTS meetup_diary_collection_broadcast ON public.diary_reactions;
CREATE TRIGGER meetup_diary_collection_broadcast
  AFTER INSERT OR UPDATE OR DELETE ON public.diary_reactions
  FOR EACH ROW EXECUTE FUNCTION meetup_private.broadcast_diary_collection_change();

COMMIT;
