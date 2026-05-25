import { useEffect, useRef, useState } from 'react'

function KakaoMapView({
  currentLocation,
  memberLocations = [],
  places = [],
  selectedPlace,
  routePath = [],
  memberRoutePaths = [],
  onMapClick,
  pickedPlace,
}) {
  const mapRef = useRef(null)
  const mapObjectRef = useRef(null)

  const userMarkerRef = useRef(null)
  const memberMarkerRefs = useRef([])
  const placeMarkerRefs = useRef([])
  const pickedMarkerRef = useRef(null)

  const selectedInfoWindowRef = useRef(null)
  const routePolylineRef = useRef(null)
  const memberRoutePolylineRefs = useRef([])

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

  // 지도 클릭으로 위치 선택
  useEffect(() => {
    if (!isMapReady || !mapObjectRef.current || !onMapClick) {
      return
    }

    const clickHandler = (mouseEvent) => {
      const latlng = mouseEvent.latLng

      onMapClick({
        lat: latlng.getLat(),
        lng: latlng.getLng(),
      })
    }

    window.kakao.maps.event.addListener(
      mapObjectRef.current,
      'click',
      clickHandler
    )

    return () => {
      window.kakao.maps.event.removeListener(
        mapObjectRef.current,
        'click',
        clickHandler
      )
    }
  }, [isMapReady, onMapClick])

  // 지도 클릭으로 선택한 위치 마커
  useEffect(() => {
    if (!isMapReady || !mapObjectRef.current) {
      return
    }

    if (pickedMarkerRef.current) {
      pickedMarkerRef.current.setMap(null)
      pickedMarkerRef.current = null
    }

    if (!pickedPlace || !pickedPlace.lat || !pickedPlace.lng) {
      return
    }

    const position = new window.kakao.maps.LatLng(
      Number(pickedPlace.lat),
      Number(pickedPlace.lng)
    )

    pickedMarkerRef.current = new window.kakao.maps.Marker({
      position,
      map: mapObjectRef.current,
      title: pickedPlace.name || '선택한 위치',
    })

    const infoWindow = new window.kakao.maps.InfoWindow({
      content: `
        <div style="padding:8px; font-size:13px; line-height:1.5;">
          <strong>${pickedPlace.name || '선택한 위치'}</strong>
          <p style="margin:4px 0;">위도: ${Number(pickedPlace.lat).toFixed(6)}</p>
          <p style="margin:4px 0;">경도: ${Number(pickedPlace.lng).toFixed(6)}</p>
        </div>
      `,
    })

    window.kakao.maps.event.addListener(pickedMarkerRef.current, 'click', () => {
      infoWindow.open(mapObjectRef.current, pickedMarkerRef.current)
    })

    mapObjectRef.current.setCenter(position)
  }, [pickedPlace, isMapReady])

  // 내 브라우저 현재 위치 마커
  useEffect(() => {
    if (!isMapReady || !mapObjectRef.current || !currentLocation) {
      return
    }

    const location = new window.kakao.maps.LatLng(
      Number(currentLocation.lat),
      Number(currentLocation.lng)
    )

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

  // 방 멤버 위치 마커
  useEffect(() => {
    if (!isMapReady || !mapObjectRef.current) {
      return
    }

    memberMarkerRefs.current.forEach((marker) => marker.setMap(null))
    memberMarkerRefs.current = []

    if (!memberLocations || memberLocations.length === 0) {
      return
    }

    const bounds = new window.kakao.maps.LatLngBounds()
    let validLocationCount = 0

    memberLocations.forEach((memberLocation) => {
      if (!memberLocation.latitude || !memberLocation.longitude) {
        return
      }

      const nickname = memberLocation.profiles?.nickname || '멤버'

      const position = new window.kakao.maps.LatLng(
        Number(memberLocation.latitude),
        Number(memberLocation.longitude)
      )

      bounds.extend(position)
      validLocationCount += 1

      const marker = new window.kakao.maps.Marker({
        position,
        map: mapObjectRef.current,
        title: nickname,
      })

      const infoWindow = new window.kakao.maps.InfoWindow({
        content: `
          <div style="padding:10px; font-size:13px; line-height:1.5;">
            <strong>${nickname}</strong>
            <p style="margin:4px 0;">현재 위치</p>
            <p style="margin:4px 0;">정확도: ${
              memberLocation.accuracy
                ? `${Math.round(memberLocation.accuracy)}m`
                : '정보 없음'
            }</p>
          </div>
        `,
      })

      window.kakao.maps.event.addListener(marker, 'click', () => {
        infoWindow.open(mapObjectRef.current, marker)
      })

      memberMarkerRefs.current.push(marker)
    })

    if (validLocationCount === 1) {
      const position = memberMarkerRefs.current[0].getPosition()
      mapObjectRef.current.setCenter(position)
      mapObjectRef.current.setLevel(5)
    }

    if (
      validLocationCount >= 2 &&
      places.length === 0 &&
      memberRoutePaths.length === 0
    ) {
      mapObjectRef.current.setBounds(bounds)
    }
  }, [memberLocations, places.length, memberRoutePaths.length, isMapReady])

  // 장소 마커
  useEffect(() => {
    if (!isMapReady || !mapObjectRef.current) {
      return
    }

    placeMarkerRefs.current.forEach((marker) => marker.setMap(null))
    placeMarkerRefs.current = []

    if (!places || places.length === 0) {
      return
    }

    const bounds = new window.kakao.maps.LatLngBounds()
    let validPlaceCount = 0

    places.forEach((place) => {
      if (!place.lat || !place.lng) {
        return
      }

      const position = new window.kakao.maps.LatLng(
        Number(place.lat),
        Number(place.lng)
      )

      bounds.extend(position)
      validPlaceCount += 1

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

    if (validPlaceCount === 1 && memberRoutePaths.length === 0) {
      mapObjectRef.current.setCenter(
        new window.kakao.maps.LatLng(
          Number(places[0].lat),
          Number(places[0].lng)
        )
      )
      mapObjectRef.current.setLevel(4)
    }

    if (validPlaceCount >= 2 && memberRoutePaths.length === 0) {
      mapObjectRef.current.setBounds(bounds)
    }
  }, [places, memberRoutePaths.length, isMapReady])

  // 선택한 장소 인포윈도우
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

  // 기존 단일 경로 선 표시
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

  // 멤버별 경로선 표시
  useEffect(() => {
    if (!isMapReady || !mapObjectRef.current) {
      return
    }

    memberRoutePolylineRefs.current.forEach((polyline) => {
      polyline.setMap(null)
    })
    memberRoutePolylineRefs.current = []

    if (!memberRoutePaths || memberRoutePaths.length === 0) {
      return
    }

    const bounds = new window.kakao.maps.LatLngBounds()
    let validRouteCount = 0

    memberRoutePaths.forEach((route) => {
      if (!route.path || route.path.length === 0) {
        return
      }

      const linePath = route.path.map((point) => {
        return new window.kakao.maps.LatLng(
          Number(point.lat),
          Number(point.lng)
        )
      })

      linePath.forEach((position) => {
        bounds.extend(position)
      })

      validRouteCount += 1

      const polyline = new window.kakao.maps.Polyline({
        path: linePath,
        strokeWeight: route.mode === 'transit' ? 4 : 5,
        strokeOpacity: route.mode === 'transit' ? 0.65 : 0.85,
        strokeStyle: route.mode === 'transit' ? 'shortdash' : 'solid',
      })

      polyline.setMap(mapObjectRef.current)
      memberRoutePolylineRefs.current.push(polyline)
    })

    places.forEach((place) => {
      if (place.lat && place.lng) {
        bounds.extend(
          new window.kakao.maps.LatLng(Number(place.lat), Number(place.lng))
        )
      }
    })

    memberLocations.forEach((member) => {
      if (member.latitude && member.longitude) {
        bounds.extend(
          new window.kakao.maps.LatLng(
            Number(member.latitude),
            Number(member.longitude)
          )
        )
      }
    })

    if (validRouteCount > 0) {
      mapObjectRef.current.setBounds(bounds)
    }
  }, [memberRoutePaths, memberLocations, places, isMapReady])

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

    reject(new Error('index.html에 카카오맵 SDK script가 로드되지 않았습니다.'))
  })
}

export default KakaoMapView