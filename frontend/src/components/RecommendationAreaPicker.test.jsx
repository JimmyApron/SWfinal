import { fireEvent, render, screen } from '@testing-library/react';
import RecommendationAreaPicker from './RecommendationAreaPicker';
jest.mock('./map/LocationPicker', () => function Search({ onSelect }) {
  return <button onClick={() => onSelect('검색한 역', '주소', { name: '검색한 역', address: '주소', lat: 37, lng: 127 })}>검색 결과 선택</button>;
});
jest.mock('./map/KakaoMapView', () => function Map({ onMapClick, searchArea }) {
  return <div><button onClick={() => onMapClick({ lat: 36, lng: 128 })}>지도 중심 선택</button>{searchArea && <span>원 반경 {searchArea.radius}</span>}</div>;
});
test('검색 또는 지도 클릭으로 중심 선택, 반경 변경', () => {
  const onChange = jest.fn();
  const onRadiusChange = jest.fn();
  const view = render(<RecommendationAreaPicker center={null} radius={1500} onChange={onChange} onRadiusChange={onRadiusChange} />);
  expect(screen.getByRole('status')).toHaveTextContent('아직 추천 중심점');
  fireEvent.click(screen.getByText('검색 결과 선택'));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ lat: 37, lng: 127, name: '검색한 역' }));
  fireEvent.click(screen.getByText('지도 중심 선택'));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ lat: 36, lng: 128 }));
  view.rerender(<RecommendationAreaPicker center={{ lat: 36, lng: 128, name: '선택 위치' }} radius={2000} onChange={onChange} onRadiusChange={onRadiusChange} />);
  expect(screen.getByText('원 반경 2000')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('slider'), { target: { value: '3000' } });
  expect(onRadiusChange).toHaveBeenCalledWith(3000);
});
