const express = require('express')

const router = express.Router()

router.post('/time', async (req, res) => {
  try {
    const { origin, destination, mode } = req.body

    if (!origin || !destination || !mode) {
      return res.status(400).json({
        message: 'origin, destination, mode가 필요합니다.',
      })
    }

    if (mode === 'car') {
      const result = await getKakaoCarRoute(origin, destination)
      return res.json(result)
    }

    if (mode === 'transit') {
      const result = await getGoogleRoute(origin, destination, 'TRANSIT')
      return res.json(result)
    }

    if (mode === 'walk') {
      const result = await getGoogleRoute(origin, destination, 'WALK')
      return res.json(result)
    }

    return res.status(400).json({
      message: '지원하지 않는 이동수단입니다.',
    })
  } catch (error) {
    console.error('이동시간 계산 오류:', error)
    return res.status(500).json({
      message: error.message || '이동시간 계산 중 오류가 발생했습니다.',
    })
  }
})

async function getKakaoCarRoute(origin, destination) {
  const kakaoRestApiKey = process.env.KAKAO_REST_API_KEY

  if (!kakaoRestApiKey) {
    throw new Error('KAKAO_REST_API_KEY가 설정되지 않았습니다.')
  }

  const originText = `${origin.lng},${origin.lat}`
  const destinationText = `${destination.lng},${destination.lat}`

  const url =
    `https://apis-navi.kakaomobility.com/v1/directions` +
    `?origin=${originText}` +
    `&destination=${destinationText}` +
    `&priority=RECOMMEND`

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `KakaoAK ${kakaoRestApiKey}`,
      'Content-Type': 'application/json',
    },
  })

  const data = await response.json()

  if (!response.ok) {
    console.error('카카오 자동차 경로 오류:', data)
    throw new Error('카카오 자동차 경로 계산에 실패했습니다.')
  }

  const route = data.routes?.[0]

  if (!route) {
    throw new Error('자동차 경로를 찾지 못했습니다.')
  }

  return {
    duration: route.summary?.duration,
    distance: route.summary?.distance,
  }
}

async function getGoogleRoute(origin, destination, travelMode) {
  const googleApiKey = process.env.GOOGLE_MAPS_API_KEY

  if (!googleApiKey) {
    throw new Error('GOOGLE_MAPS_API_KEY가 설정되지 않았습니다.')
  }

  const requestBody = {
    origin: {
      location: {
        latLng: {
          latitude: Number(origin.lat),
          longitude: Number(origin.lng),
        },
      },
    },
    destination: {
      location: {
        latLng: {
          latitude: Number(destination.lat),
          longitude: Number(destination.lng),
        },
      },
    },
    travelMode,
    languageCode: 'ko',
    units: 'METRIC',
  }

  const response = await fetch(
    'https://routes.googleapis.com/directions/v2:computeRoutes',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': googleApiKey,
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters',
      },
      body: JSON.stringify(requestBody),
    }
  )

  const data = await response.json()

  if (!response.ok) {
    console.error('Google Routes 오류:', data)
    throw new Error('Google Routes 경로 계산에 실패했습니다.')
  }

  const route = data.routes?.[0]

  if (!route) {
    throw new Error('Google 경로를 찾지 못했습니다.')
  }

  return {
    duration: parseDurationToSeconds(route.duration),
    distance: route.distanceMeters,
  }
}

function parseDurationToSeconds(durationText) {
  if (!durationText) return null

  return Number(durationText.replace('s', ''))
}

module.exports = router