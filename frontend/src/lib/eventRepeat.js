const pad = (n) => String(n).padStart(2, "0");
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (key) => new Date(`${key}T00:00:00`);

// 방 공용 일정(roomid 있음)만 반복을 적용한다. 개인 일정은 시작 날짜 구간만 표시한다.
export function isRepeatingRoomEvent(event) {
  const shared = Boolean(event?.roomid) || (Array.isArray(event?.roomids) && event.roomids.length > 0);
  return shared && Boolean(event.repeat) && event.repeat !== "none";
}

function addRepeat(start, repeat, n) {
  if (repeat === "daily") return new Date(start.getFullYear(), start.getMonth(), start.getDate() + n);
  if (repeat === "weekly") return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7 * n);
  const months = repeat === "yearly" ? 12 * n : n;
  const target = new Date(start.getFullYear(), start.getMonth() + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(start.getDate(), last));
  return target;
}

// firstKey~lastKey 범위에 걸치는 일정의 [시작 Date, 종료 Date] 목록 (반복 포함)
// personal: true 이면 roomid 없는 개인 일정도 반복을 펼친다 (홈 캘린더용)
export function getEventSpans(event, firstKey, lastKey, { personal = false } = {}) {
  const start = parse(event.date);
  const spanDays = Math.round((parse(event.enddate || event.date) - start) / 86400000);
  const first = parse(firstKey);
  const last = parse(lastKey);
  const spans = [];
  const repeats = personal ? Boolean(event.repeat) && event.repeat !== "none" : isRepeatingRoomEvent(event);
  for (let n = 0; n < 5000; n += 1) {
    const s = repeats ? addRepeat(start, event.repeat, n) : start;
    if (s > last) break;
    const e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + spanDays);
    if (e >= first) spans.push([s, e]);
    if (!repeats) break;
  }
  return spans;
}

// 화면에 표시할 날짜 키 목록
export function getEventDayKeys(event, firstKey, lastKey, options) {
  const keys = [];
  getEventSpans(event, firstKey, lastKey, options).forEach(([s, e]) => {
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      const key = toKey(d);
      if (key >= firstKey && key <= lastKey) keys.push(key);
    }
  });
  return keys;
}

// 알림 계산용: 기준 시각 부근의 각 회차 시작 시각
export function getEventStartTimes(event, aroundMs, windowDays) {
  const around = new Date(aroundMs);
  const firstKey = toKey(new Date(around.getFullYear(), around.getMonth(), around.getDate() - 1));
  const lastKey = toKey(new Date(around.getFullYear(), around.getMonth(), around.getDate() + windowDays));
  const time = (event.starttime || "00:00").slice(0, 5);
  return getEventSpans(event, firstKey, lastKey)
    .map(([s]) => new Date(`${toKey(s)}T${time}:00`))
    .filter((d) => !Number.isNaN(d.getTime()));
}
