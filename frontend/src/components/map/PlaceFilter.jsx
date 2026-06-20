function PlaceFilter({
  radius,
  ratingFilter,
  reviewCountFilter,
  onChangeRadius,
  onChangeRatingFilter,
  onChangeReviewCountFilter,
}) {
  return (
    <div className="place-filter">
      <h3>필터</h3>

      <div>
        <label>
          거리 반경: <span style={{ fontSize: '12px', color: '#666' }}>(카카오맵 기준)</span>{' '}
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
          별점: <span style={{ fontSize: '12px', color: '#666' }}>(구글맵 기준)</span>{' '}
          <select
            value={ratingFilter}
            onChange={(event) => onChangeRatingFilter(event.target.value)}
          >
            <option value="all">모두</option>
            <option value="under3.5">3.5 미만</option>
            <option value="3.5">3.5 이상</option>
            <option value="4.0">4.0 이상</option>
            <option value="4.5">4.5 이상</option>
          </select>
        </label>
      </div>

      <div>
        <label>
          리뷰 수: <span style={{ fontSize: '12px', color: '#666' }}>(구글맵 기준)</span>{' '}
          <select
            value={reviewCountFilter}
            onChange={(event) => onChangeReviewCountFilter(event.target.value)}
          >
            <option value="all">모두</option>
            <option value="under10">10개 미만</option>
            <option value="10">10개 이상</option>
            <option value="50">50개 이상</option>
            <option value="100">100개 이상</option>
            <option value="300">300개 이상</option>
          </select>
        </label>
      </div>
    </div>
  )
}

export default PlaceFilter
