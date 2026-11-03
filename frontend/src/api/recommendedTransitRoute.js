function directDistance(origin, destination) {
  const radians = value => value * Math.PI / 180
  const a = Math.sin(radians(destination.lat - origin.lat) / 2) ** 2 +
    Math.cos(radians(origin.lat)) * Math.cos(radians(destination.lat)) *
    Math.sin(radians(destination.lng - origin.lng) / 2) ** 2
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, a)))
}

// Straight distance only rules out distant pairs; thresholds use the actual
// walking route. request('walking') uses the existing server-side TMAP cache.
export async function recommendedTransitRoute(origin, destination, request, signal) {
  let walking
  if (directDistance(origin, destination) <= 1000) {
    try {
      const data = await request('walking')
      if (typeof data.distance === 'number' && Number.isFinite(data.distance) && data.distance >= 0 &&
          data.segments?.length && data.segments.every(path => path.length >= 2)) walking = data
    } catch (error) {
      if (signal?.aborted) throw error
      // A missing walking route must not prevent public transit directions.
    }
  }
  if (walking && walking.distance <= 500) return { data: walking, mode: 'walking' }
  const transit = await request('transit')
  if (walking && walking.distance <= 1000 &&
      typeof walking.duration === 'number' && Number.isFinite(walking.duration) && walking.duration >= 0 &&
      typeof transit.duration === 'number' && Number.isFinite(transit.duration) && transit.duration >= 0 &&
      walking.duration <= transit.duration) return { data: walking, mode: 'walking' }
  return { data: transit, mode: 'transit' }
}
