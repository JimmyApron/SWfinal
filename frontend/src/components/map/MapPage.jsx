import { useEffect, useState } from 'react'

import KakaoMapView from './KakaoMapView'
import CurrentLocationButton from './CurrentLocationButton'
import PlaceSearchPanel from './PlaceSearchPanel'
import RoutePanel from './RoutePanel'

import { getCurrentPosition } from '../../services/geolocationService'
import { saveMyLocation, getRoomMemberLocations } from '../../api/mapApi'

function MapPage() {
  const currentRoomId = 7
  const currentUserId = '38e90772-f0a2-4762-810c-44b7c55848eb'

  const [currentLocation, setCurrentLocation] = useState(null)
  const [memberLocations, setMemberLocations] = useState([])

  const [places, setPlaces] = useState([])
  const [selectedPlace, setSelectedPlace] = useState(null)
  const [destination, setDestination] = useState(null)

  const [routeInfo, setRouteInfo] = useState(null)
  const [routeSteps, setRouteSteps] = useState([])
  const [routeMessage, setRouteMessage] = useState('')
  const [routePath, setRoutePath] = useState([])

  const [message, setMessage] = useState('')

  useEffect(() => {
    const loadMemberLocations = async () => {
      if (!currentRoomId) return

      try {
        const locations = await getRoomMemberLocations(currentRoomId)
        setMemberLocations(locations)
        setMessage('DB에 저장된 멤버 위치를 불러왔습니다.')
      } catch (error) {
        console.error('멤버 위치 조회 오류:', error)
        setMessage('멤버 위치를 불러오지 못했습니다.')
      }
    }

    loadMemberLocations()
  }, [])

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

  const handleSelectPlace = (place) => {
    setSelectedPlace(place)
    setDestination(place)

    setRouteInfo(null)
    setRouteSteps([])
    setRoutePath([])
    setRouteMessage('')

    setMessage(`${place.name}을 목적지로 설정했습니다.`)
  }

  const handleSearchRoute = async () => {
    if (!currentLocation) {
      setRouteMessage('먼저 현재 위치를 가져와주세요.')
      return
    }

    if (!destination) {
      setRouteMessage('먼저 추천 장소 목록에서 목적지를 선택해주세요.')
      return
    }

    if (!destination.lat || !destination.lng) {
      setRouteMessage('목적지 좌표가 없습니다. 다른 장소를 선택해주세요.')
      return
    }

    try {
      setRouteMessage('경로를 검색하는 중입니다.')
      setRouteInfo(null)
      setRouteSteps([])
      setRoutePath([])

      const apiBaseUrl = process.env.REACT_APP_API_BASE_URL

      const response = await fetch(`${apiBaseUrl}/kakao/route`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          origin: {
            lat: currentLocation.lat,
            lng: currentLocation.lng,
          },
          destination: {
            lat: destination.lat,
            lng: destination.lng,
          },
        }),
      })

      if (!response.ok) {
        throw new Error('경로 검색 API 요청 실패')
      }

      const data = await response.json()

      if (!data.path || data.path.length === 0) {
        setRouteMessage('경로 좌표를 찾지 못했습니다.')
        return
      }

      setRoutePath(data.path)

      setRouteInfo({
        distance: data.distance,
        duration: data.duration,
      })

      setRouteSteps(data.steps || [])
      setRouteMessage('경로 검색이 완료되었습니다.')
    } catch (error) {
      console.error('경로 검색 오류:', error)
      setRouteMessage('경로 검색 중 오류가 발생했습니다.')
    }
  }

  return (
    <section className="map-section">
      <h2>지도 기능</h2>

      <CurrentLocationButton onClick={handleCurrentLocation} />

      {message && <p>{message}</p>}

      {currentLocation && (
        <div className="location-box">
          <p>내 현재 위치</p>
          <p>위도: {currentLocation.lat}</p>
          <p>경도: {currentLocation.lng}</p>
          <p>정확도: {Math.round(currentLocation.accuracy)}m</p>
        </div>
      )}

      {memberLocations.length > 0 && (
        <div className="location-box">
          <h3>DB에 저장된 멤버 위치</h3>

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

      <KakaoMapView
        currentLocation={currentLocation}
        memberLocations={memberLocations}
        places={places}
        selectedPlace={selectedPlace}
        routePath={routePath}
      />

      <PlaceSearchPanel
        searchLocation={currentLocation}
        onSearchResult={setPlaces}
        onSelectPlace={handleSelectPlace}
      />

      <RoutePanel
        currentLocation={currentLocation}
        destination={destination}
        routeInfo={routeInfo}
        routeSteps={routeSteps}
        routeMessage={routeMessage}
        onSearchRoute={handleSearchRoute}
      />
    </section>
  )
}

export default MapPage