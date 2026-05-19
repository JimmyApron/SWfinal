import { useEffect, useRef, useState } from 'react'

function KakaoMapView({
  currentLocation,
  places = [],
  selectedPlace,
  routePath = [],
}) {
  const mapRef = useRef(null)
  const mapObjectRef = useRef(null)
  const userMarkerRef = useRef(null)
  const placeMarkerRefs = useRef([])
  const selectedInfoWindowRef = useRef(null)
  const routePolylineRef = useRef(null)

  const [isMapReady, setIsMapReady] = useState(false)
  const [mapError, setMapError] = useState('')

  useEffect(() => {
    loadKakaoMapScript()
      .then(() => {
        setIsMapReady(true)
      })
      .catch((error) => {
        console.error(error)
        setMapError('카카오맵을 불러오지 못했습니다.')
      })
  }, [])

  useEffect(() => {
    if (!isMapReady || !mapRef.current || mapObjectRef.current) {
      return
    }

    const container = mapRef.current

    const options = {
      center: new window.kakao.maps.LatLng(35.1796, 129.0756),
      level: 4,
    }

    mapObjectRef.current = new window.kakao.maps.Map(container, options)
  }, [isMapReady])

  useEffect(() => {
    if (!isMapReady || !mapObjectRef.current || !currentLocation) {
      return
    }

    const location = new window.kakao.maps.LatLng(
      Number(currentLocation.lat),
      Number(currentLocation.lng)
    )

    mapObjectRef.current.setCenter(location)

    if (userMarkerRef.current) {
      userMarkerRef.current.setMap(null)
    }

    userMarkerRef.current = new window.kakao.maps.Marker({
      position: location,
      map: mapObjectRef.current,
      title: '내 위치',
    })

    const infoWindow = new window.kakao.maps.InfoWindow({
      content: `
        <div style="padding:8px; font-size:13px;">
          <strong>내 위치</strong>
        </div>
      `,
    })

    window.kakao.maps.event.addListener(userMarkerRef.current, 'click', () => {
      infoWindow.open(mapObjectRef.current, userMarkerRef.current)
    })
  }, [currentLocation, isMapReady])

  useEffect(() => {
    if (!isMapReady || !mapObjectRef.current) {
      return
    }

    placeMarkerRefs.current.forEach((marker) => marker.setMap(null))
    placeMarkerRefs.current = []

    places.forEach((place) => {
      if (!place.lat || !place.lng) {
        return
      }

      const position = new window.kakao.maps.LatLng(
        Number(place.lat),
        Number(place.lng)
      )

      const marker = new window.kakao.maps.Marker({
        position,
        map: mapObjectRef.current,
        title: place.name,
      })

      window.kakao.maps.event.addListener(marker, 'click', () => {
        openPlaceInfoWindow(place, marker)
      })

      placeMarkerRefs.current.push(marker)
    })
  }, [places, isMapReady])

  useEffect(() => {
    if (!isMapReady || !mapObjectRef.current || !selectedPlace) {
      return
    }

    if (!selectedPlace.lat || !selectedPlace.lng) {
      console.log('선택한 장소 좌표가 없습니다:', selectedPlace)
      return
    }

    const selectedLocation = new window.kakao.maps.LatLng(
      Number(selectedPlace.lat),
      Number(selectedPlace.lng)
    )

    mapObjectRef.current.setCenter(selectedLocation)
    mapObjectRef.current.setLevel(3)

    const matchedMarker = placeMarkerRefs.current.find((marker) => {
      const markerPosition = marker.getPosition()

      return (
        markerPosition.getLat() === Number(selectedPlace.lat) &&
        markerPosition.getLng() === Number(selectedPlace.lng)
      )
    })

    if (matchedMarker) {
      openPlaceInfoWindow(selectedPlace, matchedMarker)
    } else {
      const marker = new window.kakao.maps.Marker({
        position: selectedLocation,
        map: mapObjectRef.current,
        title: selectedPlace.name,
      })

      openPlaceInfoWindow(selectedPlace, marker)
    }
  }, [selectedPlace, isMapReady])

  useEffect(() => {
    if (!isMapReady || !mapObjectRef.current) {
      return
    }

    if (routePolylineRef.current) {
      routePolylineRef.current.setMap(null)
      routePolylineRef.current = null
    }

    if (!routePath || routePath.length === 0) {
      return
    }

    const linePath = routePath.map((point) => {
      return new window.kakao.maps.LatLng(Number(point.lat), Number(point.lng))
    })

    routePolylineRef.current = new window.kakao.maps.Polyline({
      path: linePath,
      strokeWeight: 5,
      strokeColor: '#FF0000',
      strokeOpacity: 0.8,
      strokeStyle: 'solid',
    })

    routePolylineRef.current.setMap(mapObjectRef.current)

    const bounds = new window.kakao.maps.LatLngBounds()

    linePath.forEach((position) => {
      bounds.extend(position)
    })

    mapObjectRef.current.setBounds(bounds)
  }, [routePath, isMapReady])

  const openPlaceInfoWindow = (place, marker) => {
    if (selectedInfoWindowRef.current) {
      selectedInfoWindowRef.current.close()
    }

    selectedInfoWindowRef.current = new window.kakao.maps.InfoWindow({
      content: `
        <div style="padding:10px; font-size:13px; line-height:1.5;">
          <strong>${place.name || '장소명 없음'}</strong>
          <p style="margin:4px 0;">${place.address || '주소 정보 없음'}</p>
          ${
            place.kakaoMapUrl
              ? `<a href="${place.kakaoMapUrl}" target="_blank">카카오맵에서 보기</a>`
              : ''
          }
        </div>
      `,
    })

    selectedInfoWindowRef.current.open(mapObjectRef.current, marker)
  }

  if (mapError) {
    return <p>{mapError}</p>
  }

  return (
    <div>
      {!isMapReady && <p>지도 불러오는 중...</p>}

      <div
        ref={mapRef}
        style={{
          width: '100%',
          height: '500px',
          border: '1px solid black',
        }}
      />
    </div>
  )
}

function loadKakaoMapScript() {
  return new Promise((resolve, reject) => {
    if (window.kakao && window.kakao.maps) {
      resolve()
      return
    }

    const apiKey = process.env.REACT_APP_KAKAO_JAVASCRIPT_KEY

    if (!apiKey) {
      reject(new Error('REACT_APP_KAKAO_JAVASCRIPT_KEY가 없습니다.'))
      return
    }

    const existingScript = document.getElementById('kakao-map-sdk')

    if (existingScript) {
      existingScript.onload = () => {
        resolve()
      }

      existingScript.onerror = () => {
        reject(new Error('카카오맵 SDK 로드 실패'))
      }

      return
    }

    const script = document.createElement('script')
    script.id = 'kakao-map-sdk'
    script.type = 'text/javascript'
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${apiKey}&libraries=services`

    script.onload = () => {
      if (window.kakao && window.kakao.maps) {
        resolve()
      } else {
        reject(new Error('카카오맵 객체가 생성되지 않았습니다.'))
      }
    }

    script.onerror = () => {
      reject(new Error('카카오맵 SDK script 로드 실패'))
    }

    document.head.appendChild(script)
  })
}

export default KakaoMapView