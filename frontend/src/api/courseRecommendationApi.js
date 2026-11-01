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

export async function generateRecommendationResult({ condition, schedule }) {
  return generateCourseRecommendations({ condition, schedule });
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
