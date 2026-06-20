import { FaMapMarkerAlt } from 'react-icons/fa'

function PlaceList({
  places,
  onSelectPlace,
  onSharePlace,
  selectedPlaceIds = [],
  onToggleVotePlace,
}) {
  if (!places || places.length === 0) {
    return <p>검색 결과가 없습니다.</p>
  }

  return (
    <div>
      <h3>추천 장소 목록</h3>

      <ul>
        {places.map((place) => {
          const kakaoMapUrl = getKakaoMapUrl(place)

          return (
            <li key={place.id}>
              {onToggleVotePlace && (
                <label
                  className="map-place-vote-check"
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={selectedPlaceIds.includes(String(place.id))}
                    onChange={() => onToggleVotePlace(place)}
                  />{' '}
                  투표 항목으로 선택
                </label>
              )}

              <strong className="map-place-title">{place.name}</strong>

              <p>{place.address}</p>

              {place.rating !== null && place.rating !== undefined && (
                <p>
                  ⭐ {Number(place.rating).toFixed(1)} / 5.0
                  {place.reviewCount !== null && place.reviewCount !== undefined && (
                    <span> ({place.reviewCount})</span>
                  )}
                </p>
              )}

              {place.distance !== null && place.distance !== undefined && (
                <p>현재 위치에서 거리: {formatDistance(place.distance)}</p>
              )}

              <div className="map-place-action-row">
                <button
                  type="button"
                  className="map-place-action-button"
                  onClick={() => onSelectPlace(place)}
                >
                  지도에서 보기
                </button>

                {onSharePlace && (
                  <button
                    type="button"
                    className="map-place-action-button"
                    onClick={() => onSharePlace(place)}
                  >
                    채팅에 공유
                  </button>
                )}
              </div>

              {kakaoMapUrl && (
                <a
                  className="map-place-kakao-button"
                  href={kakaoMapUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <FaMapMarkerAlt aria-hidden="true" />
                  <span>카카오맵에서 보기</span>
                </a>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function formatDistance(distance) {
  const meter = Number(distance)

  if (Number.isNaN(meter)) {
    return '거리 정보 없음'
  }

  if (meter >= 1000) {
    return `${(meter / 1000).toFixed(1)}km`
  }

  return `${Math.round(meter)}m`
}

function getKakaoMapUrl(place = {}) {
  const explicitUrl = place.kakaoMapUrl || place.kakaomapurl
  if (explicitUrl) return explicitUrl

  const lat = place.lat ?? place.latitude ?? place.placelat ?? place.locationlat
  const lng = place.lng ?? place.longitude ?? place.placelng ?? place.locationlng

  if (!isValidLatLng(lat, lng)) return ''

  const name =
    place.name ||
    place.placename ||
    place.place_name ||
    place.location ||
    place.address ||
    '선택한 장소'

  return `https://map.kakao.com/link/map/${encodeURIComponent(name)},${Number(lat)},${Number(lng)}`
}

function isValidLatLng(lat, lng) {
  const numberLat = Number(lat)
  const numberLng = Number(lng)

  return (
    Number.isFinite(numberLat) &&
    Number.isFinite(numberLng) &&
    numberLat >= -90 &&
    numberLat <= 90 &&
    numberLng >= -180 &&
    numberLng <= 180
  )
}

export default PlaceList
