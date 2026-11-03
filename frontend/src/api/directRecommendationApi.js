import { createCourseWithStops, getCurrentRoomParticipantInfo } from './courseApi';
import { finalizeDirectCourse, getFinalizedCourse } from './courseFinalizationApi';
import { buildCourseVoteDbRows } from '../utils/courseVoteUtils';
import { replaceFinalizedCourse } from './courseRoadmapApi';

export async function confirmRecommendedCourse({ roomId, scheduleId, course }) {
  if (!roomId || !scheduleId || !course?.stops?.length) throw new Error('확정할 일정과 코스를 확인해 주세요.');
  // 모임 참여자가 아니면 여기서 예외가 난다. 일정 생성자가 아니어도 확정할 수 있다.
  await getCurrentRoomParticipantInfo(roomId);
  const existing = await getFinalizedCourse(scheduleId);
  const rows = buildCourseVoteDbRows(course);
  const saved = await createCourseWithStops({ roomId, scheduleId, courseName: rows.course_name,
    recommendationCondition: rows.recommendation_condition,
    estimatedTotalDurationMin: rows.estimated_total_duration_min,
    estimatedTravelTimeMin: rows.estimated_travel_time_min,
    estimatedCostPerPerson: rows.estimated_cost_per_person, stops: rows.stops });
  if (existing && String(existing.course_id) !== String(saved.id)) {
    return replaceFinalizedCourse(scheduleId, saved.id, existing.course_id);
  }
  return finalizeDirectCourse({ roomId, scheduleId, courseId: saved.id });
}
