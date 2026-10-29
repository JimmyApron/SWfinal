import { courseCombinationKey, generateCourseRecommendations } from "../utils/courseRecommendationEngine";

export function deduplicateRecommendationResult(payload) {
  if (!payload || !Array.isArray(payload.courses)) return null;
  const seen = new Set();
  const courses = payload.courses.filter((course) => {
    if (!Array.isArray(course?.stops) || !course.stops.length) return false;
    const signature = courseCombinationKey(course.stops);
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  }).slice(0, 5);
  return { ...payload, courses };
}

export async function generateRecommendationResult({ condition, schedule }) {
  return generateCourseRecommendations({ condition: condition ? { ...condition, minRating: 0, ratingProviderAvailable: false, priority: condition.priority === "rating" ? "travel" : condition.priority } : condition, schedule });
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
