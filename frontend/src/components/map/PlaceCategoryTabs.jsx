function PlaceCategoryTabs({ selectedCategory, onChangeCategory }) {
  const categories = [
    { value: 'restaurant', label: '음식점' },
    { value: 'cafe', label: '카페' },
    { value: 'activity', label: '놀거리' },
    { value: 'parking', label: '주차장' },
  ]

  return (
    <div className="place-category-tabs">
      {categories.map((category) => {
        const isSelected = selectedCategory === category.value

        return (
          <button
            key={category.value}
            type="button"
            className={isSelected ? 'is-selected' : ''}
            aria-pressed={isSelected}
            onClick={() => onChangeCategory(category.value)}
          >
            {category.label}
          </button>
        )
      })}
    </div>
  )
}

export default PlaceCategoryTabs
