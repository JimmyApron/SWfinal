-- Read-only metadata checks for the project owner. Not executed by this audit.
-- Six new course-related tables. A NULL relation indicates a missing table.
SELECT expected.table_name, to_regclass('public.' || expected.table_name) AS relation
FROM (VALUES ('courses'), ('course_stops'), ('vote_course_links'),
  ('course_member_confirmations'), ('schedule_creation_records'), ('schedule_finalizations')) AS expected(table_name);

SELECT table_name, column_name, data_type, udt_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN (
  'confirmed_schedules', 'schedule_creation_records', 'courses', 'course_stops',
  'votes', 'voteoptions', 'vote_course_links', 'voteresponses',
  'course_member_confirmations', 'schedule_finalizations',
  'room_members', 'room_guests', 'room_messages'
)
ORDER BY table_name, ordinal_position;

SELECT c.conrelid::regclass AS table_name, c.conname, c.contype,
       pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
JOIN pg_namespace n ON n.oid = c.connamespace
WHERE n.nspname = 'public' AND c.conrelid IN (
  SELECT cl.oid FROM pg_class cl JOIN pg_namespace ns ON ns.oid = cl.relnamespace
  WHERE ns.nspname = 'public' AND cl.relname IN (
    'confirmed_schedules', 'schedule_creation_records', 'courses', 'course_stops',
    'votes', 'voteoptions', 'vote_course_links', 'voteresponses',
    'course_member_confirmations', 'schedule_finalizations', 'room_messages', 'room_members', 'room_guests'
  )
)
ORDER BY table_name, c.conname;

SELECT tablename, indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename IN (
  'courses', 'course_stops', 'vote_course_links', 'schedule_creation_records',
  'course_member_confirmations', 'schedule_finalizations', 'votes', 'voteoptions', 'voteresponses'
)
ORDER BY tablename, indexname;
