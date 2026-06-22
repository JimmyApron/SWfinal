import { useEffect, useState } from 'react'
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
  variant = 'panel',
  onResultStateChange,
  sheetSnap = 'collapsed',
  sheetStyle,
  sheetDragProps = {},
  sheetHandleProps = {},
  onOpenFriends,
  onCloseResults,
}) {
  const [selectedCategory, setSelectedCategory] = useState('')
  const [radius, setRadius] = useState('1000')
  const [ratingFilter, setRatingFilter] = useState('all')
  const [reviewCountFilter, setReviewCountFilter] = useState('all')
  const [places, setPlaces] = useState([])
  const [selectedPlaceIds, setSelectedPlaceIds] = useState([])
  const [message, setMessage] = useState('')
  const [isFilterOpen, setIsFilterOpen] = useState(false)

  useEffect(() => {
    if (!message) return undefined

    const timeoutId = setTimeout(() => {
      setMessage('')
    }, 2400)

    return () => clearTimeout(timeoutId)
  }, [message])

  const handleChangeCategory = (category) => {
    setSelectedCategory(category)
    if (variant === 'mapOverlay') {
      setIsFilterOpen(true)
    }
  }

  const handleSearchPlaces = async (categoryOverride) => {
    if (!searchLocation) {
      setMessage('먼저 중간 장소를 확정해주세요.')
      return
    }

    try {
      setMessage('')
      const categoryToSearch =
        typeof categoryOverride === 'string'
          ? categoryOverride
          : selectedCategory || 'restaurant'

      const kakaoPlaces = await searchNearbyPlaces({
        lat: searchLocation.lat,
        lng: searchLocation.lng,
        category: categoryToSearch,
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
      onResultStateChange?.(filteredPlaces.length > 0)
      if (variant === 'mapOverlay') {
        setIsFilterOpen(false)
      }

      if (filteredPlaces.length === 0) {
        setMessage('맞는 장소를 못 찾았어요. 반경을 넓히거나 필터를 살짝 낮춰보세요.')
      } else {
        setMessage('')
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

  const handleSelectAllPlaces = () => {
    setSelectedPlaceIds(places.map((place) => String(place.id)))
  }

  const handleClearSelectedPlaces = () => {
    setSelectedPlaceIds([])
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

  const handleCloseResults = (event) => {
    event?.preventDefault()
    event?.stopPropagation()
    setPlaces([])
    setSelectedPlaceIds([])
    onSearchResult([])
    onResultStateChange?.(false)
    onCloseResults?.()
  }

  if (!searchLocation) {
    return (
      <section className={variant === 'mapOverlay' ? 'map-place-search-panel is-empty' : undefined}>
        <h2>주변 장소 추천</h2>
        <p>
          먼저 유명 중간 장소를 추천받고, 그중 하나를 중간 장소로 확정해주세요.
          중간 장소가 확정되면 그 주변의 음식점, 카페, 놀거리를 검색할 수 있습니다.
        </p>
      </section>
    )
  }

  return (
    <section className={variant === 'mapOverlay' ? 'map-place-search-panel' : undefined}>
      <div className={variant === 'mapOverlay' ? 'map-search-control-card' : undefined}>
        {variant !== 'mapOverlay' && <h2>확정된 중간 장소 주변 추천</h2>}

        {variant !== 'mapOverlay' && (
          <p>
            기준 장소: {searchLocation.name || '확정된 중간 장소'}
          </p>
        )}

        <div className="map-category-strip">
          {variant === 'mapOverlay' && onOpenFriends && (
            <button
              type="button"
              className="map-friend-chip"
              onClick={onOpenFriends}
            >
              멤버위치
            </button>
          )}
          <PlaceCategoryTabs
            selectedCategory={selectedCategory}
            onChangeCategory={handleChangeCategory}
          />
        </div>

        {(variant !== 'mapOverlay' || isFilterOpen) && (
          <div className={variant === 'mapOverlay' ? 'map-filter-popover' : undefined}>
            <PlaceFilter
              radius={radius}
              ratingFilter={ratingFilter}
              reviewCountFilter={reviewCountFilter}
              onChangeRadius={setRadius}
              onChangeRatingFilter={setRatingFilter}
              onChangeReviewCountFilter={setReviewCountFilter}
            />

            {variant !== 'mapOverlay' && (
              <p style={{ fontSize: '13px', color: '#666' }}>
                거리 반경은 카카오맵 장소 검색 기준이고, 별점과 리뷰 수는 구글맵 기준입니다.
              </p>
            )}

            <div className="map-filter-actions">
              {variant === 'mapOverlay' && (
                <button type="button" onClick={() => setIsFilterOpen(false)}>
                  닫기
                </button>
              )}
              <button type="button" onClick={() => handleSearchPlaces()}>
                검색하기
              </button>
            </div>
          </div>
        )}
      </div>

      {message && (
        <div className="map-toast-message" role="status" aria-live="polite">
          {message}
        </div>
      )}

      {places.length > 0 && (
        <div
          className={variant === 'mapOverlay' ? `map-bottom-sheet map-results-sheet is-${sheetSnap}` : undefined}
          style={variant === 'mapOverlay' ? sheetStyle : undefined}
          {...(variant === 'mapOverlay' ? sheetDragProps : {})}
        >
          {variant === 'mapOverlay' && <div className="map-sheet-handle" {...sheetHandleProps} />}
          <div className="map-sheet-header">
            {variant === 'mapOverlay' && (
              <button
                type="button"
                className="map-sheet-back-button"
                onClick={handleCloseResults}
                aria-label="검색 결과 닫기"
              >
                <span aria-hidden="true">←</span>
              </button>
            )}
            <div className="map-sheet-title-block">
              <strong>주변 장소 검색 결과</strong>
              <span>{places.length}개 장소</span>
            </div>
            {onCreateAdditionalPlaceVote && (
              <button
                type="button"
                className="map-sheet-header-action"
                onClick={handleCreateVote}
              >
                주변 장소 투표 만들기
              </button>
            )}
          </div>
          {onCreateAdditionalPlaceVote && (
            <div className="map-selection-actions">
              <button type="button" onClick={handleSelectAllPlaces}>
                모두 선택
              </button>
              <button type="button" onClick={handleClearSelectedPlaces}>
                모두 해제
              </button>
            </div>
          )}
          <PlaceList
            places={places}
            onSelectPlace={onSelectPlace}
            onSharePlace={onSharePlace}
            selectedPlaceIds={selectedPlaceIds}
            onToggleVotePlace={onCreateAdditionalPlaceVote ? handleToggleVotePlace : null}
          />
        </div>
      )}
    </section>
  )
}

export default PlaceSearchPanel
