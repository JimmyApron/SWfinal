// DB에서 읽은 시간은 "HH:MM:SS"(Postgres time 타입), 폼 입력은 "HH:MM"으로 들어와 형식이 섞여있다.
// 항상 "HH:MM:SS"로 맞춰서 dateTime을 만들어야 GMT+09(Asia/Seoul) 기준으로 정확히 들어간다.
function toHms(time) {
  const [h = "00", m = "00", s = "00"] = time.split(":");
  return [h, m, s].map((v) => v.padStart(2, "0")).join(":");
}

export async function addEventToGoogleCalendar({ title, date, starttime, endtime }) {
  const token = localStorage.getItem("google_calendar_token");
  const expiry = Number(localStorage.getItem("google_calendar_token_expiry") || 0);
  if (!token || Date.now() > expiry) {
    localStorage.removeItem("google_calendar_token");
    localStorage.removeItem("google_calendar_token_expiry");
    localStorage.removeItem("google_calendar_auto_sync");
    throw new Error("구글 캘린더 토큰이 만료됐습니다. 설정에서 다시 연결해주세요.");
  }

  const start = starttime
    ? { dateTime: `${date}T${toHms(starttime)}`, timeZone: "Asia/Seoul" }
    : { date };
  const end = endtime
    ? { dateTime: `${date}T${toHms(endtime)}`, timeZone: "Asia/Seoul" }
    : starttime
    ? { dateTime: `${date}T${toHms(starttime)}`, timeZone: "Asia/Seoul" }
    : { date };

  const body = { summary: title, start, end };

  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json();
    if (res.status === 401 || res.status === 403) {
      localStorage.removeItem("google_calendar_token");
      localStorage.removeItem("google_calendar_token_expiry");
      throw new Error("구글 캘린더 권한이 없습니다. 설정에서 다시 연결해주세요.");
    }
    throw new Error("구글 캘린더 추가 실패: " + (err.error?.message || res.status));
  }
}
