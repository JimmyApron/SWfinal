import { getApiBaseUrl } from "./apiBaseUrl";
import { courseCombinationKey, courseOverlapCount, generateCourseRecommendations } from "../utils/courseRecommendationEngine";

export function deduplicateRecommendationResult(payload) {
  if (!payload || !Array.isArray(payload.courses)) return null;
  const seen = new Set();
  const accepted = [];
  const courses = payload.courses.filter((course) => {
    if (!Array.isArray(course?.stops) || !course.stops.length) return false;
    const signature = courseCombinationKey(course.stops);
    if (seen.has(signature)) return false;
    if (accepted.some(stops => courseOverlapCount(stops, course.stops) >= 2)) return false;
    seen.add(signature);
    accepted.push(course.stops);
    return true;
  }).slice(0, 5);
  return { ...payload, courses };
}

// 지도의 도보 선과 같은 서버 API(/route/walking, 서버 캐시 공유)에서 실제 도보 시간(초)·거리(m)를 가져온다.
async function fetchWalkingRoute(from, to) {
  const response = await fetch(`${getApiBaseUrl()}/route/walking`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      origin: { lat: Number(from.latitude), lng: Number(from.longitude) },
      destination: { lat: Number(to.latitude), lng: Number(to.longitude) },
    }),
  });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

// 직선거리 기반 추정치를 티맵 보행자 경로의 실제 도보 시간·거리로 교체한다.
// 개별 구간 조회에 실패하면 그 구간은 기존 추정치를 그대로 둔다.
export async function applyWalkingRouteTimes(course) {
  const cache = new Map();
  const lookup = (from, to) => {
    const key = `${from.latitude},${from.longitude}>${to.latitude},${to.longitude}`;
    if (!cache.has(key)) cache.set(key, fetchWalkingRoute(from, to).catch(() => null));
    return cache.get(key);
  };

  const stops = await Promise.all(course.stops.map(async (stop, index) => {
    const previous = course.stops[index - 1];
    if (!previous || [previous, stop].some(s => s.latitude == null || s.longitude == null)) return stop;
    const route = await lookup(previous, stop);
    if (!route || !Number.isFinite(route.duration) || !Number.isFinite(route.distance)) return stop;
    return { ...stop, travelTimeFromPrevMin: Math.max(1, Math.round(route.duration / 60)), distanceFromPrevM: Math.round(route.distance) };
  }));

  const estimatedTravelTimeMin = stops.reduce((sum, stop, index) => sum + (index ? stop.travelTimeFromPrevMin || 0 : 0), 0);
  return { ...course, stops, estimatedTravelTimeMin };
}

export async function generateRecommendationResult({ condition, schedule }) {
  const result = await generateCourseRecommendations({ condition, schedule });
  if (!result?.courses?.length || !["walking", "walk"].includes(result.condition?.travelMode)) return result;
  return { ...result, courses: await Promise.all(result.courses.map(applyWalkingRouteTimes)) };
}

export function getCourseRecommendationStorageKey(roomId, scheduleId) {
  const safeRoomId = Number(roomId) || "unknown";
  const safeScheduleId = Number(scheduleId) || "unknown";
  return `course_recommendation_result_${safeRoomId}_${safeScheduleId}`;
}

export function saveRecommendationResultToStorage(roomId, scheduleId, payload) {
  if (typeof window === "undefined") return;
  const key = getCourseRecommendationStorageKey(roomId, scheduleId);
  window.localStorage.setItem(key, JSON.stringify(deduplicateRecommendationResult(payload)));
}

export function loadRecommendationResultFromStorage(roomId, scheduleId) {
  if (typeof window === "undefined") return null;
  const key = getCourseRecommendationStorageKey(roomId, scheduleId);
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return deduplicateRecommendationResult(JSON.parse(raw));
  } catch {
    return null;
  }
}
