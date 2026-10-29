import { supabase } from "../lib/supabaseClient";
import { getApiBaseUrl } from "./apiBaseUrl";
import { hasFixedTimetableConflict } from "../utils/fixedTimetableUtils";

// 시간표 캡처(에브리타임 등)를 읽어 수업 블록을 돌려받는다. (이미지는 서버에 남지 않는다)
// 반환: [{ weekday, starttime, endtime }]
export async function recognizeTimetableImage(file, { signal } = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;

  const formData = new FormData();
  formData.append("image", file);

  let response;
  try {
    response = await fetch(`${getApiBaseUrl()}/timetable/ocr`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
      signal,
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("네트워크 연결을 확인하고 다시 시도해 주세요.");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message || "시간표를 인식하지 못했어요.");
  return { classes: body.classes, partial: Boolean(body.partial) };
}

// 반환: [{ weekday: 0~6, starttime: "HH:MM", endtime: "HH:MM" }]
export async function getFixedTimetable(userId) {
  const { data, error } = await supabase
    .from("fixed_timetables")
    .select("weekday, starttime, endtime")
    .eq("userid", userId)
    .order("weekday", { ascending: true })
    .order("starttime", { ascending: true });

  if (error) throw new Error("고정 시간표 조회 실패");

  return (data || []).map((row) => ({
    weekday: row.weekday,
    starttime: row.starttime.slice(0, 5),
    endtime: row.endtime.slice(0, 5),
  }));
}

export async function saveFixedTimetable(userId, blocks) {
  const current = await getFixedTimetable(userId);
  const normalize = (items) => [...items]
    .map(({ weekday, starttime, endtime }) => ({ weekday, starttime: starttime.slice(0, 5), endtime: endtime.slice(0, 5) }))
    .sort((a, b) => a.weekday - b.weekday || a.starttime.localeCompare(b.starttime) || a.endtime.localeCompare(b.endtime));
  const expected = normalize(current);
  const next = normalize(blocks);
  if (JSON.stringify(expected) === JSON.stringify(next)) return { changed: false };

  const { error } = await supabase.rpc("save_my_fixed_timetable", {
    p_user_id: userId,
    p_expected_blocks: expected,
    p_blocks: next,
  });

  if (!error) return { changed: true };

  // A request can commit while the response is lost. Read back before reporting failure.
  try {
    const saved = normalize(await getFixedTimetable(userId));
    if (JSON.stringify(saved) === JSON.stringify(next)) return { changed: true, recovered: true };
  } catch (_) {
    throw new Error("저장 결과를 확인하지 못했어요. 다시 불러와 확인해 주세요.");
  }

  if (error.code === "40001") throw new Error("다른 기기에서 시간표가 변경됐어요. 최신 내용을 불러온 뒤 다시 저장해 주세요.");
  throw new Error("고정 시간표 저장에 실패했어요. 기존 시간표는 유지됐어요.");
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localTimeString(date = new Date()) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export async function getFixedTimetableConflicts(userId, blocks) {
  const { data: memberships, error: memberError } = await supabase
    .from("room_members")
    .select("roomid, rooms(roomname)")
    .eq("userid", userId);
  if (memberError) throw new Error("참여 중인 모임 일정을 확인하지 못했어요.");

  const roomIds = [...new Set((memberships || []).map((row) => Number(row.roomid)))];
  if (!roomIds.length) return { confirmed: [], availability: [] };

  const today = localDateString();
  const timeNow = localTimeString();
  const [{ data: schedules, error: scheduleError }, { data: dismissed, error: dismissedError }, { data: choices, error: choiceError }] = await Promise.all([
    supabase.from("confirmed_schedules").select("id, roomid, title, date, starttime, endtime, isallday, absentees").in("roomid", roomIds).or(`date.gte.${today},date.is.null`),
    supabase.from("dismissed_schedules").select("scheduleid").eq("userid", userId),
    supabase.from("member_availabilities").select("roomid, candidateid, date, starttime, endtime").eq("userid", userId).in("roomid", roomIds).gte("date", today),
  ]);
  if (scheduleError || dismissedError || choiceError) throw new Error("일정 충돌을 확인하지 못했어요.");

  const roomNames = new Map((memberships || []).map((row) => [Number(row.roomid), row.rooms?.roomname || "모임"]));
  const dismissedIds = new Set((dismissed || []).map((row) => Number(row.scheduleid)));
  const confirmed = (schedules || []).filter((schedule) => {
    if (!schedule.date || schedule.date < today || dismissedIds.has(Number(schedule.id))) return false;
    if (schedule.date === today && !schedule.isallday && schedule.endtime?.slice(0, 5) <= timeNow) return false;
    if ((schedule.absentees || []).map(String).includes(String(userId))) return false;
    return hasFixedTimetableConflict(blocks, schedule.date, schedule.starttime || "00:00", schedule.endtime || "24:00", Boolean(schedule.isallday));
  }).map((schedule) => ({ ...schedule, roomname: roomNames.get(Number(schedule.roomid)) }));

  const availability = (choices || []).filter((choice) =>
    choice.date >= today && hasFixedTimetableConflict(blocks, choice.date, choice.starttime, choice.endtime)
  ).map((choice) => ({ ...choice, roomname: roomNames.get(Number(choice.roomid)) }));

  return { confirmed, availability };
}
