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
  onSetMeetingPlace,
  mapHeight = '500px',
}) {
  const mapRef = useRef(null)
  const mapObjectRef = useRef(null)

  const userMarkerRef = useRef(null)
  const memberMarkerRefs = useRef([])
  const placeMarkerRefs = useRef([])
  const pickedMarkerRef = useRef(null)
  const selectedPlaceMarkerRef = useRef(null)

  const selectedInfoWindowRef = useRef(null)
  const routePolylineRef = useRef(null)
  const memberRoutePolylineRefs = useRef([])
  const autoFitPendingRef = useRef(true)

  const [isMapReady, setIsMapReady] = useState(false)
  const [mapError, setMapError] = useState('')
  const placeViewportKey = places
    .map((place) => `${place.id || place.name}-${place.lat}-${place.lng}`)
    .join('|')
  const selectedPlaceViewportKey = selectedPlace
    ? `${selectedPlace.id || selectedPlace.name}-${selectedPlace.lat}-${selectedPlace.lng}`
    : ''

  useEffect(() => {
    autoFitPendingRef.current = true
  }, [placeViewportKey, selectedPlaceViewportKey])

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

  // 지도 생성
  // 탭이 숨겨져 있을 때 지도 div 크기가 0으로 잡히는 문제를 막기 위해
  // 컨테이너 크기가 잡힐 때까지 잠깐 재시도함
  useEffect(() => {
    if (!isMapReady || !mapRef.current || mapObjectRef.current) {
      return
    }

    let retryCount = 0
    let timerId = null

    const createMapWhenVisible = () => {
      const container = mapRef.current

      if (!container) return

      const width = container.offsetWidth
      const height = container.offsetHeight

      console.log('카카오맵 컨테이너 크기:', width, height)

      if ((width === 0 || height === 0) && retryCount < 30) {
        retryCount += 1
        timerId = setTimeout(createMapWhenVisible, 100)
        return
      }

      const initialCenter = getPreferredCenter({
        selectedPlace,
        pickedPlace,
        places,
        currentLocation,
      })

      const options = {
        center: new window.kakao.maps.LatLng(initialCenter.lat, initialCenter.lng),
        level: 4,
      }

      mapObjectRef.current = new window.kakao.maps.Map(container, options)

      setTimeout(() => {
        if (mapObjectRef.current) {
          mapObjectRef.current.relayout()
          const preferredCenter = getPreferredCenter({
            selectedPlace,
            pickedPlace,
            places,
            currentLocation,
          })
          mapObjectRef.current.setCenter(
            new window.kakao.maps.LatLng(preferredCenter.lat, preferredCenter.lng)
          )
        }
      }, 300)
    }

    createMapWhenVisible()

    return () => {
      if (timerId) {
        clearTimeout(timerId)
      }
    }
  }, [currentLocation, isMapReady, pickedPlace, places, selectedPlace])

  // 탭 전환/렌더링 타이밍 때문에 지도 화면이 빈칸으로 보이는 문제 보정
  useEffect(() => {
    if (!isMapReady || !mapObjectRef.current) return

    const relayoutMap = () => {
      setTimeout(() => {
        if (mapObjectRef.current) {
          console.log('카카오맵 relayout 실행')
          mapObjectRef.current.relayout()
        }
      }, 200)
    }

    window.addEventListener('resize', relayoutMap)
    document.addEventListener('visibilitychange', relayoutMap)

    relayoutMap()

    const intervalId = setInterval(relayoutMap, 500)

    const stopTimer = setTimeout(() => {
      clearInterval(intervalId)
    }, 3000)

    return () => {
      window.removeEventListener('resize', relayoutMap)
      document.removeEventListener('visibilitychange', relayoutMap)
      clearInterval(intervalId)
      clearTimeout(stopTimer)
    }
  }, [isMapReady, currentLocation, memberLocations, places, selectedPlace])

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

    if (!isValidLatLng(pickedPlace?.lat, pickedPlace?.lng)) {
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
          <strong>${escapeHtml(pickedPlace.name || '선택한 위치')}</strong>
          <p style="margin:4px 0;">${escapeHtml(pickedPlace.address || '주소 정보 없음')}</p>
        </div>
      `,
    })

    window.kakao.maps.event.addListener(pickedMarkerRef.current, 'click', () => {
      infoWindow.open(mapObjectRef.current, pickedMarkerRef.current)
    })

    mapObjectRef.current.setCenter(position)
    mapObjectRef.current.relayout()
  }, [pickedPlace, isMapReady])

  // 내 브라우저 현재 위치 마커
  useEffect(() => {
    if (!isMapReady || !mapObjectRef.current || !currentLocation) {
      return
    }

    if (!isValidLatLng(currentLocation.lat, currentLocation.lng)) {
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

    mapObjectRef.current.setCenter(location)
    mapObjectRef.current.relayout()
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
      if (!isValidLatLng(memberLocation.latitude, memberLocation.longitude)) {
        return
      }

      const nickname = getMemberNickname(memberLocation)

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
            <strong>${escapeHtml(nickname)}</strong>
            <p style="margin:4px 0;">현재 위치</p>
            <p style="margin:4px 0;">정확도: ${
              memberLocation.accuracy
                ? `${Math.round(Number(memberLocation.accuracy))}m`
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

    if (
      autoFitPendingRef.current &&
      validLocationCount === 1 &&
      memberMarkerRefs.current[0]
    ) {
      const position = memberMarkerRefs.current[0].getPosition()
      mapObjectRef.current.setCenter(position)
      mapObjectRef.current.setLevel(5)
      autoFitPendingRef.current = false
    }

    if (
      autoFitPendingRef.current &&
      validLocationCount >= 2 &&
      places.length === 0 &&
      memberRoutePaths.length === 0
    ) {
      mapObjectRef.current.setBounds(bounds)
      autoFitPendingRef.current = false
    }

    mapObjectRef.current.relayout()
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
    let firstValidPlace = null

    places.forEach((place) => {
      if (!isValidLatLng(place.lat, place.lng)) {
        return
      }

      if (!firstValidPlace) {
        firstValidPlace = place
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
        title: place.name || '장소',
      })

      window.kakao.maps.event.addListener(marker, 'click', () => {
        openPlaceInfoWindow(place, marker)
      })

      placeMarkerRefs.current.push(marker)
    })

    if (
      autoFitPendingRef.current &&
      validPlaceCount === 1 &&
      firstValidPlace &&
      memberRoutePaths.length === 0
    ) {
      mapObjectRef.current.setCenter(
        new window.kakao.maps.LatLng(
          Number(firstValidPlace.lat),
          Number(firstValidPlace.lng)
        )
      )
      mapObjectRef.current.setLevel(4)
      autoFitPendingRef.current = false
    }

    if (
      autoFitPendingRef.current &&
      validPlaceCount >= 2 &&
      memberRoutePaths.length === 0
    ) {
      mapObjectRef.current.setBounds(bounds)
      autoFitPendingRef.current = false
    }

    mapObjectRef.current.relayout()
  }, [places, memberRoutePaths.length, isMapReady])

  // 선택한 장소 인포윈도우
  useEffect(() => {
    if (!isMapReady || !mapObjectRef.current) {
      return
    }

    if (selectedPlaceMarkerRef.current) {
      selectedPlaceMarkerRef.current.setMap(null)
      selectedPlaceMarkerRef.current = null
    }

    if (!selectedPlace) return

    if (!isValidLatLng(selectedPlace.lat, selectedPlace.lng)) {
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
        title: selectedPlace.name || '장소',
      })

      window.kakao.maps.event.addListener(marker, 'click', () => {
        openPlaceInfoWindow(selectedPlace, marker)
      })

      selectedPlaceMarkerRef.current = marker
      openPlaceInfoWindow(selectedPlace, marker)
    }

    mapObjectRef.current.relayout()
    mapObjectRef.current.setCenter(selectedLocation)
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

    const linePath = routePath
      .filter((point) => isValidLatLng(point.lat, point.lng))
      .map((point) => {
        return new window.kakao.maps.LatLng(Number(point.lat), Number(point.lng))
      })

    if (linePath.length === 0) {
      return
    }

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

    if (autoFitPendingRef.current) {
      mapObjectRef.current.setBounds(bounds)
      autoFitPendingRef.current = false
    }
    mapObjectRef.current.relayout()
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

      const linePath = route.path
        .filter((point) => isValidLatLng(point.lat, point.lng))
        .map((point) => {
          return new window.kakao.maps.LatLng(
            Number(point.lat),
            Number(point.lng)
          )
        })

      if (linePath.length === 0) {
        return
      }

      linePath.forEach((position) => {
        bounds.extend(position)
      })

      validRouteCount += 1

      const polylineOption = {
        path: linePath,
        strokeWeight: route.mode === 'transit' ? 4 : 5,
        strokeOpacity: route.mode === 'transit' ? 0.65 : 0.85,
        strokeStyle: route.mode === 'transit' ? 'shortdash' : 'solid',
      }

      if (route.mode === 'car') {
        polylineOption.strokeColor = '#FF0000'
      }

      if (route.mode === 'transit') {
        polylineOption.strokeColor = '#3366FF'
      }

      const polyline = new window.kakao.maps.Polyline(polylineOption)

      polyline.setMap(mapObjectRef.current)
      memberRoutePolylineRefs.current.push(polyline)
    })

    places.forEach((place) => {
      if (isValidLatLng(place.lat, place.lng)) {
        bounds.extend(
          new window.kakao.maps.LatLng(Number(place.lat), Number(place.lng))
        )
      }
    })

    memberLocations.forEach((member) => {
      if (isValidLatLng(member.latitude, member.longitude)) {
        bounds.extend(
          new window.kakao.maps.LatLng(
            Number(member.latitude),
            Number(member.longitude)
          )
        )
      }
    })

    if (autoFitPendingRef.current && validRouteCount > 0) {
      mapObjectRef.current.setBounds(bounds)
      autoFitPendingRef.current = false
    }

    mapObjectRef.current.relayout()
  }, [memberRoutePaths, memberLocations, places, isMapReady])

  const openPlaceInfoWindow = (place, marker) => {
    if (selectedInfoWindowRef.current) {
      selectedInfoWindowRef.current.close()
    }

    const kakaoMapUrl = place.kakaoMapUrl || place.kakaomapurl

    const content = document.createElement('div')
    content.style.padding = '10px'
    content.style.fontSize = '13px'
    content.style.lineHeight = '1.5'

    const name = document.createElement('strong')
    name.textContent = place.name || '장소명 없음'
    content.appendChild(name)

    const address = document.createElement('p')
    address.style.margin = '4px 0'
    address.textContent = place.address || '주소 정보 없음'
    content.appendChild(address)

    if (kakaoMapUrl) {
      const link = document.createElement('a')
      link.href = kakaoMapUrl
      link.target = '_blank'
      link.rel = 'noreferrer'
      link.textContent = '카카오맵에서 보기'
      content.appendChild(link)
    }

    if (onSetMeetingPlace && !place.isConfirmedMiddlePlace) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = '만날 위치로 설정하기'
      button.style.display = 'block'
      button.style.marginTop = '8px'
      button.style.padding = '7px 10px'
      button.style.border = 'none'
      button.style.borderRadius = '7px'
      button.style.backgroundColor = '#7c79ff'
      button.style.color = '#fff'
      button.style.cursor = 'pointer'
      button.style.fontSize = '12px'
      button.style.fontWeight = 'bold'
      button.style.width = '100%'
      button.addEventListener('click', () => onSetMeetingPlace(place))
      content.appendChild(button)
    }

    selectedInfoWindowRef.current = new window.kakao.maps.InfoWindow({
      content,
    })

    selectedInfoWindowRef.current.open(mapObjectRef.current, marker)
  }

  if (mapError) {
    return <p>{mapError}</p>
  }

  return (
    <div
      style={{
        width: '100%',
        minHeight: mapHeight,
      }}
    >
      {!isMapReady && <p>지도 불러오는 중...</p>}

      <div
        ref={mapRef}
        style={{
          width: '100%',
          height: mapHeight,
          minHeight: mapHeight,
          display: 'block',
          position: 'relative',
          overflow: 'hidden',
          border: '1px solid black',
          backgroundColor: '#f2f2f2',
        }}
      />
    </div>
  )
}

function getMemberNickname(memberLocation) {
  return (
    memberLocation.profiles?.nickname ||
    memberLocation.room_guests?.nickname ||
    memberLocation.nickname ||
    '멤버'
  )
}

function isValidLatLng(lat, lng) {
  const numberLat = Number(lat)
  const numberLng = Number(lng)

  return (
    Number.isFinite(numberLat) &&
    Number.isFinite(numberLng) &&
    numberLat >= -90 &&
    numberLat <= 90 &&
    numberLng >= -180 &&
    numberLng <= 180
  )
}

function getPreferredCenter({
  selectedPlace,
  pickedPlace,
  places = [],
  currentLocation,
}) {
  if (isValidLatLng(selectedPlace?.lat, selectedPlace?.lng)) {
    return {
      lat: Number(selectedPlace.lat),
      lng: Number(selectedPlace.lng),
    }
  }

  if (isValidLatLng(pickedPlace?.lat, pickedPlace?.lng)) {
    return {
      lat: Number(pickedPlace.lat),
      lng: Number(pickedPlace.lng),
    }
  }

  const firstPlace = places.find((place) => isValidLatLng(place?.lat, place?.lng))

  if (firstPlace) {
    return {
      lat: Number(firstPlace.lat),
      lng: Number(firstPlace.lng),
    }
  }

  if (isValidLatLng(currentLocation?.lat, currentLocation?.lng)) {
    return {
      lat: Number(currentLocation.lat),
      lng: Number(currentLocation.lng),
    }
  }

  return {
    lat: 37.5665,
    lng: 126.978,
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function loadKakaoMapScript() {
  return new Promise((resolve, reject) => {
    if (!window.kakao || !window.kakao.maps) {
      reject(new Error('index.html에 카카오맵 SDK script가 로드되지 않았습니다.'))
      return
    }

    if (window.kakao.maps.load) {
      window.kakao.maps.load(() => {
        resolve()
      })
      return
    }

    resolve()
  })
}

export default KakaoMapView
