export function calculateDistanceKm(location1, location2) {
  const earthRadiusKm = 6371

  const lat1 = toRadian(location1.lat)
  const lat2 = toRadian(location2.lat)

  const latDiff = toRadian(location2.lat - location1.lat)
  const lngDiff = toRadian(location2.lng - location1.lng)

  const a =
    Math.sin(latDiff / 2) * Math.sin(latDiff / 2) +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(lngDiff / 2) *
      Math.sin(lngDiff / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return earthRadiusKm * c
}

export function calculateProgressPercent(startLocation, currentLocation, destinationLocation) {
  const totalDistance = calculateDistanceKm(startLocation, destinationLocation)
  const remainingDistance = calculateDistanceKm(currentLocation, destinationLocation)

  if (totalDistance === 0) {
    return 100
  }

  const progress = ((totalDistance - remainingDistance) / totalDistance) * 100

  return Math.max(0, Math.min(100, Math.round(progress)))
}

function toRadian(degree) {
  return degree * (Math.PI / 180)
}