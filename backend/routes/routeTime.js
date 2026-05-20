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

    return res.status(400).json({
      message: '지원하지 않는 이동수단입니다. 자동차 또는 대중교통만 선택할 수 있습니다.',
    })
  } catch (error) {
    console.error('이동시간 계산 오류:', error)

    if (error.code === 'ROUTE_NOT_FOUND') {
      return res.status(404).json({
        message: error.message,
        code: 'ROUTE_NOT_FOUND',
        availableTravelModes: error.availableTravelModes || [],
      })
    }

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

  const googleModeMap = {
    TRANSIT: 'transit',
  }

  const mode = googleModeMap[travelMode]

  if (!mode) {
    throw new Error(`지원하지 않는 Google 이동수단입니다: ${travelMode}`)
  }

  const originText = `${origin.lat},${origin.lng}`
  const destinationText = `${destination.lat},${destination.lng}`

  const params = new URLSearchParams({
    origin: originText,
    destination: destinationText,
    mode,
    language: 'ko',
    key: googleApiKey,
  })

  if (mode === 'transit') {
    params.set('departure_time', 'now')
  }

  const url = `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`

  const response = await fetch(url)
  const data = await response.json()

  console.log('Google Directions 응답:', JSON.stringify({
    mode,
    status: data.status,
    error_message: data.error_message,
    routesLength: data.routes?.length || 0,
    available_travel_modes: data.available_travel_modes,
  }, null, 2))

  if (!response.ok) {
    throw new Error('Google Directions API 요청에 실패했습니다.')
  }

  if (data.status !== 'OK') {
    throw new Error(
      `Google ${mode} 경로 계산 실패: ${data.status}${data.error_message ? ` - ${data.error_message}` : ''}`
    )
  }

  const route = data.routes?.[0]
  const leg = route?.legs?.[0]

  if (!leg) {
    throw new Error(`Google ${mode} 경로를 찾지 못했습니다.`)
  }

    return {
        duration: leg.duration?.value,
        distance: leg.distance?.value,
        encodedPolyline: route.overview_polyline?.points || null,
        steps: leg.steps?.map((step) => ({
            travelMode: step.travel_mode,
            instruction: step.html_instructions,
            duration: step.duration?.value,
            distance: step.distance?.value,
            encodedPolyline: step.polyline?.points || null,
            transitDetails: step.transit_details
            ? {
                lineName: step.transit_details.line?.name,
                lineShortName: step.transit_details.line?.short_name,
                vehicleType: step.transit_details.line?.vehicle?.type,
                departureStop: step.transit_details.departure_stop?.name,
                arrivalStop: step.transit_details.arrival_stop?.name,
                numStops: step.transit_details.num_stops,
                }
            : null,
        })) || [],
    }
}

function parseDurationToSeconds(durationText) {
  if (!durationText) return null

  return Number(durationText.replace('s', ''))
}

module.exports = router