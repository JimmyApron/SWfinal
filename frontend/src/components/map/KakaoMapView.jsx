import { useCallback, useEffect, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FiUser } from 'react-icons/fi'

function KakaoMapView({
  currentLocation,
  memberLocations = [],
  places = [],
  selectedPlace,
  destination,
  confirmedMeetingPlace,
  routePath = [],
  memberRoutePaths = [],
  memberRouteResults = [],
  memberLocationLabels = {},
  onMapClick,
  pickedPlace,
  onSetMeetingPlace,
  className = '',
  height = '500px',
  mapHeight,
  fitBoundsRequest = 0,
  centerRequest = 0,
  centerLevel = 4,
  preferredCenter,
}) {
  const mapRef = useRef(null)
  const mapObjectRef = useRef(null)

  const userMarkerRef = useRef(null)
  const memberMarkerRefs = useRef([])
  const placeMarkerRefs = useRef([])
  const meetingPlaceMarkerRef = useRef(null)
  const pickedMarkerRef = useRef(null)
  const selectedPlaceMarkerRef = useRef(null)
  const onSetMeetingPlaceRef = useRef(onSetMeetingPlace)
  const confirmedMeetingPlaceRef = useRef(confirmedMeetingPlace)

  const selectedInfoWindowRef = useRef(null)
  const selectedInfoWindowKeyRef = useRef('')
  const routePolylineRef = useRef(null)
  const memberRoutePolylineRefs = useRef([])
  const autoFitPendingRef = useRef(true)
  const handledFitBoundsRequestRef = useRef(0)
  const handledCenterRequestRef = useRef(0)

  const [isMapReady, setIsMapReady] = useState(false)
  const [mapError, setMapError] = useState('')
  const placeViewportKey = places
    .map((place) => `${place.id || place.name}-${place.lat}-${place.lng}`)
    .join('|')
  const selectedPlaceViewportKey = selectedPlace
    ? `${selectedPlace.id || selectedPlace.name}-${selectedPlace.lat}-${selectedPlace.lng}`
    : ''
  const confirmedMeetingPlaceViewportKey = getPlaceViewportKey(confirmedMeetingPlace)

  useEffect(() => {
    onSetMeetingPlaceRef.current = onSetMeetingPlace
  }, [onSetMeetingPlace])

  useEffect(() => {
    confirmedMeetingPlaceRef.current = confirmedMeetingPlace
  }, [confirmedMeetingPlaceViewportKey, confirmedMeetingPlace])

  const closeActiveInfoWindow = useCallback(() => {
    if (selectedInfoWindowRef.current) {
      selectedInfoWindowRef.current.close()
    }

    selectedInfoWindowRef.current = null
    selectedInfoWindowKeyRef.current = ''
  }, [])

  const toggleInfoWindow = useCallback((infoWindow, marker, infoKey) => {
    if (selectedInfoWindowRef.current && selectedInfoWindowKeyRef.current === infoKey) {
      closeActiveInfoWindow()
      return
    }

    closeActiveInfoWindow()
    selectedInfoWindowRef.current = infoWindow
    selectedInfoWindowKeyRef.current = infoKey
    infoWindow.open(mapObjectRef.current, marker)
  }, [closeActiveInfoWindow])

  const openPlaceInfoWindow = useCallback((place, marker) => {
    const infoKey = getMarkerInfoKey('place', place)

    if (selectedInfoWindowRef.current && selectedInfoWindowKeyRef.current === infoKey) {
      closeActiveInfoWindow()
      return
    }

    closeActiveInfoWindow()

    const kakaoMapUrl = getKakaoMapUrl(place)

    const content = document.createElement('div')
    content.style.padding = '8px'
    content.style.fontSize = '12px'
    content.style.lineHeight = '1.4'
    content.style.boxSizing = 'border-box'
    content.style.width = '210px'
    content.style.maxWidth = '210px'
    content.style.overflow = 'hidden'

    const name = document.createElement('strong')
    name.textContent = place.name || '장소명 없음'
    content.appendChild(name)

    const address = document.createElement('p')
    address.style.margin = '4px 0'
    address.style.wordBreak = 'keep-all'
    address.style.overflowWrap = 'anywhere'
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

    resolveKakaoPlaceUrl(place).then((resolvedUrl) => {
      if (!resolvedUrl) return

      const link = content.querySelector('a[target="_blank"]')
      if (link) {
        link.href = resolvedUrl
      }
    })

    const isCurrentMeetingPlace =
      place.isConfirmedMiddlePlace ||
      isSameMapPlace(place, confirmedMeetingPlaceRef.current)

    if (onSetMeetingPlaceRef.current && !isCurrentMeetingPlace) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = '만날 장소로 설정하기'
      button.style.display = 'block'
      button.style.marginTop = '6px'
      button.style.padding = '6px 8px'
      button.style.border = 'none'
      button.style.borderRadius = '7px'
      button.style.backgroundColor = '#7c79ff'
      button.style.color = '#fff'
      button.style.cursor = 'pointer'
      button.style.fontSize = '11px'
      button.style.fontWeight = 'bold'
      button.style.width = '100%'
      button.style.boxSizing = 'border-box'
      button.style.lineHeight = '1.2'
      button.addEventListener('click', () => onSetMeetingPlaceRef.current?.(place))
      content.appendChild(button)
    }

    selectedInfoWindowRef.current = new window.kakao.maps.InfoWindow({
      content,
      zIndex: 100,
    })
    selectedInfoWindowKeyRef.current = infoKey

    selectedInfoWindowRef.current.open(mapObjectRef.current, marker)
  }, [closeActiveInfoWindow])

  const refreshCustomOverlayPositions = useCallback(() => {
    const customOverlays = [
      ...memberMarkerRefs.current,
      ...placeMarkerRefs.current,
      meetingPlaceMarkerRef.current,
      selectedPlaceMarkerRef.current,
    ].filter(Boolean)

    customOverlays.forEach((marker) => {
      const position = marker.position || marker.anchor?.getPosition?.()

      if (position && marker.overlay?.setPosition) {
        marker.overlay.setPosition(position)
      }
    })
  }, [])

  useEffect(() => {
    autoFitPendingRef.current = true
  }, [placeViewportKey, selectedPlaceViewportKey, confirmedMeetingPlaceViewportKey])

  useEffect(() => {
    closeActiveInfoWindow()
  }, [confirmedMeetingPlaceViewportKey, closeActiveInfoWindow])

  useEffect(() => {
    if (!fitBoundsRequest) return
    autoFitPendingRef.current = true
  }, [fitBoundsRequest])

  useEffect(() => {
    if (
      !centerRequest ||
      handledCenterRequestRef.current === centerRequest ||
      !isMapReady ||
      !mapObjectRef.current
    ) {
      return
    }

    const center = getPreferredCenter({
      selectedPlace,
      pickedPlace,
      places,
      currentLocation,
      preferredCenter,
    })

    handledCenterRequestRef.current = centerRequest

    setTimeout(() => {
      if (!mapObjectRef.current) return

      mapObjectRef.current.relayout()
      mapObjectRef.current.setCenter(
        new window.kakao.maps.LatLng(center.lat, center.lng)
      )
      mapObjectRef.current.setLevel(centerLevel)
    }, 120)
  }, [
    centerLevel,
    centerRequest,
    currentLocation,
    isMapReady,
    pickedPlace,
    places,
    preferredCenter,
    selectedPlace,
  ])

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
        preferredCenter,
      })

      const options = {
        center: new window.kakao.maps.LatLng(initialCenter.lat, initialCenter.lng),
        level: 4,
      }

      mapObjectRef.current = new window.kakao.maps.Map(container, options)

      setTimeout(() => {
        if (mapObjectRef.current) {
          mapObjectRef.current.relayout()
          const nextCenter = getPreferredCenter({
            selectedPlace,
            pickedPlace,
            places,
            currentLocation,
            preferredCenter,
          })
          mapObjectRef.current.setCenter(
            new window.kakao.maps.LatLng(nextCenter.lat, nextCenter.lng)
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
  }, [currentLocation, isMapReady, pickedPlace, places, preferredCenter, selectedPlace])

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

  useEffect(() => {
    if (!isMapReady || !mapObjectRef.current) {
      return
    }

    const map = mapObjectRef.current
    let animationFrameId = null

    const refreshOnNextFrame = () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId)
      }

      animationFrameId = requestAnimationFrame(() => {
        refreshCustomOverlayPositions()
        animationFrameId = null
      })
    }

    const eventNames = [
      'center_changed',
      'zoom_start',
      'zoom_changed',
      'bounds_changed',
      'idle',
    ]

    eventNames.forEach((eventName) => {
      window.kakao.maps.event.addListener(map, eventName, refreshOnNextFrame)
    })

    return () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId)
      }

      eventNames.forEach((eventName) => {
        window.kakao.maps.event.removeListener(map, eventName, refreshOnNextFrame)
      })
    }
  }, [isMapReady, refreshCustomOverlayPositions])

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
      title: pickedPlace.name || '선택한 장소',
    })

    const infoWindow = new window.kakao.maps.InfoWindow({
      content: `
        <div style="padding:8px; font-size:13px; line-height:1.5;">
          <strong>${escapeHtml(pickedPlace.name || '선택한 장소')}</strong>
          <p style="margin:4px 0;">${escapeHtml(pickedPlace.address || '주소 정보 없음')}</p>
        </div>
      `,
      zIndex: 100,
    })

    window.kakao.maps.event.addListener(pickedMarkerRef.current, 'click', () => {
      toggleInfoWindow(infoWindow, pickedMarkerRef.current, getMarkerInfoKey('picked', pickedPlace))
    })

    mapObjectRef.current.setCenter(position)
    mapObjectRef.current.relayout()
  }, [pickedPlace, isMapReady, toggleInfoWindow])

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
      zIndex: 100,
    })

    window.kakao.maps.event.addListener(userMarkerRef.current, 'click', () => {
      toggleInfoWindow(infoWindow, userMarkerRef.current, getMarkerInfoKey('user', currentLocation))
    })

    if (!preferredCenter && !selectedPlace && places.length === 0) {
      mapObjectRef.current.setCenter(location)
    }
    mapObjectRef.current.relayout()
  }, [
    currentLocation,
    isMapReady,
    places.length,
    preferredCenter,
    selectedPlace,
    toggleInfoWindow,
  ])

  // 방 멤버 위치 마커
  useEffect(() => {
    if (!isMapReady || !mapObjectRef.current) {
      return
    }

    memberMarkerRefs.current.forEach((marker) => {
      if (marker?.overlay) marker.overlay.setMap(null)
      if (marker?.anchor) marker.anchor.setMap(null)
      if (marker?.setMap) marker.setMap(null)
    })
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

      const anchorMarker = new window.kakao.maps.Marker({
        position,
        map: mapObjectRef.current,
        title: nickname,
        image: createInfoAnchorImage('member'),
      })
      anchorMarker.setOpacity?.(0)
      const profileImageUrl = getMemberProfileImageUrl(memberLocation)
      const isDeparted = isMemberDeparted(memberLocation)
      const routeResult = getMemberRouteResult(memberLocation, memberRouteResults)
      const locationLabel =
        memberLocationLabels[getMemberKey(memberLocation)] ||
        getRegisteredLocationLabel(memberLocation) ||
        getCoordinateLabel(memberLocation)
      const markerContent = createMemberMarkerContent({
        nickname,
        profileImageUrl,
        isGuest: Boolean(memberLocation.guestid),
        isDeparted,
        hasRouteError: Boolean(routeResult?.error),
      })
      const overlay = new window.kakao.maps.CustomOverlay({
        position,
        content: markerContent,
        xAnchor: 0.5,
        yAnchor: 0.33,
        zIndex: 4,
      })

      overlay.setMap(mapObjectRef.current)

      const infoWindow = new window.kakao.maps.InfoWindow({
        content: createMemberInfoContent({
          nickname,
          locationLabel,
          transportMode: memberLocation.transportmode,
          routeResult,
        }),
        zIndex: 100,
      })

      markerContent.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        toggleInfoWindow(infoWindow, anchorMarker, getMarkerInfoKey('member', memberLocation))
      })

      window.kakao.maps.event.addListener(anchorMarker, 'click', () => {
        toggleInfoWindow(infoWindow, anchorMarker, getMarkerInfoKey('member', memberLocation))
      })

      memberMarkerRefs.current.push({ overlay, anchor: anchorMarker, position })
    })

    if (
      autoFitPendingRef.current &&
      validLocationCount === 1 &&
      memberMarkerRefs.current[0]
    ) {
      const position = memberMarkerRefs.current[0].position
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
  }, [
    memberLocations,
    memberLocationLabels,
    memberRouteResults,
    places.length,
    memberRoutePaths.length,
    isMapReady,
    toggleInfoWindow,
  ])

  // 장소 마커
  useEffect(() => {
    if (!isMapReady || !mapObjectRef.current) {
      return
    }

    placeMarkerRefs.current.forEach((marker) => {
      if (marker?.overlay) marker.overlay.setMap(null)
      if (marker?.anchor) marker.anchor.setMap(null)
      if (marker?.setMap) marker.setMap(null)
    })
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

      const anchorMarker = new window.kakao.maps.Marker({
        position,
        map: mapObjectRef.current,
        title: place.name || '장소',
        image: createInfoAnchorImage('nearby'),
      })
      anchorMarker.setOpacity?.(0)

      const markerContent = createPlaceMarkerContent({
        label: place.name || '장소',
        variant: 'nearby',
      })
      const overlay = new window.kakao.maps.CustomOverlay({
        position,
        content: markerContent,
        yAnchor: 1,
        zIndex: isSameMapPlace(place, confirmedMeetingPlace) ? 6 : 3,
      })

      overlay.setMap(mapObjectRef.current)

      markerContent.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        openPlaceInfoWindow(place, anchorMarker)
      })

      window.kakao.maps.event.addListener(anchorMarker, 'click', () => {
        openPlaceInfoWindow(place, anchorMarker)
      })

      placeMarkerRefs.current.push({ overlay, anchor: anchorMarker, position, place })
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
  }, [
    places,
    memberRoutePaths.length,
    isMapReady,
    openPlaceInfoWindow,
    confirmedMeetingPlaceViewportKey,
  ])

  useEffect(() => {
    if (!isMapReady || !mapObjectRef.current) {
      return
    }

    if (meetingPlaceMarkerRef.current) {
      if (meetingPlaceMarkerRef.current.overlay) {
        meetingPlaceMarkerRef.current.overlay.setMap(null)
      }
      if (meetingPlaceMarkerRef.current.anchor) {
        meetingPlaceMarkerRef.current.anchor.setMap(null)
      }
      meetingPlaceMarkerRef.current = null
    }

    const meetingLat = confirmedMeetingPlace?.lat ?? confirmedMeetingPlace?.locationlat
    const meetingLng = confirmedMeetingPlace?.lng ?? confirmedMeetingPlace?.locationlng

    if (!isValidLatLng(meetingLat, meetingLng)) {
      return
    }

    const position = new window.kakao.maps.LatLng(Number(meetingLat), Number(meetingLng))
    const normalizedMeetingPlace = {
      ...confirmedMeetingPlace,
      lat: Number(meetingLat),
      lng: Number(meetingLng),
      name:
        confirmedMeetingPlace?.name ||
        confirmedMeetingPlace?.location ||
        confirmedMeetingPlace?.placename ||
        '만날 장소',
    }

    const anchorMarker = new window.kakao.maps.Marker({
      position,
      map: mapObjectRef.current,
      title: normalizedMeetingPlace.name,
      image: createInfoAnchorImage('meeting'),
    })
    anchorMarker.setOpacity?.(0)

    const markerContent = createPlaceMarkerContent({
      label: normalizedMeetingPlace.name,
      variant: 'meeting',
    })
    const overlay = new window.kakao.maps.CustomOverlay({
      position,
      content: markerContent,
      yAnchor: 1,
      zIndex: 7,
    })

    overlay.setMap(mapObjectRef.current)

    markerContent.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      openPlaceInfoWindow(normalizedMeetingPlace, anchorMarker)
    })

    window.kakao.maps.event.addListener(anchorMarker, 'click', () => {
      openPlaceInfoWindow(normalizedMeetingPlace, anchorMarker)
    })

    meetingPlaceMarkerRef.current = { overlay, anchor: anchorMarker, position }
    mapObjectRef.current.relayout()
  }, [confirmedMeetingPlaceViewportKey, isMapReady, openPlaceInfoWindow])

  // 선택한 장소 인포윈도우
  useEffect(() => {
    if (!isMapReady || !mapObjectRef.current) {
      return
    }

    if (selectedPlaceMarkerRef.current) {
      if (selectedPlaceMarkerRef.current.overlay) {
        selectedPlaceMarkerRef.current.overlay.setMap(null)
      }
      if (selectedPlaceMarkerRef.current.anchor) {
        selectedPlaceMarkerRef.current.anchor.setMap(null)
      }
      if (selectedPlaceMarkerRef.current.setMap) {
        selectedPlaceMarkerRef.current.setMap(null)
      }
      selectedPlaceMarkerRef.current = null
    }

    if (!selectedPlace) {
      closeActiveInfoWindow()
      return
    }

    if (!isValidLatLng(selectedPlace.lat, selectedPlace.lng)) {
      console.log('선택한 장소 좌표가 없습니다:', selectedPlace)
      return
    }

    const selectedLocation = new window.kakao.maps.LatLng(
      Number(selectedPlace.lat),
      Number(selectedPlace.lng)
    )

    if (isSameMapPlace(selectedPlace, confirmedMeetingPlace)) {
      mapObjectRef.current.relayout()
      mapObjectRef.current.setCenter(selectedLocation)

      if (meetingPlaceMarkerRef.current?.anchor) {
        openPlaceInfoWindow(selectedPlace, meetingPlaceMarkerRef.current.anchor)
      }
      return
    }

    const matchedMarker = placeMarkerRefs.current.find((marker) => {
      const markerPosition = marker.anchor?.getPosition?.() || marker.getPosition?.()

      if (!markerPosition) return false

      return (
        markerPosition.getLat() === Number(selectedPlace.lat) &&
        markerPosition.getLng() === Number(selectedPlace.lng)
      )
    })

    let activeMarker = matchedMarker?.anchor || matchedMarker

    if (!activeMarker) {
      const anchorMarker = new window.kakao.maps.Marker({
        position: selectedLocation,
        map: mapObjectRef.current,
        title: selectedPlace.name || '장소',
        image: createInfoAnchorImage('nearby'),
      })
      anchorMarker.setOpacity?.(0)

      const markerContent = createPlaceMarkerContent({
        label: selectedPlace.name || '장소',
        variant: 'nearby',
      })
      const overlay = new window.kakao.maps.CustomOverlay({
        position: selectedLocation,
        content: markerContent,
        yAnchor: 1,
        zIndex: 5,
      })

      overlay.setMap(mapObjectRef.current)

      markerContent.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        openPlaceInfoWindow(selectedPlace, anchorMarker)
      })

      window.kakao.maps.event.addListener(anchorMarker, 'click', () => {
        openPlaceInfoWindow(selectedPlace, anchorMarker)
      })

      selectedPlaceMarkerRef.current = { overlay, anchor: anchorMarker }
      activeMarker = anchorMarker
    }

    mapObjectRef.current.relayout()
    mapObjectRef.current.setCenter(selectedLocation)
    openPlaceInfoWindow(selectedPlace, activeMarker)
  }, [
    selectedPlace,
    confirmedMeetingPlaceViewportKey,
    isMapReady,
    closeActiveInfoWindow,
    openPlaceInfoWindow,
  ])

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

    const meetingLat = confirmedMeetingPlace?.lat ?? confirmedMeetingPlace?.locationlat
    const meetingLng = confirmedMeetingPlace?.lng ?? confirmedMeetingPlace?.locationlng

    if (isValidLatLng(meetingLat, meetingLng)) {
      bounds.extend(new window.kakao.maps.LatLng(Number(meetingLat), Number(meetingLng)))
    }

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
  }, [
    memberRoutePaths,
    memberLocations,
    places,
    confirmedMeetingPlaceViewportKey,
    isMapReady,
  ])

  useEffect(() => {
    if (
      !fitBoundsRequest ||
      handledFitBoundsRequestRef.current === fitBoundsRequest ||
      !isMapReady ||
      !mapObjectRef.current
    ) {
      return
    }

    const map = mapObjectRef.current
    const bounds = new window.kakao.maps.LatLngBounds()
    let pointCount = 0

    const extendBounds = (lat, lng) => {
      if (!isValidLatLng(lat, lng)) return

      bounds.extend(new window.kakao.maps.LatLng(Number(lat), Number(lng)))
      pointCount += 1
    }

    memberLocations.forEach((member) => {
      extendBounds(member.latitude, member.longitude)
    })

    if (isValidLatLng(destination?.lat, destination?.lng)) {
      extendBounds(destination.lat, destination.lng)
    } else if (isValidLatLng(selectedPlace?.lat, selectedPlace?.lng)) {
      extendBounds(selectedPlace.lat, selectedPlace.lng)
    }

    const meetingLat = confirmedMeetingPlace?.lat ?? confirmedMeetingPlace?.locationlat
    const meetingLng = confirmedMeetingPlace?.lng ?? confirmedMeetingPlace?.locationlng
    extendBounds(meetingLat, meetingLng)

    places.forEach((place) => {
      extendBounds(place.lat, place.lng)
    })

    memberRoutePaths.forEach((route) => {
      route.path?.forEach((point) => {
        extendBounds(point.lat, point.lng)
      })
    })

    if (pointCount === 0) return

    handledFitBoundsRequestRef.current = fitBoundsRequest

    setTimeout(() => {
      if (!mapObjectRef.current) return

      map.relayout()

      if (pointCount === 1) {
        const center = getFirstValidLatLng({
          memberLocations,
          selectedPlace,
          destination,
          confirmedMeetingPlace,
          places,
          memberRoutePaths,
        })

        if (center) {
          map.setCenter(new window.kakao.maps.LatLng(center.lat, center.lng))
          map.setLevel(5)
        }
        return
      }

      map.setBounds(bounds, 36, 36, 140, 36)
    }, 120)
  }, [
    fitBoundsRequest,
    isMapReady,
    memberLocations,
    memberRoutePaths,
    destination,
    selectedPlace,
    confirmedMeetingPlaceViewportKey,
    places,
  ])

  if (mapError) {
    return <p>{mapError}</p>
  }

  const effectiveMapHeight = mapHeight || height

  return (
    <div
      className={className}
      style={{
        width: '100%',
        height: effectiveMapHeight,
        minHeight: effectiveMapHeight,
      }}
    >
      {!isMapReady && <p>지도 불러오는 중...</p>}

      <div
        ref={mapRef}
        style={{
          width: '100%',
          height: '100%',
          minHeight: '100%',
          display: 'block',
          position: 'relative',
          overflow: 'hidden',
          border: 'none',
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

function getMemberProfileImageUrl(memberLocation) {
  return (
    memberLocation.profiles?.profileimageurl ||
    memberLocation.room_guests?.profileimageurl ||
    memberLocation.profileimageurl ||
    ''
  )
}

function getMemberKey(memberLocation) {
  return memberLocation.userid || memberLocation.guestid || memberLocation.id || ''
}

function isMemberDeparted(memberLocation) {
  return Boolean(
    memberLocation.isdeparted ||
      memberLocation.locationstatus === 'tracking' ||
      memberLocation.locationstatus === 'departed' ||
      memberLocation.locationstatus === 'approaching'
  )
}

function getMemberRouteResult(memberLocation, memberRouteResults = []) {
  return memberRouteResults.find((result) => {
    if (memberLocation.userid) return result.userid === memberLocation.userid
    if (memberLocation.guestid) return result.guestid === memberLocation.guestid
    return false
  })
}

function getRegisteredLocationLabel(location) {
  return (
    location.locationname ||
    location.locationaddress ||
    location.address ||
    location.placename ||
    location.placeaddress ||
    ''
  )
}

function getCoordinateLabel(location) {
  const lat = Number(location.latitude)
  const lng = Number(location.longitude)

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return '위치 정보 없음'
  }

  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}

function createPlaceMarkerContent({ label, variant = 'nearby' }) {
  const isMeeting = variant === 'meeting'
  const size = isMeeting ? 34 : 28
  const innerSize = isMeeting ? 15 : 12
  const dotSize = isMeeting ? 5 : 4
  const color = isMeeting ? '#ff4d57' : '#b9a7ff'
  const shadowColor = isMeeting
    ? 'rgba(239, 68, 68, 0.32)'
    : 'rgba(124, 121, 255, 0.24)'

  const container = document.createElement('button')
  container.type = 'button'
  container.title = label || (isMeeting ? '만날 장소' : '주변 장소')
  container.style.position = 'relative'
  container.style.display = 'block'
  container.style.width = `${size}px`
  container.style.height = `${Math.round(size * 1.28)}px`
  container.style.border = 'none'
  container.style.background = 'transparent'
  container.style.boxSizing = 'border-box'
  container.style.cursor = 'pointer'
  container.style.padding = '0'
  container.style.transform = 'translateY(-3px)'

  const pin = document.createElement('span')
  pin.style.position = 'absolute'
  pin.style.left = '50%'
  pin.style.top = '1px'
  pin.style.display = 'grid'
  pin.style.placeItems = 'center'
  pin.style.width = `${size}px`
  pin.style.height = `${size}px`
  pin.style.border = '2px solid #fff'
  pin.style.borderRadius = '50% 50% 50% 3px'
  pin.style.background = color
  pin.style.boxShadow = `0 7px 16px ${shadowColor}`
  pin.style.boxSizing = 'border-box'
  pin.style.transform = 'translateX(-50%) rotate(-45deg)'

  const inner = document.createElement('span')
  inner.style.position = 'relative'
  inner.style.display = 'grid'
  inner.style.placeItems = 'center'
  inner.style.width = `${innerSize}px`
  inner.style.height = `${innerSize}px`
  inner.style.border = '2px solid #fff'
  inner.style.borderRadius = '50%'
  inner.style.boxSizing = 'border-box'
  inner.style.transform = 'rotate(45deg)'

  const dot = document.createElement('span')
  dot.style.position = 'absolute'
  dot.style.left = '50%'
  dot.style.top = '50%'
  dot.style.width = `${dotSize}px`
  dot.style.height = `${dotSize}px`
  dot.style.borderRadius = '50%'
  dot.style.background = '#fff'
  dot.style.transform = 'translate(-50%, -50%)'

  inner.appendChild(dot)
  pin.appendChild(inner)
  container.appendChild(pin)

  return container
}

function createInfoAnchorImage(variant = 'nearby') {
  const isMeeting = variant === 'meeting'
  const isMember = variant === 'member'
  const width = isMeeting ? 34 : 28
  const height = isMeeting ? 52 : isMember ? 26 : 44
  const imageSrc = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='

  return new window.kakao.maps.MarkerImage(
    imageSrc,
    new window.kakao.maps.Size(width, height),
    {
      offset: new window.kakao.maps.Point(width / 2, height),
    }
  )
}

function createMemberMarkerContent({
  nickname,
  profileImageUrl,
  isGuest,
  isDeparted,
  hasRouteError,
}) {
  const container = document.createElement('button')
  container.type = 'button'
  container.style.display = 'flex'
  container.style.flexDirection = 'column'
  container.style.alignItems = 'center'
  container.style.gap = '4px'
  container.style.width = '72px'
  container.style.height = '64px'
  container.style.border = 'none'
  container.style.background = 'transparent'
  container.style.padding = '0'
  container.style.cursor = 'pointer'
  container.style.font = 'inherit'
  container.style.color = '#111827'

  const avatarWrap = document.createElement('span')
  avatarWrap.style.position = 'relative'
  avatarWrap.style.display = 'block'
  avatarWrap.style.width = '42px'
  avatarWrap.style.height = '42px'

  const avatar = document.createElement('span')
  avatar.style.display = 'flex'
  avatar.style.alignItems = 'center'
  avatar.style.justifyContent = 'center'
  avatar.style.width = '42px'
  avatar.style.height = '42px'
  avatar.style.borderRadius = '50%'
  avatar.style.overflow = 'hidden'
  avatar.style.background = '#f1f5f9'
  avatar.style.border = '2px solid #fff'
  avatar.style.boxShadow = '0 4px 12px rgba(15, 23, 42, 0.28)'
  avatar.style.boxSizing = 'border-box'
  avatar.style.fontSize = '16px'
  avatar.style.fontWeight = '800'

  if (profileImageUrl) {
    const image = document.createElement('img')
    image.src = profileImageUrl
    image.alt = ''
    image.referrerPolicy = 'no-referrer'
    image.style.width = '100%'
    image.style.height = '100%'
    image.style.objectFit = 'cover'
    avatar.appendChild(image)
  } else if (isGuest) {
    avatar.innerHTML = renderToStaticMarkup(
      <FiUser aria-hidden="true" focusable="false" />
    )
    const icon = avatar.querySelector('svg')
    if (icon) {
      icon.style.width = '22px'
      icon.style.height = '22px'
      icon.style.color = '#7c79ff'
      icon.style.strokeWidth = '1.9'
    }
  } else {
    avatar.textContent = getMemberInitial(nickname)
  }

  const statusDot = document.createElement('span')
  statusDot.style.position = 'absolute'
  statusDot.style.right = '0'
  statusDot.style.bottom = '1px'
  statusDot.style.width = '11px'
  statusDot.style.height = '11px'
  statusDot.style.borderRadius = '50%'
  statusDot.style.background = hasRouteError ? '#ef4444' : isDeparted ? '#16c75b' : '#9ca3af'
  statusDot.style.border = '2px solid #fff'
  statusDot.style.boxShadow = '0 1px 3px rgba(15, 23, 42, 0.24)'
  statusDot.style.boxSizing = 'border-box'

  const label = document.createElement('span')
  label.textContent = nickname
  label.style.maxWidth = '72px'
  label.style.padding = '1px 5px'
  label.style.borderRadius = '999px'
  label.style.background = 'rgba(255, 255, 255, 0.92)'
  label.style.boxShadow = '0 2px 8px rgba(15, 23, 42, 0.16)'
  label.style.fontSize = '12px'
  label.style.fontWeight = '700'
  label.style.lineHeight = '1.35'
  label.style.whiteSpace = 'nowrap'
  label.style.overflow = 'hidden'
  label.style.textOverflow = 'ellipsis'

  avatarWrap.appendChild(avatar)
  avatarWrap.appendChild(statusDot)
  container.appendChild(avatarWrap)
  container.appendChild(label)

  return container
}

function getMemberInitial(nickname) {
  const trimmedNickname = String(nickname || '').trim()
  return trimmedNickname ? trimmedNickname.charAt(0) : '멤'
}

function createMemberInfoContent({ nickname, locationLabel, transportMode, routeResult }) {
  const hasRouteError = Boolean(routeResult?.error)
  const hasRemainingTime =
    !hasRouteError &&
    routeResult?.durationMinutes !== null &&
    routeResult?.durationMinutes !== undefined
  const remainingDistance = routeResult?.distanceKm
    ? `${routeResult.distanceKm}km`
    : routeResult?.distance
      ? `${(Number(routeResult.distance) / 1000).toFixed(1)}km`
      : ''
  const transportModeLabel = getTransportModeLabel(transportMode)
  const routeSummary = hasRemainingTime
    ? [
        `${routeResult.durationMinutes}분`,
        remainingDistance,
      ].filter(Boolean).join(' · ')
    : ''

  const routeSummaryWithTransport = [
    routeSummary,
    transportModeLabel,
  ].filter(Boolean).join(' \u00B7 ')

  return `
    <div style="width:220px; padding:12px; box-sizing:border-box; font-size:13px; line-height:1.45; color:#111827;">
      <strong style="display:block; margin-bottom:8px; font-size:14px;">${escapeHtml(nickname)}</strong>
      <p style="margin:0 0 6px; word-break:keep-all; overflow-wrap:anywhere;">
        <span style="display:block; color:#6b7280; font-size:12px;">현재 위치</span>
        ${escapeHtml(locationLabel || '위치 정보 없음')}
      </p>
      ${
        routeSummaryWithTransport
          ? `<p style="margin:0; font-weight:700;">${escapeHtml(routeSummaryWithTransport)}</p>`
          : ''
      }
      ${
        hasRouteError
          ? `<p style="margin:8px 0 0; color:#ef4444; font-size:12px; font-weight:800;">경로 검색 불가</p>`
          : ''
      }
    </div>
  `
}

function getTransportModeLabel(mode) {
  const normalizedMode = String(mode || '').trim()

  if (normalizedMode === 'car') return '\uC790\uB3D9\uCC28'
  if (normalizedMode === 'transit') return '\uB300\uC911\uAD50\uD1B5'
  return mode || ''
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

function getPlaceViewportKey(place = {}) {
  const lat = place?.lat ?? place?.latitude ?? place?.placelat ?? place?.locationlat
  const lng = place?.lng ?? place?.longitude ?? place?.placelng ?? place?.locationlng

  if (!isValidLatLng(lat, lng)) return ''

  return [
    place.id || place.placeid || place.kakaoPlaceId || '',
    place.name || place.placename || place.location || '',
    place.address || place.placeaddress || place.locationaddress || '',
    Number(lat),
    Number(lng),
  ].join(':')
}

function getKakaoMapUrl(place = {}) {
  const explicitUrl = place.kakaoMapUrl || place.kakaomapurl
  if (explicitUrl) return explicitUrl

  const lat = place.lat ?? place.latitude ?? place.placelat ?? place.locationlat
  const lng = place.lng ?? place.longitude ?? place.placelng ?? place.locationlng

  if (!isValidLatLng(lat, lng)) return ''

  const name =
    place.name ||
    place.placename ||
    place.place_name ||
    place.location ||
    place.address ||
    '선택한 장소'

  return `https://map.kakao.com/link/map/${encodeURIComponent(name)},${Number(lat)},${Number(lng)}`
}

function resolveKakaoPlaceUrl(place = {}) {
  const explicitUrl = place.kakaoMapUrl || place.kakaomapurl
  if (explicitUrl) return Promise.resolve(explicitUrl)

  if (!window.kakao?.maps?.services) return Promise.resolve('')

  const keyword = String(
    place.name ||
    place.placename ||
    place.location ||
    place.address ||
    place.placeaddress ||
    place.locationaddress ||
    ''
  ).trim()

  if (!keyword) return Promise.resolve('')

  return new Promise((resolve) => {
    const placesService = new window.kakao.maps.services.Places()
    const lat = Number(place.lat ?? place.latitude ?? place.placelat ?? place.locationlat)
    const lng = Number(place.lng ?? place.longitude ?? place.placelng ?? place.locationlng)
    const searchOptions = isValidLatLng(lat, lng)
      ? {
          location: new window.kakao.maps.LatLng(lat, lng),
          radius: 2000,
        }
      : {}

    placesService.keywordSearch(
      keyword,
      (data, status) => {
        if (status !== window.kakao.maps.services.Status.OK || !data?.length) {
          resolve('')
          return
        }

        const matchedPlace = findBestKakaoPlaceMatch(data, place)
        resolve(matchedPlace?.place_url || '')
      },
      searchOptions
    )
  })
}

function findBestKakaoPlaceMatch(results, place = {}) {
  const targetLat = Number(place.lat ?? place.latitude ?? place.placelat ?? place.locationlat)
  const targetLng = Number(place.lng ?? place.longitude ?? place.placelng ?? place.locationlng)
  const targetName = normalizePlaceText(place.name || place.placename || place.location)
  const targetAddress = normalizePlaceText(place.address || place.placeaddress || place.locationaddress)

  const scoredResults = results.map((result, index) => {
    const resultName = normalizePlaceText(result.place_name)
    const resultAddress = normalizePlaceText(result.road_address_name || result.address_name)
    const resultLat = Number(result.y)
    const resultLng = Number(result.x)
    let score = 0

    if (targetName && resultName === targetName) score += 100
    if (targetName && resultName.includes(targetName)) score += 40
    if (targetName && targetName.includes(resultName)) score += 25
    if (targetAddress && resultAddress === targetAddress) score += 80
    if (targetAddress && resultAddress.includes(targetAddress)) score += 30

    if (isValidLatLng(targetLat, targetLng) && isValidLatLng(resultLat, resultLng)) {
      const distanceScore = Math.max(0, 30 - getCoordinateDistance(targetLat, targetLng, resultLat, resultLng) * 100000)
      score += distanceScore
    }

    return { result, score, index }
  })

  scoredResults.sort((a, b) => b.score - a.score || a.index - b.index)
  return scoredResults[0]?.result || results[0]
}

function getCoordinateDistance(latA, lngA, latB, lngB) {
  return Math.hypot(Number(latA) - Number(latB), Number(lngA) - Number(lngB))
}

function isSameMapPlace(place, target) {
  if (!place || !target) return false

  const placeLat = Number(place.lat ?? place.latitude)
  const placeLng = Number(place.lng ?? place.longitude)
  const targetLat = Number(target.lat ?? target.latitude ?? target.locationlat)
  const targetLng = Number(target.lng ?? target.longitude ?? target.locationlng)
  const placeName = normalizePlaceText(place.name || place.placename || place.location)
  const targetName = normalizePlaceText(target.name || target.placename || target.location)

  if (placeName && targetName && placeName === targetName) {
    return true
  }

  if (
    Number.isFinite(placeLat) &&
    Number.isFinite(placeLng) &&
    Number.isFinite(targetLat) &&
    Number.isFinite(targetLng)
  ) {
    return Math.abs(placeLat - targetLat) < 0.0005 && Math.abs(placeLng - targetLng) < 0.0005
  }

  const placeAddress = normalizePlaceText(place.address || place.placeaddress || place.locationaddress)
  const targetAddress = normalizePlaceText(target.address || target.placeaddress || target.locationaddress)

  return Boolean(placeAddress && targetAddress && placeAddress === targetAddress)
}

function normalizePlaceText(value) {
  return String(value || '').replace(/\s+/g, '').trim()
}

function getFirstValidLatLng({
  memberLocations = [],
  selectedPlace,
  destination,
  confirmedMeetingPlace,
  places = [],
  memberRoutePaths = [],
}) {
  const firstMemberLocation = memberLocations.find((member) =>
    isValidLatLng(member.latitude, member.longitude)
  )

  if (firstMemberLocation) {
    return {
      lat: Number(firstMemberLocation.latitude),
      lng: Number(firstMemberLocation.longitude),
    }
  }

  if (isValidLatLng(destination?.lat, destination?.lng)) {
    return {
      lat: Number(destination.lat),
      lng: Number(destination.lng),
    }
  }

  if (isValidLatLng(selectedPlace?.lat, selectedPlace?.lng)) {
    return {
      lat: Number(selectedPlace.lat),
      lng: Number(selectedPlace.lng),
    }
  }

  const meetingLat = confirmedMeetingPlace?.lat ?? confirmedMeetingPlace?.locationlat
  const meetingLng = confirmedMeetingPlace?.lng ?? confirmedMeetingPlace?.locationlng

  if (isValidLatLng(meetingLat, meetingLng)) {
    return {
      lat: Number(meetingLat),
      lng: Number(meetingLng),
    }
  }

  const firstPlace = places.find((place) => isValidLatLng(place.lat, place.lng))

  if (firstPlace) {
    return {
      lat: Number(firstPlace.lat),
      lng: Number(firstPlace.lng),
    }
  }

  for (const route of memberRoutePaths) {
    const firstPoint = route.path?.find((point) => isValidLatLng(point.lat, point.lng))

    if (firstPoint) {
      return {
        lat: Number(firstPoint.lat),
        lng: Number(firstPoint.lng),
      }
    }
  }

  return null
}

function getMarkerInfoKey(type, item = {}) {
  const id =
    item.id ||
    item.placeid ||
    item.kakaoPlaceId ||
    item.userid ||
    item.guestid ||
    item.name ||
    item.locationname ||
    item.title ||
    ''
  const lat = item.lat ?? item.latitude ?? ''
  const lng = item.lng ?? item.longitude ?? ''

  return `${type}:${id}:${lat}:${lng}`
}

function getPreferredCenter({
  selectedPlace,
  pickedPlace,
  places = [],
  currentLocation,
  preferredCenter,
}) {
  if (isValidLatLng(preferredCenter?.lat, preferredCenter?.lng)) {
    return {
      lat: Number(preferredCenter.lat),
      lng: Number(preferredCenter.lng),
    }
  }

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
    lat: 35.1796,
    lng: 129.0756,
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
