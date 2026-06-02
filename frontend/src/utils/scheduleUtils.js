export function getTodayStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

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

  return allBlocks.map((block) => ({
    date: block.date,
    starttime: block.starttime,
    endtime: block.endtime,
    availableCount: block.users.size,
    duration: timeToMinutes(block.endtime) - timeToMinutes(block.starttime),
  }));
}

/**
 * 정렬 방식에 따라 당일 결과를 정렬해서 반환
 * sortBy: "count" | "duration"
 */
export function sortAvailableTimes(blocks, sortBy = "count") {
  return [...blocks]
    .sort((a, b) => {
      if (sortBy === "duration") {
        if (b.duration !== a.duration) return b.duration - a.duration;
        return b.availableCount - a.availableCount;
      }
      // default: count
      if (b.availableCount !== a.availableCount) return b.availableCount - a.availableCount;
      return b.duration - a.duration;
    })
    .slice(0, 10);
}

/**
 * N일 연속 조합 중 가능 인원이 많은 순으로 반환
 * candidates: [{ date, ... }]
 * availabilities: [{ date, userid, ... }]
 * nDays: 연속 일수
 */
export function getTopConsecutiveDays(availabilities, candidates, nDays) {
  if (!availabilities || !candidates || nDays < 1) return [];

  // 후보 날짜 목록 (중복 제거 후 정렬)
  const candidateDates = [...new Set(candidates.map((c) => c.date).filter(Boolean))].sort();

  if (candidateDates.length < nDays) return [];

  // 사용자별 가능 날짜 Set
  const userDates = {};
  availabilities.forEach(({ date, userid }) => {
    if (!date || !userid) return;
    if (!userDates[userid]) userDates[userid] = new Set();
    userDates[userid].add(date);
  });

  const results = [];

  for (let i = 0; i <= candidateDates.length - nDays; i++) {
    const sequence = candidateDates.slice(i, i + nDays);

    // 실제 날짜가 연속(하루 간격)인지 확인
    let isConsecutive = true;
    for (let j = 1; j < sequence.length; j++) {
      const prev = new Date(sequence[j - 1] + "T00:00:00");
      const curr = new Date(sequence[j] + "T00:00:00");
      const diffDays = Math.round((curr - prev) / (1000 * 60 * 60 * 24));
      if (diffDays !== 1) { isConsecutive = false; break; }
    }
    if (!isConsecutive) continue;

    // 모든 날에 가능한 인원 계산
    let availableCount = 0;
    const availableUsers = [];
    Object.entries(userDates).forEach(([userId, dates]) => {
      if (sequence.every((d) => dates.has(d))) {
        availableCount++;
        availableUsers.push(userId);
      }
    });

    results.push({
      dates: sequence,
      startDate: sequence[0],
      endDate: sequence[sequence.length - 1],
      availableCount,
      availableUsers,
    });
  }

  return results
    .sort((a, b) => b.availableCount - a.availableCount)
    .slice(0, 10);
}
