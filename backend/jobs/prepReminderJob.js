require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");
const {
  getPrepReminderIdempotencyKey,
  getSharedShortages,
  isWithinPrepReminderRecoveryWindow,
} = require("./prepReminderRules");

let supabase;

function getSupabase() {
  if (supabase) return supabase;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    throw new Error("SUPABASE_URL 또는 SUPABASE_KEY가 설정되지 않았습니다.");
  }
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  return supabase;
}

function getKstDate(date = new Date()) {
  const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
  };
}

function dateKey({ year, month, day }) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getTomorrowKey(now = new Date()) {
  const kst = getKstDate(now);
  const tomorrow = new Date(Date.UTC(kst.year, kst.month, kst.day + 1));
  return dateKey({
    year: tomorrow.getUTCFullYear(),
    month: tomorrow.getUTCMonth(),
    day: tomorrow.getUTCDate(),
  });
}

function getKstDateBounds(date) {
  return {
    start: new Date(`${date}T00:00:00+09:00`).toISOString(),
    end: new Date(
      new Date(`${date}T00:00:00+09:00`).getTime() + 24 * 60 * 60 * 1000
    ).toISOString(),
  };
}

function getItemNames(items) {
  return items.map((item) => item.name).filter(Boolean);
}

async function getScheduleParticipants(schedule) {
  const client = getSupabase();
  const [
    { data: members, error: memberError },
    { data: guests, error: guestError },
  ] = await Promise.all([
    client
      .from("room_members")
      .select("userid, schedulenotifenabled")
      .eq("roomid", schedule.roomid),
    client
      .from("room_guests")
      .select("id, schedulenotifenabled")
      .eq("roomid", schedule.roomid),
  ]);

  if (memberError) {
    throw new Error(`회원 알림 대상을 조회하지 못했습니다: ${memberError.message}`);
  }
  if (guestError) {
    throw new Error(`게스트 알림 대상을 조회하지 못했습니다: ${guestError.message}`);
  }

  const absentIds = new Set((schedule.absentees || []).map(String));
  return [
    ...(members || []).map((member) => ({
      id: String(member.userid),
      type: "member",
      notificationEnabled: member.schedulenotifenabled !== false,
    })),
    ...(guests || []).map((guest) => ({
      id: String(guest.id),
      type: "guest",
      notificationEnabled: guest.schedulenotifenabled !== false,
    })),
  ].filter((participant) => !absentIds.has(participant.id));
}

async function getIncompleteItems(schedule, participant) {
  const client = getSupabase();
  const { data: items, error: itemsError } = await client
    .from("prep_items")
    .select("id, name, kind, neededcount")
    .eq("scheduleid", schedule.id);
  if (itemsError) {
    throw new Error(`준비물 목록을 조회하지 못했습니다: ${itemsError.message}`);
  }
  if (!items?.length) return { personal: [], assigned: [], shortages: [] };

  const personalItems = items.filter((item) => item.kind === "personal");
  const sharedItems = items.filter((item) => item.kind === "shared");

  const [
    { data: checks, error: checksError },
    { data: assignments, error: assignmentsError },
  ] = await Promise.all([
    personalItems.length
      ? client
          .from("prep_checks")
          .select("itemid, checked")
          .in(
            "itemid",
            personalItems.map((item) => item.id)
          )
          .eq("memberid", participant.id)
          .eq("membertype", participant.type)
      : Promise.resolve({ data: [], error: null }),
    sharedItems.length
      ? client
          .from("prep_assignments")
          .select("itemid, memberid, membertype, status, isdone")
          .in(
            "itemid",
            sharedItems.map((item) => item.id)
          )
          .in("status", ["assigned", "requested"])
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (checksError) {
    throw new Error(`개인 체크 상태를 조회하지 못했습니다: ${checksError.message}`);
  }
  if (assignmentsError) {
    throw new Error(`공유 준비물 담당을 조회하지 못했습니다: ${assignmentsError.message}`);
  }

  const checkedIds = new Set(
    (checks || []).filter((check) => check.checked).map((check) => check.itemid)
  );
  const incompletePersonal = personalItems.filter(
    (item) => !checkedIds.has(item.id)
  );
  const mineIncomplete = (assignments || [])
    .filter(
      (assignment) =>
        assignment.status === "assigned" &&
        assignment.memberid === participant.id &&
        assignment.membertype === participant.type &&
        !assignment.isdone
    )
    .map((assignment) =>
      sharedItems.find((item) => item.id === assignment.itemid)
    )
    .filter(Boolean);
  const shortages = getSharedShortages(sharedItems, assignments || []);

  return {
    personal: incompletePersonal,
    assigned: mineIncomplete,
    shortages,
  };
}

async function sendScheduleReminders(schedule, reminderDate) {
  const client = getSupabase();
  const participants = await getScheduleParticipants(schedule);
  if (participants.length === 0) return;

  const [{ data: room, error: roomError }, { data: roomItems, error: itemError }] =
    await Promise.all([
      client
        .from("rooms")
        .select("roomname")
        .eq("id", schedule.roomid)
        .maybeSingle(),
      client
        .from("prep_items")
        .select("id, name, kind, neededcount")
        .eq("scheduleid", schedule.id),
    ]);

  if (roomError) {
    throw new Error(`방 이름을 조회하지 못했습니다: ${roomError.message}`);
  }
  if (itemError) {
    throw new Error(`준비물 목록을 조회하지 못했습니다: ${itemError.message}`);
  }
  if (!roomItems?.length) return;

  const link = `/schedules/${schedule.id}/prep`;
  const notificationRows = [];

  for (const participant of participants) {
    const incomplete = await getIncompleteItems(schedule, participant);
    const personalAndAssigned = [
      ...getItemNames(incomplete.personal),
      ...getItemNames(incomplete.assigned),
    ];
    const shortageNames = incomplete.shortages.map(
      (item) => `${item.name} (${item.confirmedCount}/${item.neededcount}명, ${item.shortageCount}명 부족)`
    );

    if (personalAndAssigned.length === 0 && shortageNames.length === 0) continue;

    const sections = [];
    if (personalAndAssigned.length) {
      sections.push(`내가 아직 안 챙긴 것: ${personalAndAssigned.join(", ")}`);
    }
    if (shortageNames.length) {
      sections.push(`담당 인원이 부족한 항목: ${shortageNames.join(", ")}`);
    }

    notificationRows.push({
      roomid: schedule.roomid,
      receiverid: participant.id,
      senderid: null,
      type: "prep_reminder",
      title: "🎒 내일 일정 준비물 확인",
      message: `[${room?.roomname || "모임"}] ${schedule.title || "내일 일정"} 준비물을 확인해 주세요. ${sections.join(" · ")}`,
      link,
      isread: false,
      issilent: !participant.notificationEnabled,
      idempotency_key: getPrepReminderIdempotencyKey(
        schedule.id,
        participant,
        schedule.date
      ),
    });
  }

  if (notificationRows.length === 0) return;

  const { error: insertError } = await client
    .from("notifications")
    .upsert(notificationRows, {
      onConflict: "idempotency_key",
      ignoreDuplicates: true,
    });
  if (insertError) {
    throw new Error(`전날 준비물 알림을 저장하지 못했습니다: ${insertError.message}`);
  }

  console.log(
    `✅ [준비물 알림] 일정 ${schedule.id}, ${notificationRows.length}명 알림 전송 (${reminderDate})`
  );
}

async function checkAndSendPrepReminders(now = new Date()) {
  if (!isWithinPrepReminderRecoveryWindow(now)) return;
  const kst = getKstDate(now);

  const reminderDate = dateKey(kst);
  const targetDate = getTomorrowKey(now);
  const { data: schedules, error } = await getSupabase()
    .from("confirmed_schedules")
    .select("id, roomid, title, date, absentees")
    .eq("date", targetDate);

  if (error) {
    throw new Error(`내일 확정 일정을 조회하지 못했습니다: ${error.message}`);
  }

  for (const schedule of schedules || []) {
    try {
      await sendScheduleReminders(schedule, reminderDate);
    } catch (scheduleError) {
      console.error(
        `❌ [준비물 알림] 일정 ${schedule.id} 처리 실패:`,
        scheduleError
      );
    }
  }
}

function startPrepReminderJob() {
  console.log("🚀 [백엔드] 전날 준비물 알림 작업 활성화됨 (1분 간격)");

  checkAndSendPrepReminders().catch((error) =>
    console.error("❌ [준비물 알림] 시작 시 검사 실패:", error)
  );

  setInterval(() => {
    checkAndSendPrepReminders().catch((error) =>
      console.error("❌ [준비물 알림] 주기 검사 실패:", error)
    );
  }, 60_000);
}

module.exports = {
  checkAndSendPrepReminders,
  getIncompleteItems,
  getKstDateBounds,
  getTomorrowKey,
  startPrepReminderJob,
};
