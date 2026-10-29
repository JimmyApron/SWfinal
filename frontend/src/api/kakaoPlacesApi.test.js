import { searchPlacesByKeyword } from './kakaoPlacesApi';
const params = { lat: 37, lng: 127, keyword: 'private-search' };
function sdk(status, data) {
  window.kakao = { maps: { LatLng: function () {}, services: {
    Status: { OK: 'OK', ZERO_RESULT: 'ZERO_RESULT', ERROR: 'ERROR' }, SortBy: { DISTANCE: 'distance' },
    Places: function () { this.keywordSearch = (query, callback) => callback(data, status); },
  } } };
}
afterEach(() => { delete window.kakao; });
test.each(['OK', 'ZERO_RESULT'])('정상 SDK %s는 HTTP 200을 추측하지 않음', async (status) => {
  sdk(status, []);
  const onDiagnostic = jest.fn();
  await expect(searchPlacesByKeyword({ ...params, onDiagnostic })).resolves.toEqual([]);
  expect(onDiagnostic).toHaveBeenCalledWith({ sdkStatus: status, httpStatus: null, httpStatusAvailable: false, resultCount: 0 });
});
test('SDK 오류는 ZERO_RESULT로 처리 안 함', async () => {
  sdk('ERROR', { privateResponse: true });
  const onDiagnostic = jest.fn();
  await expect(searchPlacesByKeyword({ ...params, onDiagnostic })).rejects.toMatchObject({ searchStage: 'sdk_callback' });
  expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ sdkStatus: 'ERROR', resultCount: 0 }));
});
test('SDK 없음은 검색 전 실패로 구분', async () => {
  await expect(searchPlacesByKeyword(params)).rejects.toMatchObject({ searchStage: 'sdk_load' });
});
test('좌표 없으면 임의 좌표·거리 정렬·반경을 SDK에 전달하지 않음', async () => {
  sdk('ZERO_RESULT', []);
  const search = jest.fn((query, callback) => callback([], 'ZERO_RESULT'));
  window.kakao.maps.services.Places = function () { this.keywordSearch = search; };
  await searchPlacesByKeyword({ lat: null, lng: null, keyword: '지역 카페' });
  expect(search).toHaveBeenCalledWith('지역 카페', expect.any(Function), {});
});
