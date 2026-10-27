# MeetUP calendar and diary migration review plan

This is a test plan only. No migration or test was executed against Supabase.

## Apply order after review

1. Record the current migration history. This project has no restorable backup available on its current plan; treat SQL application as non-reversible and do not promise point-in-time restore.
2. Run `meetup_diary_preflight.sql` in SQL Editor and save its results.
3. Review live column types, current auth user triggers/functions, Storage policies, and existing grants. Resolve every migration preflight mismatch before applying.
4. Apply the migration to a disposable Supabase project first. Run the checks below there.
5. Confirm the new table RLS, grants, policies, trigger, bucket, and publication choices. This migration intentionally does not change RLS or publication membership for the existing seven application tables. It adds bucket-scoped restrictive Storage policies so broad legacy permissive policies cannot expose diary photos; the added policies pass non-diary buckets unchanged.
6. Apply to production only after the current approval, live preflight review, and migration diff review all pass. No backup gate is assumed; any destructive or existing-object change remains out of scope.

## Authentication and RLS scenarios

- Authenticated member registers its own actor identity in a room where `room_members.userid` matches `auth.uid()`; succeeds and is idempotent.
- Any active room member, including a user listed in `confirmed_schedules.absentees`, can save and publish a diary for a past meeting; meeting attendance and exclusion status do not grant or deny diary access.
- `get_meeting_diary_progress` is callable only by an authenticated current room member. It returns published room-visible member IDs plus that caller's own published record (if private), count, and room-member target count; it never reveals another member's private writing status or content.
- Member registration in another room, a removed room, or with another member's user id is denied.
- Anonymous Auth user has `auth.uid()` and is treated as `authenticated`, but cannot create an actor identity directly or read other actors' drafts.
- Guest identity is provisioned only by a trusted server-side flow that atomically verifies/creates its guest row and maps it to that anonymous Auth subject. Client-supplied legacy `guest_id` alone must never establish the mapping.
- A localStorage-only legacy guest cannot use diary RPCs until a trusted identity migration/re-entry flow exists; existing guest chat/vote/room paths remain outside this migration.
- Active room member/guest can list room meetings and published `visibility='room'` diaries.
- Other room actor, unauthenticated `anon`, and an actor from another room cannot read the diary, photo metadata, or Storage object.
- Owner can read their own draft and private published diary; another actor cannot read either.
- After leave/kick, actor loses room content access. The owner may still read their own diary by design; confirm product policy for retaining their own content.
- Direct INSERT/UPDATE/DELETE to diary/meeting/photo/outbox tables is denied; the allowlisted RPCs and service role paths work.

## Diary autosave and concurrency

- First autosave with `expected_version=0` creates one `draft`, version 1; repeat saves for same actor/meeting do not create a second row.
- Empty autosave never enqueues a publish notification.
- Mood/visibility and body saves advance `version` and `updated_at`; text length 500 succeeds and 501 fails.
- Submit two writes using the same expected version: one succeeds; the stale one returns a serialization/version conflict and cannot overwrite the winner.
- Deliver requests out of order and retry the latest request id; the stale payload never replaces a higher version.
- First `p_publish=true` transitions draft to published and emits one outbox event. Repeating the request or later editing a published entry emits no second first-publish event.
- KST boundary checks: meeting date today is allowed, tomorrow is rejected; test immediately before/after 00:00 KST and 23:50 KST.
- Disconnect while editing: verify future frontend implementation recovers from local IndexedDB/localStorage, then reconciles with the server version instead of blind overwrite. SQL alone does not provide browser offline storage or the 2-second/10-second debounce timers.

## Photo scenarios

- Upload 1 and 10 photos; 11 is rejected by metadata RPC.
- Zero photos removes all metadata; a non-empty set requires exactly one cover, unique positions 0-9, distinct object paths, and existing objects in the private bucket.
- Reorder, replace cover, add, and delete photos increments diary version once and rejects stale version.
- Partial object upload failure leaves no metadata update; retry only missing uploads. Failed/orphan objects are cleaned later by a service-role job after a retention window.
- Private diary's Storage object cannot be selected by another actor and is never served from a public bucket; signed URL expiry and leave/kick behavior are verified.

## Meeting and legacy behavior

- Historical `confirmed_schedules` backfill creates one linked meeting per dated schedule whose room still exists, all with unknown attendance; null-date drafts and orphaned room references are skipped without changing the source schedules.
- Same room/date accepts multiple schedule and lightning meetings; monthly count/order is computed from KST `meeting_date` plus stable `created_at,id` tie-breaker.
- Schedule insert/update synchronizes the snapshot. Deleting the source detaches its FK but leaves the meeting and diaries.
- Deleting a room must not be blocked by diary foreign keys: room references on actor identities and meetings become NULL, notification settings cascade, and diary/meeting rows remain. Verify that only the diary owner retains access after the room is gone.
- Schedule date cancellation after a diary exists marks the meeting cancelled while preserving its snapshot and diary. Schedule date/time edits after a diary exists do not rewrite the diary's historical snapshot.
- A lightning meeting today or in the past succeeds; a future date fails. Participant list must be same-room identities and begins `unknown` until confirmed.
- Existing schedule, vote, location, chat, guest entry/exit/kick, notifications, personal calendar, and Google Calendar flows pass regression checks.

## Notification, Realtime, and recovery

- Autosave creates no outbox item. First publish creates one outbox item; reaction creates one item only for another actor; author self-reaction is denied.
- Dispatcher retries are idempotent by `event_key`; notification preference OFF suppresses delivery. The migration includes per-room actor preferences and a one-per-meeting/actor reminder ledger; the scheduled 23:50 KST worker and delivery into the existing `notifications` table remain application/server work.
- Postgres Changes can remain RLS-enabled, but do not add private diary/photo rows to a broad publication. Prefer private Broadcast for small room events, after Realtime authorization is configured; clients refetch allowed rows through RLS.
- Verify no realtime event body or Broadcast payload contains private diary text, Storage path, or signed URL.
- Apply migration twice in a disposable project; second run must not duplicate backfill rows/policies/bucket or rewrite existing diary data.
- If a disposable restore is unavailable, validate the SQL against a separate test project before production. After diary data exists, use a forward repair/disable path and retain data rather than dropping tables.

## Known rollout gates

- Inspect `handle_new_oauth_user()` and all `auth.users` triggers before enabling Anonymous Auth. This checkout has no tracked SQL definition for them, and current read-only Supabase access was unavailable in this turn.
- Existing RLS-off app tables stay unchanged here. Their security remediation needs a separate per-feature policy rollout because current clients rely on direct CRUD, guest localStorage ids, broad joins, and Postgres Changes.
- A server-side guest provisioning function/Edge Function is required. Historical localStorage guest sessions cannot be safely bound to an anonymous Auth subject based only on a caller-provided guest id.
- Room deletion does not use `ON DELETE RESTRICT` for room references. The migration preserves diary/meeting rows by setting their room references to NULL; room notification settings are removed with the room. The product must still decide whether retaining owner-only records after room deletion is desired.
- Google Drive synchronization is intentionally out of scope until core calendar/diary and access controls are stable.
