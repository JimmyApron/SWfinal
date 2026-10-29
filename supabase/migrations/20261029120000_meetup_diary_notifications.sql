-- Adds server-dispatched in-app notifications for room diaries.
-- This migration is intentionally forward-only; previously applied migrations are untouched.

ALTER TABLE public.diary_notification_outbox
  DROP CONSTRAINT IF EXISTS diary_notification_outbox_event_type_check,
  ALTER COLUMN diary_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS meeting_id uuid REFERENCES public.room_meetings(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS recipient_user_ids uuid[],
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

ALTER TABLE public.diary_notification_outbox
  ADD CONSTRAINT diary_notification_outbox_event_type_check
  CHECK (event_type IN ('diary_first_published','diary_reaction','diary_lightning_created','diary_all_complete'));
ALTER TABLE public.diary_notification_outbox
  DROP CONSTRAINT IF EXISTS diary_notification_outbox_diary_id_fkey,
  ADD CONSTRAINT diary_notification_outbox_diary_id_fkey
    FOREIGN KEY(diary_id) REFERENCES public.meeting_diaries(id) ON DELETE SET NULL;

ALTER TABLE public.room_diary_notification_settings
  ADD COLUMN IF NOT EXISTS lightning_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS all_complete_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.room_meetings
  ADD COLUMN IF NOT EXISTS creation_request_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS room_meetings_creator_request_uidx
  ON public.room_meetings(created_by_identity_id,creation_request_id)
  WHERE creation_request_id IS NOT NULL;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_idempotency_key_uidx
  ON public.notifications(idempotency_key);

ALTER TABLE public.diary_reminder_deliveries
  ALTER COLUMN recipient_actor_identity_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS recipient_user_id uuid,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE public.diary_reminder_deliveries
  DROP CONSTRAINT IF EXISTS diary_reminder_deliveries_meeting_id_recipient_actor_identity_id_key;
ALTER TABLE public.diary_reminder_deliveries
  DROP CONSTRAINT IF EXISTS diary_reminder_deliveries_status_check,
  ADD CONSTRAINT diary_reminder_deliveries_status_check CHECK(status IN ('queued','sent','failed','skipped'));
ALTER TABLE public.diary_reminder_deliveries
  DROP CONSTRAINT IF EXISTS diary_reminder_deliveries_meeting_id_fkey,
  ADD CONSTRAINT diary_reminder_deliveries_meeting_id_fkey
    FOREIGN KEY(meeting_id) REFERENCES public.room_meetings(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS diary_reminder_deliveries_recipient_user_uidx
  ON public.diary_reminder_deliveries(meeting_id,recipient_user_id) WHERE recipient_user_id IS NOT NULL;

-- Preserve the logged-in member cohort at meeting creation for completion counts.
-- Existing meetings are deliberately left without fabricated historical snapshots.
CREATE TABLE IF NOT EXISTS public.room_meeting_diary_targets (
  meeting_id uuid NOT NULL REFERENCES public.room_meetings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(meeting_id,user_id)
);
ALTER TABLE public.room_meeting_diary_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.room_meeting_diary_targets FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON public.room_meeting_diary_targets TO service_role;

CREATE TABLE IF NOT EXISTS public.diary_reaction_notification_ledger (
  diary_id uuid NOT NULL REFERENCES public.meeting_diaries(id) ON DELETE CASCADE,
  actor_identity_id uuid NOT NULL REFERENCES public.room_actor_identities(id) ON DELETE CASCADE,
  notified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(diary_id,actor_identity_id)
);
ALTER TABLE public.diary_reaction_notification_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.diary_reaction_notification_ledger FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.diary_reaction_notification_ledger TO service_role;

CREATE OR REPLACE FUNCTION meetup_private.snapshot_room_meeting_diary_targets()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.room_meeting_diary_targets(meeting_id,user_id)
  SELECT NEW.id,rm.userid FROM public.room_members rm
  WHERE rm.roomid=NEW.room_id AND rm.userid IS NOT NULL
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS meetup_snapshot_meeting_diary_targets ON public.room_meetings;
CREATE TRIGGER meetup_snapshot_meeting_diary_targets
AFTER INSERT ON public.room_meetings
FOR EACH ROW EXECUTE FUNCTION meetup_private.snapshot_room_meeting_diary_targets();

CREATE OR REPLACE FUNCTION meetup_private.enqueue_diary_notification_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_room_id bigint;
  v_member_ids uuid[];
  v_member_count integer;
  v_published_count integer;
  v_has_snapshot boolean;
  v_newly_public boolean;
BEGIN
  IF NEW.status <> 'published' THEN RETURN NEW; END IF;

  v_newly_public := NEW.visibility='room' AND (TG_OP = 'INSERT'
    OR OLD.status IS DISTINCT FROM 'published'
    OR OLD.visibility IS DISTINCT FROM 'room');

  SELECT m.room_id INTO v_room_id
  FROM public.room_meetings m WHERE m.id=NEW.meeting_id;
  IF v_room_id IS NULL THEN RETURN NEW; END IF;

  -- Serialize concurrent first publications for this meeting before counting.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.meeting_id::text,0));

  SELECT EXISTS(SELECT 1 FROM public.room_meeting_diary_targets t WHERE t.meeting_id=NEW.meeting_id)
    INTO v_has_snapshot;
  IF v_has_snapshot THEN
    SELECT COALESCE(array_agg(t.user_id),ARRAY[]::uuid[]),count(*)
      INTO v_member_ids,v_member_count
    FROM public.room_meeting_diary_targets t WHERE t.meeting_id=NEW.meeting_id;
  ELSIF v_newly_public THEN
    SELECT COALESCE(array_agg(DISTINCT rm.userid), ARRAY[]::uuid[]), count(DISTINCT rm.userid)
      INTO v_member_ids,v_member_count
    FROM public.room_members rm
    WHERE rm.roomid=v_room_id AND rm.userid IS NOT NULL;
  END IF;

  SELECT count(DISTINCT d.author_identity_id)::integer INTO v_published_count
  FROM public.meeting_diaries d
  JOIN public.room_actor_identities i ON i.id=d.author_identity_id
  WHERE d.meeting_id=NEW.meeting_id AND d.status='published'
    AND i.auth_user_id=ANY(v_member_ids);

  IF v_member_count > 0 AND v_published_count >= v_member_count THEN
    INSERT INTO public.diary_notification_outbox(
      event_key,event_type,diary_id,meeting_id,actor_identity_id,recipient_user_ids
    ) VALUES (
      'diary_all_complete:'||NEW.meeting_id::text,'diary_all_complete',NEW.id,NEW.meeting_id,
      NEW.author_identity_id,v_member_ids
    ) ON CONFLICT(event_key) DO NOTHING;
  ELSE
    INSERT INTO public.diary_notification_outbox(
      event_key,event_type,diary_id,meeting_id,actor_identity_id,recipient_user_ids
    ) VALUES (
      'diary_room_published:'||NEW.id::text,'diary_first_published',NEW.id,NEW.meeting_id,
      NEW.author_identity_id,ARRAY(SELECT unnest(v_member_ids) EXCEPT SELECT i.auth_user_id
        FROM public.room_actor_identities i WHERE i.id=NEW.author_identity_id AND i.auth_user_id IS NOT NULL)
    ) ON CONFLICT(event_key) DO NOTHING;
  END IF;
  RETURN NEW;
END
$function$;

-- Keep the existing notifications table contract intact, while preventing a
-- browser session from forging the new server-owned diary notification types.
CREATE OR REPLACE FUNCTION meetup_private.guard_diary_notification_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $function$
DECLARE v_role text := COALESCE(
  nullif(current_setting('request.jwt.claim.role',true),''),
  nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'
);
BEGIN
  IF NEW.type IN ('diary_reminder','diary_published','diary_reaction','diary_lightning','diary_all_complete')
     AND (v_role IN ('anon','authenticated') OR current_user IN ('anon','authenticated')) THEN
    RAISE EXCEPTION 'Diary notifications are server generated' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS guard_server_generated_diary_notifications ON public.notifications;
CREATE TRIGGER guard_server_generated_diary_notifications
BEFORE INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION meetup_private.guard_diary_notification_insert();

DROP TRIGGER IF EXISTS meetup_diary_notification_events ON public.meeting_diaries;
CREATE TRIGGER meetup_diary_notification_events
AFTER INSERT OR UPDATE OF status,visibility ON public.meeting_diaries
FOR EACH ROW EXECUTE FUNCTION meetup_private.enqueue_diary_notification_events();

CREATE OR REPLACE FUNCTION meetup_private.enqueue_lightning_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_member_ids uuid[];
BEGIN
  IF NEW.source_type <> 'lightning' OR NEW.lifecycle_status='cancelled' THEN RETURN NEW; END IF;
  SELECT COALESCE(array_agg(DISTINCT rm.userid),ARRAY[]::uuid[]) INTO v_member_ids
  FROM public.room_members rm WHERE rm.roomid=NEW.room_id AND rm.userid IS NOT NULL;
  INSERT INTO public.diary_notification_outbox(
    event_key,event_type,meeting_id,actor_identity_id,recipient_user_ids
  ) VALUES (
    'diary_lightning:'||NEW.id::text,'diary_lightning_created',NEW.id,
    NEW.created_by_identity_id,
    ARRAY(SELECT unnest(v_member_ids) EXCEPT SELECT i.auth_user_id
      FROM public.room_actor_identities i WHERE i.id=NEW.created_by_identity_id AND i.auth_user_id IS NOT NULL)
  ) ON CONFLICT(event_key) DO NOTHING;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS meetup_lightning_notification_outbox ON public.room_meetings;
CREATE TRIGGER meetup_lightning_notification_outbox
AFTER INSERT ON public.room_meetings
FOR EACH ROW EXECUTE FUNCTION meetup_private.enqueue_lightning_notification();

-- Idempotent lightning creation: a client reusing its request UUID receives the
-- original meeting ID, so a network retry cannot create another calendar entry.
CREATE OR REPLACE FUNCTION public.create_room_lightning_meeting(
  p_room_id text,p_meeting_date date,p_title text,p_start_time time,p_end_time time,
  p_location text,p_location_address text,p_participant_actor_ids uuid[],p_request_id uuid
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
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Request id is required' USING ERRCODE='22023'; END IF;
  SELECT r.id INTO v_room_id FROM public.rooms r WHERE r.id::text=p_room_id;
  IF v_room_id IS NULL OR NOT meetup_private.is_active_room_actor(p_room_id) THEN
    RAISE EXCEPTION 'Room is unavailable to this actor' USING ERRCODE='42501';
  END IF;
  IF p_meeting_date IS NULL OR p_meeting_date>(now() AT TIME ZONE 'Asia/Seoul')::date
     OR NULLIF(btrim(p_title),'') IS NULL OR cardinality(COALESCE(p_participant_actor_ids,'{}'::uuid[]))>100
     OR (p_end_time IS NOT NULL AND p_start_time IS NOT NULL AND p_end_time<p_start_time) THEN
    RAISE EXCEPTION 'Invalid lightning meeting fields' USING ERRCODE='22023';
  END IF;
  SELECT i.id INTO v_actor_id FROM public.room_actor_identities i
    WHERE i.room_id=v_room_id AND i.auth_user_id=auth.uid() AND i.actor_kind='member';
  SELECT m.id INTO v_meeting_id FROM public.room_meetings m
    WHERE m.created_by_identity_id=v_actor_id AND m.creation_request_id=p_request_id;
  IF v_meeting_id IS NOT NULL THEN RETURN v_meeting_id; END IF;

  INSERT INTO public.room_meetings(room_id,source_type,title,meeting_date,start_time,end_time,is_all_day,
    location,location_address,lifecycle_status,attendance_status,created_by_identity_id,creation_request_id)
  VALUES(v_room_id,'lightning',btrim(p_title),p_meeting_date,p_start_time,p_end_time,p_start_time IS NULL,
    p_location,p_location_address,'unknown','unknown',v_actor_id,p_request_id)
  ON CONFLICT(created_by_identity_id,creation_request_id) WHERE creation_request_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_meeting_id;
  IF v_meeting_id IS NULL THEN
    SELECT m.id INTO v_meeting_id FROM public.room_meetings m
      WHERE m.created_by_identity_id=v_actor_id AND m.creation_request_id=p_request_id;
    RETURN v_meeting_id;
  END IF;

  FOREACH v_selected_user_id IN ARRAY COALESCE(p_participant_actor_ids,'{}'::uuid[]) LOOP
    IF NOT EXISTS(SELECT 1 FROM public.room_members rm WHERE rm.roomid=v_room_id AND rm.userid=v_selected_user_id) THEN
      RAISE EXCEPTION 'Selected participant is not an active room member' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.room_actor_identities(room_id,auth_user_id,actor_kind)
      VALUES(v_room_id,v_selected_user_id,'member')
      ON CONFLICT(room_id,auth_user_id) WHERE auth_user_id IS NOT NULL DO NOTHING;
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
REVOKE ALL ON FUNCTION public.create_room_lightning_meeting(text,date,text,time,time,text,text,uuid[],uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_room_lightning_meeting(text,date,text,time,time,text,text,uuid[],uuid) TO authenticated;

CREATE OR REPLACE FUNCTION meetup_private.enqueue_diary_reaction_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_diary public.meeting_diaries%ROWTYPE; v_author_id uuid; v_room_id bigint;
BEGIN
  SELECT d.* INTO v_diary FROM public.meeting_diaries d WHERE d.id=NEW.diary_id;
  IF NOT FOUND OR v_diary.status<>'published' OR v_diary.visibility<>'room' THEN RETURN NEW; END IF;
  SELECT i.auth_user_id INTO v_author_id
  FROM public.room_actor_identities i WHERE i.id=v_diary.author_identity_id;
  IF v_author_id IS NULL OR v_author_id=(SELECT i.auth_user_id FROM public.room_actor_identities i WHERE i.id=NEW.actor_identity_id) THEN
    RETURN NEW;
  END IF;
  SELECT m.room_id INTO v_room_id FROM public.room_meetings m WHERE m.id=v_diary.meeting_id;
  IF NOT EXISTS (SELECT 1 FROM public.room_members rm WHERE rm.roomid=v_room_id AND rm.userid=v_author_id) THEN RETURN NEW; END IF;
  INSERT INTO public.diary_notification_outbox(
    event_key,event_type,diary_id,meeting_id,actor_identity_id,recipient_user_ids
  ) VALUES (
    'diary_reaction:'||NEW.id::text,'diary_reaction',NEW.diary_id,v_diary.meeting_id,
    NEW.actor_identity_id,ARRAY[v_author_id]
  ) ON CONFLICT(event_key) DO NOTHING;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS meetup_diary_reaction_outbox ON public.diary_reactions;
CREATE TRIGGER meetup_diary_reaction_outbox AFTER INSERT ON public.diary_reactions
FOR EACH ROW EXECUTE FUNCTION meetup_private.enqueue_diary_reaction_notification();

CREATE OR REPLACE FUNCTION public.claim_diary_notification_outbox(p_limit integer DEFAULT 50)
RETURNS SETOF public.diary_notification_outbox
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH candidates AS (
    SELECT o.id FROM public.diary_notification_outbox o
    WHERE o.processed_at IS NULL AND (o.claimed_at IS NULL OR o.claimed_at < now()-interval '2 minutes')
    ORDER BY o.created_at FOR UPDATE SKIP LOCKED LIMIT greatest(1,least(COALESCE(p_limit,50),200))
  ), claimed AS (
    UPDATE public.diary_notification_outbox o
    SET claimed_at=now(),attempts=o.attempts+1
    FROM candidates c WHERE o.id=c.id RETURNING o.*
  ) SELECT * FROM claimed;
$function$;
REVOKE ALL ON FUNCTION public.claim_diary_notification_outbox(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_diary_notification_outbox(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.deliver_diary_reminder(p_meeting_id uuid,p_recipient_user_id uuid)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_meeting public.room_meetings%ROWTYPE;
  v_room_name text;
  v_actor_id uuid;
  v_setting_enabled boolean;
  v_first_reaction_notice boolean;
  v_delivery_key text := 'diary_reminder:'||p_meeting_id::text||':'||p_recipient_user_id::text;
  v_role text := COALESCE(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role');
BEGIN
  IF v_role IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Server role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_meeting FROM public.room_meetings m WHERE m.id=p_meeting_id FOR SHARE;
  IF NOT FOUND OR v_meeting.lifecycle_status='cancelled'
     OR NOT EXISTS (SELECT 1 FROM public.room_members rm WHERE rm.roomid=v_meeting.room_id AND rm.userid=p_recipient_user_id) THEN
    UPDATE public.diary_reminder_deliveries SET status='skipped',claimed_at=NULL
      WHERE idempotency_key=v_delivery_key AND status='queued';
    RETURN 'skipped';
  END IF;

  SELECT i.id INTO v_actor_id FROM public.room_actor_identities i
    WHERE i.room_id=v_meeting.room_id AND i.auth_user_id=p_recipient_user_id LIMIT 1;
  SELECT s.reminders_enabled INTO v_setting_enabled
    FROM public.room_diary_notification_settings s
    WHERE s.room_id=v_meeting.room_id AND s.actor_identity_id=v_actor_id
    FOR SHARE OF s;
  IF v_setting_enabled IS FALSE OR EXISTS (
    SELECT 1 FROM public.meeting_diaries d JOIN public.room_actor_identities i ON i.id=d.author_identity_id
    WHERE d.meeting_id=p_meeting_id AND d.status='published' AND i.auth_user_id=p_recipient_user_id
  ) THEN
    UPDATE public.diary_reminder_deliveries SET status='skipped',claimed_at=NULL
      WHERE idempotency_key=v_delivery_key AND status='queued';
    RETURN 'skipped';
  END IF;

  SELECT r.roomname INTO v_room_name FROM public.rooms r WHERE r.id=v_meeting.room_id;
  INSERT INTO public.notifications(
    roomid,receiverid,senderid,type,title,message,link,isread,issilent,idempotency_key
  ) VALUES (
    v_meeting.room_id,p_recipient_user_id::text,NULL,'diary_reminder',
    '오늘의 만남은 어떠셨나요?',
    '['||COALESCE(v_room_name,'MeetUP')||'] 하루의 기록을 남겨보세요.',
    '/rooms/'||v_meeting.room_id::text||'/meetings/'||p_meeting_id::text||'/diary/edit',
    false,false,v_delivery_key
  ) ON CONFLICT(idempotency_key) DO NOTHING;
  UPDATE public.diary_reminder_deliveries SET status='sent',sent_at=COALESCE(sent_at,now()),claimed_at=NULL,last_error=NULL
    WHERE idempotency_key=v_delivery_key AND status='queued';
  RETURN 'sent';
END
$function$;
REVOKE ALL ON FUNCTION public.deliver_diary_reminder(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.deliver_diary_reminder(uuid,uuid) TO service_role;

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
      SELECT r.emoji INTO v_emoji FROM public.diary_reactions r WHERE r.id=substring(v_event.event_key from length('diary_reaction:')+1);
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

GRANT SELECT,INSERT,UPDATE ON public.diary_notification_outbox,public.diary_reminder_deliveries TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.notifications TO service_role;

NOTIFY pgrst, 'reload schema';

