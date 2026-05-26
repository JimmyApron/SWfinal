export async function addEventToGoogleCalendar({ title, date, starttime, endtime }) {
  const token = localStorage.getItem("google_calendar_token");
  const expiry = Number(localStorage.getItem("google_calendar_token_expiry") || 0);
  if (!token || Date.now() > expiry) return;

  const start = starttime
    ? { dateTime: `${date}T${starttime}:00`, timeZone: "Asia/Seoul" }
    : { date };
  const end = endtime
    ? { dateTime: `${date}T${endtime}:00`, timeZone: "Asia/Seoul" }
    : starttime
    ? { dateTime: `${date}T${starttime}:00`, timeZone: "Asia/Seoul" }
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
    console.error("구글 캘린더 추가 실패:", err);
  }
}
