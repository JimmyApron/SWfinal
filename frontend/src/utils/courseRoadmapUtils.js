export function roadmapPath(roomId, scheduleId) {
  return `/rooms/${roomId}/schedules/${scheduleId}/final-course`;
}

export function validCoordinate(latitude, longitude) {
  return latitude !== null && latitude !== undefined && String(latitude).trim() !== "" &&
    longitude !== null && longitude !== undefined && String(longitude).trim() !== "" &&
    Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude)) &&
    Math.abs(Number(latitude)) <= 90 && Math.abs(Number(longitude)) <= 180;
}

export function orderedStops(stops = []) {
  return [...stops].sort((a, b) => Number(a.stop_order) - Number(b.stop_order))
    .map((stop, index) => ({ ...stop, roadmapNumber: index + 1,
      roadmapId: `${stop.id ?? stop.stop_order}:${index}` }));
}

export function mapPlaces(stops) {
  return stops.filter((stop) => validCoordinate(stop.latitude, stop.longitude)).map((stop) => ({
    id: stop.roadmapId, name: stop.place_name, address: stop.place_address,
    lat: Number(stop.latitude), lng: Number(stop.longitude), orderNumber: stop.roadmapNumber,
    kakaoMapUrl: externalMapLink(stop),
  }));
}

export function numberInfo(value, unit = "") {
  if (value === null || value === undefined || String(value).trim() === "" || !Number.isFinite(Number(value)) || Number(value) < 0) return "정보 없음";
  return `${Number(value).toLocaleString("ko-KR")}${unit}`;
}

export function externalMapLink(stop) {
  if (stop.place_source === "kakao" && /^\d+$/.test(String(stop.place_id || ""))) {
    return `https://place.map.kakao.com/${stop.place_id}`;
  }
  if (validCoordinate(stop.latitude, stop.longitude) && stop.place_name) {
    return `https://map.kakao.com/link/map/${encodeURIComponent(stop.place_name)},${Number(stop.latitude)},${Number(stop.longitude)}`;
  }
  return null;
}

export function parseCourseShare(content) {
  if (typeof content !== "string") return null;
  try {
    const meta = JSON.parse(content);
    if (meta?.__type !== "finalized_course") return null;
    const validId = (id) => typeof id === "string" && /^[1-9]\d*$/.test(id);
    if (meta.version !== 1 || ![meta.roomId, meta.scheduleId, meta.courseId].every(validId)) return { invalid: true };
    return meta;
  } catch {
    return /"__type"\s*:\s*"finalized_course"/.test(content) ? { invalid: true } : null;
  }
}
