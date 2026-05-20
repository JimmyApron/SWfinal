const express = require('express')

const router = express.Router()

router.post('/place-rating', async (req, res) => {
  try {
    const { name, address, lat, lng } = req.body

    if (!name || !address) {
      return res.status(400).json({
        message: 'name과 address가 필요합니다.',
      })
    }

    if (!process.env.GOOGLE_MAPS_API_KEY) {
      return res.status(500).json({
        message: 'GOOGLE_MAPS_API_KEY가 설정되지 않았습니다.',
      })
    }

    const requestBody = {
      textQuery: `${name} ${address}`,
      languageCode: 'ko',
      maxResultCount: 1,
    }

    // 카카오맵 좌표 근처에서만 찾게 해서 엉뚱한 가게 매칭 줄이기
    if (lat !== undefined && lng !== undefined) {
      requestBody.locationBias = {
        circle: {
          center: {
            latitude: Number(lat),
            longitude: Number(lng),
          },
          radius: 300,
        },
      }
    }

    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount',
      },
      body: JSON.stringify(requestBody),
    })

    const data = await response.json()

    if (!response.ok) {
      console.error('Google Places API error:', data)
      return res.status(response.status).json({
        message: '구글 장소 정보를 가져오지 못했습니다.',
        googleError: data,
      })
    }

    const place = data.places?.[0]

    // 구글맵에 없거나 평점/리뷰 수 없으면 null로 보냄
    if (!place || place.rating === undefined || place.userRatingCount === undefined) {
      return res.json({
        rating: null,
        reviewCount: null,
        googlePlaceId: place?.id || null,
      })
    }

    return res.json({
      rating: place.rating,
      reviewCount: place.userRatingCount,
      googlePlaceId: place.id || null,
      googleName: place.displayName?.text || null,
      googleAddress: place.formattedAddress || null,
    })
  } catch (error) {
    console.error('Google place rating error:', error)
    return res.status(500).json({
      message: '구글 평점 정보를 가져오지 못했습니다.',
    })
  }
})

module.exports = router