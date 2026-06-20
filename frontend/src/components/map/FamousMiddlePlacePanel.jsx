import { useEffect, useState } from 'react'
import { FaMapMarkerAlt } from 'react-icons/fa'
import { recommendFamousMiddlePlaces } from '../../utils/famousMiddlePlaceRecommendation'

function FamousMiddlePlacePanel({
  memberLocations,
  onRecommendPlaces,
  onSelectMiddlePlace,
  onCreateMiddlePlaceVote,
  onResultStateChange,
  onCloseResults,
}) {
  const [recommendedPlaces, setRecommendedPlaces] = useState([])
  const [selectedPlaceIds, setSelectedPlaceIds] = useState([])
  const [message, setMessage] = useState('')
  const canRecommend = memberLocations?.length >= 2

  useEffect(() => {
    if (canRecommend) return

    setRecommendedPlaces([])
    setSelectedPlaceIds([])
    onRecommendPlaces?.([])
    onResultStateChange?.(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRecommend])

  const getMemberKey = (member) => {
    return member.userid || member.guestid || member.id
  }

  const getMemberNickname = (member) => {
    return (
      member.profiles?.nickname ||
      member.room_guests?.nickname ||
      member.nickname ||
      '멤버'
    )
  }

  const handleRecommend = async () => {
    if (!canRecommend) {
      setMessage('중간 장소 추천은 2명 이상 위치를 등록해야 사용할 수 있어요.')
      return
    }

    try {
      setMessage('')

      const fixedMemberTransportModes = {}

      memberLocations.forEach((member) => {
        const memberKey = getMemberKey(member)

        if (!memberKey) return

        if (member.transportmode) {
          fixedMemberTransportModes[memberKey] = member.transportmode
        }
      })

      const result = await recommendFamousMiddlePlaces({
        memberLocations,
        memberTransportModes: fixedMemberTransportModes,
      })

      setRecommendedPlaces(result)
      onRecommendPlaces?.(result)
      onResultStateChange?.(result.length > 0)

      // 추천된 장소는 기본적으로 전부 투표 항목으로 체크
      setSelectedPlaceIds(result.map((place, index) => getPlaceKey(place, index)))

      if (result.length === 0) {
        setMessage('추천할 수 있는 유명 장소가 없습니다.')
        return
      }

      setMessage('유명 중간 장소 5개를 추천했습니다.')
    } catch (error) {
      console.error('유명 중간 장소 추천 오류:', error)
      setMessage(error.message || '유명 중간 장소 추천 중 오류가 발생했습니다.')
    }
  }

  const handleTogglePlace = (placeKey) => {
    setSelectedPlaceIds((prev) => {
      if (prev.includes(placeKey)) {
        return prev.filter((id) => id !== placeKey)
      }

      return [...prev, placeKey]
    })
  }

  const handleSelectAllPlaces = () => {
    setSelectedPlaceIds(
      recommendedPlaces.map((place, index) => getPlaceKey(place, index))
    )
  }

  const handleClearSelectedPlaces = () => {
    setSelectedPlaceIds([])
  }

  const handleCreateVote = () => {
    if (!canRecommend) {
      setMessage('중간 장소 투표는 2명 이상 위치를 등록해야 만들 수 있어요.')
      return
    }

    if (!onCreateMiddlePlaceVote) {
      setMessage('중간 장소 투표 생성 기능이 연결되지 않았습니다.')
      return
    }

    const selectedPlaces = recommendedPlaces.filter((place, index) => {
      return selectedPlaceIds.includes(getPlaceKey(place, index))
    })

    if (selectedPlaces.length === 0) {
      setMessage('투표에 넣을 중간 장소를 1개 이상 선택해주세요.')
      return
    }

    onCreateMiddlePlaceVote(selectedPlaces)
  }

  const handleCloseResults = (event) => {
    event?.preventDefault()
    event?.stopPropagation()
    setRecommendedPlaces([])
    setSelectedPlaceIds([])
    setMessage('')
    onRecommendPlaces?.([])
    onResultStateChange?.(false)
    onCloseResults?.()
  }

  return (
    <section className="middle-place-panel">
      {recommendedPlaces.length > 0 && (
        <>
          <div className="map-sheet-header middle-place-result-header">
            <button
              type="button"
              className="map-sheet-back-button"
              onClick={handleCloseResults}
              aria-label="중간 장소 추천 결과 닫기"
            >
              <span aria-hidden="true">←</span>
            </button>
            <div className="map-sheet-title-block">
              <strong>추천된 중간 장소</strong>
              <span>{recommendedPlaces.length}개 장소</span>
            </div>

            <button
              type="button"
              className="map-sheet-header-action"
              onClick={handleCreateVote}
            >
              중간 장소 투표 만들기
            </button>
          </div>

          <div className="map-selection-actions">
            <button type="button" onClick={handleSelectAllPlaces}>
              모두 선택
            </button>
            <button type="button" onClick={handleClearSelectedPlaces}>
              모두 해제
            </button>
          </div>

          <div className="middle-place-result-list">
            {recommendedPlaces.map((place, index) => {
              const placeKey = getPlaceKey(place, index)
              const isSelected = selectedPlaceIds.includes(placeKey)
              const kakaoMapUrl = getKakaoMapUrl(place)

              return (
                <div
                  key={place.id || `${place.name}-${index}`}
                  className="middle-place-result-card"
                >
                  <label
                    className="middle-place-vote-check"
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleTogglePlace(placeKey)}
                    />
                    <span>투표 항목으로 선택</span>
                  </label>

                  <div className="middle-place-result-title">
                    <b>{index + 1}</b>
                    <h4>{place.name}</h4>
                  </div>

                  <p>{place.address}</p>
                  <div className="middle-place-result-meta">
                    <span>{place.category || '정보 없음'}</span>
                    <span>시간 차이 {Math.round(place.timeGap / 60)}분</span>
                  </div>

                  <div className="middle-place-route-list">
                    {place.travelResults.map((result) => (
                      <span key={result.userid || result.guestid || result.nickname}>
                        {result.nickname} · {getModeLabel(result.mode)} · {result.durationMinutes}분
                      </span>
                    ))}
                  </div>

                  {kakaoMapUrl && (
                    <a
                      className="middle-place-kakao-button"
                      href={kakaoMapUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <FaMapMarkerAlt aria-hidden="true" />
                      <span>카카오맵에서 보기</span>
                    </a>
                  )}

                  <button
                    type="button"
                    className="middle-place-confirm-button"
                    onClick={() => onSelectMiddlePlace(place)}
                  >
                    이 장소를 중간 장소로 확정
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}

      {recommendedPlaces.length === 0 && (
        <div className="middle-place-control-card">
          <div className="middle-place-copy">
            <span>만날 장소 추천</span>
            <h2>유명 중간 장소 찾기</h2>
            <p>
              멤버들의 출발 위치와 이동수단을 비교해서 모두가 이동하기 좋은 유명 장소를 추천해요.
            </p>
          </div>

          <div className="middle-place-member-strip">
            {memberLocations.map((member) => {
              const memberKey = getMemberKey(member)
              const nickname = getMemberNickname(member)

              return (
                <div key={memberKey} className="middle-place-member-chip">
                  <strong>{nickname}</strong>
                  <span>{getModeLabel(member.transportmode)}</span>
                </div>
              )
            })}
          </div>

          <button
            type="button"
            className="middle-place-recommend-button"
            onClick={handleRecommend}
            disabled={!canRecommend}
          >
            유명 중간 장소 5개 추천
          </button>

          {!canRecommend && (
            <p className="middle-place-helper">
              2명 이상 위치와 이동수단을 등록하면 추천을 받을 수 있어요.
            </p>
          )}

          {message && <p className="middle-place-message">{message}</p>}
        </div>
      )}
    </section>
  )
}

function getPlaceKey(place, index) {
  return String(
    place.id ||
      `${place.name}-${place.lat}-${place.lng}-${index}`
  )
}

function getModeLabel(mode) {
  if (mode === 'car') return '자동차'
  if (mode === 'transit') return '대중교통'
  return mode
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

export default FamousMiddlePlacePanel
