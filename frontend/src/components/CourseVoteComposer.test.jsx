import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import CourseVoteComposer from './CourseVoteComposer';

jest.mock('./map/KakaoMapView', () => function Map({ places }) { return <div data-testid="map">{places.map(p => p.name).join(' → ')}</div>; });
jest.mock('./map/LocationPicker', () => function Picker({ onSelect }) { return <>
  <button onClick={() => onSelect('카페 A', '홍대', { id: '1', lat: 37.55, lng: 126.92 })}>카페 검색 결과</button>
  <button onClick={() => onSelect('식당 B', '홍대', { id: '2', lat: 37.5501, lng: 126.9201 })}>식당 검색 결과</button>
</>; });
const schedule = { id: 3, title: '홍대 약속', starttime: '15:30', endtime: '18:00' };
test('추천 후보의 기존 추정 가격 범위를 표시', () => {
  render(<Fixture initialOptions={[{ course_name: '추천 코스', stop_count: 2, total_duration_min: 120,
    estimated_cost: null, budgetEstimate: { min: 13000, max: 28000 }, stops: [{ placeName: '카페' }] }]} />);
  expect(screen.getByText(/1인 기준 13,000~28,000원/)).toBeInTheDocument();
  expect(screen.queryByText(/비용 정보 확인 필요/)).not.toBeInTheDocument();
});
function Fixture({ initialOptions = [] }) {
  const [options, setOptions] = useState(initialOptions);
  return <CourseVoteComposer schedules={[schedule]} schedule={schedule} scheduleId={3} options={options}
    onChange={setOptions} onScheduleChange={jest.fn()} onRecommend={jest.fn()} />;
}

test('검색 장소 추가 → 순서/체류 수정 → 미리보기 → 후보 추가 → 재편집/삭제', () => {
  render(<Fixture />);
  fireEvent.click(screen.getByRole('button', { name: '직접 만들기' }));
  fireEvent.change(screen.getByLabelText('코스 이름'), { target: { value: '카페와 식사' } });
  fireEvent.click(screen.getByText('카페 검색 결과'));
  fireEvent.click(screen.getByText('식당 검색 결과'));
  expect(screen.getByTestId('map')).toHaveTextContent('카페 A → 식당 B');
  fireEvent.click(screen.getByLabelText('2번째 장소 위로'));
  expect(screen.getByTestId('map')).toHaveTextContent('식당 B → 카페 A');
  fireEvent.change(screen.getByLabelText('1번째 체류 시간'), { target: { value: '45' } });
  fireEvent.click(screen.getByRole('button', { name: '투표 후보에 추가' }));
  expect(screen.getByText('투표 후보 1개')).toBeInTheDocument();
  fireEvent.click(screen.getByText('수정·지도 보기'));
  expect(screen.getByLabelText('1번째 체류 시간')).toHaveValue(45);
  fireEvent.click(screen.getByLabelText('2번째 장소 삭제'));
  fireEvent.click(screen.getByText('후보 수정 완료'));
  expect(screen.getByText(/1곳 · 예상 45분/)).toBeInTheDocument();
  fireEvent.click(screen.getByText('후보 삭제'));
  expect(screen.getByText('투표 후보 0개')).toBeInTheDocument();
});

test('중복 장소 추가와 일정 초과 코스의 후보 추가 차단', () => {
  render(<Fixture />);
  fireEvent.click(screen.getByText('직접 만들기'));
  fireEvent.change(screen.getByLabelText('코스 이름'), { target: { value: '긴 코스' } });
  fireEvent.click(screen.getByText('카페 검색 결과'));
  fireEvent.click(screen.getByText('카페 검색 결과'));
  expect(screen.getByText('이미 추가한 장소입니다.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('1번째 체류 시간'), { target: { value: '180' } });
  expect(screen.getByText(/30분 초과/)).toBeInTheDocument();
  expect(screen.getByText('투표 후보에 추가')).toBeDisabled();
});

test('두 번째 추천 후보의 수정 화면과 지도가 해당 카드 아래에 나타나고 그 후보만 저장', () => {
  const initialOptions = ['첫 추천', '두 번째 추천'].map((name, index) => ({
    course_name: name, stop_count: 1, total_duration_min: 45,
    stops: [{ id: String(index + 1), placeName: `장소 ${index + 1}`, lat: 37.55, lng: 126.92, expectedStayMin: 45 }],
  }));
  render(<Fixture initialOptions={initialOptions} />);
  const [first, second] = screen.getAllByRole('article');
  fireEvent.click(within(second).getByRole('button', { name: '수정·지도 보기' }));
  expect(within(first).queryByLabelText('코스 이름')).not.toBeInTheDocument();
  expect(within(second).getByLabelText('코스 이름')).toHaveValue('두 번째 추천');
  expect(within(second).getByTestId('map')).toHaveTextContent('장소 2');
  expect(screen.getAllByTestId('map')).toHaveLength(1);
  fireEvent.change(within(second).getByLabelText('코스 이름'), { target: { value: '첫 추천' } });
  fireEvent.click(within(second).getByRole('button', { name: '후보 수정 완료' }));
  expect(within(second).getByRole('status')).toHaveTextContent('후보마다 다른 코스 이름');
  fireEvent.change(within(second).getByLabelText('코스 이름'), { target: { value: '두 번째 수정 완료' } });
  fireEvent.change(within(second).getByLabelText('1번째 체류 시간'), { target: { value: '30' } });
  fireEvent.click(within(second).getByRole('button', { name: '후보 수정 완료' }));
  expect(within(first).getByText('첫 추천')).toBeInTheDocument();
  expect(within(second).getByText('두 번째 수정 완료')).toBeInTheDocument();
  expect(within(second).getByText(/1곳 · 예상 30분/)).toBeInTheDocument();
  expect(screen.queryByLabelText('코스 이름')).not.toBeInTheDocument();
  fireEvent.click(within(first).getByRole('button', { name: '수정·지도 보기' }));
  expect(within(first).getByLabelText('코스 이름')).toHaveValue('첫 추천');
  fireEvent.click(within(first).getByRole('button', { name: '편집 취소' }));
  expect(screen.queryByLabelText('코스 이름')).not.toBeInTheDocument();
});
