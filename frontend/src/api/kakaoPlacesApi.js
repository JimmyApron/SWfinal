const CATEGORY_TYPE_MAP = {
  restaurant: 'FD6',
  cafe: 'CE7',
  activity: 'CT1',
  parking: 'PK6',
}

export async function searchNearbyPlaces({
  lat,
  lng,
  category = 'restaurant',
  radius = 1000,
}) {
  await loadKakaoMapScript()

  const categoryCode = CATEGORY_TYPE_MAP[category] || 'FD6'
  const placesService = new window.kakao.maps.services.Places()
  const location = new window.kakao.maps.LatLng(Number(lat), Number(lng))

  return new Promise((resolve, reject) => {
    placesService.categorySearch(
      categoryCode,
      (data, status) => {
        if (status === window.kakao.maps.services.Status.OK) {
          const formattedPlaces = data.map((place) => ({
            id: place.id,
            name: place.place_name || '이름 없음',
            address:
              place.road_address_name ||
              place.address_name ||
              '주소 정보 없음',
            lat: Number(place.y),
            lng: Number(place.x),
            phone: place.phone || '',
            distance: place.distance ? Number(place.distance) : null,
            kakaoMapUrl: place.place_url || '',
          }))

          resolve(formattedPlaces)
          return
        }

        if (status === window.kakao.maps.services.Status.ZERO_RESULT) {
          resolve([])
          return
        }

        reject(new Error('카카오 장소 검색에 실패했습니다.'))
      },
      {
        location,
        radius: Number(radius),
        sort: window.kakao.maps.services.SortBy.DISTANCE,
      }
    )
  })
}

function loadKakaoMapScript() {
  return new Promise((resolve, reject) => {
    if (window.kakao && window.kakao.maps && window.kakao.maps.services) {
      resolve()
      return
    }

    reject(new Error('index.html에 카카오맵 services 라이브러리가 로드되지 않았습니다.'))
  })
}

export async function searchPlacesByKeyword({
  lat,
  lng,
  keyword,
  radius = 20000,
}) {
  await loadKakaoMapScript()

  const placesService = new window.kakao.maps.services.Places()
  const location = new window.kakao.maps.LatLng(Number(lat), Number(lng))

  return new Promise((resolve, reject) => {
    placesService.keywordSearch(
      keyword,
      (data, status) => {
        if (status === window.kakao.maps.services.Status.OK) {
          const formattedPlaces = data.map((place) => ({
            id: place.id,
            name: place.place_name || '이름 없음',
            address:
              place.road_address_name ||
              place.address_name ||
              '주소 정보 없음',
            category: place.category_name || '',
            lat: Number(place.y),
            lng: Number(place.x),
            phone: place.phone || '',
            distance: place.distance ? Number(place.distance) : null,
            kakaoMapUrl: place.place_url || '',
            keyword,
          }))

          resolve(formattedPlaces)
          return
        }

        if (status === window.kakao.maps.services.Status.ZERO_RESULT) {
          resolve([])
          return
        }

        reject(new Error('카카오 키워드 장소 검색에 실패했습니다.'))
      },
      {
        location,
        radius: Number(radius),
        sort: window.kakao.maps.services.SortBy.DISTANCE,
      }
    )
  })
}