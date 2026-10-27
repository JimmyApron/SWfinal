-- Aggregate-only diary progress for the room calendar's meeting card.
-- Requires 20261028120000_meetup_calendar_diaries.sql.
-- The count intentionally ignores attendance and confirmed_schedules.absentees:
-- every current room member is a diary target, including excluded members.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_meeting_diary_progress(p_meeting_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_room_id text;
  v_published_count integer;
  v_target_count integer;
  v_published_member_ids jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501';
  END IF;

  SELECT m.room_id::text INTO v_room_id
  FROM public.room_meetings m
  WHERE m.id=p_meeting_id;

  IF v_room_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.room_members rm
    WHERE rm.roomid::text=v_room_id
      AND rm.userid::text=auth.uid()::text
  ) THEN
    RAISE EXCEPTION 'Meeting is unavailable to this room member' USING ERRCODE='42501';
  END IF;

  -- Return identities only for room-visible published records and the caller's own
  -- published record. A friend's private publication never affects this result.
  SELECT COALESCE(jsonb_agg(DISTINCT actor.auth_user_id::text), '[]'::jsonb)
    INTO v_published_member_ids
  FROM public.meeting_diaries d
  JOIN public.room_actor_identities actor ON actor.id=d.author_identity_id
  JOIN public.room_members rm
    ON rm.userid::text=actor.auth_user_id::text
   AND rm.roomid::text=v_room_id
  WHERE d.meeting_id=p_meeting_id
    AND d.status='published'
    AND (d.visibility='room' OR actor.auth_user_id=auth.uid());

  v_published_count := jsonb_array_length(v_published_member_ids);

  SELECT count(*)::integer INTO v_target_count
  FROM public.room_members rm
  WHERE rm.roomid::text=v_room_id;

  RETURN jsonb_build_object(
    'published_count',v_published_count,
    'target_count',v_target_count,
    'published_member_ids',v_published_member_ids
  );
END
$function$;

REVOKE ALL ON FUNCTION public.get_meeting_diary_progress(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_meeting_diary_progress(uuid) TO authenticated;

COMMIT;
