const express = require('express')
const router = express.Router()
const { createWalkingRouteCache } = require('./walkingRouteCache')
const lookup = createWalkingRouteCache()

router.post('/walking', async (req, res) => {
  const { origin, destination } = req.body || {}
  const valid = p => p && typeof p.lat === 'number' && typeof p.lng === 'number' &&
    Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180
  if (!valid(origin) || !valid(destination)) return res.status(400).json({ message: '유효한 출발지와 목적지 좌표가 필요합니다.' })
  if (!process.env.TMAP_APP_KEY) return res.status(503).json({ message: '실제 도보 경로를 조회하려면 서버의 TMAP_APP_KEY 설정이 필요합니다.' })
  try {
    const key = JSON.stringify([origin.lat, origin.lng, destination.lat, destination.lng])
    const result = await lookup(key, async () => {
    const response = await fetch('https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1', {
      method: 'POST', headers: { 'Content-Type': 'application/json', appKey: process.env.TMAP_APP_KEY },
      body: JSON.stringify({ startX: origin.lng, startY: origin.lat, endX: destination.lng, endY: destination.lat,
        reqCoordType: 'WGS84GEO', resCoordType: 'WGS84GEO', startName: encodeURIComponent('출발지'), endName: encodeURIComponent('도착지') }),
      signal: AbortSignal.timeout(15000),
    })
    const data = await response.json()
    if (!response.ok || data.error) return { status: 502, body: { message: 'TMAP 도보 경로 조회에 실패했습니다. 키와 보행자 API 사용 권한을 확인해 주세요.' } }
    const segments = (data.features || []).filter(f => f.geometry?.type === 'LineString')
      .map(f => f.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })))
    const summary = data.features?.find(f => f.properties?.totalTime !== undefined)?.properties
    if (!segments.length || segments.some(segment => segment.length < 2 || segment.some(p => !valid(p)))) {
      return { status: 404, body: { message: '이 구간의 실제 도보 경로를 찾지 못했습니다.' } }
    }
    return { status: 200, body: { segments, duration: summary?.totalTime ?? null, distance: summary?.totalDistance ?? null } }
    })
    return res.status(result.status).json(result.body)
  } catch (_) {
    return res.status(502).json({ message: '도보 경로 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' })
  }
})
module.exports = router
