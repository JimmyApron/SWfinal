CREATE OR REPLACE FUNCTION public.create_room_lightning_meeting(
  p_room_id text, p_meeting_date date, p_title text,
  p_start_time time, p_end_time time, p_location text,
  p_location_address text, p_participant_actor_ids uuid[] DEFAULT '{}'
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_room_id public.rooms.id%TYPE;
  v_actor_id uuid;
  v_meeting_id uuid;
  v_selected_user_id uuid;
  v_participant_identity_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  SELECT r.id INTO v_room_id FROM public.rooms r WHERE r.id::text=p_room_id;
  IF v_room_id IS NULL OR NOT meetup_private.is_active_room_actor(p_room_id) THEN
    RAISE EXCEPTION 'Room is unavailable to this actor' USING ERRCODE='42501';
  END IF;
  IF p_meeting_date IS NULL OR p_meeting_date > (now() AT TIME ZONE 'Asia/Seoul')::date THEN
    RAISE EXCEPTION 'Lightning meetings may only be today or earlier' USING ERRCODE='22023';
  END IF;
  IF NULLIF(btrim(p_title), '') IS NULL THEN
    RAISE EXCEPTION 'Meeting name is required' USING ERRCODE='22023';
  END IF;
  IF p_end_time IS NOT NULL AND p_start_time IS NOT NULL AND p_end_time < p_start_time THEN
    RAISE EXCEPTION 'End time precedes start time' USING ERRCODE='22023';
  END IF;
  IF p_participant_actor_ids IS NULL OR cardinality(p_participant_actor_ids)>100 THEN
    RAISE EXCEPTION 'Invalid participant list' USING ERRCODE='22023';
  END IF;

  SELECT i.id INTO v_actor_id FROM public.room_actor_identities i
    WHERE i.room_id::text=p_room_id AND i.auth_user_id=auth.uid();
  INSERT INTO public.room_meetings(room_id,source_type,title,meeting_date,start_time,end_time,is_all_day,location,location_address,lifecycle_status,attendance_status,created_by_identity_id)
    VALUES (v_room_id,'lightning',NULLIF(btrim(p_title),''),p_meeting_date,p_start_time,p_end_time,
      p_start_time IS NULL,p_location,p_location_address,'unknown','unknown',v_actor_id)
    RETURNING id INTO v_meeting_id;

  FOREACH v_selected_user_id IN ARRAY COALESCE(p_participant_actor_ids,'{}'::uuid[]) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.room_members rm
      WHERE rm.roomid::text=p_room_id AND rm.userid=v_selected_user_id
    ) THEN
      RAISE EXCEPTION 'Selected participant is not an active room member' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.room_actor_identities(room_id,auth_user_id,actor_kind)
      VALUES (v_room_id,v_selected_user_id,'member')
      ON CONFLICT (room_id,auth_user_id) WHERE auth_user_id IS NOT NULL DO NOTHING;
    SELECT i.id INTO v_participant_identity_id FROM public.room_actor_identities i
      WHERE i.room_id=v_room_id AND i.auth_user_id=v_selected_user_id;
    INSERT INTO public.meeting_participants(meeting_id,actor_identity_id,attendance_status,source)
      VALUES(v_meeting_id,v_participant_identity_id,'unknown','manual')
      ON CONFLICT(meeting_id,actor_identity_id) DO NOTHING;
  END LOOP;

  INSERT INTO public.meeting_participants(meeting_id,actor_identity_id,attendance_status,source)
    VALUES(v_meeting_id,v_actor_id,'unknown','manual')
    ON CONFLICT(meeting_id,actor_identity_id) DO NOTHING;
  RETURN v_meeting_id;
END
$function$;
REVOKE ALL ON FUNCTION public.create_room_lightning_meeting(text,date,text,time,time,text,text,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_room_lightning_meeting(text,date,text,time,time,text,text,uuid[]) TO authenticated;
