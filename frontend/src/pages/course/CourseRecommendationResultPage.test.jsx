import { fireEvent, render, screen } from '@testing-library/react';
import CourseRecommendationResultPage from './CourseRecommendationResultPage';
import { useLocation, useNavigate } from 'react-router-dom';
jest.mock('react-router-dom', () => ({ useLocation: jest.fn(), useNavigate: jest.fn(), useParams: () => ({ roomid: '1' }) }));
jest.mock('../../lib/supabaseClient', () => ({ supabase: {} }));

test('아직 저장하지 않은 새 일정도 추천 결과 선택 후 새 일정 초안으로 복귀', () => {
  const navigate = jest.fn();
  useNavigate.mockReturnValue(navigate);
  const draft = { form: { title: '새 약속' }, mode: 'direct', courses: [{ courseid: 'manual', course_name: '기존 후보' }] };
  const course = { id: 'new', name: '새 추천', stops: [{ id: 'p2', placeName: '식당' }] };
  useLocation.mockReturnValue({ search: '', state: { schedule: { roomid: 1, title: '새 약속' },
    recommendation: { courses: [course] }, newScheduleDraft: draft } });
  render(<CourseRecommendationResultPage />);
  fireEvent.click(screen.getByRole('button', { name: '선택한 코스를 일정에 추가' }));
  expect(navigate).toHaveBeenCalledWith('/rooms/1/schedules/new', expect.objectContaining({ state: { newScheduleDraft: expect.objectContaining({
    form: draft.form, mode: 'direct', courses: [draft.courses[0], expect.objectContaining({ course_name: '새 추천' })],
  }) } }));
});
test('state의 중복 조합 제거 후 실제 표시 개수와 투표 전달 일치, 누락 비용 안내', () => {
  const navigate = jest.fn();
  useNavigate.mockReturnValue(navigate);
  const course = { id: 'c1', name: '코스 하나', stops: [{ id: 'p1', placeName: '카페', category: '카페' }], estimatedCostPerPerson: null };
  useLocation.mockReturnValue({ search: '', state: { schedule: { id: 2, roomid: 1, title: '일정' },
    recommendation: { courses: [course, { ...course, id: 'duplicate', name: '이름만 다름' }], warning: '비용 확인 불가' } } });
  render(<CourseRecommendationResultPage />);
  expect(screen.getByText('추천 코스 1개')).toBeInTheDocument();
  expect(screen.queryByText('이름만 다름')).not.toBeInTheDocument();
  expect(screen.getByText('비용 정보 없음')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('비용 확인 불가');
  fireEvent.click(screen.getByRole('button', { name: '선택한 코스로 투표 만들기' }));
  expect(navigate).toHaveBeenCalledWith('/rooms/1/vote-create', expect.objectContaining({ state: expect.objectContaining({ selectedCourses: [course], scheduleId: 2 }) }));
});

test('예산 범위·추정 안내·평점 없음 표시와 선택 데이터 전달', () => {
  const navigate = jest.fn();
  useNavigate.mockReturnValue(navigate);
  const course = { id: 'range', name: '예산 코스', estimatedCostPerPerson: null,
    budgetEstimate: { min: 5000, max: 10000, status: 'uncertain', unknownCount: 0 },
    stops: [{ id: 'p1', placeName: '카페', category: '카페', rating: null }] };
  useLocation.mockReturnValue({ search: '', state: { schedule: { id: 2, roomid: 1 }, recommendation: { courses: [course] } } });
  render(<CourseRecommendationResultPage />);
  expect(screen.getByText('예상 예산: 1인 기준 5,000~10,000원')).toBeInTheDocument();
  expect(screen.getByText(/실제 이용 요금은 다를 수 있습니다/)).toHaveTextContent('예산 충족 여부 확인 필요');
  expect(screen.queryByText(/평점/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '선택한 코스로 투표 만들기' }));
  expect(navigate).toHaveBeenCalledWith('/rooms/1/vote-create', expect.objectContaining({ state: expect.objectContaining({ selectedCourses: [course] }) }));
});

test('기존 투표 초안에 추천 코스를 추가하도록 초안과 선택 결과를 함께 반환', () => {
  const navigate = jest.fn();
  useNavigate.mockReturnValue(navigate);
  const draft = { title: '내 투표', options: [{ course_name: '직접 코스' }], scheduleId: 2 };
  const course = { id: 'new', name: '새 추천', stops: [{ id: 'p2', placeName: '식당' }] };
  useLocation.mockReturnValue({ search: '', state: { schedule: { id: 2, roomid: 1 },
    recommendation: { courses: [course] }, courseVoteDraft: draft } });
  render(<CourseRecommendationResultPage />);
  fireEvent.click(screen.getByRole('button', { name: '선택한 코스를 후보에 추가' }));
  expect(navigate).toHaveBeenCalledWith('/rooms/1/vote-create', expect.objectContaining({ state: expect.objectContaining({
    courseVoteDraft: draft, selectedCourses: [course], scheduleId: 2,
  }) }));
});
