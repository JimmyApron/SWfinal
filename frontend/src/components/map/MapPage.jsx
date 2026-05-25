import { useEffect, useState } from 'react'

import KakaoMapView from './KakaoMapView'
import CurrentLocationButton from './CurrentLocationButton'
import PlaceSearchPanel from './PlaceSearchPanel'
import FamousMiddlePlacePanel from './FamousMiddlePlacePanel'

import { getCurrentPosition } from '../../services/geolocationService'
import { getRouteTime } from '../../api/routeTimeApi'
import { decodePolyline } from '../../utils/decodePolyline'
import { supabase } from '../../lib/supabaseClient'
import { createRoomNotifications } from '../../api/notificationApi'
import {
  saveMyLocation,
  getRoomMemberLocations,
  saveRoomMiddlePlace,
  getRoomMiddlePlace,
  deleteRoomMiddlePlace,
} from '../../api/mapApi'

function MapPage({ roomId }) {
  const currentRoomId = Number(roomId)

  const [currentUserId, setCurrentUserId] = useState(null)

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
    const fetchUser = async () => {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser()

      if (error) {
        console.error('사용자 정보 조회 오류:', error)
        setMessage('사용자 정보를 불러오지 못했습니다.')
        return
      }

      if (user) {
        setCurrentUserId(user.id)
      }
    }

    fetchUser()
  }, [])

  useEffect(() => {
    if (!currentRoomId) return

    loadMemberLocations()
  }, [currentRoomId])

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
  }, [currentRoomId])

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
        setMessage('사용자 정보를 찾을 수 없습니다. 로그인 상태를 확인해주세요.')
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

  useEffect(() => {
    if (!currentRoomId) return

    const loadSavedMiddlePlace = async () => {
      try {
        const savedMiddlePlace = await getRoomMiddlePlace(currentRoomId)

        if (!savedMiddlePlace) return

        setMiddlePlace(savedMiddlePlace)
        setSelectedPlace(savedMiddlePlace)
        setDestination(savedMiddlePlace)

        // DB에 이미 확정된 중간장소가 있으면 추천 후보 대신 확정 장소만 표시
        setPlaces([savedMiddlePlace])

        setMemberRouteResults([])
        setMemberRoutePaths([])

        setMessage(`${savedMiddlePlace.name}이 이미 중간장소로 확정되어 있습니다.`)

        await calculateAllMemberRoutesToMiddlePlace(savedMiddlePlace)
      } catch (error) {
        console.error('확정 중간장소 조회 오류:', error)
      }
    }

    loadSavedMiddlePlace()
  }, [currentRoomId])

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

  const handleSelectMiddlePlace = async (place) => {
    try {
      const savedMiddlePlace = await saveRoomMiddlePlace({
        roomId: currentRoomId,
        place,
        confirmedBy: currentUserId,
      })

      const confirmedPlace = {
        ...place,
        id: savedMiddlePlace.id,
        name: savedMiddlePlace.name,
        address: savedMiddlePlace.address,
        lat: savedMiddlePlace.lat,
        lng: savedMiddlePlace.lng,
      }

      setMiddlePlace(confirmedPlace)
      setSelectedPlace(confirmedPlace)
      setDestination(confirmedPlace)

      // 추천 후보 마커 제거하고 확정된 중간장소 1개만 지도에 표시
      setPlaces([confirmedPlace])

      // 이전 경로선 초기화 후 확정 장소 기준 경로 다시 계산
      setMemberRouteResults(confirmedPlace.travelResults || [])
      setMemberRoutePaths([])

      setMessage(`${confirmedPlace.name}을 중간장소로 확정했습니다. 멤버별 경로를 계산합니다.`)

      try {
        if (currentUserId && currentRoomId) {
          await createRoomNotifications({
            roomId: currentRoomId,
            senderId: currentUserId,
            type: 'middle_place_confirmed',
            title: '중간장소가 확정되었습니다',
            message: `${confirmedPlace.name}이 중간장소로 확정되었습니다.`,
            link: `/rooms/${currentRoomId}?tab=location`,
          })
        }
      } catch (error) {
        console.error('중간장소 확정 알림 생성 실패:', error)
      }

      await calculateAllMemberRoutesToMiddlePlace(confirmedPlace)
    } catch (error) {
      console.error('중간장소 확정 저장 오류:', error)
      setMessage('중간장소 확정 중 오류가 발생했습니다.')
    }
  }

  const handleCancelMiddlePlace = async () => {
    if (!middlePlace) {
      setMessage('취소할 중간장소가 없습니다.')
      return
    }

    const confirmCancel = window.confirm(
      '확정된 중간장소를 취소할까요? 다시 중간장소를 추천받을 수 있습니다.'
    )

    if (!confirmCancel) return

    try {
      await deleteRoomMiddlePlace(currentRoomId)

      setMiddlePlace(null)
      setSelectedPlace(null)
      setDestination(null)
      setPlaces([])
      setMemberRouteResults([])
      setMemberRoutePaths([])

      setMessage('중간장소 확정을 취소했습니다. 다시 중간장소를 추천받을 수 있습니다.')
    } catch (error) {
      console.error('중간장소 확정 취소 오류:', error)
      setMessage('중간장소 확정 취소 중 오류가 발생했습니다.')
    }
  }

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

          <button type="button" onClick={handleCancelMiddlePlace}>
            중간장소 확정 취소
          </button>
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

      {!middlePlace && (
        <FamousMiddlePlacePanel
          memberLocations={memberLocations}
          onRecommendPlaces={setPlaces}
          onSelectMiddlePlace={handleSelectMiddlePlace}
        />
      )}

      {middlePlace ? (
        <PlaceSearchPanel
          searchLocation={middlePlace}
          onSearchResult={setPlaces}
          onSelectPlace={handleSelectPlace}
        />
      ) : (
        <section>
          <h2>확정된 중간장소 주변 추천</h2>
          <p>
            먼저 유명 중간장소를 추천받고, 그중 하나를 중간장소로 확정해주세요.
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