import { useEffect, useState } from 'react'

import KakaoMapView from './KakaoMapView'
import CurrentLocationButton from './CurrentLocationButton'
import PlaceSearchPanel from './PlaceSearchPanel'
import FamousMiddlePlacePanel from './FamousMiddlePlacePanel'

import { getCurrentPosition } from '../../services/geolocationService'
import { saveMyLocation, getRoomMemberLocations } from '../../api/mapApi'
import { getRouteTime } from '../../api/routeTimeApi'
import { decodePolyline } from '../../utils/decodePolyline'

function MapPage() {
  const currentRoomId = 7
  const currentUserId = '38e90772-f0a2-4762-810c-44b7c55848eb'

  const [currentLocation, setCurrentLocation] = useState(null)
  const [memberLocations, setMemberLocations] = useState([])

  const [places, setPlaces] = useState([])
  const [selectedPlace, setSelectedPlace] = useState(null)
  const [destination, setDestination] = useState(null)

  const [middlePlace, setMiddlePlace] = useState(null)
  const [memberRouteResults, setMemberRouteResults] = useState([])
  const [memberRoutePaths, setMemberRoutePaths] = useState([])

  const [message, setMessage] = useState('')

  useEffect(() => {
    loadMemberLocations()
  }, [])

  // DB에 저장된 멤버 위치를 주기적으로 다시 불러오기
  useEffect(() => {
    if (!currentRoomId) return

    const intervalId = setInterval(async () => {
      try {
        const locations = await getRoomMemberLocations(currentRoomId)
        setMemberLocations(locations)
      } catch (error) {
        console.error('실시간 멤버 위치 갱신 오류:', error)
      }
    }, 5000)

    return () => {
      clearInterval(intervalId)
    }
  }, [])

  const loadMemberLocations = async () => {
    if (!currentRoomId) return []

    try {
      const locations = await getRoomMemberLocations(currentRoomId)
      setMemberLocations(locations)
      setMessage('DB에 저장된 멤버 위치를 불러왔습니다.')
      return locations
    } catch (error) {
      console.error('멤버 위치 조회 오류:', error)
      setMessage('멤버 위치를 불러오지 못했습니다.')
      return []
    }
  }

  const handleCurrentLocation = async () => {
    try {
      if (!currentUserId) {
        setMessage('사용자 정보를 찾을 수 없습니다.')
        return
      }

      if (!currentRoomId) {
        setMessage('방 정보를 찾을 수 없습니다.')
        return
      }

      setMessage('현재 위치를 가져오는 중입니다.')

      const location = await getCurrentPosition()

      setCurrentLocation(location)
      setMessage('현재 위치를 가져왔습니다. DB에 저장하는 중입니다.')

      await saveMyLocation({
        userId: currentUserId,
        roomId: currentRoomId,
        latitude: location.lat,
        longitude: location.lng,
        accuracy: location.accuracy,
      })

      const locations = await getRoomMemberLocations(currentRoomId)
      setMemberLocations(locations)

      setMessage('현재 위치를 가져오고 DB에 저장했습니다.')
    } catch (error) {
      console.error('현재 위치 저장 오류:', error)
      setMessage('현재 위치를 가져오거나 DB에 저장하는 중 오류가 발생했습니다.')
    }
  }

  const calculateAllMemberRoutesToMiddlePlace = async (place) => {
    if (!place) {
      setMessage('중간장소 정보가 없습니다.')
      return
    }

    const latestLocations = await loadMemberLocations()

    if (!latestLocations || latestLocations.length === 0) {
      setMessage('멤버 위치 정보가 없습니다.')
      return
    }

    try {
      setMessage('모든 멤버의 경로와 이동시간을 계산하는 중입니다.')

      const routeResults = []
      const routePaths = []

      for (const member of latestLocations) {
        if (!member.latitude || !member.longitude) {
          continue
        }

        const previousResult = place.travelResults?.find(
          (result) => result.userid === member.userid
        )

        const mode = previousResult?.mode || 'transit'

        const origin = {
          lat: Number(member.latitude),
          lng: Number(member.longitude),
        }

        const destinationPoint = {
          lat: Number(place.lat),
          lng: Number(place.lng),
        }

        const timeResult = await getRouteTime({
          origin,
          destination: destinationPoint,
          mode,
        })

        routeResults.push({
          userid: member.userid,
          nickname: member.profiles?.nickname || '멤버',
          mode,
          duration: timeResult.duration,
          distance: timeResult.distance,
          durationMinutes: Math.round(timeResult.duration / 60),
          distanceKm: timeResult.distance
            ? (timeResult.distance / 1000).toFixed(1)
            : null,
        })

        // 자동차는 기존 카카오 경로 API의 path 사용
        if (mode === 'car') {
          const pathResult = await getCarRoutePath({
            origin,
            destination: destinationPoint,
          })

          if (pathResult?.path?.length > 0) {
            routePaths.push({
              userid: member.userid,
              nickname: member.profiles?.nickname || '멤버',
              mode,
              path: pathResult.path,
            })
          }
        }

        // 대중교통은 Google Directions의 overview_polyline을 디코딩해서 사용
        if (mode === 'transit' && timeResult.encodedPolyline) {
          const decodedPath = decodePolyline(timeResult.encodedPolyline)

          if (decodedPath.length > 0) {
            routePaths.push({
              userid: member.userid,
              nickname: member.profiles?.nickname || '멤버',
              mode,
              path: decodedPath,
            })
          }
        }
      }

      setMemberRouteResults(routeResults)
      setMemberRoutePaths(routePaths)

      setMessage('중간장소까지 모든 멤버의 이동시간과 경로를 계산했습니다.')
    } catch (error) {
      console.error('멤버별 경로 계산 오류:', error)
      setMessage(error.message || '멤버별 경로 계산 중 오류가 발생했습니다.')
    }
  }

  const getCarRoutePath = async ({ origin, destination }) => {
    const apiBaseUrl = process.env.REACT_APP_API_BASE_URL

    const response = await fetch(`${apiBaseUrl}/kakao/route`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        origin,
        destination,
      }),
    })

    if (!response.ok) {
      console.warn('자동차 경로선 API 요청 실패')
      return null
    }

    return response.json()
  }

  // 유명 중간장소 후보 중 하나를 확정하는 함수
  const handleSelectMiddlePlace = async (place) => {
    setMiddlePlace(place)
    setSelectedPlace(place)
    setDestination(place)

    // 추천 후보 5개 대신 확정된 중간장소 1개만 지도에 표시
    setPlaces([place])

    // 이전 경로선 초기화 후 새로 계산
    setMemberRouteResults(place.travelResults || [])
    setMemberRoutePaths([])

    setMessage(`${place.name}을 중간장소로 확정했습니다. 멤버별 경로를 계산합니다.`)

    await calculateAllMemberRoutesToMiddlePlace(place)
  }

  // 확정된 중간장소 주변 음식점/카페/놀거리 중 하나를 선택하는 함수
  const handleSelectPlace = (place) => {
    setSelectedPlace(place)
    setDestination(place)
    setMessage(`${place.name}을 목적지로 설정했습니다.`)
  }

  const handleRefreshMemberRoutes = async () => {
    if (!middlePlace) {
      setMessage('먼저 중간장소를 확정해주세요.')
      return
    }

    await calculateAllMemberRoutesToMiddlePlace(middlePlace)
  }

  return (
    <section className="map-section">
      <h2>지도 기능</h2>

      <CurrentLocationButton onClick={handleCurrentLocation} />

      {message && <p>{message}</p>}

      {currentLocation && (
        <div className="location-box">
          <h3>내 브라우저 현재 위치</h3>
          <p>위도: {currentLocation.lat}</p>
          <p>경도: {currentLocation.lng}</p>
          <p>정확도: {Math.round(currentLocation.accuracy)}m</p>
        </div>
      )}

      {memberLocations.length > 0 && (
        <div className="location-box">
          <h3>DB에 저장된 멤버 현재 위치</h3>

          {memberLocations.map((location) => (
            <div key={location.id}>
              <p>
                닉네임: {location.profiles?.nickname || '닉네임 없음'}
              </p>
              <p>위도: {location.latitude}</p>
              <p>경도: {location.longitude}</p>
            </div>
          ))}
        </div>
      )}

      {middlePlace && (
        <div className="location-box">
          <h3>확정된 중간장소</h3>
          <p>장소명: {middlePlace.name}</p>
          <p>주소: {middlePlace.address || '주소 정보 없음'}</p>
          <p>위도: {middlePlace.lat}</p>
          <p>경도: {middlePlace.lng}</p>
        </div>
      )}

      {memberRouteResults.length > 0 && (
        <div className="location-box">
          <h3>중간장소까지 멤버별 이동시간</h3>

          <button type="button" onClick={handleRefreshMemberRoutes}>
            멤버 위치 기준으로 다시 계산
          </button>

          {memberRouteResults.map((result) => (
            <div key={result.userid}>
              <p>
                {result.nickname} / {getModeLabel(result.mode)} /{' '}
                {result.durationMinutes}분
                {result.distanceKm ? ` / ${result.distanceKm}km` : ''}
              </p>
            </div>
          ))}

          <p style={{ fontSize: '13px', color: '#666' }}>
            자동차는 카카오 경로 API, 대중교통은 Google Directions 경로 데이터를 이용해 지도에 표시합니다.
          </p>
        </div>
      )}

      <KakaoMapView
        currentLocation={currentLocation}
        memberLocations={memberLocations}
        places={places}
        selectedPlace={selectedPlace}
        memberRoutePaths={memberRoutePaths}
      />

      <FamousMiddlePlacePanel
        memberLocations={memberLocations}
        onRecommendPlaces={setPlaces}
        onSelectMiddlePlace={handleSelectMiddlePlace}
      />

      {middlePlace ? (
        <PlaceSearchPanel
          searchLocation={middlePlace}
          onSearchResult={setPlaces}
          onSelectPlace={handleSelectPlace}
        />
      ) : (
        <section>
          <h2>주변 장소 추천</h2>
          <p>
            먼저 위에서 유명 중간장소를 추천받고, 그중 하나를 중간장소로 확정해주세요.
            중간장소가 확정되면 그 주변의 음식점, 카페, 놀거리 장소를 검색할 수 있습니다.
          </p>
        </section>
      )}
    </section>
  )
}

function getModeLabel(mode) {
  if (mode === 'car') return '자동차'
  if (mode === 'transit') return '대중교통'
  return mode
}

export default MapPage