import { searchPlacesByKeyword } from '../api/kakaoPlacesApi'
import { getRouteTime } from '../api/routeTimeApi'

const DISCOVERY_KEYWORDS = [
  '테마거리',
  '먹자골목',
  '카페거리',
  '벚꽃거리',
  '관광명소',
  '해수욕장',
  '공원',
  '시장',
  '전통시장',
  '백화점',
  '쇼핑몰',
  '복합쇼핑몰',
  '아울렛',
  '문화시설',
  '박물관',
  '미술관',
  '체험관',
  '전시관',
  '광장',
  '영화관',
  '복합문화공간',
]

const ALLOWED_CATEGORY_PREFIXES = [
  // 관광/명소 계열
  '여행 > 관광,명소',
  '여행 > 관광,명소 > 거리,골목',
  '여행 > 관광,명소 > 테마거리',
  '여행 > 관광,명소 > 공원',
  '여행 > 관광,명소 > 해수욕장',
  '여행 > 관광,명소 > 광장',
  '여행 > 관광,명소 > 전망대',
  '여행 > 관광,명소 > 문화거리',
  '여행 > 관광,명소 > 유적지',

  // 문화/예술/전시 계열
  '문화,예술',
  '문화,예술 > 문화시설',
  '문화,예술 > 공연장',
  '문화,예술 > 전시관',
  '문화,예술 > 박물관',
  '문화,예술 > 미술관',
  '문화,예술 > 영화관',
  '문화,예술 > 복합문화공간',

  // 쇼핑/대형 상권 계열
  '쇼핑,유통 > 백화점',
  '쇼핑,유통 > 쇼핑센터,할인매장',
  '쇼핑,유통 > 아울렛',
  '쇼핑,유통 > 시장',
  '쇼핑,유통 > 전통시장',
  '쇼핑,유통 > 복합쇼핑몰',
  '쇼핑,유통 > 대형마트',

  // 실내 놀거리 / 체험 계열
  '스포츠,레저 > 테마파크',
  '스포츠,레저 > 놀이공원',
  '스포츠,레저 > 동물원',
  '스포츠,레저 > 아쿠아리움',
  '스포츠,레저 > 체험관',

  // 역/교통 중심지
  '교통,수송 > 지하철,전철',
  '교통,수송 > 기차역',
  '교통,수송 > 버스터미널',
]

const EXCLUDE_CATEGORY_PREFIXES = [
  // 숙박 제외
  '여행 > 숙박',

  // 음식점/카페는 중간장소 확정 후 주변 추천에서 따로 사용
  '음식점',
  '카페',

  // 생활시설 제외
  '가정,생활',
  '서비스,산업',
  '의료,건강',
  '부동산',
  '금융,보험',

  // 소형 판매점/개별 매장 제외
  '쇼핑,유통 > 패션',
  '쇼핑,유통 > 의류',
  '쇼핑,유통 > 잡화',
  '쇼핑,유통 > 화장품',
  '쇼핑,유통 > 스포츠용품',
  '쇼핑,유통 > 생활용품',
  '쇼핑,유통 > 편의점',
  '쇼핑,유통 > 슈퍼마켓',
  '쇼핑,유통 > 종합소매',

  // 스포츠 장소가 아니라 용품/학원/소형 시설이면 제외
  '스포츠,레저 > 스포츠용품',
  '스포츠,레저 > 골프',
  '스포츠,레저 > 골프연습장',
  '스포츠,레저 > 헬스장',
  '스포츠,레저 > 요가',
  '스포츠,레저 > 필라테스',
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
  '환전',
  '환전소',
  '외환',
  '은행',
  'atm',
  '애견',
  '한우',
  '농산물',
  '축산',
  '식육',

  // 백화점/몰 내부 매장 및 브랜드
  '유니클로',
  '노스페이스',
  '토리버치',
  '로브테일러',
  '부가티',
  '몽클레르',
  '구찌',
  '프라다',
  '샤넬',
  '루이비통',
  '나이키',
  '아디다스',
  '자라',
  '무인양품',
  '올리브영',
  '스타벅스',
  '콜핑',
  '말본골프',
  '골프',
  '캠핑용품',
  '스포츠용품',

  // 너무 소형/개별 장소 느낌
  '매장',
  '입구',
  '주차장',
  '고객센터',
  '푸드코트',

  // 주변 장소 추천 단계에서 따로 다룰 것들
  '도넛',
  '디저트',
  '치킨',
  '분식',
  '고깃집',
  '포토시그니처',
  '인생네컷',
  '하루필름',
  '포토이즘',
  '셀픽스',
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

  for (const keyword of DISCOVERY_KEYWORDS) {
    try {
      const places = await searchPlacesByKeyword({
        lat: middlePoint.lat,
        lng: middlePoint.lng,
        keyword,
        radius: 20000,
      })

      const validPlaces = places.filter(isValidFamousPlace)

      allPlaces.push(...validPlaces)
    } catch (error) {
      console.warn(`${keyword} 키워드 검색 실패:`, error)
    }
  }

  const uniquePlaces = removeDuplicatePlaces(allPlaces)

  const sortedPlaces = uniquePlaces.sort((a, b) => {
    return getPlaceQualityScore(b) - getPlaceQualityScore(a)
  })

  // 이동시간 계산 중 실패하는 후보가 있을 수 있으므로 내부 후보는 넉넉히 유지
  return sortedPlaces.slice(0, 20)
}

async function scorePlaceByTravelTime({
  place,
  memberLocations,
  memberTransportModes,
}) {
  const travelResults = []

  for (const member of memberLocations) {
    const memberKey = member.userid || member.guestid || member.id
    const mode = memberTransportModes[memberKey]

    if (!mode) {
      throw new Error('이동수단을 등록하지 않은 멤버가 있습니다.')
    }

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
      guestid: member.guestid,
      nickname:
        member.profiles?.nickname ||
        member.room_guests?.nickname ||
        member.nickname ||
        '멤버',
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
  const placeQualityScore = getPlaceQualityScore(place)

  return {
    ...place,
    travelResults,
    timeGap,
    avgDuration,
    placeQualityScore,

    // timeGap, avgDuration은 초 단위라 장소 품질 점수에 가중치를 줌
    score: timeGap + avgDuration * 0.2 - placeQualityScore * 20,
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
  const name = normalizeText(place.name || '')
  const category = place.category || ''
  const normalizedCategory = normalizeText(category)

  const isExcludedByKeyword = EXCLUDE_KEYWORDS.some((keyword) => {
    const normalizedKeyword = normalizeText(keyword)

    return (
      name.includes(normalizedKeyword) ||
      normalizedCategory.includes(normalizedKeyword)
    )
  })

  if (isExcludedByKeyword) {
    return false
  }

  const isExcludedByCategory = EXCLUDE_CATEGORY_PREFIXES.some((prefix) => {
    return category.startsWith(prefix)
  })

  if (isExcludedByCategory) {
    return false
  }

  const isAllowedByCategory = ALLOWED_CATEGORY_PREFIXES.some((prefix) => {
    return category.startsWith(prefix)
  })

  if (!isAllowedByCategory) {
    return false
  }

  return true
}

function getPlaceQualityScore(place) {
  const name = normalizeText(place.name || '')
  const category = place.category || ''

  let score = 0

  // 카테고리 기반 가중치
  if (category.startsWith('여행 > 관광,명소 > 테마거리')) score += 60
  if (category.startsWith('여행 > 관광,명소 > 거리,골목')) score += 55
  if (category.startsWith('여행 > 관광,명소 > 해수욕장')) score += 55
  if (category.startsWith('여행 > 관광,명소 > 공원')) score += 45
  if (category.startsWith('여행 > 관광,명소 > 광장')) score += 45
  if (category.startsWith('여행 > 관광,명소')) score += 35

  if (category.startsWith('문화,예술 > 복합문화공간')) score += 45
  if (category.startsWith('문화,예술 > 박물관')) score += 40
  if (category.startsWith('문화,예술 > 미술관')) score += 40
  if (category.startsWith('문화,예술 > 전시관')) score += 35
  if (category.startsWith('문화,예술 > 영화관')) score += 25
  if (category.startsWith('문화,예술')) score += 25

  if (category.startsWith('쇼핑,유통 > 백화점')) score += 55
  if (category.startsWith('쇼핑,유통 > 복합쇼핑몰')) score += 50
  if (category.startsWith('쇼핑,유통 > 쇼핑센터,할인매장')) score += 40
  if (category.startsWith('쇼핑,유통 > 아울렛')) score += 40
  if (category.startsWith('쇼핑,유통 > 시장')) score += 40
  if (category.startsWith('쇼핑,유통 > 전통시장')) score += 40
  if (category.startsWith('쇼핑,유통 > 대형마트')) score += 20

  if (category.startsWith('스포츠,레저 > 테마파크')) score += 50
  if (category.startsWith('스포츠,레저 > 놀이공원')) score += 45
  if (category.startsWith('스포츠,레저 > 동물원')) score += 45
  if (category.startsWith('스포츠,레저 > 아쿠아리움')) score += 45
  if (category.startsWith('스포츠,레저 > 체험관')) score += 35

  if (category.startsWith('교통,수송 > 지하철,전철')) score += 20
  if (category.startsWith('교통,수송 > 기차역')) score += 20
  if (category.startsWith('교통,수송 > 버스터미널')) score += 20

  // 이름 기반 보너스
  const bonusWords = [
    '거리',
    '먹자골목',
    '카페거리',
    '벚꽃거리',
    '해수욕장',
    '공원',
    '시장',
    '백화점',
    '롯데몰',
    '몰',
    '광장',
    '박물관',
    '미술관',
    '체험관',
    '문화',
    '시민공원',
    '삼정타워',
  ]

  bonusWords.forEach((word) => {
    if (name.includes(normalizeText(word))) {
      score += 10
    }
  })

  return score
}

function normalizeText(text) {
  return text.replace(/\s/g, '').toLowerCase()
}
