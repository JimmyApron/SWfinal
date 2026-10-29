import { fireEvent, render, screen } from '@testing-library/react';
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
