import { supabase } from "../lib/supabaseClient";
import { getApiBaseUrl } from "./apiBaseUrl";

// 시간표 캡처(에브리타임 등)를 읽어 수업 블록을 돌려받는다. (이미지는 서버에 남지 않는다)
// 반환: [{ weekday, starttime, endtime }]
export async function recognizeTimetableImage(file) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;

  const formData = new FormData();
  formData.append("image", file);

  const response = await fetch(`${getApiBaseUrl()}/timetable/ocr`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message || "시간표를 인식하지 못했어요.");
  return body.classes;
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
  const { error: deleteError } = await supabase
    .from("fixed_timetables")
    .delete()
    .eq("userid", userId);

  if (deleteError) throw new Error("기존 고정 시간표 삭제 실패");

  if (blocks.length === 0) return;

  const { error: insertError } = await supabase.from("fixed_timetables").insert(
    blocks.map((block) => ({
      userid: userId,
      weekday: block.weekday,
      starttime: block.starttime,
      endtime: block.endtime,
    }))
  );

  if (insertError) throw new Error("고정 시간표 저장 실패");
}
