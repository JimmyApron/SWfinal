import { useCallback } from 'react';
import LocationPicker from './map/LocationPicker';
import KakaoMapView from './map/KakaoMapView';
import { validRecommendationCenter } from '../utils/recommendationAreaUtils';

export default function RecommendationAreaPicker({ center, radius, onChange, onRadiusChange }) {
  const select = useCallback((name, address, place) => {
    if (validRecommendationCenter(place)) onChange({ lat: Number(place.lat), lng: Number(place.lng), name: place.name || name || '선택한 위치', address: place.address || address || '' });
  }, [onChange]);
  const click = useCallback((point) => {
    if (validRecommendationCenter(point)) onChange({ ...point, name: '지도에서 선택한 위치', address: '' });
  }, [onChange]);
  const selected = validRecommendationCenter(center) ? center : null;
  return <section aria-label="추천 구역 선택" style={{ background: '#fff', border: '1px solid #EEE7FF', borderRadius: 18, padding: 16, marginBottom: 14 }}>
    <h3 style={{ marginTop: 0 }}>어느 구역에서 만날까요?</h3>
    <p style={{ color: '#646478', fontSize: 13 }}>장소·지역을 검색하거나 지도를 눌러 중심점을 정한 뒤, 핀을 끌어서 옮길 수 있어요.</p>
    <LocationPicker onSelect={select} showMap={false} includeAddressSearch placeholder="장소·지역 검색 (예: 홍대입구역)" />
    <div style={{ margin: '12px 0', borderRadius: 12, overflow: 'hidden' }}>
      <KakaoMapView preferredCenter={selected} pickedPlace={selected} onMapClick={click}
        onPickedPlaceDragEnd={click}
        searchArea={selected ? { lat: selected.lat, lng: selected.lng, radius } : null} height="300px" />
    </div>
    <p role="status">{selected ? `추천 중심: ${selected.name}` : '아직 추천 중심점을 선택하지 않았습니다.'}</p>
    {selected?.address && <p style={{ fontSize: 13 }}>{selected.address}</p>}
    <label htmlFor="recommendation-radius">추천 반경: {(Number(radius) / 1000).toLocaleString('ko-KR')}km</label>
    <input id="recommendation-radius" type="range" min="500" max="5000" step="500" value={radius}
      onChange={(event) => onRadiusChange(Number(event.target.value))} style={{ width: '100%', accentColor: '#7B61FF', marginTop: 12 }} />
    <p style={{ color: '#646478', fontSize: 12 }}>선택한 원 안의 장소에서 코스를 추천합니다. 지도 기본 화면은 선택된 추천 위치가 아닙니다.</p>
  </section>;
}
