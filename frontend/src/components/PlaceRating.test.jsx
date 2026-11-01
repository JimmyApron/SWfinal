import { render, screen } from '@testing-library/react';
import PlaceRating from './PlaceRating';

test('소수점 평점을 별의 채움 비율과 접근 가능한 점수로 표시', () => {
  const { container } = render(<PlaceRating rating={4.3} />);
  expect(screen.getByRole('img', { name: '평점 4.3점, 5점 만점' })).toBeInTheDocument();
  expect(screen.getByText('4.3')).toBeInTheDocument();
  expect(container.querySelector('span[style*="width: 86%"]')).toBeInTheDocument();
});
test.each([null, undefined, '', 'invalid', -1, 6])('유효하지 않은 평점 %s는 없음으로 표시', rating => {
  render(<PlaceRating rating={rating} />);
  expect(screen.getByText('평점 정보 없음')).toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
test('숫자 문자열 평점도 표시', () => {
  render(<PlaceRating rating="5" />);
  expect(screen.getByRole('img', { name: '평점 5.0점, 5점 만점' })).toBeInTheDocument();
});
