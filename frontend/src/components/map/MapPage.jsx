import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { FaKeyboard, FaLocationArrow, FaUserFriends } from 'react-icons/fa'

import KakaoMapView from './KakaoMapView'
import CurrentLocationButton from './CurrentLocationButton'
import PlaceSearchPanel from './PlaceSearchPanel'
import FamousMiddlePlacePanel from './FamousMiddlePlacePanel'
import LocationPicker from './LocationPicker'

import { getCurrentPosition } from '../../services/geolocationService'
import { getRouteTime } from '../../api/routeTimeApi'
import { decodePolyline } from '../../utils/decodePolyline'
import { supabase } from '../../lib/supabaseClient'
import {
  createNotification,
  createGuestNotification,
  createRoomNotifications,
} from '../../api/notificationApi'
import {
  saveMyLocation,
  saveMyGuestLocation,
  getRoomMemberLocations,
  getRoomParticipants,
  saveRoomMiddlePlace,
  getRoomMiddlePlace,
  deleteRoomMiddlePlace,
  updateLocationStatus,
} from '../../api/mapApi'
import {
  applyConfirmedLocationToSchedule,
  clearConfirmedScheduleLocation,
  createDraftConfirmedSchedule,
  createLocationOnlyConfirmedSchedule,
  getAdditionalConfirmedLocations,
  getRoomConfirmedSchedules,
} from '../../api/scheduleApi'

const FRIEND_LOCATION_PREVIEW_COUNT = 3
const FRIEND_SHEET_MIN_TOP = 72
const FRIEND_SHEET_BOTTOM_VISIBLE_HEIGHT = 116
const FRIEND_SHEET_COLLAPSED_HEIGHT = 176
const FRIEND_SHEET_TOP_SNAP_DISTANCE = 36
const FRIEND_SHEET_COLLAPSED_SNAP_DISTANCE = 72
const FRIEND_SHEET_HIDDEN_SNAP_DISTANCE = 18
const SHEET_EXPANDED_SNAP_DISTANCE = 36
const SHEET_COLLAPSED_SNAP_DISTANCE = 24
const SHEET_HIDDEN_SNAP_DISTANCE = 18
const SHEET_HIDDEN_VISIBLE_HEIGHT = 54

function MapPage({ roomId }) {
  const navigate = useNavigate()
  const routerLocation = useLocation()
  const currentRoomId = Number(roomId)

  const [currentUserId, setCurrentUserId] = useState(null)
  const [currentGuestId, setCurrentGuestId] = useState(null)
  const [members, setMembers] = useState([])

  const [currentLocation, setCurrentLocation] = useState(null)
  const [memberLocations, setMemberLocations] = useState([])

  const [places, setPlaces] = useState([])
  const [selectedPlace, setSelectedPlace] = useState(null)
  const [destination, setDestination] = useState(null)

  const [middlePlace, setMiddlePlace] = useState(null)
  const [memberRouteResults, setMemberRouteResults] = useState([])
  const [memberRoutePaths, setMemberRoutePaths] = useState([])
  const [memberLocationLabels, setMemberLocationLabels] = useState({})

  const [message, setMessage] = useState('')
  const [locationUpdateError, setLocationUpdateError] = useState('')
  const [pendingMiddleLocation, setPendingMiddleLocation] = useState(null)
  const [pendingMeetingPlaceConfirm, setPendingMeetingPlaceConfirm] = useState(null)
  const [roomConfirmedSchedules, setRoomConfirmedSchedules] = useState([])
  const [roomConfirmedSchedulesLoaded, setRoomConfirmedSchedulesLoaded] = useState(false)
  const [confirmedAdditionalPlaces, setConfirmedAdditionalPlaces] = useState([])
  const [confirmedSchedulePlaceLinks, setConfirmedSchedulePlaceLinks] = useState({})
  const [selectedScheduleId, setSelectedScheduleId] = useState(null)
  const [showNewScheduleModal, setShowNewScheduleModal] = useState(false)
  const [newScheduleTitle, setNewScheduleTitle] = useState('')
  const [newScheduleTitleError, setNewScheduleTitleError] = useState('')
  const [appointmentTitle, setAppointmentTitle] = useState('')
  const [createdLocationOnlySchedule, setCreatedLocationOnlySchedule] = useState(null)
  const [transportModePrompt, setTransportModePrompt] = useState(null)
  const [showDepartureLocationPicker, setShowDepartureLocationPicker] = useState(false)
  const [showLocationRegisterModal, setShowLocationRegisterModal] = useState(false)
  const [showCancelDepartureConfirm, setShowCancelDepartureConfirm] = useState(false)
  const [showCancelMiddlePlaceConfirm, setShowCancelMiddlePlaceConfirm] = useState(false)
  const [activeMapPanel, setActiveMapPanel] = useState('default')
  const [hasSearchResultsSheet, setHasSearchResultsSheet] = useState(false)
  const [hasMiddleRecommendationResults, setHasMiddleRecommendationResults] = useState(false)
  const [sheetSnap, setSheetSnap] = useState('collapsed')
  const [sheetDragOffset, setSheetDragOffset] = useState(0)
  const [sheetFreeOffset, setSheetFreeOffset] = useState(0)
  const [showFriendMemberListOnly, setShowFriendMemberListOnly] = useState(false)
  const [friendSheetTop, setFriendSheetTop] = useState(null)
  const [friendMapFitRequest, setFriendMapFitRequest] = useState(0)
  const [mapCenterRequest, setMapCenterRequest] = useState(1)
  const [mapCenterLevel, setMapCenterLevel] = useState(4)
  const sheetDragStartRef = useRef(null)
  const lastDefaultCenterKeyRef = useRef('')
  const selectedScheduleStorageKey = currentRoomId
    ? `room:${currentRoomId}:location:selectedScheduleId`
    : null
  const selectedSchedule = roomConfirmedSchedules.find(
    (schedule) => Number(schedule.id) === Number(selectedScheduleId)
  )
  const selectedScheduleMeetingPlace = getScheduleMeetingPlace({
    schedule: selectedSchedule,
    roomId: currentRoomId,
    kakaoMapUrl: selectedSchedule?.id
      ? confirmedSchedulePlaceLinks[selectedSchedule.id] || ''
      : '',
  })
  const activeMeetingPlace = middlePlace || selectedScheduleMeetingPlace
  const visibleMapPlaces = getVisibleMapPlaces({
    places,
    confirmedAdditionalPlaces,
    activeMeetingPlace,
  })

  const myLocationRecord = memberLocations.find((location) => {
    if (currentUserId) return location.userid === currentUserId
    if (currentGuestId) return location.guestid === currentGuestId
    return false
  })

  const isDeparted = Boolean(myLocationRecord?.isdeparted)
  const isArrived = Boolean(myLocationRecord?.arrivedat)
  const isTracking = isDeparted && !isArrived
  const registeredMemberLocations = memberLocations.filter(
    (location) => location.transportmode
  )

  useEffect(() => {
    if (!message) return undefined

    const timeoutId = setTimeout(() => {
      setMessage('')
    }, 2400)

    return () => clearTimeout(timeoutId)
  }, [message])

  useEffect(() => {
    const fetchUser = async () => {
      const guestId = localStorage.getItem('guest_id')

      const {
        data: { user },
        error,
      } = await supabase.auth.getUser()

      if (error) {
        if (guestId) {
          setCurrentUserId(null)
          setCurrentGuestId(guestId)
          return
        }

        console.error('사용자 정보 조회 오류:', error)
        return
      }

      if (user) {
        setCurrentUserId(user.id)
        setCurrentGuestId(null)
        return
      }

      if (guestId) {
        setCurrentUserId(null)
        setCurrentGuestId(guestId)
      }
    }

    fetchUser()
  }, [])

  useEffect(() => {
    if (!currentRoomId) return

    loadRoomData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRoomId, selectedScheduleId])

  useEffect(() => {
    if (!currentRoomId) return

    const intervalId = setInterval(async () => {
      try {
        const locations = await getRoomMemberLocations(currentRoomId, selectedScheduleId)
        setMemberLocations(locations)

        if (activeMeetingPlace) {
          await calculateAllMemberRoutesToMiddlePlace(activeMeetingPlace, {
            locations,
            silent: true,
          })
        }
      } catch (error) {
        console.error('실시간 멤버 위치 갱신 오류:', error)
      }
    }, 3000)

    return () => {
      clearInterval(intervalId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRoomId, selectedScheduleId, activeMeetingPlace?.lat, activeMeetingPlace?.lng])

  useEffect(() => {
    if (!isTracking) return

    const intervalId = setInterval(() => {
      refreshMemberRoutesFromDb()
    }, 5000)

    return () => {
      clearInterval(intervalId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTracking, currentRoomId, activeMeetingPlace?.lat, activeMeetingPlace?.lng, selectedScheduleId])

  useEffect(() => {
    if (!currentRoomId) return
    if (selectedScheduleId) return
    if (!roomConfirmedSchedulesLoaded) return
    if (roomConfirmedSchedules.length > 0) return

    let isCancelled = false

    const loadSavedMiddlePlace = async () => {
      try {
        const savedMiddlePlace = await getRoomMiddlePlace(currentRoomId)

        if (isCancelled) return
        if (!savedMiddlePlace) return

        const confirmedMiddlePlace = {
          ...savedMiddlePlace,
          isConfirmedMiddlePlace: true,
        }

        setMiddlePlace(confirmedMiddlePlace)
        setSelectedPlace(confirmedMiddlePlace)
        setDestination(confirmedMiddlePlace)
        setPlaces([confirmedMiddlePlace])
        setMemberRouteResults([])
        setMemberRoutePaths([])
        await calculateAllMemberRoutesToMiddlePlace(confirmedMiddlePlace)
      } catch (error) {
        console.error('확정 중간 장소 조회 오류:', error)
      }
    }

    loadSavedMiddlePlace()

    return () => {
      isCancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentRoomId,
    selectedScheduleId,
    roomConfirmedSchedulesLoaded,
    roomConfirmedSchedules.length,
  ])

  useEffect(() => {
    if (!currentRoomId) return

    const preferredId = routerLocation.state?.selectedScheduleId
    const savedSelectedScheduleId = selectedScheduleStorageKey
      ? Number(localStorage.getItem(selectedScheduleStorageKey))
      : null

    setRoomConfirmedSchedulesLoaded(false)

    getRoomConfirmedSchedules(currentRoomId)
      .then((schedules) => {
        setRoomConfirmedSchedules(schedules)
        setSelectedScheduleId((previousId) => {
          // navigation state로 전달된 일정 ID 우선 선택
          if (preferredId && schedules.some((s) => Number(s.id) === Number(preferredId))) {
            return Number(preferredId)
          }
          if (
            savedSelectedScheduleId &&
            schedules.some((s) => Number(s.id) === Number(savedSelectedScheduleId))
          ) {
            return savedSelectedScheduleId
          }
          if (schedules.some((schedule) => Number(schedule.id) === Number(previousId))) {
            return previousId
          }
          return schedules[0]?.id ?? null
        })
      })
      .catch((error) => {
        console.error('Failed to load confirmed schedules:', error)
      })
      .finally(() => {
        setRoomConfirmedSchedulesLoaded(true)
      })
  }, [currentRoomId, routerLocation.state?.selectedScheduleId, selectedScheduleStorageKey])

  useEffect(() => {
    if (!selectedScheduleStorageKey || !selectedScheduleId) return

    localStorage.setItem(selectedScheduleStorageKey, String(selectedScheduleId))
  }, [selectedScheduleId, selectedScheduleStorageKey])

  useEffect(() => {
    if (!currentRoomId || !selectedScheduleId) {
      setConfirmedAdditionalPlaces([])
      return
    }

    let isCancelled = false

    getAdditionalConfirmedLocations(currentRoomId, selectedScheduleId)
      .then((locations) => {
        if (isCancelled) return

        setConfirmedAdditionalPlaces(
          (locations || [])
            .map(toMapPlace)
            .filter((place) => isValidMapPoint(place.lat, place.lng))
        )
      })
      .catch((error) => {
        if (isCancelled) return
        console.error('Failed to load additional confirmed locations:', error)
        setConfirmedAdditionalPlaces([])
      })

    return () => {
      isCancelled = true
    }
  }, [currentRoomId, selectedScheduleId])

  useEffect(() => {
    if (!currentRoomId || !selectedScheduleId) return

    const selectedMiddlePlace = selectedScheduleMeetingPlace

    setMiddlePlace(selectedMiddlePlace)
    setSelectedPlace(selectedMiddlePlace)
    setDestination(selectedMiddlePlace)
    setPlaces(selectedMiddlePlace ? [selectedMiddlePlace] : [])
    setMemberRouteResults([])
    setMemberRoutePaths([])
    loadMemberLocations().then(() => {
      if (selectedMiddlePlace) {
        calculateAllMemberRoutesToMiddlePlace(selectedMiddlePlace)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentRoomId,
    selectedScheduleId,
    selectedSchedule?.location,
    selectedSchedule?.locationaddress,
    selectedSchedule?.locationlat,
    selectedSchedule?.locationlng,
    confirmedSchedulePlaceLinks,
  ])

  const getMemberKey = (member) => {
    return member.userid || member.guestid || member.id
  }

  const getMemberNickname = (member) => {
    return (
      member.profiles?.nickname ||
      member.room_guests?.nickname ||
      member.nickname ||
      '비회원'
    )
  }

  const getMemberLocationRecord = (member) => {
    return memberLocations.find((location) => {
      if (member.userid) return location.userid === member.userid
      if (member.guestid) return location.guestid === member.guestid
      return false
    })
  }

  const getMemberRouteResult = (member) => {
    return memberRouteResults.find((result) => {
      if (member.userid) return result.userid === member.userid
      if (member.guestid) return result.guestid === member.guestid
      return false
    })
  }

  const getChatSenderProfile = () => {
    const myMember = members.find((member) => {
      if (currentUserId) return member.userid === currentUserId
      if (currentGuestId) return member.guestid === currentGuestId
      return false
    })

    return {
      nickname:
        myMember?.profiles?.nickname ||
        myMember?.nickname ||
        localStorage.getItem('guest_nickname') ||
        '익명',
      profileimageurl: myMember?.profiles?.profileimageurl || null,
    }
  }

  const loadRoomData = async () => {
    await Promise.all([loadMemberLocations(), loadMembers()])
  }

  const loadMembers = async () => {
    if (!currentRoomId) return []

    try {
      const memberData = await getRoomParticipants(currentRoomId)
      setMembers(memberData || [])
      return memberData || []
    } catch (error) {
      console.error('멤버 조회 오류:', error)
      return []
    }
  }

  const loadMemberLocations = async () => {
    if (!currentRoomId) return []

    try {
      const locations = await getRoomMemberLocations(currentRoomId, selectedScheduleId)
      setMemberLocations(locations)
      return locations
    } catch (error) {
      console.error('멤버 위치 조회 오류:', error)
      return []
    }
  }

  const saveCurrentUserLocation = async (location, statusFields = {}) => {
    const savedAt = new Date().toISOString()

    const payload = {
      roomId: currentRoomId,
      scheduleId: selectedScheduleId,
      latitude: location?.lat ?? null,
      longitude: location?.lng ?? null,
      accuracy: location?.accuracy ?? null,
      lastLocationUpdatedAt: savedAt,
      ...statusFields,
    }

    if (currentGuestId) {
      return saveMyGuestLocation({
        ...payload,
        guestId: currentGuestId,
      })
    }

    return saveMyLocation({
      ...payload,
      userId: currentUserId,
    })
  }

  const sendMapShareToChat = async ({ shareType, place }) => {
    if (!currentRoomId) {
      setMessage('방 정보를 찾을 수 없어 채팅에 공유할 수 없습니다.')
      return false
    }

    if (!currentUserId && !currentGuestId) {
      setMessage('로그인 또는 게스트 정보가 있어야 채팅에 공유할 수 있습니다.')
      return false
    }

    const lat = place?.lat ?? place?.latitude
    const lng = place?.lng ?? place?.longitude

    if (!lat || !lng) {
      setMessage('위치 좌표가 없어 채팅에 공유할 수 없습니다.')
      return false
    }

    const sender = getChatSenderProfile()

    const content = {
      __type: 'map_share',
      sharetype: shareType,
      name: place.name || place.placename || '공유 장소',
      address: place.address || place.placeaddress || '',
      lat,
      lng,
      rating: place.rating ?? null,
      reviewcount: place.reviewCount ?? null,
    }

    const { error } = await supabase.from('room_messages').insert([
      {
        roomid: currentRoomId,
        userid: currentUserId || null,
        nickname: sender.nickname,
        profileimageurl: sender.profileimageurl,
        content: JSON.stringify(content),
        imageurl: null,
      },
    ])

    if (error) {
      console.error('지도 정보 채팅 공유 실패:', error)
      setMessage('채팅 공유에 실패했습니다.')
      return false
    }

    setMessage('채팅에 공유했습니다.')
    return true
  }

  const handleShareCurrentLocation = async () => {
    let location = currentLocation

    if (!location) {
      try {
        location = await getCurrentPosition()
        setCurrentLocation(location)

        await saveCurrentUserLocation(location, {
          locationStatus: isTracking ? 'tracking' : 'idle',
          locationError: null,
        })

        await loadMemberLocations()
      } catch (error) {
        console.error('현재 위치 공유용 위치 조회 실패:', error)

        location =
          myLocationRecord && {
            lat: myLocationRecord.latitude,
            lng: myLocationRecord.longitude,
          }
      }
    }

    const isShared = await sendMapShareToChat({
      shareType: 'current_location',
      place: {
        name: '현재 위치',
        lat: location?.lat,
        lng: location?.lng,
      },
    })

    return isShared
  }

  const handleShareMiddlePlace = async () => {
    if (!activeMeetingPlace) {
      setMessage('확정된 중간 장소가 없습니다.')
      return
    }

    const isShared = await sendMapShareToChat({
      shareType: 'middle_place',
      place: activeMeetingPlace,
    })

    return isShared
  }

  const handleShareNearbyPlace = async (place) => {
    await sendMapShareToChat({
      shareType: 'nearby_place',
      place,
    })
  }

  const notifyDeparture = async () => {
    const senderName =
      members.find((member) => {
        if (currentUserId) return member.userid === currentUserId
        if (currentGuestId) return member.guestid === currentGuestId
        return false
      })?.nickname || '멤버'

    await Promise.all(
      members
        .filter((member) => {
          if (currentUserId && member.userid === currentUserId) return false
          if (currentGuestId && member.guestid === currentGuestId) return false
          return member.userid || member.guestid
        })
        .map((member) => {
          const notification = {
            roomId: currentRoomId,
            type: 'member_departed',
            title: '출발 알림',
            message: `${senderName}님이 출발했습니다.`,
            link: `/rooms/${currentRoomId}?tab=location`,
          }

          if (member.guestid) {
            return createGuestNotification({
              ...notification,
              guestId: member.guestid,
            })
          }

          return createNotification({
            ...notification,
            receiverId: member.userid,
            senderId: currentUserId,
          })
        })
    )
  }

  const handleCurrentLocation = async () => {
    try {
      if (!currentUserId && !currentGuestId) {
        setMessage('사용자 정보를 찾을 수 없습니다. 로그인 상태를 확인해주세요.')
        return
      }

      if (!currentRoomId) {
        setMessage('방 정보를 찾을 수 없습니다.')
        return
      }

      const location = await getCurrentPosition()

      setCurrentLocation(location)
      setTransportModePrompt({ location, isEdit: false, source: 'current' })
      setMessage('')
    } catch (error) {
      console.error('현재 위치 저장 오류:', error)
      setMessage('현재 위치를 가져오지 못했습니다.')
    }
  }

  const handleSelectDepartureLocation = (name, address, place = {}) => {
    const location = {
      lat: Number(place.lat),
      lng: Number(place.lng),
      accuracy: null,
      name,
      address: address || place.address || '',
    }

    if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)) {
      setMessage('출발 위치 좌표를 찾지 못했습니다.')
      return
    }

    setCurrentLocation(location)
    setShowDepartureLocationPicker(false)
    setShowLocationRegisterModal(false)
    setTransportModePrompt({ location, isEdit: false, source: 'manual' })
    setMessage('')
  }

  const handleSelectTransportMode = async (transportMode) => {
    if (!transportModePrompt?.location) return

    try {
      await saveCurrentUserLocation(transportModePrompt.location, {
        transportMode,
        locationStatus: isTracking ? 'tracking' : 'idle',
        locationError: null,
      })

      setCurrentLocation(transportModePrompt.location)
      setTransportModePrompt(null)
      await loadMemberLocations()

      if (activeMeetingPlace) {
        await calculateAllMemberRoutesToMiddlePlace(activeMeetingPlace)
      }

      if (transportModePrompt.source === 'manual') {
        setMessage('')
        return
      }

      setMessage('')
    } catch (error) {
      console.error('이동수단 저장 오류:', error)
      setMessage('이동수단을 저장하지 못했습니다.')
    }
  }

  const handleEditTransportMode = () => {
    if (!myLocationRecord) return

    setTransportModePrompt({
      isEdit: true,
      location: {
        lat: Number(myLocationRecord.latitude),
        lng: Number(myLocationRecord.longitude),
        accuracy: myLocationRecord.accuracy,
      },
    })
  }

  const refreshMemberRoutesFromDb = async () => {
    if (!currentRoomId) return

    try {
      await loadMemberLocations()

      if (activeMeetingPlace) {
        await calculateAllMemberRoutesToMiddlePlace(activeMeetingPlace)
      }
    } catch (error) {
      console.error('DB 위치 기반 경로 재계산 실패:', error)
    }
  }

  const getSavedLocationSnapshot = () => {
    if (isValidMapPoint(currentLocation?.lat, currentLocation?.lng)) {
      return currentLocation
    }

    if (isValidMapPoint(myLocationRecord?.latitude, myLocationRecord?.longitude)) {
      return {
        lat: Number(myLocationRecord.latitude),
        lng: Number(myLocationRecord.longitude),
        accuracy: myLocationRecord.accuracy ?? null,
      }
    }

    return null
  }

  const handleCancelDeparture = async () => {
    if (!currentUserId && !currentGuestId) {
      setMessage('로그인 또는 게스트 정보를 찾을 수 없습니다.')
      return
    }

    if (!currentRoomId) {
      setMessage('방 정보를 찾을 수 없습니다.')
      return
    }

    try {
      setMessage('')

      const location = getSavedLocationSnapshot()

      await saveCurrentUserLocation(location, {
        isDeparted: false,
        departedAt: null,
        arrivedAt: null,
        locationStatus: 'idle',
        locationError: null,
      })

      try {
        await updateLocationStatus({
          roomId: currentRoomId,
          scheduleId: selectedScheduleId,
          userId: currentUserId,
          guestId: currentGuestId,
          status: 'idle',
          isDeparted: false,
        })
      } catch (statusError) {
        console.warn('출발 취소 보조 업데이트 실패:', statusError)
      }

      setLocationUpdateError('')
      await loadMemberLocations()

      if (activeMeetingPlace) {
        await calculateAllMemberRoutesToMiddlePlace(activeMeetingPlace, { silent: true })
      }

      setMessage('')
    } catch (error) {
      console.error('출발 취소 실패:', error)
      setMessage('출발 취소 중 오류가 발생했습니다.')
    }
  }

  const handleDepartureButtonClick = () => {
    if (isTracking) {
      setShowCancelDepartureConfirm(true)
      return
    }

    handleStartDeparture()
  }

  const handleStartDeparture = async () => {
    if (isArrived) {
      setMessage('이미 도착 처리되어 다시 출발할 수 없습니다.')
      return
    }

    if (!currentUserId && !currentGuestId) {
      setMessage('로그인 또는 게스트 정보가 있어야 출발할 수 있습니다.')
      return
    }

    if (!currentRoomId) {
      setMessage('방 정보를 찾을 수 없습니다.')
      return
    }

    if (!myLocationRecord?.transportmode) {
      setMessage('현재 위치와 이동수단을 먼저 등록해주세요.')
      return
    }

    if (!activeMeetingPlace) {
      setMessage('중간 장소를 확정해주세요.')
      return
    }

    try {
      const location = getSavedLocationSnapshot()
      const now = new Date().toISOString()

      await saveCurrentUserLocation(location, {
        isDeparted: true,
        departedAt: myLocationRecord?.departedat || now,
        arrivedAt: null,
        locationStatus: 'tracking',
        locationError: null,
      })

      try {
        await updateLocationStatus({
          roomId: currentRoomId,
          scheduleId: selectedScheduleId,
          userId: currentUserId,
          guestId: currentGuestId,
          status: 'tracking',
          isDeparted: true,
        })
      } catch (statusError) {
        console.warn('출발 상태 보조 업데이트 실패:', statusError)
      }

      await loadMemberLocations()
      await notifyDeparture()

      if (activeMeetingPlace) {
        await calculateAllMemberRoutesToMiddlePlace(activeMeetingPlace)
      }

      setMessage('출발했습니다.')
    } catch (error) {
      console.error('출발 처리 실패:', error)
      setMessage('출발 처리 중 오류가 발생했습니다.')
    }
  }

  const handleArrive = async () => {
    if (!currentUserId && !currentGuestId) {
      setMessage('로그인 또는 게스트 정보를 찾을 수 없습니다.')
      return
    }

    try {
      let location = currentLocation

      try {
        location = await getCurrentPosition()
        setCurrentLocation(location)
      } catch (error) {
        console.warn('도착 처리 중 현재 위치 갱신 실패:', error)
      }

      await saveCurrentUserLocation(location, {
        isDeparted: false,
        arrivedAt: new Date().toISOString(),
        locationStatus: 'arrived',
        locationError: null,
      })

      try {
        await updateLocationStatus({
          roomId: currentRoomId,
          scheduleId: selectedScheduleId,
          userId: currentUserId,
          guestId: currentGuestId,
          status: 'arrived',
          isArrived: true,
        })
      } catch (statusError) {
        console.warn('도착 상태 보조 업데이트 실패:', statusError)
      }

      setLocationUpdateError('')
      await loadMemberLocations()

      if (activeMeetingPlace) {
        await calculateAllMemberRoutesToMiddlePlace(activeMeetingPlace)
      }

      setMessage('도착 처리되었습니다.')
    } catch (error) {
      console.error('도착 처리 실패:', error)
      setMessage('도착 처리에 실패했습니다.')
    }
  }

  const handleRequestLocation = async (member) => {
    try {
      if (!currentUserId && !currentGuestId) {
        alert('로그인한 사용자만 위치 등록 요청을 보낼 수 있습니다.')
        return
      }

      const requestLink = `/rooms/${currentRoomId}?tab=location&request=location-${Date.now()}`

      if (member.guestid) {
        await createGuestNotification({
          roomId: currentRoomId,
          guestId: member.guestid,
          type: 'location_request',
          title: '위치 등록 요청',
          message: '아직 위치를 등록하지 않았습니다. 위치를 등록해주세요!',
          link: requestLink,
        })
      } else {
        await createNotification({
          roomId: currentRoomId,
          receiverId: member.userid,
          senderId: currentUserId,
          type: 'location_request',
          title: '위치 등록 요청',
          message: '아직 위치를 등록하지 않았습니다. 위치를 등록해주세요!',
          link: requestLink,
        })
      }

      alert(`${member.nickname || '상대방'}님에게 위치 등록 요청 알림을 보냈습니다.`)
    } catch (error) {
      console.error('위치 등록 요청 알림 전송 실패:', error)
      alert('위치 등록 요청 알림 전송에 실패했습니다.')
    }
  }

  const isMemberLocationRegistered = (member) => {
    return memberLocations.some((location) => {
      if (!location.transportmode) return false
      if (member.userid) return location.userid === member.userid
      if (member.guestid) return location.guestid === member.guestid
      return false
    })
  }

  const renderLocationRequestAction = (member) => {
    if (isMemberLocationRegistered(member)) return null

    const isMe =
      (member.userid && member.userid === currentUserId) ||
      (member.guestid && member.guestid === currentGuestId)
    const canRequestLocation = Boolean(member.userid || member.guestid)

    if (isMe || !canRequestLocation) return null

    return (
      <button
        type="button"
        className="friend-location-request-button"
        onClick={() => handleRequestLocation(member)}
      >
        위치 등록 요청
      </button>
    )
  }

  const maybeSendArrivalNotifications = async ({
    member,
    nickname,
    durationMinutes,
    distance,
  }) => {
    const isMe =
      member.userid === currentUserId ||
      (currentGuestId && member.guestid === currentGuestId)

    if (!isMe || !currentRoomId) return

    const status = member.locationstatus
    const isAlreadyArrived = member.arrivedat || status === 'arrived'
    const isAlreadyApproaching = status === 'approaching'
    const isMoving =
      member.isdeparted ||
      status === 'tracking' ||
      status === 'departed' ||
      status === 'approaching'

    if (!isMoving || isAlreadyArrived) return

    if (
      durationMinutes > 0 &&
      durationMinutes <= 10 &&
      !isAlreadyApproaching
    ) {
      try {
        await updateLocationStatus({
          roomId: currentRoomId,
          scheduleId: selectedScheduleId,
          userId: currentUserId,
          guestId: currentGuestId,
          status: 'approaching',
        })

        await createRoomNotifications({
          roomId: currentRoomId,
          senderId: currentUserId || currentGuestId,
          type: 'arrival_approaching',
          title: '⚠️ 도착 10분 전!',
          message: `방에 ${nickname}님이 약 ${durationMinutes}분 뒤에 목적지에 도착할 예정입니다.`,
          link: `/rooms/${currentRoomId}?tab=location`,
        })
      } catch (error) {
        console.error('도착 10분 전 알림 처리 실패:', error)
      }
    }

    const distanceValue = distance || 9999

    if (distanceValue <= 50 && !isAlreadyArrived) {
      try {
        await updateLocationStatus({
          roomId: currentRoomId,
          scheduleId: selectedScheduleId,
          userId: currentUserId,
          guestId: currentGuestId,
          status: 'arrived',
          isArrived: true,
        })

        await saveCurrentUserLocation(currentLocation, {
          isDeparted: false,
          arrivedAt: new Date().toISOString(),
          locationStatus: 'arrived',
          locationError: null,
        })

        await createRoomNotifications({
          roomId: currentRoomId,
          senderId: currentUserId || currentGuestId,
          type: 'arrival_completed',
          title: '✅ 도착 완료!',
          message: `방에 ${nickname}님이 목적지에 도착했습니다!`,
          link: `/rooms/${currentRoomId}?tab=location`,
        })
      } catch (error) {
        console.error('도착 완료 알림 처리 실패:', error)
      }
    }
  }

  const calculateAllMemberRoutesToMiddlePlace = async (place, options = {}) => {
    if (!place) {
      return
    }

    const latestLocations = options.locations || await loadMemberLocations()

    if (!latestLocations || latestLocations.length === 0) {
      return
    }

    const routeResults = []
    const routePaths = []
    const routedMemberKeys = new Set()

    for (const member of latestLocations) {
      try {
        if (!member.latitude || !member.longitude) {
          continue
        }

        const memberKey = getMemberKey(member)

        if (!memberKey || routedMemberKeys.has(memberKey)) {
          continue
        }

        routedMemberKeys.add(memberKey)

        const nickname = getMemberNickname(member)

        const mode = normalizeTransportMode(member.transportmode)

        if (!mode) {
          continue
        }

        const origin = {
          lat: Number(member.latitude),
          lng: Number(member.longitude),
        }

        const destinationPoint = {
          lat: Number(place.lat),
          lng: Number(place.lng),
        }

        let routePath = []
        let routeSummary = null

        if (mode === 'car') {
          const pathResult = await getCarRoutePath({
            origin,
            destination: destinationPoint,
          })

          if (pathResult?.path?.length > 0) {
            routePath = pathResult.path
            routeSummary = pathResult
          }
        }

        if (mode === 'transit') {
          const timeResult = await getRouteTime({
            origin,
            destination: destinationPoint,
            mode,
          })

          routeSummary = timeResult

          routePath = timeResult.encodedPolyline
            ? decodePolyline(timeResult.encodedPolyline)
            : (timeResult.steps || [])
                .map((step) => step.encodedPolyline)
                .filter(Boolean)
                .flatMap((encodedPath) => decodePolyline(encodedPath))
        }

        const durationMinutes = routeSummary?.duration
          ? Math.round(routeSummary.duration / 60)
          : null

        const routeResult = {
          userid: member.userid,
          guestid: member.guestid,
          nickname,
          mode,
          duration: routeSummary?.duration ?? null,
          distance: routeSummary?.distance ?? null,
          durationMinutes,
          distanceKm: routeSummary?.distance
            ? (routeSummary.distance / 1000).toFixed(1)
            : null,
        }

        if (durationMinutes !== null) {
          await maybeSendArrivalNotifications({
            member,
            nickname,
            durationMinutes,
            distance: routeSummary?.distance,
          })
        }

        if (routePath.length > 0) {
          routePaths.push({
            userid: member.userid,
            guestid: member.guestid,
            nickname,
            mode,
            path: routePath,
          })
        } else if (durationMinutes === null) {
          routeResult.error = '경로 검색 불가'
        }

        routeResults.push(routeResult)
      } catch (error) {
        const nickname = getMemberNickname(member)
        const mode = normalizeTransportMode(member.transportmode)

        console.error(`${nickname} 경로 계산 오류:`, error)

        routeResults.push({
          userid: member.userid,
          guestid: member.guestid,
          nickname,
          mode: mode || null,
          duration: null,
          distance: null,
          durationMinutes: null,
          distanceKm: null,
          error: '경로 검색 불가',
        })
      }
    }

    setMemberRouteResults(routeResults)
    setMemberRoutePaths(routePaths)

    if (routeResults.some((result) => result.error)) {
      return
    }
  }

  const getCarRoutePath = async ({ origin, destination }) => {
    const apiBaseUrl = (
      process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api'
    ).replace(/\/$/, '')
    const url = `${apiBaseUrl}/kakao/route`
    const requestBody = {
      origin,
      destination,
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const responseBody = await readRouteResponseBody(response)

        console.error('[Kakao Route API] 자동차 경로선 계산 실패', {
          url,
          status: response.status,
          statusText: response.statusText,
          requestBody,
          responseBody,
        })
        return null
      }

      const data = await response.json()

      if (!Array.isArray(data?.path)) {
        console.warn('[Kakao Route API] 자동차 경로선 응답 형식 확인 필요', {
          url,
          requestBody,
          responseBody: data,
        })
      }

      return data
    } catch (error) {
      console.error('[Kakao Route API] 자동차 경로선 서버 연결 실패', {
        url,
        requestBody,
        error,
      })
      return null
    }
  }

  const handleSelectMiddlePlace = async (place) => {
    const scheduleLocation = toScheduleLocation(place, currentRoomId)

    if (isPlaceholderPlaceName(scheduleLocation.placename)) {
      scheduleLocation.placename = scheduleLocation.placeaddress || '이름 없는 장소'
    }

    // 만약 선택된 일정이 없으면, 일정을 선택하거나 새로 만들도록 모달을 띄움
    if (!selectedScheduleId) {
      setPendingMiddleLocation(scheduleLocation)
      return
    }

    try {
      const updatedSchedule = await applyConfirmedLocationToSchedule(
        selectedScheduleId,
        scheduleLocation,
        true
      )
      
      const confirmedPlace = {
        ...place,
        name: scheduleLocation.placename,
        address: scheduleLocation.placeaddress || '',
        lat: scheduleLocation.placelat,
        lng: scheduleLocation.placelng,
        kakaoMapUrl: place.kakaoMapUrl || place.kakaomapurl || '',
        id: `schedule-${selectedScheduleId}`,
        isConfirmedMiddlePlace: true,
        scheduleid: selectedScheduleId,
      }

      if (confirmedPlace.kakaoMapUrl) {
        setConfirmedSchedulePlaceLinks((links) => ({
          ...links,
          [selectedScheduleId]: confirmedPlace.kakaoMapUrl,
        }))
      }

      setMiddlePlace(confirmedPlace)
      setSelectedPlace(confirmedPlace)
      setDestination(confirmedPlace)
      setPlaces([confirmedPlace])
      setHasMiddleRecommendationResults(false)
      setMemberRouteResults([])
      setMemberRoutePaths([])
      
      const schedules = await getRoomConfirmedSchedules(currentRoomId)
      const nextSchedules = replaceScheduleInList(schedules, updatedSchedule)
      setRoomConfirmedSchedules(nextSchedules)
      
      // 날짜가 없는 일정인 경우 날짜 설정 유도 모달 표시
      const targetSchedule = nextSchedules.find(
        (schedule) => Number(schedule.id) === Number(selectedScheduleId)
      )
      if (targetSchedule && !targetSchedule.date) {
        setCreatedLocationOnlySchedule(targetSchedule)
      }

      setMessage(`${targetSchedule?.title || '일정'}의 만날 장소로 저장했어요.`)
      await calculateAllMemberRoutesToMiddlePlace(confirmedPlace)

    } catch (error) {
      console.error('중간 장소 확정 저장 오류:', error)
      setMessage('중간 장소 확정 중 오류가 발생했습니다.')
    }
  }

  const handleApplyMiddlePlaceToSchedule = async (scheduleId) => {
    if (!pendingMiddleLocation) return

    try {
      await applyConfirmedLocationToSchedule(scheduleId, pendingMiddleLocation, true)
      
      const schedules = await getRoomConfirmedSchedules(currentRoomId)
      setRoomConfirmedSchedules(schedules)
      setSelectedScheduleId(scheduleId)
      
      const targetSchedule = schedules.find(
        (schedule) => Number(schedule.id) === Number(scheduleId)
      )
      
      // 만날 장소로 즉시 반영
      const confirmedPlace = {
        name: pendingMiddleLocation.placename,
        address: pendingMiddleLocation.placeaddress,
        lat: pendingMiddleLocation.placelat,
        lng: pendingMiddleLocation.placelng,
        id: `schedule-${scheduleId}`,
        isConfirmedMiddlePlace: true,
        scheduleid: scheduleId,
      }

      setMiddlePlace(confirmedPlace)
      setSelectedPlace(confirmedPlace)
      setDestination(confirmedPlace)
      setPlaces([confirmedPlace])
      setHasMiddleRecommendationResults(false)
      
      setPendingMiddleLocation(null)
      setAppointmentTitle('')
      
      if (targetSchedule && !targetSchedule.date) {
        setCreatedLocationOnlySchedule(targetSchedule)
      }
      
      setMessage('선택한 일정에 만날 장소를 저장했습니다.')
      await calculateAllMemberRoutesToMiddlePlace(confirmedPlace)
    } catch (error) {
      setMessage(`일정 장소 저장 실패: ${error.message}`)
    }
  }

  const handleCreateScheduleFromMiddlePlace = async () => {
    if (!appointmentTitle.trim()) {
      alert('일정 이름을 입력해주세요.')
      return
    }

    try {
      // API 수정됨: applyConfirmedLocationToSchedule를 내부에서 호출함
      const schedule = await createLocationOnlyConfirmedSchedule(
        pendingMiddleLocation,
        true,
        appointmentTitle
      )
      
      setPendingMiddleLocation(null)
      setAppointmentTitle('')
      
      const schedules = await getRoomConfirmedSchedules(currentRoomId)
      setRoomConfirmedSchedules(schedules)
      setSelectedScheduleId(schedule.id)
      
      // 즉시 UI 반영
      const confirmedPlace = {
        name: schedule.location,
        address: schedule.locationaddress,
        lat: Number(schedule.locationlat),
        lng: Number(schedule.locationlng),
        id: `schedule-${schedule.id}`,
        isConfirmedMiddlePlace: true,
        scheduleid: schedule.id,
      }
      
      setMiddlePlace(confirmedPlace)
      setSelectedPlace(confirmedPlace)
      setDestination(confirmedPlace)
      setPlaces([confirmedPlace])
      setHasMiddleRecommendationResults(false)

      setCreatedLocationOnlySchedule({
        ...schedule,
        isLocationOnly: true,
      })
      
      await calculateAllMemberRoutesToMiddlePlace(confirmedPlace)
    } catch (error) {
      setMessage(`일정 생성 실패: ${error.message}`)
    }
  }

  const handleSetMeetingPlace = async (place) => {
    if (!currentRoomId) {
      setMessage('방 정보를 찾을 수 없어 만날 장소를 설정할 수 없습니다.')
      return
    }

    if (!selectedScheduleId) {
      setMessage('먼저 새 일정을 만들거나 기존 일정을 선택해 주세요.')
      return
    }

    setPendingMeetingPlaceConfirm({
      ...place,
      name: place.name || '이름 없는 장소',
      address: place.address || '',
    })
  }

  const handleConfirmMeetingPlace = async () => {
    if (!pendingMeetingPlaceConfirm) return

    const place = pendingMeetingPlaceConfirm
    setPendingMeetingPlaceConfirm(null)
    await handleSelectMiddlePlace(place)
  }

  const handleOpenCreatedSchedule = () => {
    if (!createdLocationOnlySchedule) return

    navigate('/confirmed-schedule', {
      state: {
        schedule: {
          ...createdLocationOnlySchedule,
          roomid: currentRoomId,
          isLocationOnly: true,
        },
      },
    })
  }

  const handleCreateMiddlePlaceVote = (selectedPlaces) => {
    if (!currentRoomId) {
      setMessage('방 정보를 찾을 수 없어 중간 장소 투표를 만들 수 없습니다.')
      return
    }

    if (!selectedPlaces || selectedPlaces.length === 0) {
      setMessage('투표로 만들 중간 장소를 1개 이상 선택해주세요.')
      return
    }

    if (!selectedScheduleId) {
      setMessage('먼저 새 일정을 만들거나 기존 일정을 선택해 주세요.')
      return
    }

    const votePlaces = selectedPlaces.map((place) => ({
      id: place.id || null,
      name: place.name || '이름 없는 장소',
      address: place.address || '',
      category: place.category || '',
      lat: place.lat,
      lng: place.lng,
      kakaomapurl: place.kakaomapurl || place.kakaoMapUrl || null,
      kakaoMapUrl: place.kakaoMapUrl || place.kakaomapurl || null,
      timeGap: place.timeGap || 0,
      travelResults: place.travelResults || [],
    }))

    navigate(`/rooms/${currentRoomId}/vote-create`, {
      state: {
        voteType: 'place',
        votePurpose: 'location',
        votetype: 'location',
        locationKind: 'middle',
        selectedPlaces: votePlaces,
        title: '중간 장소 투표',
        returnTab: 'location',
        scheduleId: selectedScheduleId,
        scheduleTitle: selectedSchedule?.title || '',
      },
    })
  }

  const handleCreateAdditionalPlaceVote = (selectedPlaces) => {
    if (!currentRoomId) {
      setMessage('방 정보를 찾을 수 없어 주변 장소 투표를 만들 수 없습니다.')
      return
    }

    if (!selectedPlaces || selectedPlaces.length === 0) {
      setMessage('투표로 만들 주변 장소를 1개 이상 선택해주세요.')
      return
    }

    if (!selectedScheduleId) {
      setMessage('먼저 새 일정을 만들거나 기존 일정을 선택해 주세요.')
      return
    }

    const votePlaces = selectedPlaces.map((place) => ({
      id: place.id || null,
      name: place.name || '이름 없는 장소',
      address: place.address || '',
      lat: place.lat,
      lng: place.lng,
      kakaomapurl: place.kakaomapurl || place.kakaoMapUrl || null,
      kakaoMapUrl: place.kakaoMapUrl || place.kakaomapurl || null,
    }))

    navigate(`/rooms/${currentRoomId}/vote-create`, {
      state: {
        voteType: 'place',
        votePurpose: 'location',
        votetype: 'location',
        locationKind: 'additional',
        selectedPlaces: votePlaces,
        title: '주변 장소 투표',
        returnTab: 'location',
        scheduleId: selectedScheduleId,
        scheduleTitle: selectedSchedule?.title || '',
      },
    })
  }

  const handleCancelMiddlePlace = () => {
    if (!activeMeetingPlace) {
      setMessage('취소할 중간 장소가 없습니다.')
      return
    }

    setShowCancelMiddlePlaceConfirm(true)
  }

  const handleConfirmCancelMiddlePlace = async () => {
    setShowCancelMiddlePlaceConfirm(false)
    try {
      if (selectedScheduleId) {
        const clearedSchedule = await clearConfirmedScheduleLocation(selectedScheduleId)
        setRoomConfirmedSchedules((schedules) =>
          replaceScheduleInList(schedules, clearedSchedule)
        )
        setConfirmedSchedulePlaceLinks((links) => {
          const nextLinks = { ...links }
          delete nextLinks[selectedScheduleId]
          return nextLinks
        })
        const schedules = await getRoomConfirmedSchedules(currentRoomId)
        setRoomConfirmedSchedules(replaceScheduleInList(schedules, clearedSchedule))
      } else {
        await deleteRoomMiddlePlace(currentRoomId)
      }

      setMiddlePlace(null)
      setSelectedPlace(null)
      setDestination(null)
      setPlaces([])
      setHasMiddleRecommendationResults(false)
      setMemberRouteResults([])
      setMemberRoutePaths([])

      setMessage('중간 장소 확정을 취소했습니다.\n다시 중간 장소를 추천받을 수 있습니다.')
    } catch (error) {
      console.error('중간 장소 확정 취소 오류:', error)
      setMessage('중간 장소 확정 취소 중 오류가 발생했습니다.')
    }
  }

  const handleSelectPlace = (place) => {
    setSelectedPlace(place)
    setDestination(place)
  }

  const handleCreateDraftSchedule = async () => {
    if (!newScheduleTitle.trim()) {
      setNewScheduleTitleError('일정 이름을 입력해 주세요.')
      return
    }

    try {
      const schedule = await createDraftConfirmedSchedule(
        currentRoomId,
        newScheduleTitle
      )
      setRoomConfirmedSchedules(await getRoomConfirmedSchedules(currentRoomId))
      setSelectedScheduleId(schedule.id)
      setNewScheduleTitle('')
      setNewScheduleTitleError('')
      setShowNewScheduleModal(false)
      setCreatedLocationOnlySchedule({
        ...schedule,
        isLocationOnly: true,
      })
      setMessage(`${schedule.title} 일정을 만들었어요. 이제 만날 장소를 정해 주세요.`)
    } catch (error) {
      setNewScheduleTitleError(error.message)
    }
  }

  const isFriendPanelOpen = activeMapPanel === 'friends'
  const mapCurrentLocation = isFriendPanelOpen ? null : currentLocation
  const isAnyMemberTracking = registeredMemberLocations.some(
    (location) => location.isdeparted && !location.arrivedat
  )
  const shouldShowMemberRoutesOnMap = isFriendPanelOpen || isTracking || isAnyMemberTracking
  const mapMemberLocations = shouldShowMemberRoutesOnMap ? registeredMemberLocations : []
  const mapMemberRoutePaths = shouldShowMemberRoutesOnMap ? memberRoutePaths : []
  const mapMemberRouteResults = shouldShowMemberRoutesOnMap ? memberRouteResults : []
  const mapMemberLocationLabels = shouldShowMemberRoutesOnMap ? memberLocationLabels : {}
  const registeredMemberCount = members.filter(isMemberLocationRegistered).length
  const hasMoreFriendMembers = members.length > FRIEND_LOCATION_PREVIEW_COUNT
  const displayedFriendMembers = showFriendMemberListOnly
    ? members
    : members.slice(0, FRIEND_LOCATION_PREVIEW_COUNT)
  const myLocationStatusLabel = getLocationStatusLabel(myLocationRecord)
  const routeAutoRecalculateSignature = [
    selectedScheduleId || '',
    activeMeetingPlace?.lat || '',
    activeMeetingPlace?.lng || '',
    registeredMemberLocations
      .map((location) => [
        location.userid || '',
        location.guestid || '',
        location.latitude || '',
        location.longitude || '',
        location.transportmode || '',
        location.isdeparted ? 'departed' : '',
        location.arrivedat || '',
        location.locationstatus || '',
        location.lastlocationupdatedat || '',
      ].join(':'))
      .sort()
      .join('|'),
  ].join('::')
  const memberLocationLabelSignature = registeredMemberLocations
    .map((location) => [
      location.userid || '',
      location.guestid || '',
      location.latitude || '',
      location.longitude || '',
      getRegisteredLocationLabel(location),
    ].join(':'))
    .sort()
    .join('|')
  const defaultMapCenter = getDefaultMapCenter({
    middlePlace: activeMeetingPlace,
    myLocationRecord,
  })

  const openFriendsPanel = () => {
    setActiveMapPanel('friends')
    setShowFriendMemberListOnly(false)
    setHasSearchResultsSheet(false)
    setSheetSnap('collapsed')
    setFriendSheetTop(null)
    setFriendMapFitRequest((request) => request + 1)
    if (activeMeetingPlace) calculateAllMemberRoutesToMiddlePlace(activeMeetingPlace)
  }

  const closeFriendsPanel = () => {
    setActiveMapPanel('default')
    setShowFriendMemberListOnly(false)
    setSheetSnap('collapsed')
    setFriendSheetTop(null)
    setMapCenterLevel(5)
    setMapCenterRequest((request) => request + 1)
  }

  const handleCloseFriendsPanel = (event) => {
    if (event?.button !== undefined && event.button !== 0) return
    event?.preventDefault()
    event?.stopPropagation()
    sheetDragStartRef.current = null
    setSheetDragOffset(0)
    closeFriendsPanel()
  }

  const handleOpenFriendMemberListOnly = () => {
    setShowFriendMemberListOnly(true)
    setSheetSnap('expanded')
    setFriendSheetTop(FRIEND_SHEET_MIN_TOP)
  }

  const handleCloseFriendMemberListOnly = (event) => {
    if (event?.button !== undefined && event.button !== 0) return
    event?.preventDefault()
    event?.stopPropagation()
    sheetDragStartRef.current = null
    setSheetDragOffset(0)
    setShowFriendMemberListOnly(false)
    setSheetSnap('expanded')
  }

  const getFriendSheetDragBounds = (sheetElement) => {
    const sheet =
      sheetElement.closest?.('.map-bottom-sheet') || sheetElement
    const containerRect = sheet.parentElement?.getBoundingClientRect()
    const sheetRect = sheet.getBoundingClientRect()

    if (!containerRect) return null

    return {
      currentTop: sheetRect.top - containerRect.top,
      minTop: FRIEND_SHEET_MIN_TOP,
      collapsedTop: Math.max(
        FRIEND_SHEET_MIN_TOP,
        containerRect.height - FRIEND_SHEET_COLLAPSED_HEIGHT
      ),
      maxTop: Math.max(
        FRIEND_SHEET_MIN_TOP,
        containerRect.height - FRIEND_SHEET_BOTTOM_VISIBLE_HEIGHT
      ),
      hiddenTop: Math.max(FRIEND_SHEET_MIN_TOP, containerRect.height - 54),
    }
  }

  const toggleSheetSnap = () => {
    setSheetSnap((current) => (current === 'expanded' ? 'collapsed' : 'expanded'))
  }

  const getSheetCssNumber = (sheetElement, propertyName, fallback) => {
    const value = Number.parseFloat(
      window.getComputedStyle(sheetElement).getPropertyValue(propertyName)
    )

    return Number.isFinite(value) ? value : fallback
  }

  const getSheetDragMetrics = (sheetElement) => {
    const sheet =
      sheetElement.closest?.('.map-bottom-sheet') || sheetElement
    const sheetHeight = sheet.getBoundingClientRect().height
    const collapsedVisibleHeight = getSheetCssNumber(sheet, '--sheet-collapsed-height', 92)
    const collapsedOffset = Math.max(0, sheetHeight - collapsedVisibleHeight)
    const hiddenOffset = Math.max(
      collapsedOffset,
      sheetHeight - SHEET_HIDDEN_VISIBLE_HEIGHT
    )
    const currentOffset =
      sheetSnap === 'expanded'
        ? 0
        : sheetSnap === 'hidden'
          ? hiddenOffset
          : sheetSnap === 'custom'
            ? Math.max(0, Math.min(hiddenOffset, sheetFreeOffset))
            : collapsedOffset

    return {
      currentOffset,
      collapsedOffset,
      hiddenOffset,
    }
  }

  const handleSheetPointerDown = (event) => {
    if (event.button !== undefined && event.button !== 0) return
    if (isInteractiveSheetTarget(event.target)) return

    const sheetRect = event.currentTarget.getBoundingClientRect()
    const dragZoneHeight = sheetSnap === 'expanded' ? 140 : 170

    if (event.clientY - sheetRect.top > dragZoneHeight) return

    const friendSheetBounds = isFriendPanelOpen
      ? getFriendSheetDragBounds(event.currentTarget)
      : null
    const sheetDragMetrics = friendSheetBounds
      ? null
      : getSheetDragMetrics(event.currentTarget)

    sheetDragStartRef.current = {
      y: event.clientY,
      snap: sheetSnap,
      ...(friendSheetBounds
        ? {
            mode: 'friend-sheet',
            top: friendSheetBounds.currentTop,
            minTop: friendSheetBounds.minTop,
            collapsedTop: friendSheetBounds.collapsedTop,
            maxTop: friendSheetBounds.maxTop,
            hiddenTop: friendSheetBounds.hiddenTop,
          }
        : sheetDragMetrics
          ? {
              offset: sheetDragMetrics.currentOffset,
              collapsedOffset: sheetDragMetrics.collapsedOffset,
              hiddenOffset: sheetDragMetrics.hiddenOffset,
            }
        : {}),
    }

    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const handleSheetPointerMove = (event) => {
    const start = sheetDragStartRef.current
    if (!start) return

    const deltaY = event.clientY - start.y

    if (start.mode === 'friend-sheet') {
      if (Math.abs(deltaY) < 6) return

      const nextTop = Math.max(start.minTop, Math.min(start.hiddenTop, start.top + deltaY))
      setSheetSnap('expanded')
      setFriendSheetTop(nextTop)
      return
    }

    const nextOffset = Math.max(
      0,
      Math.min(start.hiddenOffset, start.offset + deltaY)
    )

    setSheetDragOffset(nextOffset - start.offset)
  }

  const handleSheetPointerUp = (event) => {
    const start = sheetDragStartRef.current
    sheetDragStartRef.current = null
    setSheetDragOffset(0)

    event.currentTarget.releasePointerCapture?.(event.pointerId)

    if (!start) return

    const deltaY = event.clientY - start.y

    if (start.mode === 'friend-sheet') {
      const nextTop = Math.max(start.minTop, Math.min(start.hiddenTop, start.top + deltaY))

      if (Math.abs(deltaY) < 8) {
        setFriendSheetTop(null)
        setSheetSnap(start.snap === 'expanded' ? 'collapsed' : 'expanded')
        return
      }

      if (nextTop <= start.minTop + FRIEND_SHEET_TOP_SNAP_DISTANCE) {
        setFriendSheetTop(start.minTop)
        setSheetSnap('expanded')
        return
      }

      if (nextTop >= start.hiddenTop - FRIEND_SHEET_HIDDEN_SNAP_DISTANCE) {
        setFriendSheetTop(null)
        setSheetSnap('hidden')
        return
      }

      if (
        nextTop >= start.collapsedTop - FRIEND_SHEET_COLLAPSED_SNAP_DISTANCE &&
        nextTop <= start.collapsedTop + FRIEND_SHEET_COLLAPSED_SNAP_DISTANCE
      ) {
        setFriendSheetTop(null)
        setSheetSnap('collapsed')
        return
      }

      setFriendSheetTop(nextTop)
      setSheetSnap('expanded')
      return
    }

    if (Math.abs(deltaY) < 8) {
      toggleSheetSnap()
      return
    }

    const nextOffset = Math.max(
      0,
      Math.min(start.hiddenOffset, start.offset + deltaY)
    )

    if (nextOffset <= SHEET_EXPANDED_SNAP_DISTANCE) {
      setSheetSnap('expanded')
      return
    }

    if (nextOffset >= start.hiddenOffset - SHEET_HIDDEN_SNAP_DISTANCE) {
      setSheetSnap('hidden')
      return
    }

    if (nextOffset >= start.collapsedOffset - SHEET_COLLAPSED_SNAP_DISTANCE) {
      setSheetSnap('collapsed')
      return
    }

    setSheetFreeOffset(nextOffset)
    setSheetSnap('custom')
  }

  const handleSheetPointerCancel = (event) => {
    sheetDragStartRef.current = null
    setSheetDragOffset(0)
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  const sheetDragProps = {
    onPointerDown: handleSheetPointerDown,
    onPointerMove: handleSheetPointerMove,
    onPointerUp: handleSheetPointerUp,
    onPointerCancel: handleSheetPointerCancel,
  }

  const sheetHandleProps = {
    role: 'button',
    tabIndex: 0,
    'aria-label': sheetSnap === 'expanded' ? '패널 내리기' : '패널 올리기',
    onPointerDown: (event) => {
      event.stopPropagation()
      handleSheetPointerDown(event)
    },
    onPointerMove: (event) => {
      event.stopPropagation()
      handleSheetPointerMove(event)
    },
    onPointerUp: (event) => {
      event.stopPropagation()
      handleSheetPointerUp(event)
    },
    onPointerCancel: (event) => {
      event.stopPropagation()
      handleSheetPointerCancel(event)
    },
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        toggleSheetSnap()
      }
    },
  }
  const sheetStyle = {
    '--sheet-drag-offset': `${sheetDragOffset}px`,
    '--sheet-free-offset': `${sheetFreeOffset}px`,
    ...(isFriendPanelOpen && friendSheetTop !== null
      ? { '--friend-sheet-top': `${friendSheetTop}px` }
      : {}),
  }

  useEffect(() => {
    if (!isFriendPanelOpen || !activeMeetingPlace || registeredMemberLocations.length === 0) return

    const timeoutId = setTimeout(() => {
      calculateAllMemberRoutesToMiddlePlace(activeMeetingPlace, { silent: true })
    }, 250)

    return () => {
      clearTimeout(timeoutId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFriendPanelOpen, routeAutoRecalculateSignature])

  useEffect(() => {
    if (!isFriendPanelOpen || registeredMemberLocations.length === 0) return

    let isCancelled = false
    const geocoder =
      window.kakao?.maps?.services
        ? new window.kakao.maps.services.Geocoder()
        : null

    const getCoordinateLabel = (location) => {
      const lat = Number(location.latitude)
      const lng = Number(location.longitude)

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return '좌표 정보 없음'
      }

      return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
    }

    const resolveLocationLabel = (location) =>
      new Promise((resolve) => {
        const savedLabel = getRegisteredLocationLabel(location)

        if (savedLabel) {
          resolve(savedLabel)
          return
        }

        const lat = Number(location.latitude)
        const lng = Number(location.longitude)

        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !geocoder) {
          resolve(getCoordinateLabel(location))
          return
        }

        geocoder.coord2Address(lng, lat, (result, status) => {
          if (status === window.kakao.maps.services.Status.OK) {
            const road = result?.[0]?.road_address?.address_name || ''
            const jibun = result?.[0]?.address?.address_name || ''
            resolve(road || jibun || getCoordinateLabel(location))
            return
          }

          resolve(getCoordinateLabel(location))
        })
      })

    Promise.all(
      registeredMemberLocations.map(async (location) => [
        location.userid || location.guestid || location.id,
        await resolveLocationLabel(location),
      ])
    ).then((entries) => {
      if (isCancelled) return
      setMemberLocationLabels(Object.fromEntries(entries))
    })

    return () => {
      isCancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFriendPanelOpen, memberLocationLabelSignature])

  useEffect(() => {
    if (isFriendPanelOpen || !selectedScheduleId) return

    const centerKey = [
      selectedScheduleId,
      defaultMapCenter.lat,
      defaultMapCenter.lng,
      activeMeetingPlace?.lat ? 'meeting' : 'fallback',
    ].join(':')

    if (lastDefaultCenterKeyRef.current === centerKey) return

    lastDefaultCenterKeyRef.current = centerKey
    setMapCenterLevel(4)
    setMapCenterRequest((request) => request + 1)
  }, [
    defaultMapCenter.lat,
    defaultMapCenter.lng,
    isFriendPanelOpen,
    activeMeetingPlace?.lat,
    selectedScheduleId,
  ])

  return (
    <section className="map-section">
      {message && (
        <div className="map-toast-message" role="status" aria-live="polite">
          {message}
        </div>
      )}

      {/* 상단 일정 선택 스위처 */}
      <div className="location-top-selector" style={{ 
        padding: '16px', 
        backgroundColor: 'var(--card-bg)', 
        borderRadius: '16px', 
        marginBottom: '16px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
        border: '1px solid var(--border-color)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>📍 일정별 위치 및 경로</h3>
          <button
            type="button"
            onClick={() => setShowNewScheduleModal(true)}
            style={{ 
              padding: '6px 12px', 
              fontSize: '13px', 
              backgroundColor: '#7c79ff', 
              color: 'white', 
              border: 'none', 
              borderRadius: '8px',
              cursor: 'pointer'
            }}
          >
            + 새 일정
          </button>
        </div>

        {roomConfirmedSchedules.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '12px', color: 'var(--secondary-text)', fontSize: '14px' }}>
            아직 확정된 일정이 없습니다.<br/>
            장소를 검색해 일정을 만들거나 투표를 진행해 보세요!
          </div>
        ) : (
          <div className="location-schedule-chip-row" style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
            {roomConfirmedSchedules.map((schedule) => (
              <button
                key={schedule.id}
                draggable={false}
                onClick={() => {
                  setSelectedScheduleId(schedule.id)
                  setMiddlePlace(null)
                  setSelectedPlace(null)
                  setDestination(null)
                  setPlaces([])
                  setMemberRouteResults([])
                  setMemberRoutePaths([])
                  setHasSearchResultsSheet(false)
                  setHasMiddleRecommendationResults(false)
                  setActiveMapPanel('default')
                  setMapCenterLevel(4)
                  setMapCenterRequest((request) => request + 1)
                }}
                style={{
                  padding: '8px 16px',
                  borderRadius: '20px',
                  border: selectedScheduleId === schedule.id ? 'none' : '1px solid var(--border-color)',
                  backgroundColor: selectedScheduleId === schedule.id ? '#7c79ff' : 'var(--bg-color)',
                  color: selectedScheduleId === schedule.id ? 'white' : 'var(--text-color)',
                  fontSize: '14px',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                {schedule.title || '제목 없음'}
              </button>
            ))}
          </div>
        )}
      </div>

      {showNewScheduleModal && (
        <div className="transport-mode-overlay">
          <div className="transport-mode-dialog" style={{ borderRadius: '20px', padding: '24px' }}>
            <h3 style={{ marginTop: 0 }}>새 일정 만들기</h3>
            <p style={{ color: 'var(--secondary-text)', fontSize: '13px', marginBottom: '20px' }}>
              일정 이름을 입력하면 바로 장소와 날짜를 정할 수 있어요.
            </p>
            <input
              className="location-schedule-input"
              value={newScheduleTitle}
              onChange={(event) => {
                setNewScheduleTitle(event.target.value)
                setNewScheduleTitleError('')
              }}
              placeholder="예: 강남역 번개, 주말 회식..."
              style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid var(--border-color)', marginBottom: '8px', boxSizing: 'border-box' }}
            />
            {newScheduleTitleError && (
              <p style={{ color: '#ef4444', fontSize: '12px', margin: '0 0 16px' }}>{newScheduleTitleError}</p>
            )}
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <button
                type="button"
                onClick={() => {
                  setShowNewScheduleModal(false)
                  setNewScheduleTitleError('')
                }}
                style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-color)', color: 'var(--text-color)', cursor: 'pointer' }}
              >
                취소
              </button>
              <button 
                type="button" 
                onClick={handleCreateDraftSchedule}
                style={{ flex: 1, padding: '12px', borderRadius: '10px', border: 'none', backgroundColor: '#7c79ff', color: 'white', fontWeight: 'bold', cursor: 'pointer' }}
              >
                만들기
              </button>
            </div>
          </div>
        </div>
      )}

      {transportModePrompt && (
        <div className="transport-mode-overlay">
          <div className="transport-mode-dialog" style={{ borderRadius: '20px', padding: '24px', textAlign: 'center' }}>
            <h3 style={{ marginTop: 0 }}>🚗 이동수단 선택</h3>
            <p style={{ color: 'var(--secondary-text)', fontSize: '13px', marginBottom: '20px' }}>
              정확한 도착 시간 계산을 위해<br />이동수단을 선택해 주세요.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                type="button"
                onClick={() => handleSelectTransportMode('car')}
                style={{ 
                  padding: '14px', 
                  borderRadius: '12px', 
                  border: '1px solid var(--border-color)', 
                  backgroundColor: 'white', 
                  color: 'var(--text-color)', 
                  fontWeight: 'bold',
                  fontSize: '15px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px'
                }}
              >
                🚗 자동차
              </button>
              <button
                type="button"
                onClick={() => handleSelectTransportMode('transit')}
                style={{ 
                  padding: '14px', 
                  borderRadius: '12px', 
                  border: '1px solid var(--border-color)', 
                  backgroundColor: 'white', 
                  color: 'var(--text-color)', 
                  fontWeight: 'bold',
                  fontSize: '15px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px'
                }}
              >
                🚌 대중교통
              </button>
              <button
                type="button"
                onClick={() => setTransportModePrompt(null)}
                style={{ 
                  marginTop: '10px',
                  padding: '10px', 
                  backgroundColor: 'transparent', 
                  color: 'var(--secondary-text)', 
                  border: 'none',
                  fontSize: '13px',
                  cursor: 'pointer',
                  textDecoration: 'underline'
                }}
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {showCancelDepartureConfirm && (
        <div className="transport-mode-overlay">
          <div className="departure-cancel-dialog">
            <h3>출발을 취소할까요?</h3>
            <p>취소하면 내 상태가 미출발로 바뀌고 위치 자동 갱신이 멈춰요.</p>
            <div className="departure-cancel-actions">
              <button
                type="button"
                onClick={() => setShowCancelDepartureConfirm(false)}
              >
                계속 출발
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCancelDepartureConfirm(false)
                  handleCancelDeparture()
                }}
              >
                출발 취소
              </button>
            </div>
          </div>
        </div>
      )}

      {showCancelMiddlePlaceConfirm && (
        <div className="transport-mode-overlay">
          <div className="departure-cancel-dialog">
            <h3>중간 장소 확정 취소</h3>
            <p>
              확정된 중간 장소를 취소할까요?<br />
              다시 중간 장소를 추천받을 수 있습니다.
            </p>
            <div className="departure-cancel-actions">
              <button
                type="button"
                onClick={() => setShowCancelMiddlePlaceConfirm(false)}
              >
                유지
              </button>
              <button type="button" onClick={handleConfirmCancelMiddlePlace}>
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingMeetingPlaceConfirm && (
        <div className="transport-mode-overlay">
          <div className="departure-cancel-dialog">
            <h3>만날 장소 등록</h3>
            <p>
              {selectedSchedule?.title || '선택한 일정'}에 해당 장소를 등록하시겠습니까?
            </p>
            <strong style={{ display: 'block', marginBottom: '14px' }}>
              {pendingMeetingPlaceConfirm.name}
            </strong>
            <div className="departure-cancel-actions meeting-place-confirm-actions">
              <button type="button" onClick={handleConfirmMeetingPlace}>
                등록
              </button>
              <button
                type="button"
                onClick={() => setPendingMeetingPlaceConfirm(null)}
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingMiddleLocation && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div style={{ width: '320px', padding: '24px', borderRadius: '20px', backgroundColor: 'var(--bg-color)', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }}>
            <h3 style={{ marginBottom: '8px', textAlign: 'center' }}>
              📍 만날 장소 설정
            </h3>
            <p style={{ color: 'var(--secondary-text)', fontSize: '13px', textAlign: 'center', marginBottom: '20px' }}>
              <strong>{pendingMiddleLocation.placename}</strong><br/>
              이 장소를 어떤 일정에 등록할까요?
            </p>

            <div className="location-apply-schedule-list" style={{ maxHeight: '200px', overflowY: 'auto', marginBottom: '20px', paddingRight: '4px' }}>
              {roomConfirmedSchedules.map((schedule) => (
                <button
                  key={schedule.id}
                  type="button"
                  draggable={false}
                  onClick={() => handleApplyMiddlePlaceToSchedule(schedule.id)}
                  style={{
                    width: '100%',
                    padding: '12px',
                    marginBottom: '8px',
                    backgroundColor: 'var(--card-bg)',
                    color: 'var(--text-color)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '12px',
                    fontSize: '14px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <span style={{ fontWeight: '500' }}>{schedule.title || '제목 없음'}</span>
                  <span style={{ fontSize: '12px', color: 'var(--secondary-text)' }}>{schedule.date || '날짜 미정'}</span>
                </button>
              ))}
            </div>

            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
              <p style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: 'bold', color: '#7c79ff' }}>
                + 새로운 일정으로 확정하기
              </p>

              <input
                type="text"
                placeholder="새 일정 이름 (예: 팀 회식...)"
                value={appointmentTitle}
                onChange={(event) => setAppointmentTitle(event.target.value)}
                style={{
                  width: '100%',
                  padding: '12px',
                  fontSize: '14px',
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  boxSizing: 'border-box',
                  marginBottom: '10px',
                  backgroundColor: 'var(--card-bg)',
                  color: 'var(--text-color)'
                }}
              />

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setPendingMiddleLocation(null)}
                  style={{
                    flex: 1,
                    padding: '12px',
                    backgroundColor: 'var(--bg-color)',
                    color: 'var(--text-color)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '10px',
                    fontSize: '14px',
                    cursor: 'pointer',
                  }}
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleCreateScheduleFromMiddlePlace}
                  style={{
                    flex: 2,
                    padding: '12px',
                    backgroundColor: '#7c79ff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '10px',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                  }}
                >
                  일정 생성 및 확정
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {createdLocationOnlySchedule && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div style={{ width: '300px', padding: '24px', borderRadius: '16px', backgroundColor: 'var(--bg-color)', textAlign: 'center' }}>
            <h3 style={{ marginTop: 0 }}>일정을 정하러 가시겠습니까?</h3>
            <p style={{ color: 'var(--secondary-text)', fontSize: '13px' }}>
              일정 이름은 저장되었습니다. 날짜와 시간은 나중에 입력할 수도 있습니다.
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setCreatedLocationOnlySchedule(null)}
                style={{
                  flex: 1,
                  padding: '10px',
                  border: 'none',
                  borderRadius: '8px',
                  backgroundColor: 'var(--btn-bg)',
                  color: 'var(--btn-text)',
                  cursor: 'pointer',
                }}
              >
                나중에 정하기
              </button>
              <button
                type="button"
                onClick={handleOpenCreatedSchedule}
                style={{ flex: 1, padding: '10px', border: 'none', borderRadius: '8px', backgroundColor: '#7c79ff', color: '#fff', cursor: 'pointer' }}
              >
                지금 날짜 정하기
              </button>
            </div>
          </div>
        </div>
      )}

      {showLocationRegisterModal && (
        <div className="transport-mode-overlay">
          <div className="location-register-dialog">
            <div className="map-sheet-handle" />
            <h3>내 위치 등록</h3>
            <p>위치를 등록할 방법을 선택해주세요.</p>

            {!showDepartureLocationPicker ? (
              <div className="location-register-options">
                <button
                  type="button"
                  onClick={async () => {
                    setShowLocationRegisterModal(false)
                    await handleCurrentLocation()
                  }}
                >
                  <span className="location-register-icon"><FaLocationArrow /></span>
                  <span>
                    <strong>현재 위치로 등록</strong>
                    <small>GPS를 이용해 현재 위치를 불러옵니다.</small>
                  </span>
                  <b>›</b>
                </button>
                <button
                  type="button"
                  onClick={() => setShowDepartureLocationPicker(true)}
                >
                  <span className="location-register-icon"><FaKeyboard /></span>
                  <span>
                    <strong>직접 입력해서 등록</strong>
                    <small>장소명이나 주소를 검색해 등록합니다.</small>
                  </span>
                  <b>›</b>
                </button>
              </div>
            ) : (
              <div className="location-register-search">
                <LocationPicker
                  mapHeight="220px"
                  onSelect={handleSelectDepartureLocation}
                />
              </div>
            )}

            <button
              type="button"
              className="location-register-cancel"
              onClick={() => {
                setShowLocationRegisterModal(false)
                setShowDepartureLocationPicker(false)
              }}
            >
              취소
            </button>
          </div>
        </div>
      )}

      {selectedScheduleId && (
        <div className="map-experience">
          <KakaoMapView
            className="map-fullscreen-view"
            height="100%"
            currentLocation={mapCurrentLocation}
            memberLocations={mapMemberLocations}
            places={visibleMapPlaces}
            selectedPlace={selectedPlace}
            destination={destination}
            confirmedMeetingPlace={activeMeetingPlace}
            memberRoutePaths={mapMemberRoutePaths}
            memberRouteResults={mapMemberRouteResults}
            memberLocationLabels={mapMemberLocationLabels}
            fitBoundsRequest={isFriendPanelOpen ? friendMapFitRequest : 0}
            centerRequest={!isFriendPanelOpen ? mapCenterRequest : 0}
            centerLevel={mapCenterLevel}
            preferredCenter={!isFriendPanelOpen ? defaultMapCenter : null}
            onSetMeetingPlace={handleSetMeetingPlace}
          />

          {!isFriendPanelOpen && (
            <div className="map-floating-search">
              <LocationPicker
                allowMapClick={false}
                showMap={false}
                placeholder={
                  activeMeetingPlace
                    ? `${activeMeetingPlace.name || '확정된 중간 장소'}`
                    : '장소 검색 (예: 홍대입구역)'
                }
                onSelect={(name, address, place = {}) => {
                  const selected = {
                    ...place,
                    name,
                    address: address || place.address || '',
                  }

                  setActiveMapPanel('default')
                  handleSelectPlace(selected)
                  setPlaces([selected])
                }}
              />
            </div>
          )}

          {!isFriendPanelOpen && (
            <>
              {activeMeetingPlace ? (
                <PlaceSearchPanel
                  variant="mapOverlay"
                  searchLocation={activeMeetingPlace}
                  onSearchResult={(results) => {
                    setPlaces(results)
                    setActiveMapPanel('default')
                    setSheetSnap('expanded')
                  }}
                  onResultStateChange={setHasSearchResultsSheet}
                  sheetSnap={sheetSnap}
                  sheetStyle={sheetStyle}
                  sheetDragProps={sheetDragProps}
                  sheetHandleProps={sheetHandleProps}
                  onSelectPlace={handleSelectPlace}
                  onSharePlace={handleShareNearbyPlace}
                  onCreateAdditionalPlaceVote={handleCreateAdditionalPlaceVote}
                  onOpenFriends={openFriendsPanel}
                  onCloseResults={() => {
                    setPlaces([])
                    setSheetSnap('collapsed')
                  }}
                />
              ) : (
                null
              )}
            </>
          )}

          {!isFriendPanelOpen && !hasSearchResultsSheet && (
            <div
              className={`map-bottom-sheet map-default-sheet ${
                !activeMeetingPlace ? 'has-middle-recommendation' : ''
              } ${hasMiddleRecommendationResults ? 'has-middle-results' : ''} is-${sheetSnap}`}
              style={sheetStyle}
              {...sheetDragProps}
            >
              <div className="map-sheet-handle" {...sheetHandleProps} />

              {!hasMiddleRecommendationResults && (
                <>
                  <div className="map-sheet-header">
                    <div>
                      <div className="map-sheet-title-row">
                        <strong>{selectedSchedule?.title || '선택한 일정'}</strong>
                        {selectedSchedule?.date && (
                          <small className="map-sheet-date">
                            {formatScheduleDateLabel(selectedSchedule.date)}
                          </small>
                        )}
                      </div>
                      <span>{activeMeetingPlace ? activeMeetingPlace.name : '만날 장소 미정'}</span>
                    </div>
                  </div>

                  <div className="map-quick-actions">
                    <button
                      type="button"
                      onClick={openFriendsPanel}
                    >
                      <span className="map-quick-action-icon is-members" aria-hidden="true">
                        <FaUserFriends />
                      </span>
                      <strong>멤버위치</strong>
                      <span>{registeredMemberCount}/{members.length || 0}</span>
                    </button>
                    <button type="button" onClick={() => setShowLocationRegisterModal(true)}>
                      <span className="map-quick-action-icon is-mine" aria-hidden="true">
                        <FaLocationArrow />
                      </span>
                      <strong>{myLocationRecord?.transportmode ? '내 위치' : '내 위치 등록'}</strong>
                      <span>{myLocationStatusLabel}</span>
                    </button>
                  </div>
                </>
              )}

              {!activeMeetingPlace && (
                <FamousMiddlePlacePanel
                  memberLocations={registeredMemberLocations}
                  onRecommendPlaces={(results) => {
                    setPlaces(results)
                    setSheetSnap(results.length > 0 ? 'expanded' : 'collapsed')
                  }}
                  onResultStateChange={setHasMiddleRecommendationResults}
                  onSelectMiddlePlace={handleSelectMiddlePlace}
                  onCreateMiddlePlaceVote={handleCreateMiddlePlaceVote}
                  onCloseResults={() => {
                    setPlaces([])
                    setSheetSnap('collapsed')
                  }}
                />
              )}

              {activeMeetingPlace && (
                <div className="middle-place-summary">
                  <div>
                    <strong>확정된 만날 장소</strong>
                    <p>{activeMeetingPlace.name}</p>
                  </div>
                  <button type="button" onClick={handleShareMiddlePlace}>
                    채팅 공유
                  </button>
                  <button type="button" onClick={handleCancelMiddlePlace}>
                    취소
                  </button>
                </div>
              )}

            </div>
          )}

          {isFriendPanelOpen && (
            <div
              className={`map-bottom-sheet map-friends-sheet ${
                showFriendMemberListOnly ? 'is-member-list-mode' : ''
              } is-${sheetSnap}`}
              style={sheetStyle}
              {...sheetDragProps}
            >
              <div className="map-sheet-handle" {...sheetHandleProps} />
              {showFriendMemberListOnly ? (
                <>
                  <div className="map-sheet-header map-friends-sheet-header map-member-list-only-header">
                    <button
                      type="button"
                      className="map-sheet-back-button"
                      onClick={handleCloseFriendMemberListOnly}
                      aria-label="멤버위치 요약으로 돌아가기"
                    >
                      <span aria-hidden="true">←</span>
                    </button>
                    <div>
                      <small className="map-sheet-place-label">
                        {activeMeetingPlace?.name || '만날 장소 미정'}
                      </small>
                      <strong>멤버위치</strong>
                      <span>만날 장소까지 이동시간을 확인해요.</span>
                    </div>
                  </div>

                  <section className="friend-location-list is-member-list-only">
                    <div className="friend-list-title">
                      <div>
                        <strong>멤버 위치 현황</strong>
                        <small>만날 장소까지 이동시간을 확인해요.</small>
                      </div>
                      <div className="friend-list-actions">
                        <span>{registeredMemberCount}/{members.length || 0}</span>
                      </div>
                    </div>

                    <div className="friend-location-list-body is-scrollable">
                      {members.map((member) => {
                        const memberLocation = getMemberLocationRecord(member)
                        const routeResult = getMemberRouteResult(member)
                        const statusText = getFriendLocationSummary(memberLocation, routeResult)
                        const currentLocationLabel = memberLocation
                          ? memberLocationLabels[getMemberKey(member)] ||
                            getRegisteredLocationLabel(memberLocation)
                          : ''

                        return (
                          <div className="friend-location-row" key={getMemberKey(member)}>
                            <div className="friend-avatar">👤</div>
                            <div>
                              <strong>{member.nickname || '닉네임 없음'}</strong>
                              {currentLocationLabel && (
                                <span className="friend-current-location">
                                  현재 위치: {currentLocationLabel}
                                </span>
                              )}
                              {statusText && <span>{statusText}</span>}
                            </div>
                            {renderLocationRequestAction(member)}
                          </div>
                        )
                      })}
                    </div>
                  </section>
                </>
              ) : (
                <>
                  <div className="map-sheet-header map-friends-sheet-header">
                    <button
                      type="button"
                      className="map-sheet-back-button"
                      onClick={handleCloseFriendsPanel}
                      aria-label="지도 보기로 돌아가기"
                    >
                      <span aria-hidden="true">←</span>
                    </button>
                    <div>
                      <small className="map-sheet-place-label">
                        {activeMeetingPlace?.name || '만날 장소 미정'}
                      </small>
                      <strong>멤버위치</strong>
                      <span>멤버 위치와 만날 장소까지의 이동 정보를 확인해요.</span>
                    </div>
                  </div>

                  <div className="my-departure-card">
                    <div>
                      <strong>내 출발 상태</strong>
                      <span>{getLocationStatusLabel(myLocationRecord)}</span>
                    </div>
                    {myLocationRecord?.transportmode && (
                      <button type="button" onClick={handleEditTransportMode}>
                        교통수단 수정
                      </button>
                    )}
                  </div>

                  <div className="departure-actions">
                    <button
                      type="button"
                      onClick={handleDepartureButtonClick}
                      disabled={isArrived || !activeMeetingPlace}
                    >
                      {isTracking ? '출발 취소' : '출발하기'}
                    </button>
                    <button type="button" onClick={handleArrive} disabled={!isTracking}>
                      도착
                    </button>
                  </div>

                  <section
                    className={`friend-location-list ${
                      hasMoreFriendMembers ? 'has-more-members' : ''
                    }`}
                  >
                    <div className="friend-list-title">
                      <div>
                        <strong>멤버 위치 현황</strong>
                        <small>만날 장소까지 이동시간을 확인해요.</small>
                      </div>
                      <div className="friend-list-actions">
                        <span>{registeredMemberCount}/{members.length || 0}</span>
                      </div>
                    </div>

                    <div className="friend-location-list-preview">
                      {displayedFriendMembers.map((member) => {
                        const memberLocation = getMemberLocationRecord(member)
                        const routeResult = getMemberRouteResult(member)
                        const statusText = getFriendLocationSummary(memberLocation, routeResult)
                        const currentLocationLabel = memberLocation
                          ? memberLocationLabels[getMemberKey(member)] ||
                            getRegisteredLocationLabel(memberLocation)
                          : ''

                        return (
                          <div className="friend-location-row" key={getMemberKey(member)}>
                            <div className="friend-avatar">👤</div>
                            <div>
                              <strong>{member.nickname || '닉네임 없음'}</strong>
                              {currentLocationLabel && (
                                <span className="friend-current-location">
                                  현재 위치: {currentLocationLabel}
                                </span>
                              )}
                              {statusText && <span>{statusText}</span>}
                            </div>
                            {renderLocationRequestAction(member)}
                          </div>
                        )
                      })}
                    </div>

                    {hasMoreFriendMembers && (
                      <button
                        type="button"
                        className="friend-location-more-button"
                        onClick={handleOpenFriendMemberListOnly}
                      >
                        더보기
                      </button>
                    )}
                  </section>

                </>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function formatScheduleDateLabel(date) {
  if (!date) return ''

  const [year, month, day] = String(date).split('-')
  if (!month || !day) return String(date)

  return year ? `${year}.${month}.${day}` : `${month}.${day}`
}

function toScheduleLocation(place, roomId) {
  return {
    roomid: Number(roomId),
    voteid: place?.voteid ?? null,
    placename:
      place?.placename ||
      place?.name ||
      place?.place_name ||
      place?.location ||
      '이름 없는 장소',
    placeaddress:
      place?.placeaddress ||
      place?.address ||
      place?.road_address_name ||
      place?.locationaddress ||
      null,
    placelat: place?.placelat ?? place?.lat ?? place?.y ?? null,
    placelng: place?.placelng ?? place?.lng ?? place?.x ?? null,
  }
}

function replaceScheduleInList(schedules, updatedSchedule) {
  if (!updatedSchedule?.id) return schedules

  return schedules.map((schedule) =>
    Number(schedule.id) === Number(updatedSchedule.id)
      ? { ...schedule, ...updatedSchedule }
      : schedule
  )
}

function getScheduleMeetingPlace({ schedule, roomId, kakaoMapUrl = '' }) {
  if (!schedule || !isValidMapPoint(schedule.locationlat, schedule.locationlng)) {
    return null
  }

  const placeName = normalizeSchedulePlaceName(schedule.location)
  if (!placeName) return null

  return {
    id: `schedule-${schedule.id}`,
    roomid: roomId,
    name: placeName,
    address: schedule.locationaddress || '',
    lat: Number(schedule.locationlat),
    lng: Number(schedule.locationlng),
    kakaoMapUrl,
    isConfirmedMiddlePlace: true,
    scheduleid: schedule.id,
  }
}

function normalizeSchedulePlaceName(name) {
  const trimmedName = typeof name === 'string' ? name.trim() : ''
  if (!trimmedName) return ''

  return isPlaceholderPlaceName(trimmedName) ? '' : trimmedName
}

function isPlaceholderPlaceName(name) {
  const normalizedName = String(name || '').trim()

  return (
    /^meeting\s*place$/i.test(normalizedName) ||
    /^place$/i.test(normalizedName) ||
    /^만날\s*장소(?:\s*미정)?$/.test(normalizedName)
  )
}

function getVisibleMapPlaces({ places = [], confirmedAdditionalPlaces = [], activeMeetingPlace }) {
  const searchPlaces = places
    .map(toMapPlace)
    .filter((place) => isValidMapPoint(place.lat, place.lng))
    .filter((place) => !isSameMapPoint(place, activeMeetingPlace))

  if (searchPlaces.length > 0) {
    return searchPlaces
  }

  return confirmedAdditionalPlaces
    .map(toMapPlace)
    .filter((place) => isValidMapPoint(place.lat, place.lng))
    .filter((place) => !isSameMapPoint(place, activeMeetingPlace))
}

function toMapPlace(place = {}) {
  return {
    ...place,
    id: place.id || place.placeid || place.kakaoPlaceId || place.placename || place.name,
    name: place.name || place.placename || place.place_name || 'Place',
    address: place.address || place.placeaddress || place.locationaddress || '',
    lat: Number(place.lat ?? place.latitude ?? place.placelat ?? place.locationlat),
    lng: Number(place.lng ?? place.longitude ?? place.placelng ?? place.locationlng),
    kakaoMapUrl: place.kakaoMapUrl || place.kakaomapurl || '',
  }
}

function isSameMapPoint(place, target) {
  if (!place || !target) return false
  if (!isValidMapPoint(place.lat, place.lng) || !isValidMapPoint(target.lat, target.lng)) return false

  return (
    Math.abs(Number(place.lat) - Number(target.lat)) < 0.00001 &&
    Math.abs(Number(place.lng) - Number(target.lng)) < 0.00001
  )
}

function getRegisteredLocationLabel(location) {
  if (!location) return ''

  return (
    location.locationname ||
    location.locationaddress ||
    location.address ||
    location.placename ||
    location.placeaddress ||
    ''
  )
}

async function readRouteResponseBody(response) {
  const contentType = response.headers.get('content-type') || ''

  try {
    if (contentType.includes('application/json')) {
      return await response.json()
    }

    return await response.text()
  } catch (error) {
    return {
      message: '응답 본문을 읽지 못했습니다.',
      error: error.message,
    }
  }
}

function getDefaultMapCenter({ middlePlace, myLocationRecord }) {
  if (isValidMapPoint(middlePlace?.lat, middlePlace?.lng)) {
    return {
      lat: Number(middlePlace.lat),
      lng: Number(middlePlace.lng),
    }
  }

  if (isValidMapPoint(myLocationRecord?.latitude, myLocationRecord?.longitude)) {
    return {
      lat: Number(myLocationRecord.latitude),
      lng: Number(myLocationRecord.longitude),
    }
  }

  return {
    lat: 35.1796,
    lng: 129.0756,
  }
}

function isValidMapPoint(lat, lng) {
  return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
}

function normalizeTransportMode(mode) {
  if (mode === 'car' || mode === '자동차') return 'car'
  if (mode === 'transit' || mode === '대중교통') return 'transit'
  return mode || ''
}

function getLocationStatusLabel(location) {
  if (!location?.transportmode) return '위치 미등록'
  if (location.locationstatus === 'denied') return '위치 권한 거부'
  if (location.locationstatus === 'error') return '위치 갱신 실패'
  if (location.arrivedat || location.locationstatus === 'arrived') return '도착 완료'
  if (location.locationstatus === 'approaching') return '도착 임박'
  if (
    location.isdeparted ||
    location.locationstatus === 'tracking' ||
    location.locationstatus === 'departed'
  ) {
    return '출발함'
  }
  return '출발 전'
}

function getTransportModeLabel(mode) {
  const normalizedMode = String(mode || '').trim()

  if (normalizedMode === 'car') return '\uC790\uB3D9\uCC28'
  if (normalizedMode === 'transit') return '\uB300\uC911\uAD50\uD1B5'
  return mode || ''
}

function getFriendLocationSummary(location, routeResult) {
  {
    if (!location?.transportmode) return '\uC704\uCE58 \uBBF8\uB4F1\uB85D'

    const transportModeLabel = getTransportModeLabel(location.transportmode)
    const withTransportMode = (summary) =>
      [summary, transportModeLabel].filter(Boolean).join(' \u00B7 ')

    if (location.arrivedat || location.locationstatus === 'arrived') {
      return withTransportMode('\uB3C4\uCC29 \uC644\uB8CC')
    }

    const isDeparted =
      location.isdeparted ||
      location.locationstatus === 'tracking' ||
      location.locationstatus === 'departed' ||
      location.locationstatus === 'approaching'

    if (!isDeparted) return withTransportMode('\uBBF8\uCD9C\uBC1C')

    if (routeResult?.error) {
      return withTransportMode('\uACBD\uB85C \uAC80\uC0C9 \uBD88\uAC00')
    }

    if (routeResult?.durationMinutes !== null && routeResult?.durationMinutes !== undefined) {
      const distance = routeResult.distanceKm ? `${routeResult.distanceKm}km` : ''
      const routeSummary = [
        `${routeResult.durationMinutes}\uBD84`,
        distance,
      ].filter(Boolean).join(' \u00B7 ')

      return withTransportMode(routeSummary)
    }

    return transportModeLabel
  }
  if (!location?.transportmode) return '위치 미등록'

  if (location.arrivedat || location.locationstatus === 'arrived') {
    return '도착 완료'
  }

  const isDeparted =
    location.isdeparted ||
    location.locationstatus === 'tracking' ||
    location.locationstatus === 'departed' ||
    location.locationstatus === 'approaching'

  if (!isDeparted) return '미출발'

  if (routeResult?.error) {
    return '경로 검색 불가'
  }

  if (routeResult?.durationMinutes !== null && routeResult?.durationMinutes !== undefined) {
    const distance = routeResult.distanceKm ? ` · ${routeResult.distanceKm}km` : ''
    return `${routeResult.durationMinutes}분${distance}`
  }

  return ''
}

function isInteractiveSheetTarget(target) {
  if (!target || typeof target.closest !== 'function') return false

  return Boolean(
    target.closest(
      'button, input, select, textarea, a, label, [role="button"], .map-results-sheet li'
    )
  )
}

export default MapPage
