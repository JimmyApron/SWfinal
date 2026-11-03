import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { confirmRecommendedCourse } from '../../api/directRecommendationApi';
import CourseRecommendationResultPage from './CourseRecommendationResultPage';
import { useLocation, useNavigate } from 'react-router-dom';
jest.mock('react-router-dom', () => ({ useLocation: jest.fn(), useNavigate: jest.fn(), useParams: () => ({ roomid: '1' }) }));
jest.mock('../../lib/supabaseClient', () => ({ supabase: {} }));
jest.mock('../../api/directRecommendationApi', () => ({ confirmRecommendedCourse: jest.fn() }));
jest.mock('../../components/map/KakaoMapView', () => function Map({ places, routePath, numberedPlaces }) {
  return <div data-testid="course-map" data-places={JSON.stringify(places)} data-route={JSON.stringify(routePath)} data-numbered={String(numberedPlaces)} />;
});

beforeEach(() => {
  jest.clearAllMocks();
  window.scrollTo = jest.fn();
});

test('상세를 펼칠 때만 유효한 좌표의 방문 순서 지도 표시', async () => {
  useNavigate.mockReturnValue(jest.fn());
  useLocation.mockReturnValue({ search: '', state: { schedule: { id: 2, roomid: 1 }, recommendation: { courses: [{
    id: 'map', name: '지도 코스', stops: [
      { placeName: '첫 장소', latitude: 37.5, longitude: 127 },
      { placeName: '좌표 없음', latitude: null, longitude: null },
      { placeName: '세 번째', lat: '37.6', lng: '127.1' },
    ],
  }] } } });
  render(<CourseRecommendationResultPage />);
  expect(screen.queryByTestId('course-map')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '코스 상세 보기' }));
  const map = screen.getByTestId('course-map');
  expect(JSON.parse(map.dataset.places)).toEqual([
    expect.objectContaining({ name: '첫 장소', lat: 37.5, lng: 127, orderNumber: 1 }),
    expect.objectContaining({ name: '세 번째', lat: 37.6, lng: 127.1, orderNumber: 3 }),
  ]);
  expect(map.dataset.route).toBeUndefined();
  expect(map.dataset.numbered).toBe('true');
  await screen.findByText('이동 수단 정보가 없어 경로를 표시할 수 없습니다.');
  fireEvent.click(screen.getByRole('button', { name: '코스 상세 접기' }));
  expect(screen.queryByTestId('course-map')).not.toBeInTheDocument();
});

test('이동 시간과 식사·활동·대기를 포함한 전체 코스 시간을 분리한다', () => {
  useNavigate.mockReturnValue(jest.fn());
  useLocation.mockReturnValue({ search: '', state: { schedule: { id: 2, roomid: 1 }, recommendation: { courses: [{
    id: 'duration', name: '시간 구분 코스', travelMode: 'transit',
    estimatedTravelTimeMin: 33, totalDurationMin: 608,
    stops: [{ id: 'p1', placeName: '카페' }],
  }] } } });
  render(<CourseRecommendationResultPage />);
  expect(screen.getByText('대중교통 이동')).toBeInTheDocument();
  expect(screen.getByText('예상 이동 합계 약 33분')).toBeInTheDocument();
  expect(screen.getByText('코스 전체 약 10시간 8분 · 식사·활동·대기 포함')).toBeInTheDocument();
  expect(screen.queryByText('대중교통 이동 · 약 10시간 8분')).not.toBeInTheDocument();
});

test('추천 한 코스를 바로 확정하면 투표 대신 일정 상세 화면으로 이동', async () => {
  const navigate = jest.fn();
  useNavigate.mockReturnValue(navigate);
  const course = { id: 'direct', name: '바로 갈 코스', stops: [{ placeName: '카페' }] };
  useLocation.mockReturnValue({ search: '', state: { schedule: { id: 2, roomid: 1 }, recommendation: { courses: [course] } } });
  confirmRecommendedCourse.mockResolvedValue({ course_id: 3 });
  render(<CourseRecommendationResultPage />);
  fireEvent.click(screen.getByRole('button', { name: '이 코스로 바로 확정' }));
  expect(screen.getByRole('button', { name: '확정 중…' })).toBeDisabled();
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/rooms/1/confirmed-schedule', {
    state: { schedule: { id: 2, roomid: 1 } },
    replace: true,
  }));
  expect(confirmRecommendedCourse).toHaveBeenCalledWith({ roomId: 1, scheduleId: 2, course });
});

test('확정 실패를 표시하고 다시 시도할 수 있음', async () => {
  useNavigate.mockReturnValue(jest.fn());
  useLocation.mockReturnValue({ search: '', state: { schedule: { id: 2, roomid: 1 },
    recommendation: { courses: [{ id: 'fail', name: '실패 코스', stops: [{ placeName: '카페' }] }] } } });
  confirmRecommendedCourse.mockRejectedValue(new Error('일정 생성자만 확정할 수 있습니다.'));
  render(<CourseRecommendationResultPage />);
  fireEvent.click(screen.getByRole('button', { name: '이 코스로 바로 확정' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('일정 생성자만');
  expect(screen.getByRole('button', { name: '이 코스로 바로 확정' })).toBeEnabled();
});

test('기본 카드는 요약만 보여주고 상세보기 아래에 장소·비용·체류 시간을 펼친다', () => {
  useNavigate.mockReturnValue(jest.fn());
  const course = { id: 'detail', name: '상세 코스', estimatedTravelTimeMin: 12, stops: [
    { id: 'a', placeName: '식당', placeAddress: '서울 식당 주소', visitStartTime: '12:00', visitEndTime: '13:00', expectedStayMin: 60, estimatedCost: 15000 },
    { id: 'b', placeName: '카페', placeAddress: '서울 카페 주소', travelTimeFromPrevMin: 12, distanceFromPrevM: 800 },
  ] };
  useLocation.mockReturnValue({ search: '', state: { schedule: { id: 2, roomid: 1 }, recommendation: { courses: [course] } } });
  render(<CourseRecommendationResultPage />);
  expect(screen.queryByRole('region', { name: '상세 코스 상세 정보' })).not.toBeInTheDocument();
  expect(screen.queryByText('식당')).not.toBeInTheDocument();
  expect(screen.queryByText('1인 15,000원')).not.toBeInTheDocument();
  expect(screen.queryByText('60분 체류')).not.toBeInTheDocument();
  expect(screen.queryByText('서울 식당 주소')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '코스 상세 보기' }));
  expect(screen.getByRole('button', { name: '코스 상세 접기' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('서울 식당 주소')).toBeInTheDocument();
  expect(screen.getByText(/방문 시간: 12:00 ~ 13:00/)).toBeInTheDocument();
  expect(screen.getByText(/이전 장소에서 이동: 12분 · 800m/)).toBeInTheDocument();
  expect(screen.getAllByText('식당')).toHaveLength(1);
  expect(screen.getByText('1인 15,000원')).toBeInTheDocument();
  expect(screen.getByText('60분 체류')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '코스 상세 접기' }));
  expect(screen.queryByText('서울 식당 주소')).not.toBeInTheDocument();
  expect(screen.queryByText('1인 15,000원')).not.toBeInTheDocument();
  expect(screen.queryByText('60분 체류')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '코스 상세 보기' })).toHaveAttribute('aria-expanded', 'false');
});

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
    form: draft.form, mode: 'direct', courses: [draft.courses[0], expect.objectContaining({ course_name: '2. 새 추천' })],
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
  expect(screen.getByText('1인 예상 비용')).toBeInTheDocument();
  expect(screen.getByText('5,000~10,000원')).toBeInTheDocument();
  expect(screen.queryByText(/실제 이용 요금은 다를 수 있습니다/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '코스 상세 보기' }));
  expect(screen.getByText(/실제 이용 요금은 다를 수 있습니다/)).toHaveTextContent('선택한 예산 안에 가능한지 확인해 주세요.');
  expect(screen.getByText('평점 정보 없음')).toBeInTheDocument();
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
