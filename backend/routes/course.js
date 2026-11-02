const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const router = express.Router();

// 최종 확정 기록은 클라이언트(anon)로는 지울 수 없게 막혀 있어서, 확정 해제는 service role 로 처리한다.
// 그래서 먼저 "요청자가 그 방의 회원/게스트인지"를 확인한다.
let admin;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function getAdmin() {
  if (admin) return admin;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new HttpError(503, "backend/.env에 SUPABASE_SERVICE_ROLE_KEY를 설정해 주세요.");
  }
  admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

async function authenticate(req, roomId) {
  const client = getAdmin();
  const bearer = (req.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1];
  const guestId = req.headers["x-guest-id"];

  if (bearer) {
    const { data, error } = await client.auth.getUser(bearer);
    if (!error && data?.user) {
      const { data: member } = await client
        .from("room_members")
        .select("userid, nickname")
        .eq("roomid", roomId)
        .eq("userid", data.user.id)
        .maybeSingle();
      if (!member) throw new HttpError(403, "이 방의 멤버만 이용할 수 있어요.");
      let nickname = member.nickname;
      if (!nickname) {
        const { data: profile } = await client.from("profiles").select("nickname").eq("id", data.user.id).maybeSingle();
        nickname = profile?.nickname;
      }
      return { id: String(data.user.id), type: "member", nickname };
    }
  }

  if (guestId && /^[0-9a-f-]{36}$/i.test(String(guestId))) {
    const { data: guest } = await client
      .from("room_guests")
      .select("id, nickname")
      .eq("roomid", roomId)
      .eq("id", String(guestId))
      .maybeSingle();
    if (!guest) throw new HttpError(403, "이 방의 멤버만 이용할 수 있어요.");
    return { id: String(guest.id), type: "guest", nickname: guest.nickname };
  }

  throw new HttpError(401, "로그인하거나 게스트로 입장한 뒤 이용해 주세요.");
}

async function notifyCourseChange({ schedule, actor, type, title, message }) {
  const client = getAdmin();
  const [{ data: members }, { data: guests }, { data: room }] = await Promise.all([
    client.from("room_members").select("userid, schedulenotifenabled").eq("roomid", schedule.roomid),
    client.from("room_guests").select("id, schedulenotifenabled").eq("roomid", schedule.roomid),
    client.from("rooms").select("roomname").eq("id", schedule.roomid).maybeSingle(),
  ]);
  const prefix = room?.roomname ? `[${room.roomname}] ` : "";
  const name = actor.nickname || "참여자";
  const receivers = [
    ...(members || []).map((row) => ({ id: String(row.userid), silent: row.schedulenotifenabled === false })),
    ...(guests || []).map((row) => ({ id: String(row.id), silent: row.schedulenotifenabled === false })),
  ].filter((receiver) => receiver.id !== actor.id);
  if (receivers.length === 0) return;

  const { error } = await client.from("notifications").insert(
    receivers.map((receiver) => ({
      roomid: schedule.roomid,
      receiverid: receiver.id,
      senderid: actor.id,
      type,
      title: title(name),
      message: `${prefix}${name}님이 ${message(schedule.title || "일정")}`,
      link: `/rooms/${schedule.roomid}?tab=schedule&scheduleId=${schedule.id}`,
      isread: false,
      issilent: receiver.silent,
    }))
  );
  if (error) throw new Error(error.message);
}

// 최종 확정된 코스를 해제해 다시 정할 수 있게 한다. (코스 자체는 지우지 않는다)
router.post("/reset-finalization", async (req, res) => {
  try {
    const scheduleId = Number(req.body?.scheduleId);
    if (!Number.isSafeInteger(scheduleId) || scheduleId <= 0) {
      throw new HttpError(400, "scheduleId가 올바르지 않습니다.");
    }

    const client = getAdmin();
    const { data: schedule, error: scheduleError } = await client
      .from("confirmed_schedules")
      .select("id, roomid, title")
      .eq("id", scheduleId)
      .maybeSingle();
    if (scheduleError) throw new Error(scheduleError.message);
    if (!schedule) throw new HttpError(404, "일정을 찾을 수 없어요.");

    const actor = await authenticate(req, schedule.roomid);

    const { data: removed, error: deleteError } = await client
      .from("schedule_finalizations")
      .delete()
      .eq("schedule_id", scheduleId)
      .select("id");
    if (deleteError) throw new Error(deleteError.message);
    if (!removed?.length) throw new HttpError(404, "확정된 코스가 없어요.");

    // 다시 투표할 수 있도록 코스 투표를 연다. (실패해도 해제는 유지)
    const { error: reopenError } = await client
      .from("votes")
      .update({ isclosed: false })
      .eq("scheduleid", scheduleId)
      .eq("votetype", "course");
    if (reopenError) console.error("코스 투표 다시 열기 실패:", reopenError.message);

    await notifyCourseChange({
      schedule, actor, type: "course_reset", title: (name) => `${name}님이 확정 코스를 해제했어요`,
      message: (title) => `"${title}"의 확정 코스를 해제했어요. 새 코스를 정해 주세요.`,
    }).catch((error) =>
      console.error("코스 해제 알림 실패:", error.message)
    );

    res.json({ reset: true });
  } catch (error) {
    if (!(error instanceof HttpError)) console.error("코스 확정 해제 실패:", error);
    res
      .status(error.status || 500)
      .json({ message: error instanceof HttpError ? error.message : "코스 확정을 해제하지 못했습니다." });
  }
});

const STOP_COLUMNS = [
  "place_id", "place_source", "place_name", "place_address", "category", "latitude", "longitude",
  "visit_start_time", "visit_end_time", "expected_stay_min", "travel_time_from_prev_min",
  "distance_from_prev_m", "image_url", "estimated_cost", "rating",
];

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanStop(raw, index) {
  const name = String(raw?.place_name || "").trim().slice(0, 200);
  const latitude = numberOrNull(raw?.latitude);
  const longitude = numberOrNull(raw?.longitude);
  if (!name || latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new HttpError(400, `${index + 1}번째 장소 정보가 올바르지 않아요.`);
  }
  const stay = numberOrNull(raw?.expected_stay_min);
  if (stay === null || stay < 1 || stay > 1440) {
    throw new HttpError(400, `${index + 1}번째 장소의 체류 시간을 확인해 주세요.`);
  }
  const time = (value) => (/^\d{2}:\d{2}/.test(String(value || "")) ? String(value).slice(0, 5) : null);
  const row = {
    place_id: String(raw?.place_id ?? ""),
    place_source: String(raw?.place_source || "manual").slice(0, 30),
    place_name: name,
    place_address: String(raw?.place_address || "").slice(0, 300),
    category: raw?.category ? String(raw.category).slice(0, 100) : null,
    latitude,
    longitude,
    visit_start_time: time(raw?.visit_start_time),
    visit_end_time: time(raw?.visit_end_time),
    expected_stay_min: Math.round(stay),
    travel_time_from_prev_min: Math.max(0, Math.round(numberOrNull(raw?.travel_time_from_prev_min) ?? 0)),
    distance_from_prev_m: Math.max(0, Math.round(numberOrNull(raw?.distance_from_prev_m) ?? 0)),
    image_url: raw?.image_url ? String(raw.image_url).slice(0, 1000) : null,
    estimated_cost: numberOrNull(raw?.estimated_cost),
    rating: numberOrNull(raw?.rating),
  };
  return STOP_COLUMNS.reduce((acc, column) => ({ ...acc, [column]: row[column] }), { stop_order: index + 1 });
}

// 최종 확정된 코스의 방문 장소를 통째로 바꾼다. (추가·삭제·순서 변경·체류 시간 수정)
router.post("/update-stops", async (req, res) => {
  try {
    const scheduleId = Number(req.body?.scheduleId);
    if (!Number.isSafeInteger(scheduleId) || scheduleId <= 0) {
      throw new HttpError(400, "scheduleId가 올바르지 않습니다.");
    }
    const rawStops = req.body?.course?.stops;
    if (!Array.isArray(rawStops) || rawStops.length < 1 || rawStops.length > 20) {
      throw new HttpError(400, "방문 장소는 1~20곳이어야 해요.");
    }
    const stops = rawStops.map(cleanStop);

    const client = getAdmin();
    const { data: schedule, error: scheduleError } = await client
      .from("confirmed_schedules")
      .select("id, roomid, title")
      .eq("id", scheduleId)
      .maybeSingle();
    if (scheduleError) throw new Error(scheduleError.message);
    if (!schedule) throw new HttpError(404, "일정을 찾을 수 없어요.");

    const actor = await authenticate(req, schedule.roomid);

    const { data: finalization, error: finalizationError } = await client
      .from("schedule_finalizations")
      .select("course_id")
      .eq("schedule_id", scheduleId)
      .maybeSingle();
    if (finalizationError) throw new Error(finalizationError.message);
    if (!finalization) throw new HttpError(404, "확정된 코스가 없어요.");

    const courseId = finalization.course_id;
    const { data: previousStops, error: previousError } = await client
      .from("course_stops")
      .select("*")
      .eq("course_id", courseId);
    if (previousError) throw new Error(previousError.message);

    const { error: deleteError } = await client.from("course_stops").delete().eq("course_id", courseId);
    if (deleteError) throw new Error(deleteError.message);

    const { error: insertError } = await client
      .from("course_stops")
      .insert(stops.map((stop) => ({ ...stop, course_id: courseId })));
    if (insertError) {
      // 새 장소 저장에 실패하면 원래 장소를 되돌려 코스가 비지 않게 한다.
      if (previousStops?.length) {
        const { error: restoreError } = await client.from("course_stops").insert(previousStops);
        if (restoreError) console.error("코스 장소 복구 실패:", restoreError.message);
      }
      throw new Error(insertError.message);
    }

    const course = req.body.course;
    const { error: courseError } = await client
      .from("courses")
      .update({
        estimated_total_duration_min: numberOrNull(course.estimated_total_duration_min),
        estimated_travel_time_min: numberOrNull(course.estimated_travel_time_min),
        estimated_cost_per_person: numberOrNull(course.estimated_cost_per_person),
      })
      .eq("id", courseId);
    if (courseError) console.error("코스 요약 갱신 실패:", courseError.message);

    await notifyCourseChange({
      schedule, actor, type: "course_updated", title: (name) => `${name}님이 확정 코스를 수정했어요`,
      message: (title) => `"${title}"의 확정 코스를 수정했어요. 바뀐 코스를 확인해 보세요.`,
    }).catch((error) => console.error("코스 수정 알림 실패:", error.message));

    res.json({ updated: true });
  } catch (error) {
    if (!(error instanceof HttpError)) console.error("코스 수정 실패:", error);
    res
      .status(error.status || 500)
      .json({ message: error instanceof HttpError ? error.message : "코스를 수정하지 못했습니다." });
  }
});

module.exports = router;
