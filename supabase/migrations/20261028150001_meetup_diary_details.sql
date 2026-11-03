-- Safe member attribution for the full-screen meeting diary.
-- Room-visible published records are returned with their author account ID;
-- private records are returned only to their author.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_meeting_diary_details(p_meeting_id uuid)
RETURNS TABLE (
  id uuid,
  meeting_id uuid,
  author_identity_id uuid,
  author_auth_user_id uuid,
  status text,
  visibility text,
  mood_emoji text,
  body text,
  version integer,
  published_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_room_id text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501';
  END IF;

  SELECT m.room_id::text INTO v_room_id
  FROM public.room_meetings m
  WHERE m.id=p_meeting_id;

  IF v_room_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.room_members rm
    WHERE rm.roomid::text=v_room_id AND rm.userid::text=auth.uid()::text
  ) THEN
    RAISE EXCEPTION 'Meeting is unavailable to this room member' USING ERRCODE='42501';
  END IF;

  RETURN QUERY
  SELECT d.id, d.meeting_id, d.author_identity_id, actor.auth_user_id,
         d.status, d.visibility, d.mood_emoji, d.body, d.version,
         d.published_at, d.updated_at
  FROM public.meeting_diaries d
  JOIN public.room_actor_identities actor ON actor.id=d.author_identity_id
  WHERE d.meeting_id=p_meeting_id
    AND d.status='published'
    AND (d.visibility='room' OR actor.auth_user_id=auth.uid())
  ORDER BY d.published_at, d.id;
END
$function$;

REVOKE ALL ON FUNCTION public.get_meeting_diary_details(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_meeting_diary_details(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';

COMMIT;
