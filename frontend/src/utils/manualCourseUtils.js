import { validCoordinate } from './courseRoadmapUtils';
import { timeMinutes } from './mealTimeUtils';

const clock = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export function manualStop(place) {
  return {
    id: place.place_id ?? place.id,
    placeSource: place.place_source ?? place.placeSource ?? 'kakao',
    placeName: place.placeName ?? place.place_name ?? place.name ?? '',
    placeAddress: place.placeAddress ?? place.place_address ?? place.address ?? '',
    lat: place.lat ?? place.latitude,
    lng: place.lng ?? place.longitude,
    expectedStayMin: place.expectedStayMin ?? place.expected_stay_min ?? 60,
    category: place.category ?? null,
    estimatedCost: null,
  };
}

function travelMinutes(a, b, mode) {
  const rad = value => value * Math.PI / 180;
  const dLat = rad(Number(b.lat) - Number(a.lat));
  const dLng = rad(Number(b.lng) - Number(a.lng));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(Number(a.lat))) * Math.cos(rad(Number(b.lat))) * Math.sin(dLng / 2) ** 2;
  const distance = 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
  const [speed, minimum] = mode === 'car' ? [500, 3] : mode === 'transit' ? [180, 8] : [80, 5];
  return Math.max(minimum, Math.round(distance / speed));
}

export function buildManualCourse({ name, stops = [], startTime, travelMode = 'walking' }, schedule) {
  const errors = [];
  const start = timeMinutes(startTime, NaN);
  const scheduleStart = timeMinutes(schedule?.starttime, schedule?.isallday ? 0 : NaN);
  const scheduleEnd = timeMinutes(schedule?.endtime, schedule?.isallday ? 1439 : NaN);
  if (!String(name || '').trim()) errors.push('코스 이름을 입력해 주세요.');
  if (!stops.length) errors.push('장소를 1곳 이상 추가해 주세요.');
  if (!Number.isFinite(scheduleStart) || !Number.isFinite(scheduleEnd) || scheduleEnd <= scheduleStart) errors.push('시작·종료 시간이 있는 확정 일정을 선택해 주세요.');
  if (!Number.isFinite(start) || start < scheduleStart) errors.push('코스 시작 시간을 일정 시작 이후로 설정해 주세요.');
  if (!['walking', 'transit', 'car'].includes(travelMode)) errors.push('이동 수단을 선택해 주세요.');
  const normalized = stops.map(manualStop);
  const keys = new Set();
  normalized.forEach((stop, i) => {
    if (!stop.id || !stop.placeName || !validCoordinate(stop.lat, stop.lng)) errors.push(`${i + 1}번째 장소를 검색 결과에서 선택해 주세요.`);
    const key = `${stop.placeSource}:${stop.id}`;
    if (keys.has(key)) errors.push('같은 장소를 한 코스에 중복으로 추가할 수 없습니다.');
    keys.add(key);
    const stay = Number(stop.expectedStayMin);
    if (!Number.isInteger(stay) || stay < 1 || stay > 1440) errors.push(`${i + 1}번째 장소 체류 시간을 1~1440분으로 입력해 주세요.`);
  });
  if (errors.length) return { errors, course: null, overMinutes: 0 };
  let cursor = start;
  let totalTravel = 0;
  const timedStops = normalized.map((stop, index) => {
    const travel = index ? travelMinutes(normalized[index - 1], stop, travelMode) : 0;
    totalTravel += travel;
    cursor += travel;
    const visitStartTime = clock(cursor);
    cursor += Number(stop.expectedStayMin);
    return { ...stop, order: index + 1, expectedStayMin: Number(stop.expectedStayMin),
      travelTimeFromPrevMin: travel, visitStartTime, visitEndTime: clock(cursor) };
  });
  const overMinutes = Math.max(0, cursor - scheduleEnd);
  if (overMinutes) errors.push(`일정 종료 시간을 ${overMinutes}분 초과합니다. 체류 시간이나 장소 수를 줄여 주세요.`);
  return { errors, overMinutes, course: {
    name: name.trim(), summary: `직접 만든 코스 · ${travelMode === 'walking' ? '도보' : travelMode === 'transit' ? '대중교통' : '자동차'} · 이동 시간은 좌표 기반 추정`,
    totalDurationMin: cursor - start, estimatedTravelTimeMin: totalTravel,
    estimatedCostPerPerson: null, stops: timedStops,
    manualDraft: { startTime, travelMode },
  } };
}
