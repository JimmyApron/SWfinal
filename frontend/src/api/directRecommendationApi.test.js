import { confirmRecommendedCourse } from './directRecommendationApi';
import { createCourseWithStops, getCurrentRoomParticipantInfo } from './courseApi';
import { finalizeDirectCourse, getFinalizedCourse, getScheduleCreator } from './courseFinalizationApi';
import { replaceFinalizedCourse } from './courseRoadmapApi';

jest.mock('./courseApi');
jest.mock('./courseFinalizationApi');
jest.mock('./courseRoadmapApi', () => ({ replaceFinalizedCourse: jest.fn() }));
const request = { roomId: 1, scheduleId: 2, course: { name: '추천', stops: [{ placeName: '카페', lat: 37, lng: 127 }] } };
beforeEach(() => {
  jest.clearAllMocks();
  getCurrentRoomParticipantInfo.mockResolvedValue({ participantType: 'member', participantId: 'owner' });
  getScheduleCreator.mockResolvedValue({ created_by_type: 'member', created_by_member_id: 'owner' });
  getFinalizedCourse.mockResolvedValue(null);
  createCourseWithStops.mockResolvedValue({ id: 3 });
  finalizeDirectCourse.mockResolvedValue({ course_id: 3 });
  replaceFinalizedCourse.mockResolvedValue({ course_id: 3, replaced: true });
});
test('추천 장소를 저장하고 투표 없이 해당 코스를 확정', async () => {
  await expect(confirmRecommendedCourse(request)).resolves.toEqual({ course_id: 3 });
  expect(createCourseWithStops).toHaveBeenCalledWith(expect.objectContaining({ roomId: 1, scheduleId: 2,
    courseName: '추천', stops: [expect.objectContaining({ place_name: '카페', latitude: 37, longitude: 127 })] }));
  expect(finalizeDirectCourse).toHaveBeenCalledWith({ roomId: 1, scheduleId: 2, courseId: 3 });
});
test('일정 생성자가 아닌 모임 참여자도 확정 가능', async () => {
  getScheduleCreator.mockResolvedValue({ created_by_type: 'member', created_by_member_id: 'other' });
  await expect(confirmRecommendedCourse(request)).resolves.toEqual({ course_id: 3 });
});
test('모임 참여자가 아니면 코스 저장 전 차단', async () => {
  getCurrentRoomParticipantInfo.mockRejectedValue(new Error('모임 참여자만 이용할 수 있습니다.'));
  await expect(confirmRecommendedCourse(request)).rejects.toThrow('참여자');
  expect(createCourseWithStops).not.toHaveBeenCalled();
});
test('이미 확정된 일정도 새 코스를 저장한 뒤 기존 확정 대상만 교체한다', async () => {
  getFinalizedCourse.mockResolvedValue({ course_id: 9 });
  await expect(confirmRecommendedCourse(request)).resolves.toEqual({ course_id: 3, replaced: true });
  expect(createCourseWithStops).toHaveBeenCalled();
  expect(replaceFinalizedCourse).toHaveBeenCalledWith(2, 3, 9);
  expect(finalizeDirectCourse).not.toHaveBeenCalled();
});

test('동일한 확정 코스를 다시 선택하면 교체 없이 재사용한다', async () => {
  getFinalizedCourse.mockResolvedValue({ course_id: 3 });
  await expect(confirmRecommendedCourse(request)).resolves.toEqual({ course_id: 3 });
  expect(replaceFinalizedCourse).not.toHaveBeenCalled();
});

test('동시 변경 오류를 전달하고 확정을 삭제하거나 다시 생성하지 않는다', async () => {
  getFinalizedCourse.mockResolvedValue({ course_id: 9 });
  replaceFinalizedCourse.mockRejectedValue(new Error('다른 참여자가 확정 코스를 변경했습니다.'));
  await expect(confirmRecommendedCourse(request)).rejects.toThrow('다른 참여자');
  expect(finalizeDirectCourse).not.toHaveBeenCalled();
});
test('코스 저장 실패 시 확정하지 않음', async () => {
  createCourseWithStops.mockRejectedValue(new Error('저장 실패'));
  await expect(confirmRecommendedCourse(request)).rejects.toThrow('저장 실패');
  expect(finalizeDirectCourse).not.toHaveBeenCalled();
  expect(replaceFinalizedCourse).not.toHaveBeenCalled();
});
