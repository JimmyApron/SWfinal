import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import CourseActivityPreferences from './CourseActivityPreferences';
function Fixture({ schedule = { starttime: '09:00', endtime: '21:00' } }) {
  const [form, setForm] = useState({ activities: [], mealPreferences: { breakfast: null, lunch: null, dinner: null } });
  const [error, setError] = useState('');
  return <><CourseActivityPreferences form={form} schedule={schedule} onChange={setForm} onError={setError} /><p role="alert">{error}</p></>;
}
test('상단 선택 항목만 설정 표시, 끼니 체크 시에만 음식 종류 표시', () => {
  render(<Fixture />);
  expect(screen.queryByLabelText('식사 설정')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '식사' }));
  expect(screen.getByRole('checkbox', { name: '점심 먹기' })).not.toBeChecked();
  expect(screen.queryByRole('group', { name: '점심 음식 종류' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: '점심 먹기' }));
  expect(screen.getByRole('group', { name: '점심 음식 종류' })).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: '아침 먹기' })).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: '식사' }));
  fireEvent.click(screen.getByRole('button', { name: '식사' }));
  expect(screen.getByRole('checkbox', { name: '점심 먹기' })).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: '카페' }));
  expect(screen.getByLabelText('카페 설정')).toBeInTheDocument();
  expect(screen.queryByLabelText('주점 설정')).not.toBeInTheDocument();
});
test('저녁 일정에서 아침 체크는 거부하고 오류 안내', () => {
  render(<Fixture schedule={{ starttime: '18:00', endtime: '22:00' }} />);
  fireEvent.click(screen.getByRole('button', { name: '식사' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '아침 먹기' }));
  expect(screen.getByRole('alert')).toHaveTextContent('일정 시간대에 맞지 않는 선택');
  expect(screen.getByRole('checkbox', { name: '아침 먹기' })).not.toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: '저녁 먹기' }));
  expect(screen.getByRole('checkbox', { name: '저녁 먹기' })).toBeChecked();
});

test('식사는 확인을 누르면 접히고 수정 시 선택을 유지한다', () => {
  render(<Fixture />);
  fireEvent.click(screen.getByRole('button', { name: '식사' }));
  fireEvent.click(screen.getByRole('button', { name: '확인' }));
  expect(screen.getByRole('alert')).toHaveTextContent('먹을 끼니를 하나 이상 선택');
  expect(screen.getByRole('checkbox', { name: '점심 먹기' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: '점심 먹기' }));
  fireEvent.click(screen.getByRole('button', { name: '한식' }));
  expect(screen.getByRole('checkbox', { name: '점심 먹기' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '확인' }));
  expect(screen.queryByRole('checkbox', { name: '점심 먹기' })).not.toBeInTheDocument();
  expect(screen.getByText('식사 선택 완료')).toBeInTheDocument();
  expect(screen.getByText('점심 · 한식')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '수정' }));
  expect(screen.getByRole('checkbox', { name: '점심 먹기' })).toBeChecked();
  expect(screen.getByRole('button', { name: '한식' })).toHaveAttribute('aria-pressed', 'true');
});

test('식사와 놀거리 카드는 각각 상단 확인으로 접히고 선택을 유지하며 수정 가능', () => {
  render(<Fixture />);
  fireEvent.click(screen.getByRole('button', { name: '식사' }));
  fireEvent.click(screen.getByRole('button', { name: '놀거리' }));
  const food = within(screen.getByLabelText('식사 설정'));
  const play = within(screen.getByLabelText('놀거리 설정'));
  fireEvent.click(food.getByRole('checkbox', { name: '점심 먹기' }));
  fireEvent.click(play.getByRole('button', { name: /^방탈출/ }));
  expect(play.getByRole('button', { name: /^방탈출/ })).toHaveAttribute('aria-pressed', 'true');
  expect(play.getByRole('button', { name: /^놀거리 골고루/ })).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(play.getByRole('button', { name: '확인' }));
  expect(play.getByText('놀거리 선택 완료')).toBeInTheDocument();
  expect(play.getByText('방탈출')).toBeInTheDocument();
  expect(play.queryByRole('button', { name: /^볼링/ })).not.toBeInTheDocument();
  expect(food.getByRole('checkbox', { name: '점심 먹기' })).toBeInTheDocument();
  fireEvent.click(food.getByRole('button', { name: '확인' }));
  expect(food.getByText('식사 선택 완료')).toBeInTheDocument();
  fireEvent.click(play.getByRole('button', { name: '수정' }));
  expect(play.getByRole('button', { name: /^방탈출/ })).toHaveAttribute('aria-pressed', 'true');
  expect(food.queryByRole('checkbox')).not.toBeInTheDocument();
});

test('놀거리 미선택 상태에서는 확인해도 접히지 않음', () => {
  render(<Fixture />);
  fireEvent.click(screen.getByRole('button', { name: '놀거리' }));
  const play = within(screen.getByLabelText('놀거리 설정'));
  fireEvent.click(play.getByRole('button', { name: /^놀거리 골고루/ }));
  fireEvent.click(play.getByRole('button', { name: '확인' }));
  expect(screen.getByRole('alert')).toHaveTextContent('놀거리를 하나 이상 선택해 주세요.');
  expect(play.getByRole('button', { name: /^방탈출/ })).toBeInTheDocument();
});

test('주점 방식에 따라 저녁 식사를 대체하거나 식사 후 2차로 전환하고 원래 음식 취향 유지', () => {
  render(<Fixture />);
  fireEvent.click(screen.getByRole('button', { name: '식사' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '저녁 먹기' }));
  fireEvent.click(screen.getByRole('button', { name: '한식' }));
  fireEvent.click(screen.getByRole('button', { name: '주점' }));
  expect(screen.getByRole('radio', { name: /^저녁 식사 겸 한잔/ })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: '저녁 먹기' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: '저녁 먹기' })).toBeDisabled();
  expect(screen.queryByRole('group', { name: '저녁 음식 종류' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: /^저녁 먹고 2차/ }));
  expect(screen.getByRole('button', { name: '한식' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: '주점' }));
  expect(screen.getByRole('checkbox', { name: '저녁 먹기' })).not.toBeDisabled();
  expect(screen.getByRole('button', { name: '한식' })).toHaveAttribute('aria-pressed', 'true');
});

test('주점은 확인을 눌러야 접히고 수정하면 선택한 방문 방식을 유지', () => {
  render(<Fixture />);
  fireEvent.click(screen.getByRole('button', { name: '주점' }));
  const bar = within(screen.getByLabelText('주점 설정'));
  fireEvent.click(bar.getByRole('radio', { name: /^저녁 먹고 2차/ }));
  expect(bar.getByRole('radiogroup')).toBeInTheDocument();
  fireEvent.click(bar.getByRole('button', { name: '확인' }));
  expect(bar.getByText('주점 선택 완료')).toBeInTheDocument();
  expect(bar.getByText('저녁 먹고 2차')).toBeInTheDocument();
  expect(bar.queryByRole('radiogroup')).not.toBeInTheDocument();
  fireEvent.click(bar.getByRole('button', { name: '수정' }));
  expect(bar.getByRole('radio', { name: /^저녁 먹고 2차/ })).toBeChecked();
  fireEvent.click(bar.getByRole('button', { name: '확인' }));
  fireEvent.click(screen.getByRole('button', { name: '주점' }));
  fireEvent.click(screen.getByRole('button', { name: '주점' }));
  expect(within(screen.getByLabelText('주점 설정')).getByRole('button', { name: '확인' })).toBeInTheDocument();
});
