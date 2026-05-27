import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import KakaoMapView from './KakaoMapView'
import CurrentLocationButton from './CurrentLocationButton'
import PlaceSearchPanel from './PlaceSearchPanel'
import FamousMiddlePlacePanel from './FamousMiddlePlacePanel'

import { getCurrentPosition } from '../../services/geolocationService'
import { getRouteTime } from '../../api/routeTimeApi'
import { decodePolyline } from '../../utils/decodePolyline'
import { supabase } from '../../lib/supabaseClient'
import { createNotification, createRoomNotifications } from '../../api/notificationApi'
import { getRoomMembers } from '../../api/scheduleApi'
import {
  saveMyLocation,
  saveMyGuestLocation,
  getRoomMemberLocations,
  saveRoomMiddlePlace,
  getRoomMiddlePlace,
  deleteRoomMiddlePlace,
} from '../../api/mapApi'

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

  const [middlePlace, setMiddlePlace] = useState(null)
  const [memberRouteResults, setMemberRouteResults] = useState([])
  const [memberRoutePaths, setMemberRoutePaths] = useState([])

  const [message, setMessage] = useState('')

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

  const loadRoomData = async () => {
    await Promise.all([loadMemberLocations(), loadMembers()])
  }

  const loadMembers = async () => {
    if (!currentRoomId) return []

    try {
      const memberData = await getRoomMembers(currentRoomId)
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
      const locations = await getRoomMemberLocations(currentRoomId)
      setMemberLocations(locations)
      return locations
    } catch (error) {
      console.error('멤버 위치 조회 오류:', error)
      setMessage('멤버 위치를 불러오지 못했습니다.')
      return []
    }
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
      setMessage('현재 위치를 가져왔습니다. DB에 저장하는 중입니다.')

      if (currentGuestId) {
        await saveMyGuestLocation({
          guestId: currentGuestId,
          roomId: currentRoomId,
          latitude: location.lat,
          longitude: location.lng,
          accuracy: location.accuracy,
        })
      } else {
        await saveMyLocation({
          userId: currentUserId,
          roomId: currentRoomId,
          latitude: location.lat,
          longitude: location.lng,
          accuracy: location.accuracy,
        })
      }

      await loadMemberLocations()

      setMessage('현재 위치를 저장했습니다.')
    } catch (error) {
      console.error('현재 위치 저장 오류:', error)
      setMessage('현재 위치를 가져오거나 저장하는 중 오류가 발생했습니다.')
    }
  }

  const handleRequestLocation = async (member) => {
    try {
      if (!currentUserId) {
        alert('로그인한 사용자만 위치 등록 요청을 보낼 수 있습니다.')
        return
      }

      await createNotification({
        roomId: currentRoomId,
        receiverId: member.userid,
        senderId: currentUserId,
        type: 'location_request',
        title: '위치 등록 요청',
        message: '아직 위치를 등록하지 않았습니다. 위치를 등록해주세요!',
        link: `/rooms/${currentRoomId}?tab=location`,
      })

      alert(`${member.nickname || '상대방'}님에게 위치 등록 요청 알림을 보냈습니다.`)
    } catch (error) {
      console.error('위치 등록 요청 알림 전송 실패:', error)
      alert('위치 등록 요청 알림 전송에 실패했습니다.')
    }
  }

  const isMemberLocationRegistered = (member) => {
    return memberLocations.some((location) => location.userid === member.userid)
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

        const memberKey = getMemberKey(member)
        const nickname = getMemberNickname(member)

        const previousResult = place.travelResults?.find((result) => {
          const resultKey = result.userid || result.guestid || result.id
          return resultKey === memberKey
        })

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
          guestid: member.guestid,
          nickname,
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
          mode: 'transit',
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

  useEffect(() => {
    if (!currentRoomId) return

    const loadSavedMiddlePlace = async () => {
      try {
        const savedMiddlePlace = await getRoomMiddlePlace(currentRoomId)

        if (!savedMiddlePlace) return

        setMiddlePlace(savedMiddlePlace)
        setSelectedPlace(savedMiddlePlace)
        setPlaces([savedMiddlePlace])
        setMemberRouteResults([])
        setMemberRoutePaths([])
        setMessage(`${savedMiddlePlace.name}이(가) 중간 장소로 확정되어 있습니다.`)

        await calculateAllMemberRoutesToMiddlePlace(savedMiddlePlace)
      } catch (error) {
        console.error('확정 중간 장소 조회 오류:', error)
      }
    }

    loadSavedMiddlePlace()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      console.warn('자동차 경로 API 요청 실패')
      return null
    }

    return response.json()
  }

  const handleSelectMiddlePlace = async (place) => {
    try {
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
      }

      setMiddlePlace(confirmedPlace)
      setSelectedPlace(confirmedPlace)
      setPlaces([confirmedPlace])
      setMemberRouteResults(confirmedPlace.travelResults || [])
      setMemberRoutePaths([])
      setMessage(`${confirmedPlace.name}을(를) 중간 장소로 확정했습니다. 멤버별 경로를 계산합니다.`)

      try {
        if (currentUserId && currentRoomId) {
          await createRoomNotifications({
            roomId: currentRoomId,
            senderId: currentUserId,
            type: 'middle_place_confirmed',
            title: '중간 장소가 확정되었습니다',
            message: `${confirmedPlace.name}이(가) 중간 장소로 확정되었습니다.`,
            link: `/rooms/${currentRoomId}?tab=location`,
          })
        }
      } catch (error) {
        console.error('중간 장소 확정 알림 생성 실패:', error)
      }

      await calculateAllMemberRoutesToMiddlePlace(confirmedPlace)
    } catch (error) {
      console.error('중간 장소 확정 저장 오류:', error)
      setMessage('중간 장소 확정 중 오류가 발생했습니다.')
    }
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
        selectedPlaces: votePlaces,
        title: '중간 장소 투표',
        returnTab: 'location',
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
      await deleteRoomMiddlePlace(currentRoomId)

      setMiddlePlace(null)
      setSelectedPlace(null)
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
    setMessage(`${place.name}을(를) 목적지로 설정했습니다.`)
  }

  const handleRefreshMemberRoutes = async () => {
    if (!middlePlace) {
      setMessage('먼저 중간 장소를 확정해주세요.')
      return
    }

    await calculateAllMemberRoutesToMiddlePlace(middlePlace)
  }

  return (
    <section className="map-section">
      <h2>위치 기능</h2>

      <CurrentLocationButton onClick={handleCurrentLocation} />

      {message && <p>{message}</p>}

      {members.length > 0 && (
        <div className="location-box">
          <h3>멤버 위치 등록 현황</h3>

          {members.map((member) => {
            const isRegistered = isMemberLocationRegistered(member)
            const isMe = member.userid === currentUserId

            return (
              <div
                key={member.id}
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
                  {isRegistered ? '위치 등록 완료' : isMe ? '내 위치 미등록' : '위치 등록 안 함'}
                </span>

                {!isRegistered && !isMe && (
                  <button type="button" onClick={() => handleRequestLocation(member)}>
                    위치 등록 요청
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {currentLocation && (
        <div className="location-box">
          <h3>브라우저 현재 위치</h3>
          <p>위도: {currentLocation.lat}</p>
          <p>경도: {currentLocation.lng}</p>
          <p>정확도: {Math.round(currentLocation.accuracy)}m</p>
        </div>
      )}

      {memberLocations.length > 0 && (
        <div className="location-box">
          <h3>DB에 저장된 멤버 현재 위치</h3>

          {memberLocations.map((location) => (
            <div key={getMemberKey(location)}>
              <p>닉네임: {getMemberNickname(location)}</p>
              <p>위도: {location.latitude}</p>
              <p>경도: {location.longitude}</p>
            </div>
          ))}
        </div>
      )}

      {middlePlace && (
        <div className="location-box">
          <h3>확정된 중간 장소</h3>
          <p>장소명: {middlePlace.name}</p>
          <p>주소: {middlePlace.address || '주소 정보 없음'}</p>
          <p>위도: {middlePlace.lat}</p>
          <p>경도: {middlePlace.lng}</p>

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
          onCreateMiddlePlaceVote={handleCreateMiddlePlaceVote}
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
          <h2>확정된 중간 장소 주변 추천</h2>
          <p>
            먼저 유명 중간 장소를 추천받고, 그중 하나를 중간 장소로 확정해주세요.
            중간 장소가 확정되면 주변 음식점, 카페, 놀거리를 검색할 수 있습니다.
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
