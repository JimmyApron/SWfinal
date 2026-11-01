import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CourseRecommendationConditionPage from './CourseRecommendationConditionPage';
import { useLocation, useNavigate } from 'react-router-dom';
import { generateRecommendationResult } from '../../api/courseRecommendationApi';
jest.mock('react-router-dom', () => ({ useParams: () => ({ roomid: '40' }), useLocation: jest.fn(), useNavigate: jest.fn() }));
jest.mock('../../lib/supabaseClient', () => ({ supabase: {} }));
jest.mock('../../api/courseRecommendationApi', () => ({ generateRecommendationResult: jest.fn() }));
jest.mock('../../components/RecommendationAreaPicker', () => function Picker({ center, radius, onChange, onRadiusChange }) {
  return <div><span>{center ? `중심 ${center.lat}` : '선택 전'}</span>
    <button onClick={() => onChange({ lat: 35, lng: 129, name: '선택 지점', address: '' })}>지도 선택</button>
    <button onClick={() => onRadiusChange(3000)}>반경 변경</button><span>반경 {radius}</span></div>;
});
beforeEach(() => {
  localStorage.clear();
  useNavigate.mockReturnValue(jest.fn());
  generateRecommendationResult.mockReset().mockResolvedValue({ courses: [] });
});
const setup = (extra = {}) => {
  useLocation.mockReturnValue({ search: '', state: { schedule: { id: 177, roomid: 40, title: '일정', ...extra } } });
  return render(<CourseRecommendationConditionPage />);
};

test('0원 예산에 식사를 선택하면 추천 요청 전에 이유와 해결 방법을 안내', async () => {
  setup({ locationlat: 37, locationlng: 127, starttime: '09:00', endtime: '21:00' });
  fireEvent.click(screen.getByRole('button', { name: '식사' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '점심 먹기' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '예산 제한 없음' }));
  fireEvent.change(screen.getByRole('slider', { name: '1인당 최대 예산' }), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: /추천받기/ }));
  expect(screen.getByRole('alert')).toHaveTextContent('1인당 예산이 0원이라 식사가 포함된 코스를 추천할 수 없어요.');
  expect(screen.getByRole('alert')).toHaveTextContent('예산을 늘리거나 식사 선택을 해제해 주세요.');
  expect(generateRecommendationResult).not.toHaveBeenCalled();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: '예산 제한 없음' }));
  fireEvent.click(screen.getByRole('button', { name: /추천받기/ }));
  await waitFor(() => expect(generateRecommendationResult).toHaveBeenCalledTimes(1));
});

test('추천 요청 직후 로딩 화면을 표시하고 완료되면 결과로 이동', async () => {
  let finish;
  generateRecommendationResult.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const navigate = jest.fn();
  useNavigate.mockReturnValue(navigate);
  setup({ locationlat: 37, locationlng: 127 });
  const button = screen.getByRole('button', { name: /추천받기/ });
  fireEvent.click(button);
  expect(screen.getByRole('status')).toHaveTextContent('나에게 맞는 코스를 찾고 있어요');
  expect(screen.getByRole('progressbar', { name: '코스 추천 진행 중' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /추천받기/ })).not.toBeInTheDocument();
  fireEvent.click(button);
  expect(generateRecommendationResult).toHaveBeenCalledTimes(1);
  finish({ courses: [] });
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/rooms/40/course-recommendation-result', expect.any(Object)));
});

test('추천 실패 시 로딩을 종료하고 오류와 재시도 버튼을 표시', async () => {
  generateRecommendationResult.mockRejectedValueOnce(new Error('장소 조회에 실패했습니다.'));
  setup({ locationlat: 37, locationlng: 127 });
  fireEvent.click(screen.getByRole('button', { name: /추천받기/ }));
  expect(await screen.findByText('장소 조회에 실패했습니다.')).toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /추천받기/ }));
  await waitFor(() => expect(generateRecommendationResult).toHaveBeenCalledTimes(2));
});

test('주점 2차 선택을 저장·전달하고 낮 일정은 요청 전에 안내', async () => {
  setup({ locationlat: 37, locationlng: 127, starttime: '10:00', endtime: '16:00' });
  fireEvent.click(screen.getByRole('button', { name: '주점' }));
  fireEvent.click(screen.getByRole('radio', { name: /^저녁 먹고 2차/ }));
  fireEvent.click(screen.getByRole('button', { name: /추천받기/ }));
  expect(screen.getByRole('alert')).toHaveTextContent('저녁 식사와 2차 주점을 방문할 시간이 부족');
  expect(generateRecommendationResult).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem('course_recommendation_condition_40_177'))).toMatchObject({ barMode: 'afterDinner', activities: ['bar'] });
});

test('주점 2차 추천 요청에 방문 방식과 기존 저녁 취향을 전달', async () => {
  setup({ locationlat: 37, locationlng: 127, starttime: '16:00', endtime: '23:00' });
  fireEvent.click(screen.getByRole('button', { name: '주점' }));
  fireEvent.click(screen.getByRole('radio', { name: /^저녁 먹고 2차/ }));
  fireEvent.click(screen.getByRole('button', { name: /추천받기/ }));
  await waitFor(() => expect(generateRecommendationResult).toHaveBeenCalledWith(expect.objectContaining({ condition: expect.objectContaining({ activities: ['bar'], barMode: 'afterDinner' }) })));
});
test('이동 버튼과 예산 슬라이더 값을 저장·전달하고 기존 평점과 우선순위를 유지', async () => {
  setup({ locationlat: 37, locationlng: 127 });
  fireEvent.click(screen.getByRole('button', { name: '도보' }));
  expect(screen.getByRole('button', { name: '도보' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.change(screen.getByRole('slider', { name: '장소 사이 최대 이동 시간' }), { target: { value: '20' } });
  expect(screen.getByRole('slider', { name: '1인당 최대 예산' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: '예산 제한 없음' }));
  fireEvent.change(screen.getByRole('slider', { name: '1인당 최대 예산' }), { target: { value: '25000' } });
  expect(screen.getByText('1인당 최대 25,000원')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /추천받기/ }));
  await waitFor(() => expect(generateRecommendationResult).toHaveBeenCalledWith(expect.objectContaining({
    condition: expect.objectContaining({ travelMode: 'walking', maxTravelMinutes: 20, budget: 25000, minRating: 0, priority: 'rating' }),
  })));
  expect(JSON.parse(localStorage.getItem('course_recommendation_condition_40_177')).budget).toBe(25000);
});
test('카페와 저녁을 선택하면 추천 요청에 두 조건과 일정 시간이 모두 전달', async () => {
  setup({ locationlat: 37, locationlng: 127, starttime: '15:30', endtime: '18:30' });
  fireEvent.click(screen.getByRole('button', { name: '카페' }));
  fireEvent.click(screen.getByRole('button', { name: '식사' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '저녁 먹기' }));
  fireEvent.click(screen.getByRole('button', { name: /추천받기/ }));
  await waitFor(() => expect(generateRecommendationResult).toHaveBeenCalledWith(expect.objectContaining({
    condition: expect.objectContaining({ activities: ['cafe'], mealPreferences: expect.objectContaining({ dinner: 'any' }) }),
    schedule: expect.objectContaining({ starttime: '15:30', endtime: '18:30' }),
  })));
});

test('예산 제한을 다시 해제하면 빈 값으로 전달', async () => {
  setup({ locationlat: 37, locationlng: 127 });
  const unlimited = screen.getByRole('checkbox', { name: '예산 제한 없음' });
  fireEvent.click(unlimited);
  fireEvent.click(unlimited);
  fireEvent.click(screen.getByRole('button', { name: /추천받기/ }));
  await waitFor(() => expect(generateRecommendationResult).toHaveBeenCalledWith(expect.objectContaining({ condition: expect.objectContaining({ budget: '' }) })));
});
test('저장된 평점 조건을 복원하고 구글 평점 UI 표시', () => {
  localStorage.setItem('course_recommendation_condition_40_177', JSON.stringify({ minRating: 4.5, priority: 'rating' }));
  setup({ locationlat: 37, locationlng: 127 });
  expect(screen.getByRole('button', { name: '4.5점 이상' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: '평점 우선' })).toBeInTheDocument();
  expect(screen.getByText('최소 평점 (구글맵 기준)')).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem('course_recommendation_condition_40_177'))).toMatchObject({ minRating: 4.5, priority: 'rating', ratingProviderAvailable: true });
});
test('확정 장소 좌표를 기본 중심으로 설정하고 추천 요청에 포함', async () => {
  setup({ locationlat: 37, locationlng: 127, location: '확정 장소' });
  expect(screen.getByText('중심 37')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /추천/ }));
  await waitFor(() => expect(generateRecommendationResult).toHaveBeenCalledWith(expect.objectContaining({ condition: expect.objectContaining({ searchCenter: expect.objectContaining({ lat: 37, lng: 127 }), searchRadiusMeters: 1500 }) })));
});
test('좌표 없으면 추천 차단, 지도/반경 선택 후 요청·저장', async () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: /추천/ }));
  expect(screen.getByText('지도에서 추천 중심점을 선택해 주세요.')).toBeInTheDocument();
  expect(generateRecommendationResult).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('지도 선택'));
  fireEvent.click(screen.getByText('반경 변경'));
  fireEvent.click(screen.getByRole('button', { name: /추천/ }));
  await waitFor(() => expect(generateRecommendationResult).toHaveBeenCalledWith(expect.objectContaining({ condition: expect.objectContaining({ searchCenter: expect.objectContaining({ lat: 35, lng: 129 }), searchRadiusMeters: 3000 }) })));
  expect(JSON.parse(localStorage.getItem('course_recommendation_condition_40_177')).searchRadiusMeters).toBe(3000);
});

test('투표 초안은 추천 결과 화면으로 전달하고 취소 시 투표 작성으로 복귀', async () => {
  const navigate = jest.fn();
  useNavigate.mockReturnValue(navigate);
  const draft = { title: '작성하던 투표', scheduleId: 177, options: [{ course_name: '직접 코스', stops: [] }] };
  useLocation.mockReturnValue({ search: '', state: { roomId: 40,
    schedule: { id: 177, roomid: 40, locationlat: 37, locationlng: 127 }, courseVoteDraft: draft } });
  render(<CourseRecommendationConditionPage />);
  fireEvent.click(screen.getByRole('button', { name: /추천받기/ }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/rooms/40/course-recommendation-result', expect.objectContaining({
    state: expect.objectContaining({ courseVoteDraft: draft }),
  })));
  fireEvent.click(screen.getByRole('button', { name: '취소' }));
  expect(navigate).toHaveBeenLastCalledWith('/rooms/40/vote-create', expect.objectContaining({ state: expect.objectContaining({ courseVoteDraft: draft }) }));
});

test('새 일정 추천 요청은 저장 ID 없이 가능하고 초안을 결과와 취소 경로에 유지', async () => {
  const navigate = jest.fn(); useNavigate.mockReturnValue(navigate);
  const draft = { form: { title: '새 일정' }, mode: 'vote', courses: [] };
  useLocation.mockReturnValue({ search: '', state: { roomId: 40, schedule: { roomid: 40, locationlat: 37, locationlng: 127 }, newScheduleDraft: draft } });
  render(<CourseRecommendationConditionPage />);
  fireEvent.click(screen.getByRole('button', { name: /추천받기/ }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/rooms/40/course-recommendation-result', expect.objectContaining({
    state: expect.objectContaining({ newScheduleDraft: draft }),
  })));
  fireEvent.click(screen.getByRole('button', { name: '취소' }));
  expect(navigate).toHaveBeenLastCalledWith('/rooms/40/schedules/new', { state: { newScheduleDraft: draft } });
});
