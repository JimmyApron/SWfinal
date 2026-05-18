import { useState } from 'react'
import GoogleMapView from './GoogleMapView'
import CurrentLocationButton from './CurrentLocationButton'
import PlaceSearchPanel from './PlaceSearchPanel'
import RoutePanel from './RoutePanel'
import { getCurrentPosition } from '../../services/geolocationService'
import { saveMyLocation } from '../../api/mapApi'

function MapPage() {
  const [currentLocation, setCurrentLocation] = useState(null)
  const [places, setPlaces] = useState([])
  const [selectedPlace, setSelectedPlace] = useState(null)
  const [destination, setDestination] = useState(null)

  const [directionsResult, setDirectionsResult] = useState(null)
  const [routeInfo, setRouteInfo] = useState(null)
  const [routeSteps, setRouteSteps] = useState([])
  const [routeMessage, setRouteMessage] = useState('')

  const [message, setMessage] = useState('')

  const handleCurrentLocation = async () => {
    try {
      setMessage('현재 위치를 가져오는 중입니다.')

      const location = await getCurrentPosition()

      setCurrentLocation(location)
      setMessage('현재 위치를 가져왔습니다. DB에 저장하는 중입니다.')

      try {
        await saveMyLocation({
          userId: 'test-user',
          roomId: null,
          latitude: location.lat,
          longitude: location.lng,
          accuracy: location.accuracy,
        })

        setMessage('현재 위치를 가져오고 DB에 저장했습니다.')
      } catch (error) {
        console.error('Supabase 저장 오류:', error)
        setMessage('현재 위치는 가져왔지만 DB 저장은 실패했습니다.')
      }
    } catch (error) {
      console.error('현재 위치 가져오기 오류:', error)
      setMessage('현재 위치를 가져오지 못했습니다.')
    }
  }

  const handleSelectPlace = (place) => {
    setSelectedPlace(place)
    setDestination(place)

    setDirectionsResult(null)
    setRouteInfo(null)
    setRouteSteps([])
    setRouteMessage('')

    setMessage(`${place.name}을 목적지로 설정했습니다.`)
  }

  const handleSearchRoute = () => {
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
      console.log('destination:', destination)
      return
    }

    if (!window.google || !window.google.maps) {
      setRouteMessage('Google Maps가 아직 로드되지 않았습니다.')
      return
    }

    const directionsService = new window.google.maps.DirectionsService()

    const routeRequest = {
      origin: {
        lat: Number(currentLocation.lat),
        lng: Number(currentLocation.lng),
      },
      destination: {
        lat: Number(destination.lat),
        lng: Number(destination.lng),
      },
      travelMode: window.google.maps.TravelMode.TRANSIT,
      transitOptions: {
        departureTime: new Date(),
      },
    }

    console.log('대중교통 경로 요청:', routeRequest)
    setRouteMessage('대중교통 경로를 찾는 중입니다.')

    directionsService.route(routeRequest, (result, status) => {
      console.log('Directions status:', status)
      console.log('Directions result:', result)

      if (status !== 'OK') {
        console.error('대중교통 경로 검색 실패 status:', status)
        console.error('경로 요청 origin:', routeRequest.origin)
        console.error('경로 요청 destination:', routeRequest.destination)

        setDirectionsResult(null)
        setRouteInfo(null)
        setRouteSteps([])

        if (status === 'ZERO_RESULTS') {
          setRouteMessage(
            'Google Maps에서 해당 위치의 대중교통 경로를 제공하지 않습니다. 외부 지도 앱에서 경로를 확인해주세요.'
          )
        } else if (status === 'NOT_FOUND') {
          setRouteMessage('출발지 또는 목적지 좌표를 인식하지 못했습니다.')
        } else if (status === 'REQUEST_DENIED') {
          setRouteMessage('Google Directions API 권한이 거부되었습니다. Google Cloud API 설정을 확인해주세요.')
        } else if (status === 'INVALID_REQUEST') {
          setRouteMessage('경로 요청값이 올바르지 않습니다.')
        } else if (status === 'OVER_QUERY_LIMIT') {
          setRouteMessage('Google API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.')
        } else {
          setRouteMessage(`대중교통 경로 검색 실패: ${status}`)
        }

        return
      }

      const route = result.routes[0]
      const leg = route.legs[0]

      setDirectionsResult(result)

      setRouteInfo({
        distance: leg.distance?.text || '정보 없음',
        duration: leg.duration?.text || '정보 없음',
      })

      setRouteSteps(
        leg.steps.map((step) => ({
          instructions: step.instructions || '',
          distance: step.distance?.text || '',
          duration: step.duration?.text || '',
          transit: step.transit
            ? {
                lineName:
                  step.transit.line?.short_name ||
                  step.transit.line?.name ||
                  '노선 정보 없음',
                vehicle: step.transit.line?.vehicle?.name || '교통수단 정보 없음',
              }
            : null,
        }))
      )

      setRouteMessage('대중교통 경로 검색이 완료되었습니다.')
    })
  }

  return (
    <section className="map-section">
      <h2>지도 기능</h2>

      <CurrentLocationButton onClick={handleCurrentLocation} />

      {message && <p>{message}</p>}

      {currentLocation && (
        <div className="location-box">
          <p>위도: {currentLocation.lat}</p>
          <p>경도: {currentLocation.lng}</p>
          <p>정확도: {Math.round(currentLocation.accuracy)}m</p>
        </div>
      )}

      <GoogleMapView
        currentLocation={currentLocation}
        places={places}
        selectedPlace={selectedPlace}
        directionsResult={directionsResult}
      />

      <PlaceSearchPanel
        searchLocation={currentLocation}
        onSearchResult={setPlaces}
        onSelectPlace={handleSelectPlace}
      />

      <RoutePanel
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