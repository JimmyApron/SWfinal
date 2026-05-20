const express = require('express')
const router = express.Router()

router.post('/route', async (req, res) => {
  try {
    const { origin, destination } = req.body

    if (!origin || !destination) {
      return res.status(400).json({
        message: '출발지와 목적지가 필요합니다.',
      })
    }

    const kakaoRestApiKey = process.env.KAKAO_REST_API_KEY

    if (!kakaoRestApiKey) {
      return res.status(500).json({
        message: 'KAKAO_REST_API_KEY가 설정되지 않았습니다.',
      })
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

    if (!response.ok) {
      const errorText = await response.text()
      console.error('카카오모빌리티 API 오류:', errorText)

      return res.status(response.status).json({
        message: '카카오모빌리티 길찾기 API 요청 실패',
        detail: errorText,
      })
    }

    const data = await response.json()

    const route = data.routes?.[0]

    if (!route) {
      return res.status(404).json({
        message: '경로를 찾지 못했습니다.',
      })
    }

    const path = []

    route.sections?.forEach((section) => {
      section.roads?.forEach((road) => {
        const vertexes = road.vertexes || []

        for (let i = 0; i < vertexes.length; i += 2) {
          path.push({
            lng: vertexes[i],
            lat: vertexes[i + 1],
          })
        }
      })
    })

    const distance = route.summary?.distance
    const duration = route.summary?.duration

    return res.json({
      distance,
      duration,
      path,
      steps: [],
    })
  } catch (error) {
    console.error('경로 API 서버 오류:', error)

    return res.status(500).json({
      message: '서버에서 경로 검색 중 오류가 발생했습니다.',
    })
  }
})

module.exports = router