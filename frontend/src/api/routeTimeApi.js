const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000'

export async function getRouteTime({ origin, destination, mode }) {
  const response = await fetch(`${API_BASE_URL}/route/time`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      origin,
      destination,
      mode,
    }),
  })

  if (!response.ok) {
    throw new Error('이동시간 계산에 실패했습니다.')
  }

  return response.json()
}