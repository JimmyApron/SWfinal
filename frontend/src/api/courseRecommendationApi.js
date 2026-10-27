import { generateCourseRecommendations } from "../utils/courseRecommendationEngine";

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
  window.localStorage.setItem(key, JSON.stringify(payload));
}

export function loadRecommendationResultFromStorage(roomId, scheduleId) {
  if (typeof window === "undefined") return null;
  const key = getCourseRecommendationStorageKey(roomId, scheduleId);
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
