const CATEGORY_TYPE_MAP = {
  restaurant: ['restaurant'],
  cafe: ['cafe'],
  activity: ['tourist_attraction', 'amusement_park', 'movie_theater', 'bowling_alley'],
}

export async function searchNearbyPlaces({
  lat,
  lng,
  category = 'restaurant',
  radius = 1000,
  minRating = 0,
  minReviewCount = 0,
  maxPriceLevel = 'all',
}) {
  if (!window.google || !window.google.maps) {
    throw new Error('Google Maps가 아직 로드되지 않았습니다.')
  }

  const { Place, SearchNearbyRankPreference } =
    await window.google.maps.importLibrary('places')

  const includedPrimaryTypes = CATEGORY_TYPE_MAP[category] || ['restaurant']

  const request = {
    fields: [
      'id',
      'displayName',
      'formattedAddress',
      'location',
      'rating',
      'userRatingCount',
      'priceLevel',
      'googleMapsURI',
    ],
    locationRestriction: {
      center: {
        lat: Number(lat),
        lng: Number(lng),
      },
      radius: Number(radius),
    },
    includedPrimaryTypes,
    maxResultCount: 20,
    rankPreference: SearchNearbyRankPreference.POPULARITY,
  }

  const { places } = await Place.searchNearby(request)

  const formattedPlaces = places.map((place) => {
    const placeLat =
      typeof place.location?.lat === 'function'
        ? place.location.lat()
        : place.location?.lat

    const placeLng =
      typeof place.location?.lng === 'function'
        ? place.location.lng()
        : place.location?.lng

    return {
      id: place.id,
      name: place.displayName || '이름 없음',
      address: place.formattedAddress || '주소 정보 없음',
      lat: placeLat,
      lng: placeLng,
      rating: place.rating || 0,
      reviewCount: place.userRatingCount || 0,
      priceLevel: place.priceLevel || 'PRICE_LEVEL_UNSPECIFIED',
      googleMapsUri: place.googleMapsURI || '',
    }
  })

  return formattedPlaces.filter((place) => {
    const passRating = Number(place.rating) >= Number(minRating)
    const passReviewCount = Number(place.reviewCount) >= Number(minReviewCount)
    const passPrice = checkPriceLevel(place.priceLevel, maxPriceLevel)

    return passRating && passReviewCount && passPrice
  })
}

function checkPriceLevel(priceLevel, maxPriceLevel) {
  if (maxPriceLevel === 'all') {
    return true
  }

  const priceScoreMap = {
    PRICE_LEVEL_FREE: 0,
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4,
    PRICE_LEVEL_UNSPECIFIED: 999,
  }

  const score = priceScoreMap[priceLevel] ?? 999

  return score <= Number(maxPriceLevel)
}