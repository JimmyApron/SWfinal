function PlaceList({ places, onSelectPlace }) {
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

            <p>
              평점: {place.rating || '정보 없음'} / 리뷰 수: {place.reviewCount || 0}
            </p>

            <p>가격대: {formatPriceLevel(place.priceLevel)}</p>

            <button type="button" onClick={() => onSelectPlace(place)}>
              지도에서 보기
            </button>

            {place.googleMapsUri && (
              <p>
                <a href={place.googleMapsUri} target="_blank" rel="noreferrer">
                  구글맵에서 열기
                </a>
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function formatPriceLevel(priceLevel) {
  const priceMap = {
    PRICE_LEVEL_FREE: '무료',
    PRICE_LEVEL_INEXPENSIVE: '저렴',
    PRICE_LEVEL_MODERATE: '보통',
    PRICE_LEVEL_EXPENSIVE: '비쌈',
    PRICE_LEVEL_VERY_EXPENSIVE: '매우 비쌈',
    PRICE_LEVEL_UNSPECIFIED: '정보 없음',
  }

  return priceMap[priceLevel] || '정보 없음'
}

export default PlaceList