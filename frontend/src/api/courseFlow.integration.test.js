import { supabase } from '../lib/supabaseClient';
import { mockDatabase } from '../testUtils/mockDatabase';
import { createScheduleWithCreator } from './scheduleCreationApi';
import { createCourseWithStops } from './courseApi';
import { generateRecommendationResult } from './courseRecommendationApi';
import { searchPlacesByKeyword } from './kakaoPlacesApi';
import { buildCourseVoteDbRows, normalizeCourseVoteSelection } from '../utils/courseVoteUtils';
import { createVote, submitVote } from './voteApi';
import { confirmMyVotedCourse } from './courseConfirmationApi';
import { getCourseConfirmationProgress, finalizeCourse } from './courseFinalizationApi';
import { getFinalizedRoadmap, shareFinalizedCourse } from './courseRoadmapApi';
import { parseCourseShare } from '../utils/courseRoadmapUtils';

jest.mock('../lib/supabaseClient', () => ({ supabase: { from: jest.fn(), auth: { getUser: jest.fn() } } }));
jest.mock('./kakaoPlacesApi', () => ({ searchNearbyPlaces: jest.fn(), searchPlacesByKeyword: jest.fn() }));
jest.mock('./notificationApi', () => ({ createRoomNotifications: jest.fn() }));
jest.mock('./mapApi', () => ({ updateRoomLocationTransportModes: jest.fn() }));

test('actual APIs compose: create → recommend → persist two → vote/revote → confirm → finalize → roadmap → share → another participant reads', async () => {
  const db = Object.fromEntries(['confirmed_schedules', 'schedule_creation_records', 'courses', 'course_stops', 'votes', 'voteoptions', 'vote_course_links', 'voteresponses', 'course_member_confirmations', 'schedule_finalizations', 'room_messages'].map((table) => [table, []]));
  db.rooms = [{ id: 1, roomname: '통합 테스트' }];
  db.room_members = [{ roomid: 1, userid: 'member-a' }, { roomid: 1, userid: 'member-b' }];
  db.room_guests = [{ roomid: 1, id: 'guest-a', nickname: '손님' }];
  db.profiles = [{ id: 'member-a', nickname: '생성자' }];
  mockDatabase(supabase, db);
  const asMember = (id) => { localStorage.removeItem('guest_id'); supabase.auth.getUser.mockResolvedValue({ data: { user: { id } }, error: null }); };
  asMember('member-a');
  const created = await createScheduleWithCreator({ roomid: 1, title: '신규 일정', date: '2026-11-01', locationlat: 37, locationlng: 127 });
  expect(created.error).toBeNull();
  const schedule = created.data;
  expect(db.schedule_creation_records[0].created_by_member_id).toBe('member-a');
  searchPlacesByKeyword.mockResolvedValue(Array.from({ length: 8 }, (_, i) => ({ id: String(1000 + i), name: `장소 ${i}`, address: '서울', lat: 37 + i / 1000, lng: 127 + i / 1000, category: '카페', imageUrl: 'https://example.com/image.jpg', rating: 4.5 })));
  const recommendation = await generateRecommendationResult({ schedule, condition: { activities: ['cafe'], travelMode: 'walk', minRating: 0 } });
  expect(recommendation.courses.length).toBeGreaterThanOrEqual(2);
  const savedCourses = [];
  for (const candidate of recommendation.courses.slice(0, 2)) {
    const payload = buildCourseVoteDbRows(candidate);
    savedCourses.push(await createCourseWithStops({ roomId: 1, scheduleId: schedule.id, courseName: payload.course_name,
      recommendationCondition: payload.recommendation_condition, estimatedTotalDurationMin: payload.estimated_total_duration_min,
      estimatedTravelTimeMin: payload.estimated_travel_time_min, estimatedCostPerPerson: payload.estimated_cost_per_person, stops: payload.stops }));
  }
  expect(db.course_stops[0]).toMatchObject({ place_source: 'kakao', place_id: '1000', category: '카페' });
  const vote = await createVote({ roomid: 1, scheduleid: schedule.id, userid: 'member-a', nickname: '생성자', title: '코스 투표', votetype: 'course',
    options: normalizeCourseVoteSelection(savedCourses), ismultiple: false, isanonymous: false, allowaddoption: false });
  expect(db.vote_course_links).toHaveLength(2);
  const [a, b] = db.voteoptions;
  await expect(confirmMyVotedCourse(vote.id, 1)).rejects.toThrow('투표');
  await submitVote(vote.id, [b.id], 'member-a', '생성자');
  await confirmMyVotedCourse(vote.id, 1);
  await submitVote(vote.id, [a.id], 'member-a', '생성자');
  expect(db.course_member_confirmations[0].is_active).toBe(false);
  await confirmMyVotedCourse(vote.id, 1);
  const request = { roomId: 1, scheduleId: schedule.id, voteId: vote.id, courseId: savedCourses[0].id };
  expect((await getCourseConfirmationProgress(request)).canFinalize).toBe(false);
  await expect(finalizeCourse(request)).rejects.toThrow('참석자 전원');
  asMember('member-b');
  await submitVote(vote.id, [a.id], 'member-b', '회원');
  await confirmMyVotedCourse(vote.id, 1);
  localStorage.setItem('guest_id', 'guest-a');
  supabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: { name: 'AuthSessionMissingError' } });
  await submitVote(vote.id, [a.id], 'guest-a', '손님');
  await confirmMyVotedCourse(vote.id, 1);
  await expect(finalizeCourse(request)).rejects.toThrow('일정 생성자만');
  asMember('member-a');
  expect((await getCourseConfirmationProgress(request)).canFinalize).toBe(true);
  await finalizeCourse(request);
  await expect(submitVote(vote.id, [b.id], 'member-a', '생성자')).rejects.toThrow('변경할 수 없습니다');
  const roadmap = await getFinalizedRoadmap(1, schedule.id);
  expect(roadmap.course.id).toBe(savedCourses[0].id);
  await shareFinalizedCourse(1, schedule.id);
  const meta = parseCourseShare(db.room_messages[0].content);
  asMember('member-b');
  expect((await getFinalizedRoadmap(meta.roomId, meta.scheduleId, meta.courseId)).course.stops).toEqual(roadmap.course.stops);
  localStorage.clear();
});
