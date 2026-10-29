// 고정 시간표 셀 <-> 블록 변환, 후보 일정 자동 채움에 쓰는 순수 함수 모음.
// 셀 키는 `${weekday}-${HH:MM}` (30분 단위).

export const TIME_SLOTS = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, "0");
  const m = i % 2 === 0 ? "00" : "30";
  return `${h}:${m}`;
});

export function getNextSlotTime(time) {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + 30;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function blocksToCells(blocks) {
  const cells = new Set();
  blocks.forEach((block) => {
    TIME_SLOTS.forEach((time) => {
      if (time >= block.starttime && time < block.endtime) {
        cells.add(`${block.weekday}-${time}`);
      }
    });
  });
  return cells;
}

export function cellsToBlocks(cells) {
  const blocks = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    let current = null;
    TIME_SLOTS.forEach((time) => {
      if (cells.has(`${weekday}-${time}`)) {
        if (current) {
          current.endtime = getNextSlotTime(time);
        } else {
          current = { weekday, starttime: time, endtime: getNextSlotTime(time) };
        }
      } else if (current) {
        blocks.push(current);
        current = null;
      }
    });
    if (current) blocks.push(current);
  }
  return blocks;
}

export function getWeekday(dateString) {
  return new Date(`${dateString}T00:00:00`).getDay();
}

export function isSlotBusy(blocks, weekday, time) {
  return blocks.some(
    (block) => block.weekday === weekday && time >= block.starttime && time < block.endtime
  );
}

export function hasFixedTimetableConflict(blocks, dateString, starttime, endtime, allDay = false) {
  const weekday = getWeekday(dateString);
  return blocks.some((block) =>
    block.weekday === weekday &&
    (allDay || (block.starttime < endtime.slice(0, 5) && starttime.slice(0, 5) < block.endtime))
  );
}
