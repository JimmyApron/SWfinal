import { searchPlacesByKeyword } from '../api/kakaoPlacesApi'
import { getRouteTime } from '../api/routeTimeApi'

const PRIORITY_FAMOUS_KEYWORDS = [
  '롯데백화점',
  '신세계백화점',
  '현대백화점',
  '롯데몰',
  '신세계',
  '센텀시티',
  '프리미엄아울렛',
  '아울렛',
  '해수욕장',
  '시민공원',
  '부산시민공원',
  '자갈치시장',
  '국제시장',
  'BIFF광장',
  '전포카페거리',
]

const EXCLUDE_KEYWORDS = [
  '편의점',
  '약국',
  '병원',
  '의원',
  '치과',
  '한의원',
  '부동산',
  '주유소',
  '세탁소',
  '미용실',
  '애견',
  '한우',
  '농산물',
  '축산',
  '식육',
]

export function calculateMiddlePoint(memberLocations) {
  const validLocations = memberLocations.filter(
    (location) => location.latitude && location.longitude
  )

  if (validLocations.length === 0) {
    return null
  }

  const total = validLocations.reduce(
    (sum, location) => ({
      lat: sum.lat + Number(location.latitude),
      lng: sum.lng + Number(location.longitude),
    }),
    { lat: 0, lng: 0 }
  )

  return {
    lat: total.lat / validLocations.length,
    lng: total.lng / validLocations.length,
  }
}

export async function recommendFamousMiddlePlaces({
  memberLocations,
  memberTransportModes,
}) {
  if (!memberLocations || memberLocations.length < 2) {
    throw new Error('멤버 위치가 2개 이상 필요합니다.')
  }

  const middlePoint = calculateMiddlePoint(memberLocations)

  if (!middlePoint) {
    throw new Error('중간 좌표를 계산할 수 없습니다.')
  }

  const candidatePlaces = await getFamousCandidatePlaces(middlePoint)

  const scoredPlaces = []

  for (const place of candidatePlaces) {
    try {
      const scoredPlace = await scorePlaceByTravelTime({
        place,
        memberLocations,
        memberTransportModes,
      })

      scoredPlaces.push(scoredPlace)
    } catch (error) {
      console.warn('장소 이동시간 계산 실패:', place.name, error)
    }
  }

  return scoredPlaces
    .sort((a, b) => a.score - b.score)
    .slice(0, 5)
}

async function getFamousCandidatePlaces(middlePoint) {
  const allPlaces = []

  for (const keyword of FAMOUS_PLACE_KEYWORDS) {
    const places = await searchPlacesByKeyword({
      lat: middlePoint.lat,
      lng: middlePoint.lng,
      keyword,
      radius: 20000,
    })

    allPlaces.push(...places)
  }

  const uniquePlaces = removeDuplicatePlaces(allPlaces)
  const filteredPlaces = uniquePlaces.filter(isValidFamousPlace)

  // 후보를 너무 많이 계산하면 API 호출이 많아져서 일단 5개만 사용
  return filteredPlaces.slice(0, 5)
}

async function scorePlaceByTravelTime({
  place,
  memberLocations,
  memberTransportModes,
}) {
  const travelResults = []

  for (const member of memberLocations) {
    const mode = memberTransportModes[member.userid] || 'transit'

    const result = await getRouteTime({
      origin: {
        lat: Number(member.latitude),
        lng: Number(member.longitude),
      },
      destination: {
        lat: Number(place.lat),
        lng: Number(place.lng),
      },
      mode,
    })

    travelResults.push({
      userid: member.userid,
      nickname: member.profiles?.nickname || '멤버',
      mode,
      duration: result.duration,
      distance: result.distance,
      durationMinutes: Math.round(result.duration / 60),
    })
  }

  const durations = travelResults.map((item) => item.duration)

  const maxDuration = Math.max(...durations)
  const minDuration = Math.min(...durations)
  const avgDuration =
    durations.reduce((sum, value) => sum + value, 0) / durations.length

  const timeGap = maxDuration - minDuration

  return {
    ...place,
    travelResults,
    timeGap,
    avgDuration,
    score: timeGap + avgDuration * 0.2,
  }
}

function removeDuplicatePlaces(places) {
  const placeMap = new Map()

  places.forEach((place) => {
    const key = place.id || `${place.name}-${place.lat}-${place.lng}`

    if (!placeMap.has(key)) {
      placeMap.set(key, place)
    }
  })

  return Array.from(placeMap.values())
}

function isValidFamousPlace(place) {
  const name = place.name || ''
  const category = place.category || ''

  const isExcluded = EXCLUDE_KEYWORDS.some((keyword) => {
    return name.includes(keyword) || category.includes(keyword)
  })

  if (isExcluded) {
    return false
  }

  const isPriorityPlace = PRIORITY_FAMOUS_KEYWORDS.some((keyword) => {
    return name.includes(keyword) || category.includes(keyword)
  })

  return isPriorityPlace
}