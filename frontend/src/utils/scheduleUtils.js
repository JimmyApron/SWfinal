function timeToMinutes(time) {
  if (!time) return 0;
  if (time === "24:00") return 24 * 60;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes) {
  if (minutes >= 24 * 60) return "24:00";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function expandToSlots(starttime, endtime) {
  const slots = [];
  let current = timeToMinutes(starttime);
  const end = timeToMinutes(endtime);
  while (current < end) {
    slots.push(minutesToTime(current));
    current += 30;
  }
  return slots;
}

export function getTopAvailableTimes(availabilities) {
  if (!availabilities || availabilities.length === 0) return [];

  // 날짜별 슬롯 맵: date -> { "HH:MM_HH:MM" -> Set<userid> }
  const dateSlotMap = {};

  availabilities.forEach((item) => {
    const { date, starttime, endtime, userid } = item;
    if (!date || !userid) return;

    if (!dateSlotMap[date]) dateSlotMap[date] = {};

    const effectiveStart = starttime || "00:00";
    const effectiveEnd = endtime || "24:00";

    expandToSlots(effectiveStart, effectiveEnd).forEach((slotStart) => {
      const slotMinutes = timeToMinutes(slotStart);
      const slotEnd = minutesToTime(slotMinutes + 30);
      const key = `${slotStart}_${slotEnd}`;
      if (!dateSlotMap[date][key]) dateSlotMap[date][key] = new Set();
      dateSlotMap[date][key].add(userid);
    });
  });

  // 날짜별로 연속된 슬롯 중 같은 사용자 집합이면 병합
  const allBlocks = [];

  Object.entries(dateSlotMap).forEach(([date, slotMap]) => {
    const sortedSlots = Object.entries(slotMap).sort(([a], [b]) =>
      timeToMinutes(a.split("_")[0]) - timeToMinutes(b.split("_")[0])
    );

    let currentBlock = null;

    sortedSlots.forEach(([slotKey, users]) => {
      const [slotStart, slotEnd] = slotKey.split("_");
      const userSetKey = [...users].sort().join(",");

      if (
        currentBlock &&
        currentBlock.endtime === slotStart &&
        currentBlock.userSetKey === userSetKey
      ) {
        currentBlock.endtime = slotEnd;
      } else {
        if (currentBlock) allBlocks.push(currentBlock);
        currentBlock = {
          date,
          starttime: slotStart,
          endtime: slotEnd,
          users: new Set(users),
          userSetKey,
        };
      }
    });

    if (currentBlock) allBlocks.push(currentBlock);
  });

  // 가능 인원 내림차순 → 겹치는 시간 길이 내림차순
  return allBlocks
    .map((block) => ({
      date: block.date,
      starttime: block.starttime,
      endtime: block.endtime,
      availableCount: block.users.size,
      duration: timeToMinutes(block.endtime) - timeToMinutes(block.starttime),
    }))
    .sort((a, b) => {
      if (b.availableCount !== a.availableCount) return b.availableCount - a.availableCount;
      return b.duration - a.duration;
    })
    .slice(0, 10);
}
