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
  priceRangeFilter = 'all',
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
      'priceRange',
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
      priceRange: place.priceRange || null,
      googleMapsUri: place.googleMapsURI || '',
    }
  })

  return formattedPlaces.filter((place) => {
    const passRating = Number(place.rating) >= Number(minRating)
    const passReviewCount = Number(place.reviewCount) >= Number(minReviewCount)
    const passPriceRange = checkPriceRange(place.priceRange, priceRangeFilter)

    return passRating && passReviewCount && passPriceRange
  })
}

function checkPriceRange(priceRange, priceRangeFilter) {
  if (priceRangeFilter === 'all') {
    return true
  }

  if (priceRangeFilter === 'unknown') {
    return !priceRange
  }

  if (!priceRange) {
    return false
  }

  const startPrice = priceRange.startPrice
  const endPrice = priceRange.endPrice

  const startAmount = getMoneyUnits(startPrice)
  const endAmount = getMoneyUnits(endPrice)

  if (priceRangeFilter === 'under10000') {
    return isPriceInRange(startAmount, endAmount, 1, 10000)
  }

  if (priceRangeFilter === 'under20000') {
    return isPriceInRange(startAmount, endAmount, 10001, 20000)
  }

  if (priceRangeFilter === 'under30000') {
    return isPriceInRange(startAmount, endAmount, 20001, 30000)
  }

  if (priceRangeFilter === 'over30000') {
    return isPriceOver(startAmount, endAmount, 30000)
  }

  return true
}

function getMoneyUnits(money) {
  if (!money || money.units === undefined || money.units === null) {
    return null
  }

  return Number(money.units)
}

function isPriceInRange(startAmount, endAmount, min, max) {
  if (startAmount === null && endAmount === null) {
    return false
  }

  if (startAmount !== null && startAmount >= min && startAmount <= max) {
    return true
  }

  if (endAmount !== null && endAmount >= min && endAmount <= max) {
    return true
  }

  if (
    startAmount !== null &&
    endAmount !== null &&
    startAmount <= min &&
    endAmount >= max
  ) {
    return true
  }

  return false
}

function isPriceOver(startAmount, endAmount, 기준금액) {
  if (startAmount !== null && startAmount >= 기준금액) {
    return true
  }

  if (endAmount !== null && endAmount >= 기준금액) {
    return true
  }

  return false
}