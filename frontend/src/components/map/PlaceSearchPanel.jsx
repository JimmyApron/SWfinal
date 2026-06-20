import { useState } from 'react'
import { searchNearbyPlaces } from '../../api/kakaoPlacesApi'
import { attachGoogleRatings } from '../../api/googlePlacesApi'
import PlaceCategoryTabs from './PlaceCategoryTabs'
import PlaceFilter from './PlaceFilter'
import PlaceList from './PlaceList'

function PlaceSearchPanel({
  searchLocation,
  onSearchResult,
  onSelectPlace,
  onSharePlace,
  onCreateAdditionalPlaceVote,
}) {
  const [selectedCategory, setSelectedCategory] = useState('restaurant')
  const [radius, setRadius] = useState('1000')
  const [ratingFilter, setRatingFilter] = useState('all')
  const [reviewCountFilter, setReviewCountFilter] = useState('all')
  const [places, setPlaces] = useState([])
  const [selectedPlaceIds, setSelectedPlaceIds] = useState([])
  const [message, setMessage] = useState('')

  const handleSearchPlaces = async () => {
    if (!searchLocation) {
      setMessage('먼저 중간 장소를 확정해주세요.')
      return
    }

    try {
      setMessage('확정된 중간 장소 주변에서 장소를 검색하고, 구글맵 평점 정보를 불러오는 중입니다.')

      const kakaoPlaces = await searchNearbyPlaces({
        lat: searchLocation.lat,
        lng: searchLocation.lng,
        category: selectedCategory,
        radius,
      })

      const placesWithGoogleRatings = await attachGoogleRatings(kakaoPlaces)

      const filteredPlaces = placesWithGoogleRatings.filter((place) => {
        const rating = Number(place.rating)
        const reviewCount = Number(place.reviewCount)

        let passRating = true
        let passReviewCount = true

        if (ratingFilter === 'under3.5') {
          passRating = !Number.isNaN(rating) && rating < 3.5
        } else if (ratingFilter !== 'all') {
          passRating = !Number.isNaN(rating) && rating >= Number(ratingFilter)
        }

        if (reviewCountFilter === 'under10') {
          passReviewCount = !Number.isNaN(reviewCount) && reviewCount < 10
        } else if (reviewCountFilter !== 'all') {
          passReviewCount = !Number.isNaN(reviewCount) && reviewCount >= Number(reviewCountFilter)
        }

        return passRating && passReviewCount
      })

      setPlaces(filteredPlaces)
      setSelectedPlaceIds(filteredPlaces.map((place) => String(place.id)))
      onSearchResult(filteredPlaces)

      if (filteredPlaces.length === 0) {
        setMessage('조건에 맞는 장소가 없습니다. 거리 반경을 넓히거나 별점/리뷰 조건을 바꿔보세요.')
      } else {
        setMessage(`검색 완료: ${filteredPlaces.length}개`)
      }
    } catch (error) {
      console.error('장소 검색 오류:', error)
      setMessage(error.message || '장소 검색에 실패했습니다.')
    }
  }

  const handleToggleVotePlace = (place) => {
    const placeId = String(place.id)
    setSelectedPlaceIds((currentIds) =>
      currentIds.includes(placeId)
        ? currentIds.filter((id) => id !== placeId)
        : [...currentIds, placeId]
    )
  }

  const handleCreateVote = () => {
    const selectedPlaces = places.filter((place) =>
      selectedPlaceIds.includes(String(place.id))
    )

    if (selectedPlaces.length === 0) {
      setMessage('투표에 넣을 추가 장소를 1개 이상 선택해주세요.')
      return
    }

    onCreateAdditionalPlaceVote(selectedPlaces)
  }

  if (!searchLocation) {
    return (
      <section>
        <h2>주변 장소 추천</h2>
        <p>
          먼저 유명 중간 장소를 추천받고, 그중 하나를 중간 장소로 확정해주세요.
          중간 장소가 확정되면 그 주변의 음식점, 카페, 놀거리를 검색할 수 있습니다.
        </p>
      </section>
    )
  }

  return (
    <section>
      <h2>확정된 중간 장소 주변 추천</h2>

      <p>
        기준 장소: {searchLocation.name || '확정된 중간 장소'}
      </p>

      <PlaceCategoryTabs
        selectedCategory={selectedCategory}
        onChangeCategory={setSelectedCategory}
      />

      <PlaceFilter
        radius={radius}
        ratingFilter={ratingFilter}
        reviewCountFilter={reviewCountFilter}
        onChangeRadius={setRadius}
        onChangeRatingFilter={setRatingFilter}
        onChangeReviewCountFilter={setReviewCountFilter}
      />

      <p style={{ fontSize: '13px', color: '#666' }}>
        거리 반경은 카카오맵 장소 검색 기준이고, 별점과 리뷰 수는 구글맵 기준입니다.
      </p>

      <button type="button" onClick={handleSearchPlaces}>
        중간 장소 주변 검색
      </button>

      {message && <p>{message}</p>}

      {places.length > 0 && onCreateAdditionalPlaceVote && (
        <button type="button" onClick={handleCreateVote}>
          선택한 장소로 추가 장소 투표 만들기
        </button>
      )}

      <PlaceList
        places={places}
        onSelectPlace={onSelectPlace}
        onSharePlace={onSharePlace}
        selectedPlaceIds={selectedPlaceIds}
        onToggleVotePlace={onCreateAdditionalPlaceVote ? handleToggleVotePlace : null}
      />
    </section>
  )
}

export default PlaceSearchPanel
