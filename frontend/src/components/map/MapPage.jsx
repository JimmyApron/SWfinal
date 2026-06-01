import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

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
  getRoomConfirmedSchedules,
} from '../../api/scheduleApi'

function MapPage({ roomId }) {
  const navigate = useNavigate()
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

  const [message, setMessage] = useState('')
  const [shareToast, setShareToast] = useState('')
  const [locationUpdateError, setLocationUpdateError] = useState('')
  const [pendingMiddleLocation, setPendingMiddleLocation] = useState(null)
  const [roomConfirmedSchedules, setRoomConfirmedSchedules] = useState([])
  const [selectedScheduleId, setSelectedScheduleId] = useState(null)
  const [showNewScheduleModal, setShowNewScheduleModal] = useState(false)
  const [newScheduleTitle, setNewScheduleTitle] = useState('')
  const [newScheduleTitleError, setNewScheduleTitleError] = useState('')
  const [appointmentTitle, setAppointmentTitle] = useState('')
  const [createdLocationOnlySchedule, setCreatedLocationOnlySchedule] = useState(null)
  const [transportModePrompt, setTransportModePrompt] = useState(null)
  const selectedSchedule = roomConfirmedSchedules.find(
    (schedule) => Number(schedule.id) === Number(selectedScheduleId)
  )

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
        setMessage('사용자 정보를 불러오지 못했습니다.')
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
      } catch (error) {
        console.error('실시간 멤버 위치 갱신 오류:', error)
      }
    }, 5000)

    return () => {
      clearInterval(intervalId)
    }
  }, [currentRoomId, selectedScheduleId])

  useEffect(() => {
    if (!isTracking) return

    const intervalId = setInterval(() => {
      updateDepartedLocation()
    }, 30000)

    return () => {
      clearInterval(intervalId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTracking, currentRoomId, currentUserId, currentGuestId, middlePlace, selectedScheduleId])

  useEffect(() => {
    if (!currentRoomId) return
    if (selectedScheduleId) return

    const loadSavedMiddlePlace = async () => {
      try {
        const savedMiddlePlace = await getRoomMiddlePlace(currentRoomId)

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
        setMessage(`${savedMiddlePlace.name}이(가) 중간 장소로 확정되어 있습니다.`)

        await calculateAllMemberRoutesToMiddlePlace(confirmedMiddlePlace)
      } catch (error) {
        console.error('확정 중간 장소 조회 오류:', error)
      }
    }

    loadSavedMiddlePlace()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRoomId, selectedScheduleId])

  useEffect(() => {
    if (!currentRoomId) return

    getRoomConfirmedSchedules(currentRoomId)
      .then((schedules) => {
        setRoomConfirmedSchedules(schedules)
        setSelectedScheduleId((previousId) => {
          if (schedules.some((schedule) => Number(schedule.id) === Number(previousId))) {
            return previousId
          }
          return schedules[0]?.id ?? null
        })
      })
      .catch((error) => {
        console.error('Failed to load confirmed schedules:', error)
      })
  }, [currentRoomId])

  useEffect(() => {
    if (!currentRoomId || !selectedScheduleId) return

    let selectedMiddlePlace = null

    if (
      selectedSchedule &&
      selectedSchedule.locationlat !== null &&
      selectedSchedule.locationlng !== null
    ) {
      selectedMiddlePlace = {
        id: `schedule-${selectedSchedule.id}`,
        roomid: currentRoomId,
        name: selectedSchedule.location || 'Meeting place',
        address: selectedSchedule.locationaddress || '',
        lat: Number(selectedSchedule.locationlat),
        lng: Number(selectedSchedule.locationlng),
        isConfirmedMiddlePlace: true,
        scheduleid: selectedSchedule.id,
      }
    }

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
  }, [currentRoomId, selectedScheduleId, selectedSchedule?.locationlat, selectedSchedule?.locationlng])

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
      setMessage('멤버 위치를 불러오지 못했습니다.')
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
      name: place.name || place.placename || '공유 위치',
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

    if (isShared) {
      setShareToast('현재위치가 채팅에 공유되었습니다!')
      setTimeout(() => setShareToast(''), 2000)
    }
  }

  const handleShareMiddlePlace = async () => {
    if (!middlePlace) {
      setMessage('확정된 중간장소가 없습니다.')
      return
    }

    const isShared = await sendMapShareToChat({
      shareType: 'middle_place',
      place: middlePlace,
    })

    if (isShared) {
      setShareToast('확정된 중간장소가 채팅에 공유되었습니다!')
      setTimeout(() => setShareToast(''), 2000)
    }
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

      setMessage('현재 위치를 가져오는 중입니다.')

      const location = await getCurrentPosition()

      setCurrentLocation(location)
      setTransportModePrompt({ location, isEdit: false })
      setMessage('이동수단을 입력하세요.')
    } catch (error) {
      console.error('현재 위치 저장 오류:', error)
      setMessage('현재 위치를 가져오거나 저장하는 중 오류가 발생했습니다.')
    }
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

      if (middlePlace) {
        await calculateAllMemberRoutesToMiddlePlace(middlePlace)
      }

      setMessage(
        transportModePrompt.isEdit
          ? middlePlace
            ? '이동수단을 수정하고 경로를 다시 계산했습니다.'
            : '이동수단을 수정했습니다.'
          : middlePlace
          ? '현재 위치와 이동수단을 저장하고 경로를 다시 계산했습니다.'
          : '현재 위치와 이동수단을 저장했습니다.'
      )
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

  const updateDepartedLocation = async () => {
    if (!currentRoomId || (!currentUserId && !currentGuestId)) return

    try {
      const location = await getCurrentPosition()

      setCurrentLocation(location)
      setLocationUpdateError('')

      await saveCurrentUserLocation(location, {
        isDeparted: true,
        locationStatus: 'tracking',
        locationError: null,
      })

      await loadMemberLocations()

      if (middlePlace) {
        await calculateAllMemberRoutesToMiddlePlace(middlePlace)
      }
    } catch (error) {
      const nextStatus = error?.code === 1 ? 'denied' : 'error'
      const nextMessage =
        nextStatus === 'denied'
          ? '위치 권한이 거부되어 자동 갱신을 할 수 없습니다.'
          : '위치 자동 갱신에 실패했습니다.'

      console.error('출발 후 위치 자동 갱신 실패:', error)
      setLocationUpdateError(nextMessage)

      await saveCurrentUserLocation(null, {
        isDeparted: true,
        locationStatus: nextStatus,
        locationError: nextMessage,
      })

      await loadMemberLocations()
    }
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

    if (!middlePlace) {
      setMessage('중간위치를 확정해주세요.')
      return
    }

    try {
      setMessage('출발 처리 중입니다. 현재 위치를 확인하고 있어요.')

      const location = await getCurrentPosition()
      const now = new Date().toISOString()

      setCurrentLocation(location)
      setLocationUpdateError('')

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

      if (middlePlace) {
        await calculateAllMemberRoutesToMiddlePlace(middlePlace)
      }

      setMessage('출발했습니다. 30초마다 위치를 자동 갱신합니다.')
    } catch (error) {
      const nextStatus = error?.code === 1 ? 'denied' : 'error'
      const nextMessage =
        nextStatus === 'denied'
          ? '위치 권한이 거부되어 출발 처리를 완료하지 못했습니다.'
          : '현재 위치를 가져오지 못해 출발 처리를 완료하지 못했습니다.'

      console.error('출발 처리 실패:', error)
      setLocationUpdateError(nextMessage)
      setMessage(nextMessage)

      await saveCurrentUserLocation(null, {
        isDeparted: false,
        locationStatus: nextStatus,
        locationError: nextMessage,
      })

      await loadMemberLocations()
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

      if (middlePlace) {
        await calculateAllMemberRoutesToMiddlePlace(middlePlace)
      }

      setMessage('도착 처리되었습니다. 위치 자동 갱신을 멈춥니다.')
    } catch (error) {
      console.error('도착 처리 실패:', error)
      setMessage('도착 처리 중 오류가 발생했습니다.')
    }
  }

  const handleRequestLocation = async (member) => {
    try {
      if (!currentUserId && !currentGuestId) {
        alert('로그인한 사용자만 위치 등록 요청을 보낼 수 있습니다.')
        return
      }

      if (member.guestid) {
        await createGuestNotification({
          roomId: currentRoomId,
          guestId: member.guestid,
          type: 'location_request',
          title: '위치 등록 요청',
          message: '아직 위치를 등록하지 않았습니다. 위치를 등록해주세요!',
          link: `/rooms/${currentRoomId}?tab=location`,
        })
      } else {
        await createNotification({
          roomId: currentRoomId,
          receiverId: member.userid,
          senderId: currentUserId,
          type: 'location_request',
          title: '위치 등록 요청',
          message: '아직 위치를 등록하지 않았습니다. 위치를 등록해주세요!',
          link: `/rooms/${currentRoomId}?tab=location`,
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

  const calculateAllMemberRoutesToMiddlePlace = async (place) => {
    if (!place) {
      setMessage('중간 장소 정보가 없습니다.')
      return
    }

    const latestLocations = await loadMemberLocations()

    if (!latestLocations || latestLocations.length === 0) {
      setMessage('멤버 위치 정보가 없습니다.')
      return
    }

    setMessage('모든 멤버의 경로와 이동시간을 계산하는 중입니다.')

    const routeResults = []
    const routePaths = []

    for (const member of latestLocations) {
      try {
        if (!member.latitude || !member.longitude) {
          continue
        }

        const nickname = getMemberNickname(member)

        const mode = member.transportmode

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

        const timeResult = await getRouteTime({
          origin,
          destination: destinationPoint,
          mode,
        })

        const durationMinutes = Math.round(timeResult.duration / 60)

        routeResults.push({
          userid: member.userid,
          guestid: member.guestid,
          nickname,
          mode,
          duration: timeResult.duration,
          distance: timeResult.distance,
          durationMinutes,
          distanceKm: timeResult.distance
            ? (timeResult.distance / 1000).toFixed(1)
            : null,
        })

        await maybeSendArrivalNotifications({
          member,
          nickname,
          durationMinutes,
          distance: timeResult.distance,
        })

        if (mode === 'car') {
          const pathResult = await getCarRoutePath({
            origin,
            destination: destinationPoint,
          })

          if (pathResult?.path?.length > 0) {
            routePaths.push({
              userid: member.userid,
              guestid: member.guestid,
              nickname,
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
              guestid: member.guestid,
              nickname,
              mode,
              path: decodedPath,
            })
          }
        }
      } catch (error) {
        const nickname = getMemberNickname(member)

        console.error(`${nickname} 경로 계산 오류:`, error)

        routeResults.push({
          userid: member.userid,
          guestid: member.guestid,
          nickname,
          mode: member.transportmode || null,
          duration: null,
          distance: null,
          durationMinutes: null,
          distanceKm: null,
          error: '경로 계산 실패',
        })
      }
    }

    setMemberRouteResults(routeResults)
    setMemberRoutePaths(routePaths)

    if (routeResults.some((result) => result.error)) {
      setMessage('일부 멤버의 경로 계산에 실패했지만 위치 정보는 표시합니다.')
      return
    }

    setMessage('중간 장소까지 모든 멤버의 이동시간과 경로를 계산했습니다.')
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
      console.warn('자동차 경로 API 요청 실패')
      return null
    }

    return response.json()
  }

  const handleSelectMiddlePlace = async (place) => {
    if (!selectedScheduleId) {
      setMessage('먼저 새 일정을 만들거나 기존 일정을 선택해 주세요.')
      return
    }

    try {
      const scheduleLocation = {
        roomid: currentRoomId,
        voteid: null,
        placename: place.name,
        placeaddress: place.address || null,
        placelat: place.lat,
        placelng: place.lng,
      }

      await applyConfirmedLocationToSchedule(selectedScheduleId, scheduleLocation, true)
      const confirmedPlace = {
        ...place,
        id: `schedule-${selectedScheduleId}`,
        isConfirmedMiddlePlace: true,
        scheduleid: selectedScheduleId,
      }

      setMiddlePlace(confirmedPlace)
      setSelectedPlace(confirmedPlace)
      setDestination(confirmedPlace)
      setPlaces([confirmedPlace])
      setMemberRouteResults(confirmedPlace.travelResults || [])
      setMemberRoutePaths([])
      setRoomConfirmedSchedules(await getRoomConfirmedSchedules(currentRoomId))
      if (!selectedSchedule?.date) {
        setCreatedLocationOnlySchedule(selectedSchedule || { id: selectedScheduleId })
      }
      setMessage(`${selectedSchedule?.title || '선택한 일정'}의 만날 위치로 저장했어요.`)
      await calculateAllMemberRoutesToMiddlePlace(confirmedPlace)

      if (false) {
      const savedMiddlePlace = await saveRoomMiddlePlace({
        roomId: currentRoomId,
        place,
        confirmedBy: currentUserId || null,
      })

      const confirmedPlace = {
        ...place,
        id: savedMiddlePlace.id,
        name: savedMiddlePlace.name,
        address: savedMiddlePlace.address,
        lat: savedMiddlePlace.lat,
        lng: savedMiddlePlace.lng,
        isConfirmedMiddlePlace: true,
      }

      setMiddlePlace(confirmedPlace)
      setSelectedPlace(confirmedPlace)
      setDestination(confirmedPlace)
      setPlaces([confirmedPlace])
      setMemberRouteResults(confirmedPlace.travelResults || [])
      setMemberRoutePaths([])
      setMessage(`${confirmedPlace.name}을(를) 중간 장소로 확정했습니다. 멤버별 경로를 계산합니다.`)

      setPendingMiddleLocation({
        roomid: currentRoomId,
        voteid: null,
        placename: confirmedPlace.name,
        placeaddress: confirmedPlace.address || null,
        placelat: confirmedPlace.lat,
        placelng: confirmedPlace.lng,
      })
      setAppointmentTitle('')
      setRoomConfirmedSchedules(await getRoomConfirmedSchedules(currentRoomId))

      try {
        if (currentUserId && currentRoomId) {
          await createRoomNotifications({
            roomId: currentRoomId,
            senderId: currentUserId,
            type: 'middle_place_confirmed',
            title: '중간 장소가 확정되었습니다',
            message: `방에 ${confirmedPlace.name}이(가) 중간 장소로 확정되었습니다.`,
            link: `/rooms/${currentRoomId}?tab=location`,
          })
        }
      } catch (error) {
        console.error('중간 장소 확정 알림 생성 실패:', error)
      }

      await calculateAllMemberRoutesToMiddlePlace(confirmedPlace)
      }
    } catch (error) {
      console.error('중간 장소 확정 저장 오류:', error)
      setMessage('중간 장소 확정 중 오류가 발생했습니다.')
    }
  }

  const handleApplyMiddlePlaceToSchedule = async (scheduleId) => {
    try {
      await applyConfirmedLocationToSchedule(scheduleId, pendingMiddleLocation, true)
      setRoomConfirmedSchedules(await getRoomConfirmedSchedules(currentRoomId))
      setSelectedScheduleId(scheduleId)
      setPendingMiddleLocation(null)
      setAppointmentTitle('')
      setMessage('선택한 일정에 중간 장소를 추가했습니다.')
    } catch (error) {
      setMessage(`일정 위치 저장 실패: ${error.message}`)
    }
  }

  const handleCreateScheduleFromMiddlePlace = async () => {
    if (!appointmentTitle.trim()) {
      alert('일정 이름을 입력해주세요.')
      return
    }

    try {
      const schedule = await createLocationOnlyConfirmedSchedule(
        pendingMiddleLocation,
        true,
        appointmentTitle
      )
      setPendingMiddleLocation(null)
      setAppointmentTitle('')
      setCreatedLocationOnlySchedule({
        ...schedule,
        isLocationOnly: true,
      })
      setRoomConfirmedSchedules(await getRoomConfirmedSchedules(currentRoomId))
      setSelectedScheduleId(schedule.id)
    } catch (error) {
      setMessage(`일정 생성 실패: ${error.message}`)
    }
  }

  const handleSetMeetingPlace = async (place) => {
    if (!currentRoomId) {
      setMessage('방 정보를 찾을 수 없어 만날 위치를 설정할 수 없습니다.')
      return
    }

    await handleSelectMiddlePlace(place)

    if (false) {
    setPendingMiddleLocation({
      roomid: currentRoomId,
      voteid: null,
      placename: place.name || '이름 없는 장소',
      placeaddress: place.address || null,
      placelat: place.lat,
      placelng: place.lng,
    })
    setAppointmentTitle('')

    try {
      setRoomConfirmedSchedules(await getRoomConfirmedSchedules(currentRoomId))
    } catch (error) {
      setPendingMiddleLocation(null)
      setMessage(`확정 일정 조회 실패: ${error.message}`)
    }
  }

  }

  const handleOpenCreatedSchedule = () => {
    if (!createdLocationOnlySchedule) return

    navigate(`/rooms/${currentRoomId}?tab=schedule`)
  }

  const handleCreateMiddlePlaceVote = (selectedPlaces) => {
    if (!currentRoomId) {
      setMessage('방 정보를 찾을 수 없어 중간 장소 투표를 만들 수 없습니다.')
      return
    }

    if (!selectedPlaces || selectedPlaces.length === 0) {
      setMessage('투표로 만들 중간 장소 후보를 1개 이상 선택해주세요.')
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
      setMessage('방 정보를 찾을 수 없어 추가장소 투표를 만들 수 없습니다.')
      return
    }

    if (!selectedPlaces || selectedPlaces.length === 0) {
      setMessage('투표로 만들 추가장소 후보를 1개 이상 선택해주세요.')
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
        title: '추가 장소 투표',
        returnTab: 'location',
        scheduleId: selectedScheduleId,
        scheduleTitle: selectedSchedule?.title || '',
      },
    })
  }

  const handleCancelMiddlePlace = async () => {
    if (!middlePlace) {
      setMessage('취소할 중간 장소가 없습니다.')
      return
    }

    const confirmCancel = window.confirm(
      '확정된 중간 장소를 취소할까요? 다시 중간 장소를 추천받을 수 있습니다.'
    )

    if (!confirmCancel) return

    try {
      if (selectedScheduleId) {
        await clearConfirmedScheduleLocation(selectedScheduleId)
        setRoomConfirmedSchedules(await getRoomConfirmedSchedules(currentRoomId))
      } else {
        await deleteRoomMiddlePlace(currentRoomId)
      }

      setMiddlePlace(null)
      setSelectedPlace(null)
      setDestination(null)
      setPlaces([])
      setMemberRouteResults([])
      setMemberRoutePaths([])

      setMessage('중간 장소 확정을 취소했습니다. 다시 중간 장소를 추천받을 수 있습니다.')
    } catch (error) {
      console.error('중간 장소 확정 취소 오류:', error)
      setMessage('중간 장소 확정 취소 중 오류가 발생했습니다.')
    }
  }

  const handleSelectPlace = (place) => {
    setSelectedPlace(place)
    setDestination(place)
    setMessage(`${place.name}을(를) 목적지로 설정했습니다.`)
  }

  const handleRefreshMemberRoutes = async () => {
    if (!middlePlace) {
      setMessage('먼저 중간 장소를 확정해주세요.')
      return
    }

    await calculateAllMemberRoutesToMiddlePlace(middlePlace)
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
      setMessage(`${schedule.title} 일정을 만들었어요. 이제 만날 위치를 정해 주세요.`)
    } catch (error) {
      setNewScheduleTitleError(error.message)
    }
  }

  return (
    <section className="map-section">
      {showNewScheduleModal && (
        <div className="transport-mode-overlay">
          <div className="transport-mode-dialog">
            <h3>새 일정 만들기</h3>
            <p className="location-schedule-helper">
              일정 이름만 먼저 저장하고 위치와 날짜는 이어서 정할 수 있어요.
            </p>
            <input
              className="location-schedule-input"
              value={newScheduleTitle}
              onChange={(event) => {
                setNewScheduleTitle(event.target.value)
                setNewScheduleTitleError('')
              }}
              placeholder="일정 이름"
            />
            {newScheduleTitleError && (
              <p className="location-schedule-error">{newScheduleTitleError}</p>
            )}
            <div>
              <button
                type="button"
                onClick={() => {
                  setShowNewScheduleModal(false)
                  setNewScheduleTitleError('')
                }}
              >
                취소
              </button>
              <button type="button" onClick={handleCreateDraftSchedule}>
                만들기
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
          <div style={{ width: '300px', padding: '24px', borderRadius: '16px', backgroundColor: 'var(--bg-color)' }}>
            <h3 style={{ marginBottom: '4px', textAlign: 'center' }}>
              위치가 확정되었습니다!
            </h3>
            <p style={{ color: 'var(--secondary-text)', fontSize: '13px', textAlign: 'center', marginBottom: '12px' }}>
              위치를 추가할 일정을 선택하거나 새 일정을 만들어 주세요.
            </p>

            {roomConfirmedSchedules.length > 0 && (
              <div style={{ marginBottom: '12px' }}>
                <p style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 'bold' }}>
                  1. 확정된 일정에서 정하기
                </p>
                {roomConfirmedSchedules.map((schedule) => (
                  <button
                    key={schedule.id}
                    type="button"
                    onClick={() => handleApplyMiddlePlaceToSchedule(schedule.id)}
                    style={{
                      width: '100%',
                      padding: '10px',
                      marginBottom: '6px',
                      backgroundColor: 'var(--card-bg)',
                      color: 'var(--text-color)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '10px',
                      fontSize: '14px',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    {schedule.title || schedule.date || '날짜 미정 일정'}
                  </button>
                ))}
              </div>
            )}

            <p style={{ margin: '16px 0 8px', fontSize: '13px', fontWeight: 'bold' }}>
              2. 새로운 확정 일정 추가하기
            </p>

            <input
              type="text"
              placeholder="일정 이름 (예: 팀 회식, 생일 파티...)"
              value={appointmentTitle}
              onChange={(event) => setAppointmentTitle(event.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
                border: '1px solid var(--border-color)',
                borderRadius: '10px',
                boxSizing: 'border-box',
                marginBottom: '8px',
              }}
            />

            <button
              type="button"
              onClick={handleCreateScheduleFromMiddlePlace}
              style={{
                width: '100%',
                padding: '12px',
                backgroundColor: 'var(--btn-bg)',
                color: 'var(--text-color)',
                border: 'none',
                borderRadius: '10px',
                fontSize: '15px',
                cursor: 'pointer',
              }}
            >
              새로운 확정 일정 추가하기
            </button>
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
              만날 위치와 일정 이름은 저장되었습니다. 날짜와 시간은 나중에 입력할 수도 있습니다.
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
                나중에 하기
              </button>
              <button
                type="button"
                onClick={handleOpenCreatedSchedule}
                style={{ flex: 1, padding: '10px', border: 'none', borderRadius: '8px', backgroundColor: '#7c79ff', color: '#fff', cursor: 'pointer' }}
              >
                지금 일정 정하기
              </button>
            </div>
          </div>
        </div>
      )}

      {shareToast && (
        <div
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            padding: '14px 18px',
            borderRadius: '12px',
            backgroundColor: 'rgba(0, 0, 0, 0.78)',
            color: '#fff',
            fontSize: '14px',
            zIndex: 1100,
          }}
        >
          {shareToast}
        </div>
      )}

      {transportModePrompt && (
        <div className="transport-mode-overlay">
          <div className="transport-mode-dialog">
            <h3>이동수단을 입력하세요</h3>
            <div>
              <button
                type="button"
                onClick={() => handleSelectTransportMode('transit')}
              >
                대중교통
              </button>
              <button
                type="button"
                onClick={() => handleSelectTransportMode('car')}
              >
                자동차
              </button>
            </div>
            {transportModePrompt.isEdit && (
              <button
                type="button"
                className="transport-mode-cancel"
                onClick={() => setTransportModePrompt(null)}
              >
                취소
              </button>
            )}
          </div>
        </div>
      )}

      <h2>위치 기능</h2>

      <div className="location-schedule-selector">
        {roomConfirmedSchedules.length === 0 ? (
          <>
            <strong>아직 일정이 없어요.</strong>
            <span>새 일정을 만든 뒤 출발 위치와 만날 위치를 설정해 주세요.</span>
          </>
        ) : (
          <>
            <label htmlFor="location-schedule">경로를 확인할 일정</label>
            <select
              id="location-schedule"
              value={selectedScheduleId || ''}
              onChange={(event) => setSelectedScheduleId(Number(event.target.value))}
            >
              {roomConfirmedSchedules.map((schedule) => (
                <option key={schedule.id} value={schedule.id}>
                  {schedule.title || '제목 없는 일정'}
                  {schedule.date ? ` · ${schedule.date}` : ''}
                  {schedule.starttime ? ` ${schedule.starttime.slice(0, 5)}` : ''}
                </option>
              ))}
            </select>
            {!middlePlace && (
              <span>선택한 일정의 만날 위치를 먼저 확정해 주세요.</span>
            )}
          </>
        )}
      </div>

      <button
        type="button"
        className="location-new-schedule-button"
        onClick={() => setShowNewScheduleModal(true)}
      >
        + 새 일정 만들기
      </button>

      {selectedScheduleId && (
        <>
      <CurrentLocationButton onClick={handleCurrentLocation} />

      <button type="button" onClick={handleShareCurrentLocation}>
        현재 위치 채팅에 공유
      </button>

      <div className="location-box">
        <h3>출발 상태</h3>
        <p>{getLocationStatusLabel(myLocationRecord)}</p>

        {myLocationRecord?.transportmode && (
          <p>
            교통수단: {getModeLabel(myLocationRecord.transportmode)}{' '}
            <button type="button" onClick={handleEditTransportMode}>
              수정하기
            </button>
          </p>
        )}

        {myLocationRecord?.transportmode &&
          myLocationRecord?.lastlocationupdatedat && (
          <p>
            마지막 갱신:{' '}
            {new Date(myLocationRecord.lastlocationupdatedat).toLocaleString()}
          </p>
        )}

        {(locationUpdateError || myLocationRecord?.locationerror) && (
          <p style={{ color: '#c2410c' }}>
            {locationUpdateError || myLocationRecord.locationerror}
          </p>
        )}

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handleStartDeparture}
            disabled={isTracking || isArrived || !middlePlace}
          >
            출발하기
          </button>

          <button
            type="button"
            onClick={handleArrive}
            disabled={!isTracking}
          >
            도착
          </button>
        </div>
        {!middlePlace && <p>중간위치를 확정해주세요.</p>}
      </div>

      {message && <p>{message}</p>}

      {members.length > 0 && (
        <div className="location-box">
          <h3>멤버 위치 등록 현황</h3>

          {members.map((member) => {
            const isRegistered = isMemberLocationRegistered(member)
            const isMe =
              (member.userid && member.userid === currentUserId) ||
              (member.guestid && member.guestid === currentGuestId)
            const canRequestLocation = Boolean(member.userid || member.guestid)

            return (
              <div
                key={getMemberKey(member)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  marginBottom: '6px',
                }}
              >
                <span>👤</span>
                <span>{member.nickname || '닉네임 없음'}</span>
                <span>
                  {isRegistered
                    ? '위치 등록 완료'
                    : isMe
                    ? '내 위치 미등록'
                    : '위치 미등록'}
                </span>

                {!isRegistered && !isMe && canRequestLocation && (
                  <button type="button" onClick={() => handleRequestLocation(member)}>
                    위치 등록 요청
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {members.length > 0 && (
        <div className="location-box">
          <h3>멤버 출발 여부</h3>

          {members.map((member) => {
            const memberLocation = getMemberLocationRecord(member)
            const routeResult = getMemberRouteResult(member)
            const isRegistered = Boolean(memberLocation?.transportmode)

            return (
              <div
                key={`departure-${getMemberKey(member)}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  marginBottom: '6px',
                  flexWrap: 'wrap',
                }}
              >
                <span>{member.nickname || '닉네임 없음'}</span>
                <strong>{getLocationStatusLabel(memberLocation)}</strong>
                {isRegistered && (
                  <span>
                    교통수단: {getModeLabel(memberLocation.transportmode)}
                  </span>
                )}

                {middlePlace && isRegistered && (
                  <span>{getRemainingTimeLabel(memberLocation, routeResult)}</span>
                )}

                {isRegistered && memberLocation?.lastlocationupdatedat && (
                  <span>
                    마지막 갱신:{' '}
                    {new Date(memberLocation.lastlocationupdatedat).toLocaleString()}
                  </span>
                )}

                {isRegistered && memberLocation?.locationerror && (
                  <span style={{ color: '#c2410c' }}>
                    {memberLocation.locationerror}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {currentLocation && (
        <div className="location-box">
          <h3>브라우저 현재 위치</h3>
          <p>정확도: {Math.round(currentLocation.accuracy)}m</p>
        </div>
      )}

      {memberLocations.length > 0 && (
        <div className="location-box">
          <h3>DB에 저장된 멤버 현재 위치</h3>

          {memberLocations.map((location) => (
            <div key={getMemberKey(location)}>
              <p>닉네임: {getMemberNickname(location)}</p>
              <p>출발 여부: {getLocationStatusLabel(location)}</p>

              {location.transportmode && location.lastlocationupdatedat && (
                <p>
                  마지막 갱신:{' '}
                  {new Date(location.lastlocationupdatedat).toLocaleString()}
                </p>
              )}

              {location.transportmode && location.locationerror && (
                <p style={{ color: '#c2410c' }}>{location.locationerror}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {middlePlace && (
        <div className="location-box">
          <h3>확정된 중간 장소</h3>
          <p>장소명: {middlePlace.name}</p>
          <p>주소: {middlePlace.address || '주소 정보 없음'}</p>

          <button type="button" onClick={handleShareMiddlePlace}>
            확정된 중간장소 채팅에 공유
          </button>

          <button type="button" onClick={handleCancelMiddlePlace}>
            중간 장소 확정 취소
          </button>
        </div>
      )}

      {memberRouteResults.length > 0 && (
        <div className="location-box">
          <h3>중간 장소까지 멤버별 이동시간</h3>

          <button type="button" onClick={handleRefreshMemberRoutes}>
            멤버 위치 기준으로 다시 계산
          </button>

          {memberRouteResults.map((result) => (
            <div key={result.userid || result.guestid}>
              <p>
                {result.nickname} / {getModeLabel(result.mode)} /{' '}
                {result.durationMinutes !== null
                  ? `${result.durationMinutes}분`
                  : '계산 실패'}
                {result.distanceKm ? ` / ${result.distanceKm}km` : ''}
              </p>
            </div>
          ))}

          <p style={{ fontSize: '13px', color: '#666' }}>
            자동차는 카카오 경로 API, 대중교통은 Google Directions 경로 데이터를 이용해 지도에 표시합니다.
          </p>
        </div>
      )}

      <LocationPicker
        allowMapClick={false}
        showMap={false}
        onSelect={(name, address, place = {}) => {
          const selected = {
            ...place,
            name,
            address: address || place.address || '',
          }

          handleSelectPlace(selected)
          setPlaces([selected])
        }}
      />

      <KakaoMapView
        currentLocation={currentLocation}
        memberLocations={registeredMemberLocations}
        places={places}
        selectedPlace={selectedPlace}
        destination={destination}
        memberRoutePaths={memberRoutePaths}
        onSetMeetingPlace={handleSetMeetingPlace}
      />

      {!middlePlace && (
        <FamousMiddlePlacePanel
          memberLocations={registeredMemberLocations}
          onRecommendPlaces={setPlaces}
          onSelectMiddlePlace={handleSelectMiddlePlace}
          onCreateMiddlePlaceVote={handleCreateMiddlePlaceVote}
        />
      )}

      {middlePlace ? (
        <PlaceSearchPanel
          searchLocation={middlePlace}
          onSearchResult={setPlaces}
          onSelectPlace={handleSelectPlace}
          onSharePlace={handleShareNearbyPlace}
          onCreateAdditionalPlaceVote={handleCreateAdditionalPlaceVote}
        />
      ) : (
        <section>
          <h2>확정된 중간 장소 주변 추천</h2>
          <p>
            먼저 유명 중간 장소를 추천받고, 그중 하나를 중간 장소로 확정해주세요.
            중간 장소가 확정되면 주변 음식점, 카페, 놀거리를 검색할 수 있습니다.
          </p>
        </section>
      )}
        </>
      )}
    </section>
  )
}

function getModeLabel(mode) {
  if (mode === 'car') return '자동차'
  if (mode === 'transit') return '대중교통'
  return mode
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

function getRemainingTimeLabel(location, routeResult) {
  if (!location) return '남은 시간: 위치 미등록'

  if (location.arrivedat || location.locationstatus === 'arrived') {
    return '남은 시간: 도착 완료'
  }

  if (location.locationstatus === 'denied') {
    return '남은 시간: 위치 권한 필요'
  }

  if (location.locationstatus === 'error') {
    return '남은 시간: 위치 갱신 실패'
  }

  if (!routeResult) return '남은 시간: 계산 전'

  if (routeResult.error || routeResult.durationMinutes === null) {
    return '남은 시간: 계산 실패'
  }

  const distance = routeResult.distanceKm ? ` / ${routeResult.distanceKm}km` : ''
  return `남은 시간: ${routeResult.durationMinutes}분 (${getModeLabel(routeResult.mode)}${distance})`
}

export default MapPage
