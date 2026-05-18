function PlaceFilter({
  radius,
  minRating,
  minReviewCount,
  maxPriceLevel,
  onChangeRadius,
  onChangeMinRating,
  onChangeMinReviewCount,
  onChangeMaxPriceLevel,
}) {
  return (
    <div>
      <h3>필터</h3>

      <div>
        <label>
          거리 반경:{' '}
          <select value={radius} onChange={(event) => onChangeRadius(event.target.value)}>
            <option value="500">500m</option>
            <option value="1000">1km</option>
            <option value="1500">1.5km</option>
            <option value="2000">2km</option>
            <option value="3000">3km</option>
          </select>
        </label>
      </div>

      <div>
        <label>
          최소 평점:{' '}
          <select value={minRating} onChange={(event) => onChangeMinRating(event.target.value)}>
            <option value="0">상관없음</option>
            <option value="3.5">3.5 이상</option>
            <option value="4.0">4.0 이상</option>
            <option value="4.5">4.5 이상</option>
          </select>
        </label>
      </div>

      <div>
        <label>
          최소 리뷰 수:{' '}
          <select
            value={minReviewCount}
            onChange={(event) => onChangeMinReviewCount(event.target.value)}
          >
            <option value="0">상관없음</option>
            <option value="10">10개 이상</option>
            <option value="50">50개 이상</option>
            <option value="100">100개 이상</option>
            <option value="300">300개 이상</option>
          </select>
        </label>
      </div>

      <div>
        <label>
          가격대:{' '}
          <select
            value={maxPriceLevel}
            onChange={(event) => onChangeMaxPriceLevel(event.target.value)}
          >
            <option value="all">상관없음</option>
            <option value="1">저렴 이하</option>
            <option value="2">보통 이하</option>
            <option value="3">비싼 곳까지</option>
            <option value="4">전체 가격대</option>
          </select>
        </label>
      </div>
    </div>
  )
}

export default PlaceFilter