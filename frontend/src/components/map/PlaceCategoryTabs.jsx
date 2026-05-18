function PlaceCategoryTabs({ selectedCategory, onChangeCategory }) {
  return (
    <div>
      <button
        type="button"
        onClick={() => onChangeCategory('restaurant')}
        disabled={selectedCategory === 'restaurant'}
      >
        음식점
      </button>

      <button
        type="button"
        onClick={() => onChangeCategory('cafe')}
        disabled={selectedCategory === 'cafe'}
      >
        카페
      </button>

      <button
        type="button"
        onClick={() => onChangeCategory('activity')}
        disabled={selectedCategory === 'activity'}
      >
        놀거리
      </button>

      <button
        type="button"
        onClick={() => onChangeCategory('parking')}
        disabled={selectedCategory === 'parking'}
      >
        주차장
      </button>
    </div>
  )
}

export default PlaceCategoryTabs