require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");

let client;
function getSupabase() {
  if (client) return client;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!process.env.SUPABASE_URL || !key) {
    throw new Error("SUPABASE_URL 및 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.");
  }
  client = createClient(process.env.SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}

const pad = (n) => String(n).padStart(2, "0");
function kstParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}
function kstDateKey(parts) { return `${parts.year}-${parts.month}-${parts.day}`; }
function previousDateKey(dateKey) {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

async function getActorUserId(identityId) {
  if (!identityId) return null;
  const { data, error } = await getSupabase().from("room_actor_identities")
    .select("auth_user_id").eq("id", identityId).maybeSingle();
  if (error) throw error;
  return data?.auth_user_id || null;
}

async function getDiary(diaryId) {
  if (!diaryId) return null;
  const { data, error } = await getSupabase().from("meeting_diaries")
    .select("id, meeting_id, author_identity_id, status, visibility")
    .eq("id", diaryId).maybeSingle();
  if (error) throw error;
  return data;
}

async function dispatchOutboxEvent(event) {
  const recipients = [...new Set((event.recipient_user_ids || []).filter(Boolean).map(String))];
  if (event.event_type === "diary_reaction") {
    const diary = await getDiary(event.diary_id);
    if (!diary) return;
    recipients.push(String((await getActorUserId(diary.author_identity_id)) || ""));
  }
  const uniqueRecipients = [...new Set(recipients.filter(Boolean))];
  for (const recipientId of uniqueRecipients) {
    const { error } = await getSupabase().rpc("deliver_diary_outbox_notification", {
      p_outbox_id: event.id,
      p_recipient_user_id: recipientId,
    });
    if (error) throw error;
  }
}

async function processDiaryNotificationOutbox() {
  const { data: events, error } = await getSupabase().rpc("claim_diary_notification_outbox", { p_limit: 50 });
  if (error) throw error;
  for (const event of events || []) {
    try {
      await dispatchOutboxEvent(event);
      const { error: updateError } = await getSupabase().from("diary_notification_outbox")
        .update({ processed_at: new Date().toISOString(), claimed_at: null, last_error: null })
        .eq("id", event.id).is("processed_at", null);
      if (updateError) throw updateError;
    } catch (eventError) {
      console.error(`[기록 알림] outbox ${event.event_key} 처리 실패:`, eventError.message);
      await getSupabase().from("diary_notification_outbox").update({
        claimed_at: null,
        last_error: String(eventError.message || eventError).slice(0, 1000),
      }).eq("id", event.id).is("processed_at", null);
    }
  }
}

async function enqueueReminderDeliveries(meeting, recipients) {
  if (!recipients.length) return;
  const client = getSupabase();
  const { data: identities, error: identityError } = await client.from("room_actor_identities")
    .select("id, auth_user_id").eq("room_id", meeting.room_id)
    .in("auth_user_id", recipients);
  if (identityError) throw identityError;
  const identityByUser = new Map((identities || []).map((row) => [String(row.auth_user_id), row.id]));
  const rows = recipients.map((userId) => ({
    meeting_id: meeting.id,
    recipient_actor_identity_id: identityByUser.get(String(userId)) || null,
    recipient_user_id: userId,
    idempotency_key: `diary_reminder:${meeting.id}:${userId}`,
    status: "queued",
  }));
  const { error } = await client.from("diary_reminder_deliveries")
    .upsert(rows, { onConflict: "idempotency_key", ignoreDuplicates: true });
  if (error) throw error;

  const keys = rows.map((row) => row.idempotency_key);
  const { data: queued, error: queuedError } = await client.from("diary_reminder_deliveries")
    .select("id, recipient_user_id, idempotency_key").in("idempotency_key", keys).eq("status", "queued");
  if (queuedError) throw queuedError;
  for (const row of queued || []) {
    const { error: deliveryError } = await client.rpc("deliver_diary_reminder", {
      p_meeting_id: meeting.id,
      p_recipient_user_id: row.recipient_user_id,
    });
    if (deliveryError) {
      await client.from("diary_reminder_deliveries").update({
        last_error: String(deliveryError.message || deliveryError).slice(0, 1000),
      }).eq("id", row.id).eq("status", "queued");
      console.error(`[기록 알림] 미작성 알림 ${row.idempotency_key} 재시도 예정:`, deliveryError.message);
    }
  }
}

async function processDiaryReminders(now = new Date()) {
  const parts = kstParts(now);
  const minuteOfDay = Number(parts.hour) * 60 + Number(parts.minute);
  const today = kstDateKey(parts);
  const isPrimaryWindow = minuteOfDay >= 23 * 60 + 50;
  const isFallbackWindow = minuteOfDay >= 10 && minuteOfDay < 20;
  if (!isPrimaryWindow && !isFallbackWindow) return;
  const targetDate = isFallbackWindow ? previousDateKey(today) : today;
  const client = getSupabase();
  const { data: meetings, error } = await client.from("room_meetings")
    .select("id, room_id, title, meeting_date, end_time, lifecycle_status, source_type, created_at")
    .eq("meeting_date", targetDate).neq("lifecycle_status", "cancelled");
  if (error) throw error;
  for (const meeting of meetings || []) {
    if (meeting.source_type === "lightning" && kstDateKey(kstParts(new Date(meeting.created_at))) > meeting.meeting_date) continue;
    const endTime = meeting.end_time ? String(meeting.end_time).slice(0, 5) : null;
    if (isPrimaryWindow && endTime && endTime > "23:50") continue;
    if (isPrimaryWindow && !endTime) continue;
    if (isFallbackWindow && endTime && endTime <= "23:50") continue;
    const { data: snapshot, error: snapshotError } = await client.from("room_meeting_diary_targets")
      .select("user_id").eq("meeting_id", meeting.id);
    if (snapshotError) throw snapshotError;
    let recipients = (snapshot || []).map((row) => row.user_id);
    if (!recipients.length) {
      const { data: members, error: memberError } = await client.from("room_members")
        .select("userid").eq("roomid", meeting.room_id).not("userid", "is", null);
      if (memberError) throw memberError;
      recipients = (members || []).map((row) => row.userid);
    }
    await enqueueReminderDeliveries(meeting, [...new Set(recipients.filter(Boolean))]);
  }
}

let running = false;
async function runDiaryNotificationJobs() {
  if (running) return;
  running = true;
  try {
    await processDiaryNotificationOutbox();
    await processDiaryReminders();
  } catch (error) {
    console.error("[기록 알림] 작업 실행 실패:", error.message);
  } finally { running = false; }
}

function startDiaryNotificationJob() {
  console.log("[백엔드] 기록 알림 outbox 및 KST 23:50 미작성 알림 활성화 (1분 간격)");
  runDiaryNotificationJobs();
  setInterval(runDiaryNotificationJobs, 60_000);
}

module.exports = {
  dispatchOutboxEvent,
  processDiaryNotificationOutbox,
  processDiaryReminders,
  runDiaryNotificationJobs,
  startDiaryNotificationJob,
};
