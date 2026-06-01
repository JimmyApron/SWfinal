import { useEffect, useState } from 'react'
import { recommendFamousMiddlePlaces } from '../../utils/famousMiddlePlaceRecommendation'

function FamousMiddlePlacePanel({
  memberLocations,
  onRecommendPlaces,
  onSelectMiddlePlace,
  onCreateMiddlePlaceVote,
}) {
  const [recommendedPlaces, setRecommendedPlaces] = useState([])
  const [selectedPlaceIds, setSelectedPlaceIds] = useState([])
  const [message, setMessage] = useState('')
  const canRecommend = memberLocations?.length >= 2

  useEffect(() => {
    if (canRecommend) return

    setRecommendedPlaces([])
    setSelectedPlaceIds([])
    onRecommendPlaces([])
  }, [canRecommend, onRecommendPlaces])

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
      setMessage('멤버별 이동수단 기준으로 유명 중간장소를 계산하는 중입니다.')

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
      onRecommendPlaces(result)

      // 추천된 후보는 기본적으로 전부 투표 후보로 체크
      setSelectedPlaceIds(result.map((place, index) => getPlaceKey(place, index)))

      if (result.length === 0) {
        setMessage('추천할 수 있는 유명 장소가 없습니다.')
        return
      }

      setMessage('유명 중간장소 후보 5개를 추천했습니다.')
    } catch (error) {
      console.error('유명 중간장소 추천 오류:', error)
      setMessage(error.message || '유명 중간장소 추천 중 오류가 발생했습니다.')
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

  const handleCreateVote = () => {
    if (!canRecommend) {
      setMessage('중간 장소 투표는 2명 이상 위치를 등록해야 만들 수 있어요.')
      return
    }

    if (!onCreateMiddlePlaceVote) {
      setMessage('중간장소 투표 생성 기능이 연결되지 않았습니다.')
      return
    }

    const selectedPlaces = recommendedPlaces.filter((place, index) => {
      return selectedPlaceIds.includes(getPlaceKey(place, index))
    })

    if (selectedPlaces.length === 0) {
      setMessage('투표에 넣을 중간장소 후보를 1개 이상 선택해주세요.')
      return
    }

    onCreateMiddlePlaceVote(selectedPlaces)
  }

  return (
    <section className="middle-place-panel">
      <h2>유명 중간장소 추천</h2>

      <p>
        멤버들이 등록한 이동수단을 기준으로 각자 이동시간이 비슷한 유명 장소를
        추천합니다.
      </p>

      {memberLocations.map((member) => {
        const memberKey = getMemberKey(member)
        const nickname = getMemberNickname(member)

        return (
          <div key={memberKey}>
            <span>{nickname}</span>

            <span>{getModeLabel(member.transportmode)}</span>
          </div>
        )
      })}

      <button type="button" onClick={handleRecommend} disabled={!canRecommend}>
        유명 중간장소 5개 추천
      </button>

      {!canRecommend && (
        <p>중간 장소 추천은 2명 이상 위치를 등록하면 사용할 수 있어요.</p>
      )}

      {message && <p>{message}</p>}

      {recommendedPlaces.length > 0 && (
        <div>
          <h3>추천된 중간장소</h3>

          <button
            type="button"
            onClick={handleCreateVote}
            style={{
              marginBottom: '12px',
              padding: '10px 14px',
              border: '1px solid #7c79ff',
              borderRadius: '8px',
              backgroundColor: '#f0f0ff',
              color: '#4b47d8',
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            선택한 후보로 중간장소 투표 만들기
          </button>

          {recommendedPlaces.map((place, index) => {
            const placeKey = getPlaceKey(place, index)
            const isSelected = selectedPlaceIds.includes(placeKey)

            return (
              <div
                key={place.id || `${place.name}-${index}`}
                style={{
                  border: '1px solid #ddd',
                  borderRadius: '8px',
                  padding: '12px',
                  marginBottom: '12px',
                }}
              >
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginBottom: '8px',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => handleTogglePlace(placeKey)}
                  />
                  <span>투표 후보로 선택</span>
                </label>

                <h4>
                  {index + 1}. {place.name}
                </h4>

                <p>{place.address}</p>
                <p>카테고리: {place.category || '정보 없음'}</p>
                <p>이동시간 차이: {Math.round(place.timeGap / 60)}분</p>

                {place.travelResults.map((result) => (
                  <p key={result.userid || result.guestid || result.nickname}>
                    {result.nickname} / {getModeLabel(result.mode)} /{' '}
                    {result.durationMinutes}분
                  </p>
                ))}

                <button
                  type="button"
                  onClick={() => onSelectMiddlePlace(place)}
                >
                  이 장소를 중간장소로 확정
                </button>
              </div>
            )
          })}
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

export default FamousMiddlePlacePanel
