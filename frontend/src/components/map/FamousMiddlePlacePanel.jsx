import { useState } from 'react'
import { recommendFamousMiddlePlaces } from '../../utils/famousMiddlePlaceRecommendation'

function FamousMiddlePlacePanel({
  memberLocations,
  onRecommendPlaces,
  onSelectMiddlePlace,
}) {
  const [memberTransportModes, setMemberTransportModes] = useState({})
  const [recommendedPlaces, setRecommendedPlaces] = useState([])
  const [message, setMessage] = useState('')

  const handleChangeMode = (userid, mode) => {
    setMemberTransportModes((prev) => ({
      ...prev,
      [userid]: mode,
    }))
  }

  const handleRecommend = async () => {
    if (!memberLocations || memberLocations.length < 2) {
      setMessage('멤버 위치가 2개 이상 필요합니다.')
      return
    }

    try {
      setMessage('멤버별 이동수단 기준으로 유명 중간장소를 계산하는 중입니다.')

      const result = await recommendFamousMiddlePlaces({
        memberLocations,
        memberTransportModes,
      })

      setRecommendedPlaces(result)
      onRecommendPlaces(result)

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

  return (
    <section className="middle-place-panel">
      <h2>유명 중간장소 추천</h2>

      <p>
        멤버별 이동수단을 선택하면, 각자 이동시간이 비슷한 유명 장소를
        추천합니다.
      </p>

      {memberLocations.map((member) => (
        <div key={member.userid}>
          <span>{member.profiles?.nickname || '멤버'}</span>

          <select
            value={memberTransportModes[member.userid] || 'transit'}
            onChange={(event) => {
              handleChangeMode(member.userid, event.target.value)
            }}
          >
            <option value="car">자동차</option>
            <option value="transit">대중교통</option>
          </select>
        </div>
      ))}

      <button type="button" onClick={handleRecommend}>
        유명 중간장소 5개 추천
      </button>

      {message && <p>{message}</p>}

      {recommendedPlaces.length > 0 && (
        <div>
          <h3>추천된 중간장소</h3>

          {recommendedPlaces.map((place, index) => (
            <div key={place.id || `${place.name}-${index}`}>
              <h4>
                {index + 1}. {place.name}
              </h4>

              <p>{place.address}</p>
              <p>카테고리: {place.category || '정보 없음'}</p>
              <p>이동시간 차이: {Math.round(place.timeGap / 60)}분</p>

              {place.travelResults.map((result) => (
                <p key={result.userid}>
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
          ))}
        </div>
      )}
    </section>
  )
}

function getModeLabel(mode) {
  if (mode === 'car') return '자동차'
  if (mode === 'transit') return '대중교통'
  return mode
}

export default FamousMiddlePlacePanel