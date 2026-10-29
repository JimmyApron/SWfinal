-- Read-only: list every foreign key that references confirmed schedules.
-- No user rows are read or changed.
SELECT
  c.conrelid::regclass AS referencing_table,
  c.conname AS constraint_name,
  pg_get_constraintdef(c.oid) AS definition,
  CASE c.confdeltype
    WHEN 'a' THEN 'NO ACTION'
    WHEN 'r' THEN 'RESTRICT'
    WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL'
    WHEN 'd' THEN 'SET DEFAULT'
  END AS on_delete
FROM pg_constraint c
WHERE c.contype = 'f'
  AND c.confrelid = 'public.confirmed_schedules'::regclass
ORDER BY referencing_table::text, constraint_name;
