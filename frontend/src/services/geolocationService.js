const GEOLOCATION_ERROR_MESSAGES = {
  1: '위치 권한이 거부되었습니다.',
  2: '현재 위치를 확인할 수 없습니다.',
  3: '위치 확인 시간이 초과되었습니다.',
}

function normalizeGeolocationError(error) {
  if (error instanceof Error) {
    return error
  }

  const normalizedError = new Error(
    GEOLOCATION_ERROR_MESSAGES[error?.code] || '현재 위치를 가져오지 못했습니다.'
  )

  normalizedError.name = error?.name || 'GeolocationError'
  normalizedError.code = error?.code
  normalizedError.originalError = error

  return normalizedError
}

export function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('이 브라우저에서는 위치 정보를 지원하지 않습니다.'))
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        })
      },
      (error) => {
        reject(normalizeGeolocationError(error))
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    )
  })
}

export function startWatchingPosition(onSuccess, onError) {
  if (!navigator.geolocation) {
    onError(new Error('이 브라우저에서는 위치 정보를 지원하지 않습니다.'))
    return null
  }

  const watchId = navigator.geolocation.watchPosition(
    (position) => {
      onSuccess({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
      })
    },
    (error) => {
      onError(normalizeGeolocationError(error))
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    }
  )

  return watchId
}

export function stopWatchingPosition(watchId) {
  if (watchId !== null && watchId !== undefined) {
    navigator.geolocation.clearWatch(watchId)
  }
}
