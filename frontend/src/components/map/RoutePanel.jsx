function RoutePanel({
  currentLocation,
  destination,
  routeInfo,
  routeSteps,
  routeMessage,
  onSearchRoute,
}) {
  if (!destination) {
    return (
      <section>
        <h2>경로 안내</h2>
        <p>먼저 추천 장소 목록에서 목적지를 선택해주세요.</p>
      </section>
    )
  }

  return (
    <section>
      <h2>경로 안내</h2>

      <p>목적지: {destination.name}</p>

      <button type="button" onClick={onSearchRoute}>
        경로 찾기
      </button>

      {routeMessage && <p>{routeMessage}</p>}

      {routeInfo && (
        <div>
          <p>예상 소요 시간: {formatDuration(routeInfo.duration)}</p>
          <p>거리: {formatDistance(routeInfo.distance)}</p>
        </div>
      )}

      {routeSteps && routeSteps.length > 0 && (
        <div>
          <h3>상세 경로</h3>

          <ol>
            {routeSteps.map((step, index) => (
              <li key={index}>
                <p>{step.instructions}</p>
                <p>
                  {step.distance} / {step.duration}
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div>
        {currentLocation && (
          <p>
            <a
              href={`https://map.kakao.com/link/from/내위치,${currentLocation.lat},${currentLocation.lng}/to/${encodeURIComponent(
                destination.name
              )},${destination.lat},${destination.lng}`}
              target="_blank"
              rel="noreferrer"
            >
              카카오맵에서 길찾기 열기
            </a>
          </p>
        )}

        {!currentLocation && (
          <p>
            <a
              href={`https://map.kakao.com/link/to/${encodeURIComponent(
                destination.name
              )},${destination.lat},${destination.lng}`}
              target="_blank"
              rel="noreferrer"
            >
              카카오맵에서 목적지 열기
            </a>
          </p>
        )}
      </div>
    </section>
  )
}

function formatDistance(distance) {
  const meter = Number(distance)

  if (!distance || Number.isNaN(meter)) {
    return '거리 정보 없음'
  }

  if (meter >= 1000) {
    return `${(meter / 1000).toFixed(1)}km`
  }

  return `${Math.round(meter)}m`
}

function formatDuration(duration) {
  const seconds = Number(duration)

  if (!duration || Number.isNaN(seconds)) {
    return '소요 시간 정보 없음'
  }

  const minutes = Math.round(seconds / 60)

  if (minutes >= 60) {
    const hour = Math.floor(minutes / 60)
    const remainMinute = minutes % 60

    if (remainMinute === 0) {
      return `${hour}시간`
    }

    return `${hour}시간 ${remainMinute}분`
  }

  return `${minutes}분`
}

export default RoutePanel