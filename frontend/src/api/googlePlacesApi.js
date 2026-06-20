const API_BASE_URL = (
  process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api'
).replace(/\/$/, '')

export async function getGooglePlaceRating(place) {
  const url = `${API_BASE_URL}/google/place-rating`
  const requestBody = {
    name: place.name,
    address: place.address,
    lat: place.lat,
    lng: place.lng,
  }

  let response

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })
  } catch (error) {
    console.error('[Google Places API] 서버 연결 실패', {
      url,
      requestBody,
      error,
    })
    throw new Error('구글 평점 API 서버에 연결하지 못했습니다.')
  }

  if (!response.ok) {
    const responseBody = await readResponseBody(response)

    console.error('[Google Places API] 평점 조회 실패', {
      url,
      status: response.status,
      statusText: response.statusText,
      requestBody,
      responseBody,
    })
    throw new Error('구글 평점 정보를 가져오지 못했습니다.')
  }

  return response.json()
}

async function readResponseBody(response) {
  const contentType = response.headers.get('content-type') || ''

  try {
    if (contentType.includes('application/json')) {
      return await response.json()
    }

    return await response.text()
  } catch (error) {
    return {
      message: '응답 본문을 읽지 못했습니다.',
      error: error.message,
    }
  }
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
