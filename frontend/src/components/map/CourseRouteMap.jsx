import { useEffect, useState } from 'react'
import KakaoMapView from './KakaoMapView'
import { getApiBaseUrl } from '../../api/apiBaseUrl'
import { decodePolyline } from '../../utils/decodePolyline'
import { recommendedTransitRoute } from '../../api/recommendedTransitRoute'

export default function CourseRouteMap({ places = [], travelMode, allowWalkingLookup = false, ...props }) {
  const [state, setState] = useState({ key: '', routes: [], message: '' })
  const mode = travelMode === 'walk' ? 'walking' : travelMode
  const key = JSON.stringify([mode, places.map(p => [p.lat, p.lng, p.orderNumber]), allowWalkingLookup])
  useEffect(() => {
    const controller = new AbortController()
    const [routeMode, points, walkingEnabled] = JSON.parse(key)
    setState({ key, routes: [], message: points.length > 1 ? '실제 이동 경로를 조회하고 있습니다…' : '' })
    const load = async () => {
      if (points.length < 2) return
      if (routeMode === 'walking' && !walkingEnabled) {
        setState({ key, routes: [], message: '도보 경로 조회는 코스 추천 화면에서만 제공합니다.' })
        return
      }
      if (!['walking', 'car', 'transit'].includes(routeMode)) throw new Error('이동 수단 정보가 없어 경로를 표시할 수 없습니다.')
      const routes = []
      const failures = []
      const legs = []
      let duration = 0
      let hasDuration = true
      let walkingLegs = 0
      for (let i = 1; i < points.length; i++) {
        if (controller.signal.aborted) return
        try {
        if (points[i][2] && points[i - 1][2] && points[i][2] !== points[i - 1][2] + 1) throw new Error('일부 장소의 좌표가 없어 전체 경로를 조회할 수 없습니다.')
        const request = async (requestedMode) => {
        const endpoint = requestedMode === 'walking' ? '/route/walking' : requestedMode === 'car' ? '/kakao/route' : '/route/time'
        const res = await fetch(`${getApiBaseUrl()}${endpoint}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({ origin: { lat: points[i - 1][0], lng: points[i - 1][1] },
            destination: { lat: points[i][0], lng: points[i][1] }, mode: requestedMode }),
        })
        const data = await res.json().catch(() => {
          throw new Error('길찾기 서버 응답을 확인하지 못했습니다. 백엔드를 재시작한 뒤 다시 시도해 주세요.')
        })
        if (!res.ok) throw new Error(data.message || '실제 이동 경로를 조회하지 못했습니다.')
        return data
        }
        const selected = routeMode === 'transit' && walkingEnabled
          ? await recommendedTransitRoute({ lat: points[i - 1][0], lng: points[i - 1][1] }, { lat: points[i][0], lng: points[i][1] }, request, controller.signal)
          : { data: await request(routeMode), mode: routeMode }
        const { data, mode: segmentMode } = selected
        const segments = segmentMode === 'walking' ? data.segments : segmentMode === 'car' ? [data.path] :
          (data.steps?.length ? data.steps.map(s => decodePolyline(s.encodedPolyline)) : [decodePolyline(data.encodedPolyline)])
        if (!segments?.length || segments.some(path => !path || path.length < 2)) throw new Error('실제 경로 좌표가 없습니다.')
        segments.forEach((path, index) => routes.push({
          mode: segmentMode === 'transit' && data.steps?.[index]?.travelMode === 'WALKING' ? 'walking' : segmentMode,
          path,
        }))
        if (routeMode === 'transit' && segmentMode === 'walking') walkingLegs++
        const steps = segmentMode === 'transit' ? (data.steps || []).map(step => ({
          label: step.travelMode === 'WALKING' ? '도보' : step.transitDetails?.lineShortName || step.transitDetails?.lineName || '버스·지하철',
          duration: step.duration,
        })) : []
        legs.push({ from: i - 1, to: i, mode: segmentMode, duration: data.duration, distance: data.distance, steps })
        if (typeof data.duration === 'number') duration += data.duration
        else hasDuration = false
        if (!controller.signal.aborted) setState({ key, routes: [...routes], legs: [...legs], message: `실제 경로 조회 중… (${i}/${points.length - 1}구간)` })
        } catch (error) {
          if (controller.signal.aborted) return
          failures.push({ from: points[i - 1][2] || i, to: points[i][2] || i + 1, message: error.message === 'Failed to fetch' ? '길찾기 서버에 연결하지 못했습니다. 백엔드 실행 상태를 확인해 주세요.' : error.message })
          hasDuration = false
        }
      }
      const modeLabel = { walking: '도보', car: '자동차', transit: '대중교통' }[routeMode]
      const message = failures.length
        ? (points.length === 2 ? failures[0].message : `${routes.length ? '일부 경로만 표시됩니다. ' : '경로를 표시하지 못했습니다. '}${failures.map(failure => `${failure.from}→${failure.to}: ${failure.message}`).join(' / ')}`)
        : `실제 ${modeLabel} 경로${walkingLegs ? ` · 가까운 ${walkingLegs}구간은 도보 추천` : ''}${hasDuration ? ` · 총 이동 약 ${Math.ceil(duration / 60)}분` : ''}`
      if (!controller.signal.aborted) setState({ key, routes, legs, message })
    }
    load().catch(error => {
      if (!controller.signal.aborted) setState({ key, routes: [], message: error.message })
    })
    return () => controller.abort()
  }, [key])
  return <>
    <KakaoMapView {...props} places={places} numberedPlaces memberRoutePaths={state.key === key ? state.routes : []} />
    <p role="status" style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-color, #17172B)', background: 'var(--card-bg, #F5F2FF)', padding: '10px 12px', borderRadius: 8 }}>{state.key === key ? state.message : '실제 이동 경로를 조회하고 있습니다…'}</p>
    {state.key === key && state.routes.length > 0 && <div aria-label="경로 색상 안내" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', fontSize: 12 }}>
      {[['#16A34A', '도보 구간'], ['#3366FF', '지하철·버스'], ['#FF0000', '자동차']].map(([color, label]) => (
        <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span aria-hidden="true" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', backgroundColor: color, flexShrink: 0 }} />
          {label}
        </span>
      ))}
    </div>}
    {state.key === key && state.legs?.length > 0 && <section aria-label="구간별 실제 이동 안내" style={{ marginTop: 12, fontSize: 13 }}>
      <strong>구간별 이동 종류와 시간</strong>
      <ol style={{ listStyle: 'none', padding: 0, margin: '8px 0' }}>
        {state.legs.map(leg => <li key={leg.from} style={{ padding: '10px 0', borderTop: '1px solid #E5E7EB' }}>
          <strong>{places[leg.from]?.orderNumber || leg.from + 1}. {places[leg.from]?.name || '출발 장소'} → {places[leg.to]?.orderNumber || leg.to + 1}. {places[leg.to]?.name || '도착 장소'}</strong>
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', margin: '8px 0' }}>
            <dt>이동 종류</dt><dd style={{ margin: 0 }}>{({ walking: '도보', transit: '대중교통', car: '자동차' })[leg.mode]}{mode === 'transit' && leg.mode === 'walking' ? ' · 가까운 구간 도보 추천' : ''}</dd>
            <dt>예상 소요 시간</dt><dd style={{ margin: 0 }}>{formatDuration(leg.duration)}</dd>
            <dt>이동 거리</dt><dd style={{ margin: 0 }}>{typeof leg.distance === 'number' && Number.isFinite(leg.distance) && leg.distance >= 0 ? `${Math.round(leg.distance).toLocaleString('ko-KR')}m` : '정보 없음'}</dd>
          </dl>
          {leg.steps.length > 0 && <p style={{ margin: 0, color: 'var(--secondary-text, #66657A)' }}>세부 구간: {leg.steps.map(step => `${step.label} ${formatDuration(step.duration)}`).join(' → ')}</p>}
        </li>)}
      </ol>
      <p style={{ margin: 0, color: 'var(--secondary-text, #66657A)' }}>길찾기 조회 시점의 예상 시간입니다. 경로 조회에 실패한 구간은 위 상태 안내를 확인해 주세요.</p>
    </section>}
  </>
}

function formatDuration(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '정보 없음'
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `약 ${minutes}분`
  return `약 ${Math.floor(minutes / 60)}시간${minutes % 60 ? ` ${minutes % 60}분` : ''}`
}
