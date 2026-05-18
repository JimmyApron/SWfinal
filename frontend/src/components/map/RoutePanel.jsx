function RoutePanel({
  destination,
  routeInfo,
  routeSteps,
  routeMessage,
  onSearchRoute,
}) {
  if (!destination) {
    return (
      <section>
        <h2>대중교통 경로 안내</h2>
        <p>먼저 추천 장소 목록에서 목적지를 선택해주세요.</p>
      </section>
    )
  }

  return (
    <section>
      <h2>대중교통 경로 안내</h2>

      <p>목적지: {destination.name}</p>

      <button type="button" onClick={onSearchRoute}>
        대중교통 경로 찾기
      </button>

      {routeMessage && <p>{routeMessage}</p>}

      {routeInfo && (
        <div>
          <p>예상 소요 시간: {routeInfo.duration}</p>
          <p>거리: {routeInfo.distance}</p>
        </div>
      )}

      {routeSteps && routeSteps.length > 0 && (
        <div>
          <h3>상세 경로</h3>

          <ol>
            {routeSteps.map((step, index) => (
              <li key={index}>
                <span
                  dangerouslySetInnerHTML={{
                    __html: step.instructions,
                  }}
                />

                <p>
                  {step.distance} / {step.duration}
                </p>

                {step.transit && (
                  <p>
                    대중교통: {step.transit.lineName} / {step.transit.vehicle}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      <div>
        <p>
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${destination.lat},${destination.lng}&travelmode=transit`}
            target="_blank"
            rel="noreferrer"
          >
            구글맵에서 대중교통 경로 열기
          </a>
        </p>

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
      </div>
    </section>
  )
}

export default RoutePanel