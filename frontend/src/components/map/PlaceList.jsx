function PlaceList({ places, onSelectPlace, onSharePlace }) {
  if (!places || places.length === 0) {
    return <p>검색 결과가 없습니다.</p>
  }

  return (
    <div>
      <h3>추천 장소 목록</h3>

      <ul>
        {places.map((place) => (
          <li key={place.id}>
            <strong>{place.name}</strong>

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

            <button type="button" onClick={() => onSelectPlace(place)}>
              지도에서 보기
            </button>

            {onSharePlace && (
              <button type="button" onClick={() => onSharePlace(place)}>
                채팅에 공유
              </button>
            )}

            {place.kakaoMapUrl && (
              <p>
                <a href={place.kakaoMapUrl} target="_blank" rel="noreferrer">
                  카카오맵에서 장소 열기
                </a>
              </p>
            )}
          </li>
        ))}
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

export default PlaceList
