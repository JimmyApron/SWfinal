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
    condition: expect.objectContaining({ travelMode: 'walking', maxTravelMinutes: 20, budget: 25000, minRating: 0, priority: 'travel' }),
  })));
  expect(JSON.parse(localStorage.getItem('course_recommendation_condition_40_177')).budget).toBe(25000);
});
test('예산 제한을 다시 해제하면 빈 값으로 전달', async () => {
  setup({ locationlat: 37, locationlng: 127 });
  const unlimited = screen.getByRole('checkbox', { name: '예산 제한 없음' });
  fireEvent.click(unlimited);
  fireEvent.click(unlimited);
  fireEvent.click(screen.getByRole('button', { name: /추천받기/ }));
  await waitFor(() => expect(generateRecommendationResult).toHaveBeenCalledWith(expect.objectContaining({ condition: expect.objectContaining({ budget: '' }) })));
});
test('과거 평점 조건은 초기화하고 평점 UI를 제거', () => {
  localStorage.setItem('course_recommendation_condition_40_177', JSON.stringify({ minRating: 4.5, priority: 'rating' }));
  setup({ locationlat: 37, locationlng: 127 });
  expect(screen.queryByRole('button', { name: '4.5점 이상' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '평점 우선' })).not.toBeInTheDocument();
  expect(screen.queryByText(/평점/)).not.toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem('course_recommendation_condition_40_177'))).toMatchObject({ minRating: 0, priority: 'travel', ratingProviderAvailable: false });
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
