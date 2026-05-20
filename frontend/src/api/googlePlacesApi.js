const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000'

export async function getGooglePlaceRating(place) {
  const response = await fetch(`${API_BASE_URL}/google/place-rating`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: place.name,
      address: place.address,
      lat: place.lat,
      lng: place.lng,
    }),
  })

  if (!response.ok) {
    throw new Error('구글 평점 정보를 가져오지 못했습니다.')
  }

  return response.json()
}

export async function attachGoogleRatings(places) {
  const placesWithRatings = await Promise.all(
    places.map(async (place) => {
      try {
        const googleData = await getGooglePlaceRating(place)

        return {
          ...place,
          rating: googleData.rating,
          reviewCount: googleData.reviewCount,
          googlePlaceId: googleData.googlePlaceId,
        }
      } catch (error) {
        console.warn('구글 평점 매칭 실패:', place.name, error)

        return {
          ...place,
          rating: null,
          reviewCount: null,
          googlePlaceId: null,
        }
      }
    })
  )

  return placesWithRatings
}