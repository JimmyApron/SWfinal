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

            <p>가격대: {formatPriceRange(place.priceRange)}</p>

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

function formatPriceRange(priceRange) {
  if (!priceRange) {
    return '가격 정보 없음'
  }

  const startPrice = priceRange.startPrice
  const endPrice = priceRange.endPrice

  if (!startPrice && !endPrice) {
    return '가격 정보 없음'
  }

  if (startPrice && endPrice) {
    const start = formatMoney(startPrice)
    const end = formatMoney(endPrice)

    return `${start} ~ ${end}`
  }

  if (startPrice && !endPrice) {
    return `${formatMoney(startPrice)} 이상`
  }

  if (!startPrice && endPrice) {
    return `${formatMoney(endPrice)} 이하`
  }

  return '가격 정보 없음'
}

function formatMoney(money) {
  const currencyCode = money.currencyCode || 'KRW'
  const units = Number(money.units || 0).toLocaleString()

  if (currencyCode === 'KRW') {
    return `₩${units}`
  }

  return `${currencyCode} ${units}`
}

export default PlaceList