import { validCoordinate } from './courseRoadmapUtils';

export function validRecommendationCenter(center) {
  return Boolean(center && validCoordinate(center.lat, center.lng));
}

export function scheduleRecommendationCenter(schedule) {
  const center = { lat: schedule?.locationlat ?? schedule?.lat, lng: schedule?.locationlng ?? schedule?.lng,
    name: schedule?.location || '일정의 확정 장소', address: schedule?.locationaddress || '' };
  return validRecommendationCenter(center) ? { ...center, lat: Number(center.lat), lng: Number(center.lng) } : null;
}

export function validRecommendationRadius(value) {
  const radius = Number(value);
  return value != null && value !== '' && Number.isFinite(radius) && radius >= 500 && radius <= 5000;
}
