-- READ-ONLY Supabase preflight. Run this entire file once in SQL Editor.
-- It is one SELECT statement and returns a single result table with 17 rows.
-- Each row contains check_name, row_count, status, and a JSON payload.
-- Empty checks return status='no_rows' and payload=[].
-- No application data values are queried. Cron command text is intentionally
-- omitted because it can contain URLs or credentials. String literals in
-- function and policy source are masked before being returned.
WITH
columns_data AS (
  SELECT count(*)::integer AS row_count,
         COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.table_name, q.ordinal_position), '[]'::jsonb) AS payload
  FROM (
    SELECT table_schema, table_name, column_name, data_type, udt_name,
           is_nullable, column_default, ordinal_position
    FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name IN ('rooms','room_members','room_guests','confirmed_schedules','profiles','notifications','dismissed_schedules')
  ) q
),
constraints_data AS (
  SELECT count(*)::integer AS row_count,
         COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.table_name, q.conname), '[]'::jsonb) AS payload
  FROM (
    SELECT n.nspname AS schema_name, t.relname AS table_name,
           c.conname, c.contype, pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    JOIN pg_class t ON t.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public'
      AND t.relname IN ('rooms','room_members','room_guests','confirmed_schedules','profiles','notifications','dismissed_schedules')
  ) q
),
indexes_data AS (
  SELECT count(*)::integer AS row_count,
         COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.tablename, q.indexname), '[]'::jsonb) AS payload
  FROM (
    SELECT schemaname, tablename, indexname, indexdef
    FROM pg_indexes
    WHERE schemaname='public'
      AND tablename IN ('rooms','room_members','room_guests','confirmed_schedules','profiles','notifications','dismissed_schedules')
  ) q
),
rls_data AS (
  SELECT count(*)::integer AS row_count,
         COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.table_name), '[]'::jsonb) AS payload
  FROM (
    SELECT n.nspname AS schema_name, c.relname AS table_name,
           c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS force_rls
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public'
      AND c.relname IN ('rooms','room_members','room_guests','confirmed_schedules','profiles','notifications','dismissed_schedules')
  ) q
),
policies_data AS (
  SELECT count(*)::integer AS row_count,
         COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.schemaname, q.tablename, q.policyname), '[]'::jsonb) AS payload
  FROM (
    SELECT schemaname, tablename, policyname, permissive, roles, cmd,
           regexp_replace(COALESCE(qual,''), $$'([^']|'')*'$$, $$'[STRING_REDACTED]'$$, 'g') AS qual_redacted,
           regexp_replace(COALESCE(with_check,''), $$'([^']|'')*'$$, $$'[STRING_REDACTED]'$$, 'g') AS with_check_redacted,
           CASE WHEN schemaname='storage' AND tablename='objects' THEN COALESCE((
             SELECT jsonb_agg(DISTINCT x.capture[1])
             FROM regexp_matches(
               COALESCE(qual,'') || ' ' || COALESCE(with_check,''),
               $$bucket_id\s*=\s*'([^']+)'$$, 'gi'
             ) AS x(capture)
           ), '[]'::jsonb) ELSE '[]'::jsonb END AS referenced_bucket_ids
    FROM pg_policies
    WHERE schemaname IN ('public','storage')
  ) q
),
grants_data AS (
  SELECT count(*)::integer AS row_count,
         COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.table_name, q.grantee, q.privilege_type), '[]'::jsonb) AS payload
  FROM (
    SELECT grantee, table_schema, table_name, privilege_type
    FROM information_schema.role_table_grants
    WHERE table_schema='public'
      AND table_name IN ('rooms','room_members','room_guests','confirmed_schedules','profiles','notifications','dismissed_schedules')
      AND grantee IN ('anon','authenticated','service_role')
  ) q
),
auth_triggers_data AS (
  SELECT count(*)::integer AS row_count,
         COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.event_object_schema, q.event_object_table, q.trigger_name), '[]'::jsonb) AS payload
  FROM (
    SELECT event_object_schema, event_object_table, trigger_name,
           action_timing, event_manipulation, action_statement
    FROM information_schema.triggers
    WHERE (event_object_schema='auth' AND event_object_table='users')
       OR (event_object_schema='public' AND event_object_table='profiles')
  ) q
),
auth_functions_data AS (
  SELECT count(*)::integer AS row_count,
         COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.function_schema, q.function_name, q.arguments), '[]'::jsonb) AS payload
  FROM (
    SELECT n.nspname AS function_schema, p.proname AS function_name,
           pg_get_function_identity_arguments(p.oid) AS arguments,
           p.prosecdef AS security_definer,
           -- Mask every ordinary SQL string literal so embedded credentials
           -- are not returned. Function structure and identifiers remain visible.
           regexp_replace(pg_get_functiondef(p.oid), $$'([^']|'')*'$$, $$'[STRING_REDACTED]'$$, 'g') AS definition_redacted
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE p.proname ILIKE '%handle_new_oauth_user%'
       OR p.proname ILIKE '%handle_new_user%'
  ) q
),
publication_data AS (
  SELECT count(*)::integer AS row_count,
         COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.schemaname, q.tablename), '[]'::jsonb) AS payload
  FROM (
    SELECT schemaname, tablename
    FROM pg_publication_tables
    WHERE pubname='supabase_realtime'
  ) q
),
buckets_data AS (
  SELECT count(*)::integer AS row_count,
         COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.id), '[]'::jsonb) AS payload
  FROM (
    SELECT id, name, public, file_size_limit, allowed_mime_types
    FROM storage.buckets
  ) q
),
cron_catalog_data AS (
  SELECT jsonb_build_object(
    'cron_job_catalog', to_regclass('cron.job')::text,
    'net_http_request_queue', to_regclass('net.http_request_queue')::text
  ) AS payload
),
cron_jobs_data AS (
  SELECT count(*)::integer AS row_count,
         COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.jobid), '[]'::jsonb) AS payload
  FROM (
    -- Do not select command text: it can contain URLs, tokens, or credentials.
    SELECT jobid, schedule, active
    FROM cron.job
  ) q
),
object_collisions_data AS (
  SELECT count(*)::integer AS row_count,
         COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.schema_name, q.object_name), '[]'::jsonb) AS payload
  FROM (
    SELECT n.nspname AS schema_name, c.relname AS object_name, c.relkind AS object_kind
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE (n.nspname='public' AND c.relname IN (
        'room_actor_identities','room_meetings','meeting_participants',
        'meeting_diaries','diary_photos','diary_reactions',
        'diary_notification_outbox','room_diary_notification_settings','diary_reminder_deliveries'
      ))
       OR (n.nspname='meetup_private' AND c.relname IN ('is_active_room_actor','can_read_diary'))
  ) q
),
function_collisions_data AS (
  SELECT count(*)::integer AS row_count,
         COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.function_schema, q.function_name, q.arguments), '[]'::jsonb) AS payload
  FROM (
    SELECT n.nspname AS function_schema, p.proname AS function_name,
           pg_get_function_identity_arguments(p.oid) AS arguments,
           p.prosecdef AS security_definer
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE (n.nspname='public' AND p.proname IN (
        'save_meeting_diary','register_room_member_identity',
        'create_room_lightning_meeting','replace_meeting_diary_photos',
        'get_meeting_diary_progress'
      ))
       OR (n.nspname='meetup_private' AND p.proname IN ('is_active_room_actor','can_read_diary'))
  ) q
),
trigger_collisions_data AS (
  SELECT count(*)::integer AS row_count,
         COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.event_object_schema, q.event_object_table, q.trigger_name), '[]'::jsonb) AS payload
  FROM (
    SELECT event_object_schema, event_object_table, trigger_name,
           action_timing, event_manipulation, action_statement
    FROM information_schema.triggers
    WHERE event_object_schema='public'
      AND event_object_table IN ('confirmed_schedules','diary_reactions')
      AND trigger_name IN ('meetup_sync_confirmed_schedule_meeting','meetup_diary_reaction_outbox')
  ) q
),
bucket_collision_data AS (
  SELECT count(*)::integer AS row_count,
         COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.id), '[]'::jsonb) AS payload
  FROM (
    SELECT id, name, public, file_size_limit
    FROM storage.buckets
    WHERE id='meetup-diary-photos'
  ) q
),
new_tables_data AS (
  SELECT count(*)::integer AS row_count,
         COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.table_name), '[]'::jsonb) AS payload
  FROM (
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema='public'
      AND table_name IN (
        'room_actor_identities','room_meetings','meeting_participants',
        'meeting_diaries','diary_photos','diary_reactions',
        'diary_notification_outbox','room_diary_notification_settings','diary_reminder_deliveries'
      )
  ) q
)
SELECT '01_columns' AS check_name, row_count,
       CASE WHEN row_count=0 THEN 'no_rows' ELSE 'ok' END AS status, payload FROM columns_data
UNION ALL SELECT '02_constraints', row_count, CASE WHEN row_count=0 THEN 'no_rows' ELSE 'ok' END, payload FROM constraints_data
UNION ALL SELECT '03_indexes', row_count, CASE WHEN row_count=0 THEN 'no_rows' ELSE 'ok' END, payload FROM indexes_data
UNION ALL SELECT '04_rls_flags', row_count, CASE WHEN row_count=0 THEN 'no_rows' ELSE 'ok' END, payload FROM rls_data
UNION ALL SELECT '05_policies_public_storage', row_count, CASE WHEN row_count=0 THEN 'no_rows' ELSE 'ok' END, payload FROM policies_data
UNION ALL SELECT '06_table_grants', row_count, CASE WHEN row_count=0 THEN 'no_rows' ELSE 'ok' END, payload FROM grants_data
UNION ALL SELECT '07_auth_triggers', row_count, CASE WHEN row_count=0 THEN 'no_rows' ELSE 'ok' END, payload FROM auth_triggers_data
UNION ALL SELECT '08_oauth_user_functions', row_count, CASE WHEN row_count=0 THEN 'no_rows' ELSE 'ok' END, payload FROM auth_functions_data
UNION ALL SELECT '09_realtime_publication', row_count, CASE WHEN row_count=0 THEN 'no_rows' ELSE 'ok' END, payload FROM publication_data
UNION ALL SELECT '10_storage_buckets', row_count, CASE WHEN row_count=0 THEN 'no_rows' ELSE 'ok' END, payload FROM buckets_data
UNION ALL SELECT '11_cron_catalogs', 2, 'ok', payload FROM cron_catalog_data
UNION ALL SELECT '12_cron_jobs', row_count, CASE WHEN row_count=0 THEN 'no_rows' ELSE 'ok' END, payload FROM cron_jobs_data
UNION ALL SELECT '13_object_name_collisions', row_count, CASE WHEN row_count=0 THEN 'no_rows' ELSE 'review' END, payload FROM object_collisions_data
UNION ALL SELECT '14_function_name_collisions', row_count, CASE WHEN row_count=0 THEN 'no_rows' ELSE 'review' END, payload FROM function_collisions_data
UNION ALL SELECT '15_trigger_name_collisions', row_count, CASE WHEN row_count=0 THEN 'no_rows' ELSE 'review' END, payload FROM trigger_collisions_data
UNION ALL SELECT '16_storage_bucket_collision', row_count, CASE WHEN row_count=0 THEN 'no_rows' ELSE 'review' END, payload FROM bucket_collision_data
UNION ALL SELECT '17_new_table_inventory', row_count, CASE WHEN row_count=0 THEN 'no_rows' ELSE 'review' END, payload FROM new_tables_data
ORDER BY check_name;
