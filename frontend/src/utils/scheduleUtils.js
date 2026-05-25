export function getTopAvailableTimes(availabilities) {
  const timeMap = {};

  availabilities.forEach((item) => {
    const key = `${item.date}_${item.starttime}_${item.endtime}`;

    if (!timeMap[key]) {
      timeMap[key] = {
        date: item.date,
        starttime: item.starttime,
        endtime: item.endtime,
        users: new Set(),
      };
    }

    timeMap[key].users.add(item.userid);
  });

  const result = Object.values(timeMap)
    .map((item) => ({
      date: item.date,
      starttime: item.starttime,
      endtime: item.endtime,
      availableCount: item.users.size,
    }))
    .sort((a, b) => b.availableCount - a.availableCount)
    .slice(0, 5);

  return result;
}