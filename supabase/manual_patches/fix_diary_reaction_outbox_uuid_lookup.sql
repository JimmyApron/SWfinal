-- Run in the SWfinal project's SQL Editor after the diary notification migration.
-- Replaces only the outbox delivery function; queued events remain available for retry.
BEGIN;

CREATE OR REPLACE FUNCTION public.deliver_diary_outbox_notification(p_outbox_id uuid,p_recipient_user_id uuid)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_event public.diary_notification_outbox%ROWTYPE;
  v_meeting public.room_meetings%ROWTYPE;
  v_diary public.meeting_diaries%ROWTYPE;
  v_actor_user_id uuid;
  v_actor_name text;
  v_room_name text;
  v_type text;
  v_title text;
  v_message text;
  v_link text;
  v_setting text;
  v_targets uuid[];
  v_target_count integer;
  v_done_count integer;
  v_emoji text;
  v_idempotency_key text;
  v_setting_enabled boolean;
  v_first_reaction_notice boolean;
  v_role text := COALESCE(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role');
BEGIN
  IF v_role IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Server role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_event FROM public.diary_notification_outbox o WHERE o.id=p_outbox_id FOR SHARE;
  IF NOT FOUND OR v_event.processed_at IS NOT NULL THEN RETURN 'skipped'; END IF;
  SELECT * INTO v_meeting FROM public.room_meetings m
    WHERE m.id=COALESCE(v_event.meeting_id,(SELECT d.meeting_id FROM public.meeting_diaries d WHERE d.id=v_event.diary_id)) FOR SHARE;
  IF NOT FOUND OR v_meeting.lifecycle_status='cancelled'
     OR NOT EXISTS (SELECT 1 FROM public.room_members rm WHERE rm.roomid=v_meeting.room_id AND rm.userid=p_recipient_user_id) THEN
    RETURN 'skipped';
  END IF;
  IF v_event.diary_id IS NOT NULL THEN
    SELECT * INTO v_diary FROM public.meeting_diaries d WHERE d.id=v_event.diary_id;
    IF NOT FOUND THEN RETURN 'skipped'; END IF;
  END IF;
  IF v_event.event_type IN ('diary_first_published','diary_reaction') AND v_diary.id IS NULL THEN RETURN 'skipped'; END IF;
  SELECT i.auth_user_id INTO v_actor_user_id FROM public.room_actor_identities i
    WHERE i.id=v_event.actor_identity_id;
  SELECT COALESCE(m.nickname,p.nickname,'방 멤버') INTO v_actor_name
    FROM public.room_members m LEFT JOIN public.profiles p ON p.id=m.userid
    WHERE m.roomid=v_meeting.room_id AND m.userid=v_actor_user_id LIMIT 1;
  SELECT COALESCE(r.roomname,'MeetUP') INTO v_room_name FROM public.rooms r WHERE r.id=v_meeting.room_id;

  CASE v_event.event_type
    WHEN 'diary_first_published' THEN
      IF v_diary.status<>'published' OR v_diary.visibility<>'room'
         OR EXISTS(SELECT 1 FROM public.diary_notification_outbox c WHERE c.event_key='diary_all_complete:'||v_meeting.id::text)
         OR p_recipient_user_id=v_actor_user_id THEN RETURN 'skipped'; END IF;
      v_type:='diary_published'; v_setting:='published_diary_enabled';
      v_title:=COALESCE(v_actor_name,'방 멤버')||'님이 새로운 기록을 남겼어요';
      v_message:=COALESCE(v_meeting.title,'만남')||'에서의 하루를 확인해 보세요.';
      v_link:='/rooms/'||v_meeting.room_id::text||'/meetings/'||v_meeting.id::text||'/diary?author='||v_actor_user_id::text;
      v_idempotency_key:='diary:published:'||v_diary.id::text||':'||p_recipient_user_id::text;
    WHEN 'diary_reaction' THEN
      IF v_diary.status<>'published' OR v_diary.visibility<>'room'
         OR p_recipient_user_id<>(SELECT i.auth_user_id FROM public.room_actor_identities i WHERE i.id=v_diary.author_identity_id)
         OR p_recipient_user_id=v_actor_user_id THEN RETURN 'skipped'; END IF;
      SELECT r.emoji INTO v_emoji FROM public.diary_reactions r WHERE r.id=substring(v_event.event_key from length('diary_reaction:')+1)::uuid;
      IF v_emoji IS NULL THEN RETURN 'skipped'; END IF;
      v_type:='diary_reaction'; v_setting:='reaction_enabled';
      v_title:=COALESCE(v_actor_name,'방 멤버')||'님이 내 기록에 '||v_emoji||'를 남겼어요';
      v_message:=COALESCE(v_meeting.title,'만남')||' · 나의 하루';
      v_link:='/rooms/'||v_meeting.room_id::text||'/meetings/'||v_meeting.id::text||'/diary?author='||p_recipient_user_id::text;
      v_idempotency_key:='diary:reaction:'||substring(v_event.event_key from length('diary_reaction:')+1)||':'||p_recipient_user_id::text;
    WHEN 'diary_lightning_created' THEN
      IF v_meeting.source_type<>'lightning' OR p_recipient_user_id=v_actor_user_id THEN RETURN 'skipped'; END IF;
      v_type:='diary_lightning'; v_setting:='lightning_enabled';
      v_title:='⚡ '||COALESCE(v_actor_name,'방 멤버')||'님이 번개 만남을 등록했어요';
      v_message:=v_meeting.meeting_date::text||' · '||COALESCE(v_meeting.title,'번개 만남');
      v_link:='/rooms/'||v_meeting.room_id::text||'?tab=calendar&date='||v_meeting.meeting_date::text||'&meetingId='||v_meeting.id::text;
      v_idempotency_key:='diary:lightning:'||v_meeting.id::text||':'||p_recipient_user_id::text;
    WHEN 'diary_all_complete' THEN
      IF EXISTS(SELECT 1 FROM public.room_meeting_diary_targets t WHERE t.meeting_id=v_meeting.id) THEN
        SELECT array_agg(t.user_id),count(*) INTO v_targets,v_target_count
          FROM public.room_meeting_diary_targets t WHERE t.meeting_id=v_meeting.id;
      ELSE
        SELECT array_agg(DISTINCT rm.userid),count(DISTINCT rm.userid) INTO v_targets,v_target_count
          FROM public.room_members rm WHERE rm.roomid=v_meeting.room_id AND rm.userid IS NOT NULL;
      END IF;
      SELECT count(DISTINCT i.auth_user_id)::integer INTO v_done_count
        FROM public.meeting_diaries d JOIN public.room_actor_identities i ON i.id=d.author_identity_id
        WHERE d.meeting_id=v_meeting.id AND d.status='published' AND i.auth_user_id=ANY(COALESCE(v_targets,ARRAY[]::uuid[]));
      IF COALESCE(v_target_count,0)=0 OR v_done_count<>v_target_count OR NOT (p_recipient_user_id=ANY(COALESCE(v_targets,ARRAY[]::uuid[]))) THEN RETURN 'skipped'; END IF;
      v_type:='diary_all_complete'; v_setting:='all_complete_enabled';
      v_title:='모두 기록을 남겼어요! 🎉';
      v_message:=COALESCE(v_meeting.title,'만남')||'의 기록 작성이 완료됐어요.';
      v_link:='/rooms/'||v_meeting.room_id::text||'/meetings/'||v_meeting.id::text||'/diary';
      v_idempotency_key:='diary:complete:'||v_meeting.id::text||':'||p_recipient_user_id::text;
    ELSE RETURN 'skipped';
  END CASE;

  SELECT CASE v_setting
      WHEN 'published_diary_enabled' THEN s.published_diary_enabled
      WHEN 'reaction_enabled' THEN s.reaction_enabled
      WHEN 'lightning_enabled' THEN s.lightning_enabled
      WHEN 'all_complete_enabled' THEN s.all_complete_enabled
      ELSE true END
    INTO v_setting_enabled
  FROM public.room_diary_notification_settings s
  JOIN public.room_actor_identities i ON i.id=s.actor_identity_id
  WHERE s.room_id=v_meeting.room_id AND i.auth_user_id=p_recipient_user_id
  FOR SHARE OF s;
  IF v_setting_enabled IS FALSE THEN RETURN 'skipped'; END IF;

  IF v_event.event_type='diary_reaction' THEN
    INSERT INTO public.diary_reaction_notification_ledger(diary_id,actor_identity_id)
      VALUES(v_diary.id,v_event.actor_identity_id)
      ON CONFLICT(diary_id,actor_identity_id) DO NOTHING
      RETURNING true INTO v_first_reaction_notice;
    IF NOT COALESCE(v_first_reaction_notice,false) THEN RETURN 'skipped'; END IF;
  END IF;

  INSERT INTO public.notifications(roomid,receiverid,senderid,type,title,message,link,isread,issilent,idempotency_key)
    VALUES(v_meeting.room_id,p_recipient_user_id::text,v_actor_user_id::text,v_type,v_title,
      '['||v_room_name||'] '||v_message,v_link,false,false,v_idempotency_key)
    ON CONFLICT(idempotency_key) DO NOTHING;
  RETURN 'sent';
END
$function$;
REVOKE ALL ON FUNCTION public.deliver_diary_outbox_notification(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.deliver_diary_outbox_notification(uuid,uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
