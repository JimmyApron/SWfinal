import { createCourseWithStops, getCurrentRoomParticipantInfo } from './courseApi';
import { finalizeDirectCourse, getFinalizedCourse, getScheduleCreator } from './courseFinalizationApi';
import { buildCourseVoteDbRows } from '../utils/courseVoteUtils';

export async function confirmRecommendedCourse({ roomId, scheduleId, course }) {
  if (!roomId || !scheduleId || !course?.stops?.length) throw new Error('확정할 일정과 코스를 확인해 주세요.');
  const actor = await getCurrentRoomParticipantInfo(roomId);
  const creator = await getScheduleCreator(scheduleId);
  const creatorId = actor.participantType === 'member' ? creator?.created_by_member_id : creator?.created_by_guest_id;
  if (!creator || creator.created_by_type !== actor.participantType || String(creatorId) !== String(actor.participantId)) {
    throw new Error('직접 코스 지정은 해당 일정을 만든 참여자만 할 수 있습니다.');
  }
  const existing = await getFinalizedCourse(scheduleId);
  if (existing) throw new Error('이미 코스가 최종 확정된 일정입니다. 확정 코스를 확인해 주세요.');
  const rows = buildCourseVoteDbRows(course);
  const saved = await createCourseWithStops({ roomId, scheduleId, courseName: rows.course_name,
    recommendationCondition: rows.recommendation_condition,
    estimatedTotalDurationMin: rows.estimated_total_duration_min,
    estimatedTravelTimeMin: rows.estimated_travel_time_min,
    estimatedCostPerPerson: rows.estimated_cost_per_person, stops: rows.stops });
  return finalizeDirectCourse({ roomId, scheduleId, courseId: saved.id });
}
