-- MeetUP room calendar and diary foundation.
-- REVIEW ONLY: this file has not been applied to any Supabase project.
-- Preconditions are deliberately checked because live legacy column types and
-- the OAuth profile trigger could not be verified from this environment.
BEGIN;

DO $preflight$
DECLARE
  required_columns text[][] := ARRAY[
    ARRAY['public','rooms','id'],
    ARRAY['public','room_members','roomid'],
    ARRAY['public','room_members','userid'],
    ARRAY['public','room_guests','id'],
    ARRAY['public','room_guests','roomid'],
    ARRAY['public','confirmed_schedules','id'],
    ARRAY['public','confirmed_schedules','roomid'],
    ARRAY['public','confirmed_schedules','date'],
    ARRAY['public','confirmed_schedules','title'],
    ARRAY['public','confirmed_schedules','starttime'],
    ARRAY['public','confirmed_schedules','endtime'],
    ARRAY['public','confirmed_schedules','isallday'],
    ARRAY['public','confirmed_schedules','location'],
    ARRAY['public','confirmed_schedules','locationaddress']
  ];
  item text[];
  room_id_type text;
  related_room_id_type text;
  allday_type text;
BEGIN
  FOREACH item SLICE 1 IN ARRAY required_columns LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = item[1]
        AND c.table_name = item[2]
        AND c.column_name = item[3]
    ) THEN
      RAISE EXCEPTION 'MeetUP diary migration preflight failed: missing %.%.%', item[1], item[2], item[3];
    END IF;
  END LOOP;
  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'MeetUP diary migration requires auth.users';
  END IF;
  SELECT format_type(a.atttypid,a.atttypmod) INTO room_id_type
    FROM pg_attribute a WHERE a.attrelid='public.rooms'::regclass AND a.attname='id' AND NOT a.attisdropped;
  FOREACH item SLICE 1 IN ARRAY ARRAY[
    ARRAY['public','room_members','roomid'],
    ARRAY['public','room_guests','roomid'],
    ARRAY['public','confirmed_schedules','roomid']
  ] LOOP
    SELECT format_type(a.atttypid,a.atttypmod) INTO related_room_id_type
      FROM pg_attribute a WHERE a.attrelid=format('%I.%I',item[1],item[2])::regclass
        AND a.attname=item[3] AND NOT a.attisdropped;
    IF related_room_id_type IS DISTINCT FROM room_id_type THEN
      RAISE EXCEPTION 'MeetUP diary migration preflight failed: %.%.% type (%) differs from rooms.id (%)',
        item[1],item[2],item[3],related_room_id_type,room_id_type;
    END IF;
  END LOOP;
  SELECT format_type(a.atttypid,a.atttypmod) INTO allday_type
    FROM pg_attribute a WHERE a.attrelid='public.confirmed_schedules'::regclass AND a.attname='isallday' AND NOT a.attisdropped;
  IF allday_type NOT IN ('boolean') THEN
    RAISE EXCEPTION 'MeetUP diary migration preflight failed: confirmed_schedules.isallday must be boolean, got %',allday_type;
  END IF;
END
$preflight$;

CREATE SCHEMA IF NOT EXISTS meetup_private;
REVOKE ALL ON SCHEMA meetup_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA meetup_private TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.room_actor_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id bigint,
  auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('member', 'guest')),
  -- Text is intentional: the legacy guest key's actual SQL type was not
  -- available for verification. It is not trusted as authentication proof.
  legacy_guest_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (actor_kind = 'member' AND legacy_guest_id IS NULL)
    OR (actor_kind = 'guest' AND legacy_guest_id IS NOT NULL)
  )
);

DO $room_fk$
DECLARE room_type text; current_type text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod) INTO room_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.rooms'::regclass AND a.attname = 'id' AND NOT a.attisdropped;
  IF room_type IS NULL THEN RAISE EXCEPTION 'Cannot determine public.rooms.id type'; END IF;
  SELECT format_type(a.atttypid,a.atttypmod) INTO current_type FROM pg_attribute a
    WHERE a.attrelid='public.room_actor_identities'::regclass AND a.attname='room_id' AND NOT a.attisdropped;
  IF current_type IS DISTINCT FROM room_type THEN
    EXECUTE format('ALTER TABLE public.room_actor_identities ALTER COLUMN room_id TYPE %s USING room_id::%s', room_type, room_type);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.room_actor_identities'::regclass AND conname='room_actor_identities_room_id_fkey') THEN
    ALTER TABLE public.room_actor_identities ADD CONSTRAINT room_actor_identities_room_id_fkey
      FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE SET NULL;
  END IF;
END
$room_fk$;

CREATE UNIQUE INDEX IF NOT EXISTS room_actor_identities_room_auth_uidx
  ON public.room_actor_identities(room_id, auth_user_id) WHERE auth_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS room_actor_identities_room_guest_uidx
  ON public.room_actor_identities(room_id, legacy_guest_id) WHERE legacy_guest_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS room_actor_identities_auth_user_idx
  ON public.room_actor_identities(auth_user_id);

CREATE TABLE IF NOT EXISTS public.room_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id bigint,
  source_type text NOT NULL CHECK (source_type IN ('confirmed_schedule', 'lightning')),
  source_schedule_id bigint,
  title text,
  meeting_date date NOT NULL,
  start_time time,
  end_time time,
  is_all_day boolean NOT NULL DEFAULT false,
  location text,
  location_address text,
  lifecycle_status text NOT NULL DEFAULT 'scheduled'
    CHECK (lifecycle_status IN ('scheduled', 'cancelled', 'unknown')),
  attendance_status text NOT NULL DEFAULT 'unknown'
    CHECK (attendance_status IN ('unknown', 'confirmed')),
  created_by_identity_id uuid REFERENCES public.room_actor_identities(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((source_type = 'confirmed_schedule')
      OR (source_type = 'lightning' AND source_schedule_id IS NULL))
);

DO $meeting_fks$
DECLARE room_type text; schedule_type text; current_room_type text; current_schedule_type text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod) INTO room_type
  FROM pg_attribute a WHERE a.attrelid='public.rooms'::regclass AND a.attname='id' AND NOT a.attisdropped;
  SELECT format_type(a.atttypid, a.atttypmod) INTO schedule_type
  FROM pg_attribute a WHERE a.attrelid='public.confirmed_schedules'::regclass AND a.attname='id' AND NOT a.attisdropped;
  SELECT format_type(a.atttypid,a.atttypmod) INTO current_room_type FROM pg_attribute a
    WHERE a.attrelid='public.room_meetings'::regclass AND a.attname='room_id' AND NOT a.attisdropped;
  SELECT format_type(a.atttypid,a.atttypmod) INTO current_schedule_type FROM pg_attribute a
    WHERE a.attrelid='public.room_meetings'::regclass AND a.attname='source_schedule_id' AND NOT a.attisdropped;
  IF current_room_type IS DISTINCT FROM room_type THEN
    EXECUTE format('ALTER TABLE public.room_meetings ALTER COLUMN room_id TYPE %s USING room_id::%s', room_type, room_type);
  END IF;
  IF current_schedule_type IS DISTINCT FROM schedule_type THEN
    EXECUTE format('ALTER TABLE public.room_meetings ALTER COLUMN source_schedule_id TYPE %s USING source_schedule_id::%s', schedule_type, schedule_type);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.room_meetings'::regclass AND conname='room_meetings_room_id_fkey') THEN
    ALTER TABLE public.room_meetings ADD CONSTRAINT room_meetings_room_id_fkey
      FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.room_meetings'::regclass AND conname='room_meetings_source_schedule_id_fkey') THEN
    ALTER TABLE public.room_meetings ADD CONSTRAINT room_meetings_source_schedule_id_fkey
      FOREIGN KEY (source_schedule_id) REFERENCES public.confirmed_schedules(id) ON DELETE SET NULL;
  END IF;
END
$meeting_fks$;

CREATE UNIQUE INDEX IF NOT EXISTS room_meetings_schedule_uidx
  ON public.room_meetings(source_schedule_id) WHERE source_schedule_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS room_meetings_room_date_idx
  ON public.room_meetings(room_id, meeting_date, created_at);
CREATE INDEX IF NOT EXISTS room_meetings_date_idx ON public.room_meetings(meeting_date);

-- Additive historical backfill. Existing schedules are copied as unknown
-- attendance; no participant is marked as having attended.
INSERT INTO public.room_meetings(room_id,source_type,source_schedule_id,title,meeting_date,start_time,end_time,is_all_day,location,location_address,lifecycle_status,attendance_status)
SELECT cs.roomid,'confirmed_schedule',cs.id,cs.title,cs.date::date,cs.starttime::time,cs.endtime::time,
       COALESCE(cs.isallday,false),cs.location,cs.locationaddress,'scheduled','unknown'
FROM public.confirmed_schedules cs
WHERE cs.date IS NOT NULL
  -- confirmed_schedules.roomid has no FK to rooms in the live schema. Ignore
  -- orphaned rows for the room calendar so legacy room deletion cannot make
  -- this additive backfill fail.
  AND EXISTS (SELECT 1 FROM public.rooms r WHERE r.id=cs.roomid)
ON CONFLICT (source_schedule_id) WHERE source_schedule_id IS NOT NULL DO NOTHING;

CREATE TABLE IF NOT EXISTS public.meeting_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.room_meetings(id) ON DELETE CASCADE,
  actor_identity_id uuid NOT NULL REFERENCES public.room_actor_identities(id) ON DELETE RESTRICT,
  attendance_status text NOT NULL DEFAULT 'unknown'
    CHECK (attendance_status IN ('unknown', 'attended', 'absent', 'excused')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'legacy_unknown', 'room_snapshot')),
  confirmed_by_identity_id uuid REFERENCES public.room_actor_identities(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, actor_identity_id)
);
CREATE INDEX IF NOT EXISTS meeting_participants_actor_idx
  ON public.meeting_participants(actor_identity_id, meeting_id);

CREATE TABLE IF NOT EXISTS public.meeting_diaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.room_meetings(id) ON DELETE RESTRICT,
  author_identity_id uuid NOT NULL REFERENCES public.room_actor_identities(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  visibility text NOT NULL DEFAULT 'room' CHECK (visibility IN ('room', 'private')),
  mood_emoji text CHECK (mood_emoji IS NULL OR char_length(mood_emoji) <= 16),
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 500),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  last_write_request_id uuid,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'draft' AND published_at IS NULL) OR (status = 'published' AND published_at IS NOT NULL)),
  UNIQUE (meeting_id, author_identity_id)
);
CREATE INDEX IF NOT EXISTS meeting_diaries_meeting_status_idx
  ON public.meeting_diaries(meeting_id, status, visibility, published_at DESC);
CREATE INDEX IF NOT EXISTS meeting_diaries_author_updated_idx
  ON public.meeting_diaries(author_identity_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.diary_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  diary_id uuid NOT NULL REFERENCES public.meeting_diaries(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  sort_order smallint NOT NULL CHECK (sort_order BETWEEN 0 AND 9),
  is_cover boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (diary_id, sort_order)
);
CREATE UNIQUE INDEX IF NOT EXISTS diary_photos_one_cover_uidx
  ON public.diary_photos(diary_id) WHERE is_cover;
CREATE INDEX IF NOT EXISTS diary_photos_diary_order_idx
  ON public.diary_photos(diary_id, sort_order);

CREATE TABLE IF NOT EXISTS public.diary_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  diary_id uuid NOT NULL REFERENCES public.meeting_diaries(id) ON DELETE CASCADE,
  actor_identity_id uuid NOT NULL REFERENCES public.room_actor_identities(id) ON DELETE RESTRICT,
  emoji text NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 16),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (diary_id, actor_identity_id)
);
CREATE INDEX IF NOT EXISTS diary_reactions_diary_idx ON public.diary_reactions(diary_id, created_at);

-- Transactional outbox: private body/photo paths are intentionally excluded.
CREATE TABLE IF NOT EXISTS public.diary_notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  event_type text NOT NULL CHECK (event_type IN ('diary_first_published', 'diary_reaction')),
  diary_id uuid NOT NULL REFERENCES public.meeting_diaries(id) ON DELETE CASCADE,
  actor_identity_id uuid NOT NULL REFERENCES public.room_actor_identities(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text
);
CREATE INDEX IF NOT EXISTS diary_notification_outbox_pending_idx
  ON public.diary_notification_outbox(created_at) WHERE processed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.room_diary_notification_settings (
  room_id bigint NOT NULL,
  actor_identity_id uuid NOT NULL REFERENCES public.room_actor_identities(id) ON DELETE CASCADE,
  reminders_enabled boolean NOT NULL DEFAULT true,
  published_diary_enabled boolean NOT NULL DEFAULT true,
  reaction_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(room_id, actor_identity_id)
);
DO $settings_fk$
DECLARE room_type text; current_type text;
BEGIN
  SELECT format_type(a.atttypid,a.atttypmod) INTO room_type
  FROM pg_attribute a WHERE a.attrelid='public.rooms'::regclass AND a.attname='id' AND NOT a.attisdropped;
  SELECT format_type(a.atttypid,a.atttypmod) INTO current_type FROM pg_attribute a
    WHERE a.attrelid='public.room_diary_notification_settings'::regclass AND a.attname='room_id' AND NOT a.attisdropped;
  IF current_type IS DISTINCT FROM room_type THEN
    EXECUTE format('ALTER TABLE public.room_diary_notification_settings ALTER COLUMN room_id TYPE %s USING room_id::%s',room_type,room_type);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.room_diary_notification_settings'::regclass AND conname='room_diary_notification_settings_room_id_fkey') THEN
    ALTER TABLE public.room_diary_notification_settings ADD CONSTRAINT room_diary_notification_settings_room_id_fkey
      FOREIGN KEY(room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;
  END IF;
END
$settings_fk$;

-- Idempotency/dispatch ledger for one KST end-of-day reminder per attended
-- meeting and actor. Unknown legacy attendance is deliberately not eligible.
CREATE TABLE IF NOT EXISTS public.diary_reminder_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.room_meetings(id) ON DELETE RESTRICT,
  recipient_actor_identity_id uuid NOT NULL REFERENCES public.room_actor_identities(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sent','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  last_error text,
  UNIQUE(meeting_id,recipient_actor_identity_id)
);
CREATE INDEX IF NOT EXISTS diary_reminder_deliveries_queued_idx
  ON public.diary_reminder_deliveries(created_at) WHERE status='queued';

CREATE OR REPLACE FUNCTION meetup_private.is_active_room_actor(p_room_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.room_actor_identities i
    WHERE i.room_id::text = p_room_id
      AND i.auth_user_id = auth.uid()
      AND (
        (i.actor_kind = 'member' AND EXISTS (
          SELECT 1 FROM public.room_members m
          WHERE m.roomid::text = p_room_id AND m.userid::text = auth.uid()::text
        ))
        OR
        (i.actor_kind = 'guest' AND EXISTS (
          SELECT 1 FROM public.room_guests g
          WHERE g.roomid::text = p_room_id AND g.id::text = i.legacy_guest_id
        ))
      )
  )
$function$;

CREATE OR REPLACE FUNCTION meetup_private.can_read_diary(p_diary_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.meeting_diaries d
    JOIN public.room_meetings m ON m.id = d.meeting_id
    JOIN public.room_actor_identities owner_i ON owner_i.id = d.author_identity_id
    WHERE d.id = p_diary_id
      AND (
        owner_i.auth_user_id = auth.uid()
        OR (
          d.status = 'published' AND d.visibility = 'room'
          AND meetup_private.is_active_room_actor(m.room_id::text)
        )
      )
  )
$function$;

REVOKE ALL ON FUNCTION meetup_private.is_active_room_actor(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION meetup_private.can_read_diary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION meetup_private.is_active_room_actor(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION meetup_private.can_read_diary(uuid) TO authenticated, service_role;

DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['room_actor_identities','room_meetings','meeting_participants','meeting_diaries','diary_photos','diary_reactions','diary_notification_outbox','room_diary_notification_settings','diary_reminder_deliveries'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END
$rls$;

-- No direct client write to identity/meeting/diary/photo/outbox tables. RPCs and
-- a trusted server-side guest provisioning flow are the only write paths.
REVOKE ALL ON public.room_actor_identities, public.room_meetings,
  public.meeting_participants, public.meeting_diaries, public.diary_photos,
  public.diary_notification_outbox, public.diary_reminder_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.room_actor_identities, public.room_meetings,
  public.meeting_participants, public.meeting_diaries, public.diary_photos,
  public.diary_reactions, public.room_diary_notification_settings TO authenticated;
GRANT UPDATE, INSERT ON public.room_diary_notification_settings TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.diary_reactions TO authenticated;
GRANT ALL ON public.room_actor_identities, public.room_meetings,
  public.meeting_participants, public.meeting_diaries, public.diary_photos,
  public.diary_reactions, public.diary_notification_outbox,
  public.room_diary_notification_settings, public.diary_reminder_deliveries TO service_role;

DO $policies$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='room_actor_identities' AND policyname='room_actor_identity_self_read') THEN
    CREATE POLICY room_actor_identity_self_read ON public.room_actor_identities FOR SELECT TO authenticated
      USING (auth_user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='room_meetings' AND policyname='room_meetings_active_room_read') THEN
    CREATE POLICY room_meetings_active_room_read ON public.room_meetings FOR SELECT TO authenticated
      USING (meetup_private.is_active_room_actor(room_id::text));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='meeting_participants' AND policyname='meeting_participants_active_room_read') THEN
    CREATE POLICY meeting_participants_active_room_read ON public.meeting_participants FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.room_meetings m WHERE m.id=meeting_id AND meetup_private.is_active_room_actor(m.room_id::text)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='meeting_diaries' AND policyname='meeting_diaries_owner_or_published_room_read') THEN
    CREATE POLICY meeting_diaries_owner_or_published_room_read ON public.meeting_diaries FOR SELECT TO authenticated
      USING (meetup_private.can_read_diary(id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='diary_photos' AND policyname='diary_photos_visible_diary_read') THEN
    CREATE POLICY diary_photos_visible_diary_read ON public.diary_photos FOR SELECT TO authenticated
      USING (meetup_private.can_read_diary(diary_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='diary_reactions' AND policyname='diary_reactions_visible_diary_read') THEN
    CREATE POLICY diary_reactions_visible_diary_read ON public.diary_reactions FOR SELECT TO authenticated
      USING (meetup_private.can_read_diary(diary_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='diary_reactions' AND policyname='diary_reactions_insert_public_peer') THEN
    CREATE POLICY diary_reactions_insert_public_peer ON public.diary_reactions FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.meeting_diaries d
          JOIN public.room_meetings m ON m.id=d.meeting_id
          JOIN public.room_actor_identities actor_i ON actor_i.id=actor_identity_id
          WHERE d.id=diary_id AND d.status='published' AND d.visibility='room'
            AND actor_i.auth_user_id=auth.uid()
            AND actor_i.room_id::text=m.room_id::text
            AND actor_i.id <> d.author_identity_id
            AND meetup_private.is_active_room_actor(m.room_id::text)
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='diary_reactions' AND policyname='diary_reactions_delete_self') THEN
    CREATE POLICY diary_reactions_delete_self ON public.diary_reactions FOR DELETE TO authenticated
      USING (EXISTS (SELECT 1 FROM public.room_actor_identities i WHERE i.id=actor_identity_id AND i.auth_user_id=auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='room_diary_notification_settings' AND policyname='room_diary_settings_self_manage') THEN
    CREATE POLICY room_diary_settings_self_manage ON public.room_diary_notification_settings FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.room_actor_identities i WHERE i.id=actor_identity_id AND i.auth_user_id=auth.uid() AND i.room_id::text=room_id::text))
      WITH CHECK (EXISTS (SELECT 1 FROM public.room_actor_identities i WHERE i.id=actor_identity_id AND i.auth_user_id=auth.uid() AND i.room_id::text=room_id::text AND meetup_private.is_active_room_actor(room_id::text)));
  END IF;
END
$policies$;

CREATE OR REPLACE FUNCTION public.save_meeting_diary(
  p_meeting_id uuid,
  p_expected_version integer,
  p_body text,
  p_mood_emoji text,
  p_visibility text,
  p_publish boolean,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_room_id text;
  v_actor_id uuid;
  v_diary public.meeting_diaries%ROWTYPE;
  v_inserted_id uuid;
  v_first_publish boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF p_expected_version IS NULL OR p_expected_version < 0 OR p_request_id IS NULL OR p_publish IS NULL THEN RAISE EXCEPTION 'Invalid version, publish flag, or request id' USING ERRCODE='22023'; END IF;
  IF p_expected_version <> 0 AND NOT EXISTS (
    SELECT 1 FROM public.meeting_diaries d WHERE d.meeting_id=p_meeting_id
      AND d.author_identity_id IN (SELECT i.id FROM public.room_actor_identities i WHERE i.auth_user_id=auth.uid())
  ) THEN RAISE EXCEPTION 'New diary must start at version zero' USING ERRCODE='40001'; END IF;
  IF p_body IS NULL OR char_length(p_body) > 500 THEN RAISE EXCEPTION 'Diary text must be 0-500 characters' USING ERRCODE='22023'; END IF;
  IF p_visibility IS NULL OR p_visibility NOT IN ('room','private') THEN RAISE EXCEPTION 'Invalid visibility' USING ERRCODE='22023'; END IF;
  IF p_mood_emoji IS NOT NULL AND char_length(p_mood_emoji) > 16 THEN RAISE EXCEPTION 'Invalid mood emoji' USING ERRCODE='22023'; END IF;

  SELECT m.room_id::text INTO v_room_id FROM public.room_meetings m WHERE m.id=p_meeting_id FOR SHARE;
  IF v_room_id IS NULL OR NOT meetup_private.is_active_room_actor(v_room_id) THEN
    RAISE EXCEPTION 'Meeting is unavailable to this actor' USING ERRCODE='42501';
  END IF;
  IF (SELECT m.meeting_date > (now() AT TIME ZONE 'Asia/Seoul')::date FROM public.room_meetings m WHERE m.id=p_meeting_id) THEN
    RAISE EXCEPTION 'Future meetings cannot have diaries' USING ERRCODE='22023';
  END IF;

  SELECT i.id INTO v_actor_id FROM public.room_actor_identities i
  WHERE i.room_id::text=v_room_id AND i.auth_user_id=auth.uid();
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Room actor identity is not provisioned' USING ERRCODE='42501'; END IF;

  INSERT INTO public.meeting_diaries(meeting_id, author_identity_id, status, visibility, mood_emoji, body, version, last_write_request_id, published_at)
  VALUES (p_meeting_id, v_actor_id, CASE WHEN p_publish THEN 'published' ELSE 'draft' END,
    p_visibility, p_mood_emoji, p_body, 1, p_request_id, CASE WHEN p_publish THEN now() ELSE NULL END)
  ON CONFLICT (meeting_id, author_identity_id) DO NOTHING
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id IS NOT NULL THEN
    v_first_publish := p_publish;
    SELECT * INTO v_diary FROM public.meeting_diaries WHERE id=v_inserted_id;
  ELSE
    SELECT * INTO v_diary FROM public.meeting_diaries
    WHERE meeting_id=p_meeting_id AND author_identity_id=v_actor_id FOR UPDATE;
    IF v_diary.last_write_request_id=p_request_id THEN
      RETURN jsonb_build_object('id',v_diary.id,'status',v_diary.status,'version',v_diary.version,'updated_at',v_diary.updated_at,'first_published',false,'replayed',true);
    END IF;
    IF v_diary.version <> p_expected_version THEN
      RAISE EXCEPTION 'Diary version conflict: expected %, current %', p_expected_version, v_diary.version USING ERRCODE='40001';
    END IF;
    v_first_publish := (v_diary.status='draft' AND p_publish);
    UPDATE public.meeting_diaries SET
      body=p_body, mood_emoji=p_mood_emoji, visibility=p_visibility,
      status=CASE WHEN v_diary.status='published' OR p_publish THEN 'published' ELSE 'draft' END,
      published_at=CASE WHEN v_diary.published_at IS NOT NULL THEN v_diary.published_at WHEN p_publish THEN now() ELSE NULL END,
      version=version+1, updated_at=now(), last_write_request_id=p_request_id
    WHERE id=v_diary.id RETURNING * INTO v_diary;
  END IF;

  IF v_first_publish THEN
    INSERT INTO public.diary_notification_outbox(event_key,event_type,diary_id,actor_identity_id)
    VALUES ('diary_first_published:'||v_diary.id::text,'diary_first_published',v_diary.id,v_actor_id)
    ON CONFLICT (event_key) DO NOTHING;
  END IF;
  RETURN jsonb_build_object('id',v_diary.id,'status',v_diary.status,'version',v_diary.version,'updated_at',v_diary.updated_at,'first_published',v_first_publish,'replayed',false);
END
$function$;
REVOKE ALL ON FUNCTION public.save_meeting_diary(uuid,integer,text,text,text,boolean,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_meeting_diary(uuid,integer,text,text,text,boolean,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.register_room_member_identity(p_room_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_room_id public.rooms.id%TYPE; v_identity_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  SELECT r.id INTO v_room_id FROM public.rooms r WHERE r.id::text=p_room_id;
  IF v_room_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.room_members m WHERE m.roomid::text=p_room_id AND m.userid::text=auth.uid()::text
  ) THEN RAISE EXCEPTION 'Active room membership required' USING ERRCODE='42501'; END IF;
  INSERT INTO public.room_actor_identities(room_id,auth_user_id,actor_kind)
    VALUES(v_room_id,auth.uid(),'member')
    ON CONFLICT (room_id,auth_user_id) WHERE auth_user_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_identity_id;
  IF v_identity_id IS NULL THEN
    SELECT i.id INTO v_identity_id FROM public.room_actor_identities i
      WHERE i.room_id::text=p_room_id AND i.auth_user_id=auth.uid() AND i.actor_kind='member';
  END IF;
  IF v_identity_id IS NULL THEN RAISE EXCEPTION 'Room actor identity conflicts with existing identity' USING ERRCODE='23505'; END IF;
  RETURN v_identity_id;
END
$function$;
REVOKE ALL ON FUNCTION public.register_room_member_identity(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_room_member_identity(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_room_lightning_meeting(
  p_room_id text, p_meeting_date date, p_title text,
  p_start_time time, p_end_time time, p_location text,
  p_location_address text, p_participant_actor_ids uuid[] DEFAULT '{}'
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_room_id public.rooms.id%TYPE; v_actor_id uuid; v_meeting_id uuid; v_actor uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  SELECT r.id INTO v_room_id FROM public.rooms r WHERE r.id::text=p_room_id;
  IF v_room_id IS NULL OR NOT meetup_private.is_active_room_actor(p_room_id) THEN
    RAISE EXCEPTION 'Room is unavailable to this actor' USING ERRCODE='42501';
  END IF;
  IF p_meeting_date IS NULL OR p_meeting_date > (now() AT TIME ZONE 'Asia/Seoul')::date THEN
    RAISE EXCEPTION 'Lightning meetings may only be today or earlier' USING ERRCODE='22023';
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
  FOREACH v_actor IN ARRAY COALESCE(p_participant_actor_ids,'{}'::uuid[]) || ARRAY[v_actor_id] LOOP
    IF NOT EXISTS (SELECT 1 FROM public.room_actor_identities i WHERE i.id=v_actor AND i.room_id::text=p_room_id AND i.auth_user_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Participant identity is invalid for this room' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.meeting_participants(meeting_id,actor_identity_id,attendance_status,source)
      VALUES(v_meeting_id,v_actor,'unknown','manual') ON CONFLICT(meeting_id,actor_identity_id) DO NOTHING;
  END LOOP;
  RETURN v_meeting_id;
END
$function$;
REVOKE ALL ON FUNCTION public.create_room_lightning_meeting(text,date,text,time,time,text,text,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_room_lightning_meeting(text,date,text,time,time,text,text,uuid[]) TO authenticated;

-- Photo binaries are uploaded first; this RPC atomically replaces their
-- metadata and increments the same optimistic version as diary text saves.
CREATE OR REPLACE FUNCTION public.replace_meeting_diary_photos(
  p_diary_id uuid, p_expected_version integer, p_photos jsonb, p_request_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_diary public.meeting_diaries%ROWTYPE; v_room_id text; v_actor_id uuid; v_count integer; v_covers integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF p_expected_version IS NULL OR p_expected_version<1 OR p_request_id IS NULL OR p_photos IS NULL OR jsonb_typeof(p_photos)<>'array' OR jsonb_array_length(p_photos)>10 THEN
    RAISE EXCEPTION 'Invalid version, request id, or photo list' USING ERRCODE='22023';
  END IF;
  SELECT d.* INTO v_diary FROM public.meeting_diaries d WHERE d.id=p_diary_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Diary not found' USING ERRCODE='P0002'; END IF;
  SELECT m.room_id::text INTO v_room_id FROM public.room_meetings m WHERE m.id=v_diary.meeting_id;
  SELECT i.id INTO v_actor_id FROM public.room_actor_identities i WHERE i.room_id::text=v_room_id AND i.auth_user_id=auth.uid();
  IF v_actor_id IS NULL OR v_actor_id<>v_diary.author_identity_id OR NOT meetup_private.is_active_room_actor(v_room_id) THEN
    RAISE EXCEPTION 'Only the active diary owner may change photos' USING ERRCODE='42501';
  END IF;
  IF v_diary.last_write_request_id=p_request_id THEN
    RETURN jsonb_build_object('id',v_diary.id,'version',v_diary.version,'updated_at',v_diary.updated_at,'replayed',true);
  END IF;
  IF v_diary.version<>p_expected_version THEN
    RAISE EXCEPTION 'Diary version conflict: expected %, current %',p_expected_version,v_diary.version USING ERRCODE='40001';
  END IF;
  SELECT count(*),count(*) FILTER (WHERE x.is_cover) INTO v_count,v_covers
    FROM jsonb_to_recordset(p_photos) AS x(storage_path text, sort_order integer, is_cover boolean);
  IF v_count>0 AND v_covers<>1 THEN RAISE EXCEPTION 'Choose exactly one cover photo' USING ERRCODE='22023'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_photos) AS x(storage_path text, sort_order integer, is_cover boolean)
    WHERE x.sort_order NOT BETWEEN 0 AND 9 OR x.storage_path IS NULL
      OR x.storage_path NOT LIKE v_room_id||'/'||v_diary.meeting_id::text||'/'||v_diary.id::text||'/%'
      OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id='meetup-diary-photos' AND o.name=x.storage_path)
  ) THEN RAISE EXCEPTION 'Photo path/order is invalid or upload is missing' USING ERRCODE='22023'; END IF;
  IF (SELECT count(DISTINCT x.sort_order) FROM jsonb_to_recordset(p_photos) AS x(storage_path text, sort_order integer, is_cover boolean))<>v_count THEN
    RAISE EXCEPTION 'Photo order values must be unique' USING ERRCODE='22023';
  END IF;
  DELETE FROM public.diary_photos WHERE diary_id=p_diary_id;
  INSERT INTO public.diary_photos(diary_id,storage_path,sort_order,is_cover)
    SELECT p_diary_id,x.storage_path,x.sort_order,x.is_cover
    FROM jsonb_to_recordset(p_photos) AS x(storage_path text, sort_order integer, is_cover boolean);
  UPDATE public.meeting_diaries SET version=version+1,updated_at=now(),last_write_request_id=p_request_id
    WHERE id=p_diary_id RETURNING * INTO v_diary;
  RETURN jsonb_build_object('id',v_diary.id,'version',v_diary.version,'updated_at',v_diary.updated_at,'replayed',false);
END
$function$;
REVOKE ALL ON FUNCTION public.replace_meeting_diary_photos(uuid,integer,jsonb,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_meeting_diary_photos(uuid,integer,jsonb,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION meetup_private.enqueue_diary_reaction_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_author uuid;
BEGIN
  SELECT d.author_identity_id INTO v_author FROM public.meeting_diaries d WHERE d.id=NEW.diary_id;
  IF v_author IS NOT NULL AND v_author<>NEW.actor_identity_id THEN
    INSERT INTO public.diary_notification_outbox(event_key,event_type,diary_id,actor_identity_id)
      VALUES ('diary_reaction:'||NEW.id::text,'diary_reaction',NEW.diary_id,NEW.actor_identity_id)
      ON CONFLICT(event_key) DO NOTHING;
  END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS meetup_diary_reaction_outbox ON public.diary_reactions;
CREATE TRIGGER meetup_diary_reaction_outbox AFTER INSERT ON public.diary_reactions
FOR EACH ROW EXECUTE FUNCTION meetup_private.enqueue_diary_reaction_notification();

-- Schedule snapshot synchronization is intentionally limited to the known
-- legacy columns checked above. A deleted source schedule is detached; the
-- room_meetings row and diaries are retained. Past attendee state stays unknown.
CREATE OR REPLACE FUNCTION meetup_private.sync_confirmed_schedule_meeting()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_meeting_id uuid;
BEGIN
  IF TG_OP='DELETE' THEN
    UPDATE public.room_meetings SET source_schedule_id=NULL, lifecycle_status='unknown', updated_at=now()
    WHERE source_schedule_id=OLD.id;
    RETURN OLD;
  END IF;
  -- The live confirmed_schedules table has no room FK. Preserve legacy writes
  -- for orphaned room IDs without creating a meeting that violates our FK.
  IF NOT EXISTS (SELECT 1 FROM public.rooms r WHERE r.id=NEW.roomid) THEN
    UPDATE public.room_meetings SET room_id=NULL, source_schedule_id=NULL,
      lifecycle_status='unknown', updated_at=now()
    WHERE source_schedule_id=NEW.id;
    RETURN NEW;
  END IF;
  IF NEW.date IS NULL THEN
    -- Keep the snapshot and all diary rows, but reflect the cancellation even
    -- when someone has already written about the meeting.
    UPDATE public.room_meetings SET lifecycle_status='cancelled', updated_at=now()
    WHERE source_schedule_id=NEW.id;
    RETURN NEW;
  END IF;
  INSERT INTO public.room_meetings(room_id,source_type,source_schedule_id,title,meeting_date,start_time,end_time,is_all_day,location,location_address,lifecycle_status,attendance_status)
  VALUES (NEW.roomid,'confirmed_schedule',NEW.id,NEW.title,NEW.date::date,NEW.starttime::time,NEW.endtime::time,COALESCE(NEW.isallday,false),NEW.location,NEW.locationaddress,'scheduled','unknown')
  ON CONFLICT (source_schedule_id) WHERE source_schedule_id IS NOT NULL DO UPDATE SET
    room_id=CASE WHEN EXISTS (SELECT 1 FROM public.meeting_diaries d WHERE d.meeting_id=room_meetings.id) THEN room_meetings.room_id ELSE EXCLUDED.room_id END,
    title=CASE WHEN EXISTS (SELECT 1 FROM public.meeting_diaries d WHERE d.meeting_id=room_meetings.id) THEN room_meetings.title ELSE EXCLUDED.title END,
    meeting_date=CASE WHEN EXISTS (SELECT 1 FROM public.meeting_diaries d WHERE d.meeting_id=room_meetings.id) THEN room_meetings.meeting_date ELSE EXCLUDED.meeting_date END,
    start_time=CASE WHEN EXISTS (SELECT 1 FROM public.meeting_diaries d WHERE d.meeting_id=room_meetings.id) THEN room_meetings.start_time ELSE EXCLUDED.start_time END,
    end_time=CASE WHEN EXISTS (SELECT 1 FROM public.meeting_diaries d WHERE d.meeting_id=room_meetings.id) THEN room_meetings.end_time ELSE EXCLUDED.end_time END,
    is_all_day=CASE WHEN EXISTS (SELECT 1 FROM public.meeting_diaries d WHERE d.meeting_id=room_meetings.id) THEN room_meetings.is_all_day ELSE EXCLUDED.is_all_day END,
    location=CASE WHEN EXISTS (SELECT 1 FROM public.meeting_diaries d WHERE d.meeting_id=room_meetings.id) THEN room_meetings.location ELSE EXCLUDED.location END,
    location_address=CASE WHEN EXISTS (SELECT 1 FROM public.meeting_diaries d WHERE d.meeting_id=room_meetings.id) THEN room_meetings.location_address ELSE EXCLUDED.location_address END,
    lifecycle_status='scheduled', updated_at=now()
  RETURNING id INTO v_meeting_id;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS meetup_sync_confirmed_schedule_meeting ON public.confirmed_schedules;
CREATE TRIGGER meetup_sync_confirmed_schedule_meeting
AFTER INSERT OR UPDATE OF roomid,title,date,starttime,endtime,isallday,location,locationaddress OR DELETE
ON public.confirmed_schedules
FOR EACH ROW EXECUTE FUNCTION meetup_private.sync_confirmed_schedule_meeting();

-- Private Storage bucket. The client must upload under:
-- <room_id>/<meeting_uuid>/<diary_uuid>/<file_uuid>.<ext>
DO $storage_bucket_guard$
DECLARE
  policy_row record;
BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id='meetup-diary-photos' AND public) THEN
    RAISE EXCEPTION 'Bucket meetup-diary-photos already exists as public; refusing unsafe reuse';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='storage' AND c.relname='objects' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'storage.objects RLS is not enabled; refusing diary bucket creation';
  END IF;

  -- Existing restrictive policies can independently deny access to objects.
  -- Do not change them; stop and review if any unrelated one exists. Broad
  -- permissive policies are instead narrowed by the bucket-specific
  -- restrictive policies created below.
  FOR policy_row IN
    SELECT policyname, permissive
    FROM pg_policies
    WHERE schemaname='storage'
      AND tablename='objects'
      AND roles && ARRAY['public'::name,'anon'::name,'authenticated'::name]
  LOOP
    IF policy_row.permissive = 'RESTRICTIVE' AND policy_row.policyname NOT IN (
      'meetup_diary_photos_scope_select',
      'meetup_diary_photos_scope_insert',
      'meetup_diary_photos_scope_update',
      'meetup_diary_photos_scope_delete',
      'meetup_diary_photos_anon_block_all'
    ) THEN
      RAISE EXCEPTION 'Existing restrictive Storage policy % may constrain the diary bucket; review it before continuing', policy_row.policyname;
    END IF;
  END LOOP;
END
$storage_bucket_guard$;

INSERT INTO storage.buckets(id,name,public)
VALUES ('meetup-diary-photos','meetup-diary-photos',false)
ON CONFLICT (id) DO NOTHING;

DO $storage_policies$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='meetup_diary_photos_read_visible') THEN
    CREATE POLICY meetup_diary_photos_read_visible ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id='meetup-diary-photos' AND EXISTS (
        SELECT 1 FROM public.diary_photos p
        JOIN public.meeting_diaries d ON d.id=p.diary_id
        JOIN public.room_meetings m ON m.id=d.meeting_id
        WHERE p.storage_path=name AND meetup_private.can_read_diary(d.id)
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='meetup_diary_photos_insert_owner') THEN
    CREATE POLICY meetup_diary_photos_insert_owner ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id='meetup-diary-photos' AND EXISTS (
        SELECT 1 FROM public.meeting_diaries d
        JOIN public.room_meetings m ON m.id=d.meeting_id
        JOIN public.room_actor_identities i ON i.id=d.author_identity_id
        WHERE i.auth_user_id=auth.uid()
          AND m.room_id::text=split_part(name,'/',1)
          AND m.id::text=split_part(name,'/',2)
          AND d.id::text=split_part(name,'/',3)
          AND meetup_private.is_active_room_actor(m.room_id::text)
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='meetup_diary_photos_delete_owner') THEN
    CREATE POLICY meetup_diary_photos_delete_owner ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id='meetup-diary-photos' AND EXISTS (
        SELECT 1 FROM public.diary_photos p
        JOIN public.meeting_diaries d ON d.id=p.diary_id
        JOIN public.room_meetings m ON m.id=d.meeting_id
        JOIN public.room_actor_identities i ON i.id=d.author_identity_id
        WHERE p.storage_path=name AND i.auth_user_id=auth.uid()
      ));
  END IF;

  -- Restrictive policies cap any legacy broad permissive Storage policy while
  -- allowing all non-diary buckets through unchanged. PostgreSQL combines
  -- restrictive policies with AND, so an old Allow-all policy cannot expose
  -- private diary objects. Anonymous users are explicitly denied this bucket.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='meetup_diary_photos_scope_select') THEN
    CREATE POLICY meetup_diary_photos_scope_select ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
      USING (bucket_id <> 'meetup-diary-photos' OR EXISTS (
        SELECT 1 FROM public.diary_photos p
        JOIN public.meeting_diaries d ON d.id=p.diary_id
        WHERE p.storage_path=name AND meetup_private.can_read_diary(d.id)
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='meetup_diary_photos_scope_insert') THEN
    CREATE POLICY meetup_diary_photos_scope_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
      WITH CHECK (bucket_id <> 'meetup-diary-photos' OR EXISTS (
        SELECT 1 FROM public.meeting_diaries d
        JOIN public.room_meetings m ON m.id=d.meeting_id
        JOIN public.room_actor_identities i ON i.id=d.author_identity_id
        WHERE i.auth_user_id=auth.uid()
          AND m.room_id::text=split_part(name,'/',1)
          AND m.id::text=split_part(name,'/',2)
          AND d.id::text=split_part(name,'/',3)
          AND meetup_private.is_active_room_actor(m.room_id::text)
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='meetup_diary_photos_scope_update') THEN
    CREATE POLICY meetup_diary_photos_scope_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
      USING (bucket_id <> 'meetup-diary-photos')
      WITH CHECK (bucket_id <> 'meetup-diary-photos');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='meetup_diary_photos_scope_delete') THEN
    CREATE POLICY meetup_diary_photos_scope_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
      USING (bucket_id <> 'meetup-diary-photos' OR EXISTS (
        SELECT 1 FROM public.diary_photos p
        JOIN public.meeting_diaries d ON d.id=p.diary_id
        JOIN public.room_actor_identities i ON i.id=d.author_identity_id
        WHERE p.storage_path=name AND i.auth_user_id=auth.uid()
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='meetup_diary_photos_anon_block_all') THEN
    CREATE POLICY meetup_diary_photos_anon_block_all ON storage.objects AS RESTRICTIVE FOR ALL TO anon
      USING (bucket_id <> 'meetup-diary-photos')
      WITH CHECK (bucket_id <> 'meetup-diary-photos');
  END IF;
END
$storage_policies$;

COMMIT;
