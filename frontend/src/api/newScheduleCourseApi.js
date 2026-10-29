import { createScheduleWithCreator } from './scheduleCreationApi';
import { createCourseWithStops, getCurrentRoomParticipantInfo, ensureScheduleExists } from './courseApi';
import { finalizeDirectCourse, getScheduleCreator } from './courseFinalizationApi';
import { createVote } from './voteApi';
import { buildCourseVoteDbRows, normalizeCourseVoteSelection, getCourseVoteDefaults } from '../utils/courseVoteUtils';
import { timeMinutes } from '../utils/mealTimeUtils';
import { validCoordinate } from '../utils/courseRoadmapUtils';

export function validateNewScheduleCourse({ schedule, mode, courses = [], selectedCourseId }) {
  if (!['none', 'direct', 'vote'].includes(mode)) return '코스 저장 방식을 선택해 주세요.';
  if (mode === 'none') return '';
  if (schedule.isallday) return '코스를 추가하려면 하루종일을 해제하고 시작·종료 시간을 정해 주세요.';
  if (!courses.length) return '코스를 1개 이상 후보에 추가해 주세요.';
  if (mode === 'direct' && !courses.some(course => String(course.courseid) === String(selectedCourseId))) return '일정에 바로 사용할 코스 하나를 선택해 주세요.';
  const names = courses.map(course => String(course.course_name || '').trim());
  if (names.some(name => !name) || new Set(names).size !== names.length) return '후보마다 다른 코스 이름을 입력해 주세요.';
  const start = timeMinutes(schedule.starttime, NaN);
  const end = timeMinutes(schedule.endtime, NaN);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return '일정 시작·종료 시간을 확인해 주세요.';
  for (const course of courses) {
    const rows = buildCourseVoteDbRows(course);
    if (!rows.stops.length) return '각 코스에 장소를 1곳 이상 추가해 주세요.';
    let previousEnd = start;
    for (const stop of rows.stops) {
      const visitStart = timeMinutes(stop.visit_start_time, NaN);
      const visitEnd = timeMinutes(stop.visit_end_time, NaN);
      if (!validCoordinate(stop.latitude, stop.longitude) || !Number.isFinite(visitStart) || !Number.isFinite(visitEnd) ||
          visitStart < previousEnd || visitEnd <= visitStart || visitEnd > end) return `"${course.course_name}"의 시간표가 일정과 맞지 않습니다. 코스를 수정해 주세요.`;
      previousEnd = visitEnd;
    }
  }
  return '';
}

// Each acknowledged stage is retained by the caller for retrying without
// creating another schedule after a course/vote/finalization failure.
export async function saveNewScheduleWithCourse({ schedule, mode, courses = [], selectedCourseId,
  voteTitle, progress = {}, onProgress = () => {} }) {
  const invalid = validateNewScheduleCourse({ schedule, mode, courses, selectedCourseId });
  if (invalid) throw new Error(invalid);
  let state = { ...progress, courses: [...(progress.courses || [])] };
  const checkpoint = patch => { state = { ...state, ...patch }; onProgress(state); };
  if (state.orphanScheduleId) throw new Error(`일정 ${state.orphanScheduleId}은 이미 생성됐지만 생성자 기록을 확인하지 못했습니다. 새로 만들지 말고 일정 목록을 확인해 주세요.`);
  if (!state.schedule) {
    const { data, error } = await createScheduleWithCreator(schedule);
    if (error) {
      if (error.scheduleId) checkpoint({ orphanScheduleId: error.scheduleId });
      throw error;
    }
    checkpoint({ schedule: data });
  }
  if (mode === 'none') return state;
  const savedSchedule = await ensureScheduleExists(state.schedule.id, Number(schedule.roomid));
  const actor = await getCurrentRoomParticipantInfo(schedule.roomid);
  const creator = await getScheduleCreator(savedSchedule.id);
  if (!creator || creator.created_by_type !== actor.participantType || String(actor.participantId) !== String(
    actor.participantType === 'member' ? creator.created_by_member_id : creator.created_by_guest_id)) {
    throw new Error('이 일정을 만든 참여자로 다시 시도해 주세요.');
  }
  const chosen = mode === 'direct' ? courses.filter(course => String(course.courseid) === String(selectedCourseId)) : courses;
  for (let index = 0; index < chosen.length; index += 1) {
    if (state.courses[index]) continue;
    const rows = buildCourseVoteDbRows(chosen[index]);
    const saved = await createCourseWithStops({ roomId: Number(schedule.roomid), scheduleId: savedSchedule.id,
      courseName: rows.course_name, recommendationCondition: rows.recommendation_condition,
      estimatedTotalDurationMin: rows.estimated_total_duration_min, estimatedTravelTimeMin: rows.estimated_travel_time_min,
      estimatedCostPerPerson: rows.estimated_cost_per_person, stops: rows.stops });
    checkpoint({ courses: [...state.courses, { ...chosen[index], id: saved.id, courseid: saved.id, stops: saved.stops }] });
  }
  if (mode === 'direct' && !state.finalization) {
    const finalization = await finalizeDirectCourse({ roomId: Number(schedule.roomid), scheduleId: savedSchedule.id, courseId: state.courses[0].id });
    checkpoint({ finalization });
  }
  if (mode === 'vote' && !state.vote) {
    const vote = await createVote({ ...getCourseVoteDefaults(), roomid: Number(schedule.roomid), scheduleid: savedSchedule.id,
      title: voteTitle?.trim() || `${schedule.title || '새 일정'} 코스 투표`, userid: actor.participantId,
      nickname: actor.nickname || (actor.participantType === 'guest' ? '게스트' : '회원'),
      options: normalizeCourseVoteSelection(state.courses), endtimeenabled: false, endtime: null, reminderenabled: false });
    checkpoint({ vote });
  }
  return state;
}
