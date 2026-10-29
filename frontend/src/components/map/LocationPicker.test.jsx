import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import LocationPicker from './LocationPicker';
afterEach(() => { delete window.kakao; });
test('지역명은 장소 검색 0건일 때 주소 검색으로 실제 좌표 선택', async () => {
  const keywordSearch = jest.fn((query, callback) => callback([], 'ZERO_RESULT'));
  const addressSearch = jest.fn((query, callback) => callback([{ address_name: '선택 지역', x: '127', y: '37' }], 'OK'));
  window.kakao = { maps: { services: {
    Status: { OK: 'OK', ZERO_RESULT: 'ZERO_RESULT' },
    Places: function () { this.keywordSearch = keywordSearch; },
    Geocoder: function () { this.addressSearch = addressSearch; },
  } } };
  const onSelect = jest.fn();
  render(<LocationPicker showMap={false} includeAddressSearch onSelect={onSelect} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '검색' })).not.toBeDisabled());
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '선택 지역' } });
  fireEvent.click(screen.getByRole('button', { name: '검색' }));
  await waitFor(() => expect(addressSearch).toHaveBeenCalled());
  fireEvent.click(screen.getAllByText('선택 지역', { selector: 'p' })[0]);
  expect(onSelect).toHaveBeenCalledWith('선택 지역', '선택 지역', expect.objectContaining({ lat: 37, lng: 127 }));
});
