import { useState } from 'react'
import { searchNearbyPlaces } from '../../api/googlePlacesApi'
import PlaceCategoryTabs from './PlaceCategoryTabs'
import PlaceFilter from './PlaceFilter'
import PlaceList from './PlaceList'

function PlaceSearchPanel({ searchLocation, onSearchResult, onSelectPlace }) {
  const [selectedCategory, setSelectedCategory] = useState('restaurant')
  const [radius, setRadius] = useState('1000')
  const [minRating, setMinRating] = useState('0')
  const [minReviewCount, setMinReviewCount] = useState('0')
  const [priceRangeFilter, setPriceRangeFilter] = useState('all')
  const [places, setPlaces] = useState([])
  const [message, setMessage] = useState('')

  const handleSearchPlaces = async () => {
    if (!searchLocation) {
      setMessage('먼저 현재 위치를 가져와주세요.')
      return
    }

    try {
      setMessage('주변 장소를 검색하는 중입니다.')

      const result = await searchNearbyPlaces({
        lat: searchLocation.lat,
        lng: searchLocation.lng,
        category: selectedCategory,
        radius,
        minRating,
        minReviewCount,
        priceRangeFilter,
      })

      setPlaces(result)
      onSearchResult(result)

      if (result.length === 0) {
        setMessage('조건에 맞는 장소가 없습니다. 거리 반경을 넓히거나 필터를 낮춰보세요.')
      } else {
        setMessage(`검색 완료: ${result.length}개`)
      }
    } catch (error) {
      console.error('장소 검색 오류:', error)
      setMessage(error.message || '장소 검색에 실패했습니다.')
    }
  }

  return (
    <section>
      <h2>주변 장소 추천</h2>

      <PlaceCategoryTabs
        selectedCategory={selectedCategory}
        onChangeCategory={setSelectedCategory}
      />

      <PlaceFilter
        radius={radius}
        minRating={minRating}
        minReviewCount={minReviewCount}
        priceRangeFilter={priceRangeFilter}
        onChangeRadius={setRadius}
        onChangeMinRating={setMinRating}
        onChangeMinReviewCount={setMinReviewCount}
        onChangePriceRangeFilter={setPriceRangeFilter}
      />

      <button type="button" onClick={handleSearchPlaces}>
        주변 장소 검색
      </button>

      {message && <p>{message}</p>}

      <PlaceList places={places} onSelectPlace={onSelectPlace} />
    </section>
  )
}

export default PlaceSearchPanel