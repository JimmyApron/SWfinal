function ProgressPanel({
  destination,
  isTracking,
  remainingDistanceKm,
  progressPercent,
  isArrived,
  onStartTracking,
  onStopTracking,
}) {
  if (!destination) {
    return (
      <section>
        <h2>이동 진행률</h2>
        <p>먼저 추천 장소 목록에서 목적지를 선택해주세요.</p>
      </section>
    )
  }

  return (
    <section>
      <h2>이동 진행률</h2>

      <p>목적지: {destination.name}</p>

      {remainingDistanceKm !== null && (
        <p>남은 거리: {remainingDistanceKm.toFixed(2)}km</p>
      )}

      {progressPercent !== null && (
        <p>진행률: {progressPercent}%</p>
      )}

      {isArrived && <p>도착했습니다.</p>}

      {!isTracking ? (
        <button type="button" onClick={onStartTracking}>
          위치 추적 시작
        </button>
      ) : (
        <button type="button" onClick={onStopTracking}>
          위치 추적 중지
        </button>
      )}
    </section>
  )
}

export default ProgressPanel