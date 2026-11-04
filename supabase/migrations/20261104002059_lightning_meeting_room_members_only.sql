-- Limit lightning meeting edits and cancellation to active room_members.
-- Keep diaries and photos intact when a meeting is removed from the calendar.
BEGIN;

CREATE OR REPLACE FUNCTION public.update_room_lightning_meeting(
  p_room_id text,
  p_meeting_id uuid,
  p_expected_updated_at timestamptz,
  p_meeting_date date,
  p_title text,
  p_start_time time,
  p_end_time time,
  p_location text,
  p_location_address text,
  p_participant_user_ids uuid[]
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_room_id public.rooms.id%TYPE;
  v_meeting public.room_meetings%ROWTYPE;
  v_member_ids uuid[];
  v_user_id uuid;
  v_identity_id uuid;
  v_location text := NULLIF(btrim(p_location), '');
  v_address text := NULLIF(btrim(p_location_address), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT r.id INTO v_room_id FROM public.rooms r WHERE r.id::text = p_room_id;
  IF v_room_id IS NULL OR NOT meetup_private.is_active_room_actor(p_room_id) OR NOT EXISTS (
    SELECT 1 FROM public.room_members rm WHERE rm.roomid = v_room_id AND rm.userid = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Active room membership required' USING ERRCODE = '42501';
  END IF;
  SELECT m.* INTO v_meeting FROM public.room_meetings m
    WHERE m.id = p_meeting_id AND m.room_id = v_room_id AND m.source_type = 'lightning'
    FOR UPDATE;
  IF NOT FOUND OR v_meeting.lifecycle_status = 'cancelled' THEN
    RAISE EXCEPTION 'Active lightning meeting not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_updated_at IS NULL OR v_meeting.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Meeting changed; reload before editing' USING ERRCODE = '40001';
  END IF;
  IF p_meeting_date IS NULL OR p_meeting_date > (now() AT TIME ZONE 'Asia/Seoul')::date
     OR NULLIF(btrim(p_title), '') IS NULL OR length(btrim(p_title)) > 120
     OR (p_end_time IS NOT NULL AND (p_start_time IS NULL OR p_end_time < p_start_time))
     OR length(v_location) > 200 OR length(v_address) > 500
     OR (v_location IS NULL AND v_address IS NOT NULL)
     OR cardinality(COALESCE(p_participant_user_ids, '{}'::uuid[])) > 100 THEN
    RAISE EXCEPTION 'Invalid lightning meeting fields' USING ERRCODE = '22023';
  END IF;
  SELECT ARRAY(
    SELECT DISTINCT requested.user_id
    FROM unnest(COALESCE(p_participant_user_ids, '{}'::uuid[])) AS requested(user_id)
  ) INTO v_member_ids;
  IF cardinality(v_member_ids) = 0 THEN
    RAISE EXCEPTION 'At least one participant is required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_member_ids) AS requested(user_id)
    LEFT JOIN public.room_members rm
      ON rm.roomid = v_room_id AND rm.userid = requested.user_id
    WHERE requested.user_id IS NULL OR rm.userid IS NULL
  ) THEN
    RAISE EXCEPTION 'Selected participant is not an active room member' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.meeting_diaries d
    JOIN public.room_actor_identities i ON i.id = d.author_identity_id
    WHERE d.meeting_id = p_meeting_id AND i.auth_user_id IS NOT NULL
      AND i.auth_user_id <> ALL(v_member_ids)
  ) THEN
    RAISE EXCEPTION 'A member with a diary cannot be removed' USING ERRCODE = '22023';
  END IF;

  UPDATE public.room_meetings m SET
    meeting_date = p_meeting_date,
    title = btrim(p_title),
    start_time = p_start_time,
    end_time = p_end_time,
    is_all_day = p_start_time IS NULL,
    location = v_location,
    location_address = v_address,
    updated_at = now()
  WHERE m.id = p_meeting_id;

  DELETE FROM public.meeting_participants mp
  USING public.room_actor_identities i
  WHERE mp.meeting_id = p_meeting_id AND mp.actor_identity_id = i.id
    AND i.auth_user_id IS NOT NULL AND i.auth_user_id <> ALL(v_member_ids);

  FOREACH v_user_id IN ARRAY v_member_ids LOOP
    INSERT INTO public.room_actor_identities(room_id, auth_user_id, actor_kind)
      VALUES (v_room_id, v_user_id, 'member')
      ON CONFLICT (room_id, auth_user_id) WHERE auth_user_id IS NOT NULL DO NOTHING;
    SELECT i.id INTO v_identity_id FROM public.room_actor_identities i
      WHERE i.room_id = v_room_id AND i.auth_user_id = v_user_id;
    INSERT INTO public.meeting_participants(meeting_id, actor_identity_id, attendance_status, source)
      VALUES (p_meeting_id, v_identity_id, 'unknown', 'manual')
      ON CONFLICT (meeting_id, actor_identity_id) DO NOTHING;
  END LOOP;

  DELETE FROM public.room_meeting_diary_targets t WHERE t.meeting_id = p_meeting_id;
  INSERT INTO public.room_meeting_diary_targets(meeting_id, user_id)
    SELECT p_meeting_id, requested.user_id
    FROM unnest(v_member_ids) AS requested(user_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.cancel_room_lightning_meeting(
  p_room_id text,
  p_meeting_id uuid,
  p_expected_updated_at timestamptz
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_room_id public.rooms.id%TYPE;
  v_meeting public.room_meetings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT r.id INTO v_room_id FROM public.rooms r WHERE r.id::text = p_room_id;
  IF v_room_id IS NULL OR NOT meetup_private.is_active_room_actor(p_room_id) OR NOT EXISTS (
    SELECT 1 FROM public.room_members rm WHERE rm.roomid = v_room_id AND rm.userid = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Active room membership required' USING ERRCODE = '42501';
  END IF;
  SELECT m.* INTO v_meeting FROM public.room_meetings m
    WHERE m.id = p_meeting_id AND m.room_id = v_room_id AND m.source_type = 'lightning'
    FOR UPDATE;
  IF NOT FOUND OR v_meeting.lifecycle_status = 'cancelled' THEN
    RAISE EXCEPTION 'Active lightning meeting not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_updated_at IS NULL OR v_meeting.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Meeting changed; reload before deleting' USING ERRCODE = '40001';
  END IF;
  UPDATE public.room_meetings m
    SET lifecycle_status = 'cancelled', updated_at = now()
    WHERE m.id = p_meeting_id;
END
$function$;

REVOKE ALL ON FUNCTION public.update_room_lightning_meeting(text,uuid,timestamptz,date,text,time,time,text,text,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_room_lightning_meeting(text,uuid,timestamptz,date,text,time,time,text,text,uuid[]) TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_room_lightning_meeting(text,uuid,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_room_lightning_meeting(text,uuid,timestamptz) TO authenticated;
NOTIFY pgrst, 'reload schema';

COMMIT;
