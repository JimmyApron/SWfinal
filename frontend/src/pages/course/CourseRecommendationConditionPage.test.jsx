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
