import { getApiBaseUrl } from './apiBaseUrl'

const API_BASE_URL = getApiBaseUrl()

export async function getRouteTime({ origin, destination, mode }) {
  const url = `${API_BASE_URL}/route/time`
  const requestBody = {
    origin,
    destination,
    mode,
  }

  let response

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })
  } catch (error) {
    console.error('[Route API] 서버 연결 실패', {
      url,
      apiBaseUrl: API_BASE_URL,
      requestBody,
      error,
    })
    throw new Error('경로 API 서버에 연결하지 못했습니다.')
  }

  if (!response.ok) {
    const responseBody = await readResponseBody(response)

    console.error('[Route API] 이동시간 계산 실패', {
      url,
      status: response.status,
      statusText: response.statusText,
      requestBody,
      responseBody,
    })

    throw new Error(responseBody?.message || '이동시간 계산에 실패했습니다.')
  }

  const data = await response.json()

  if (data?.duration === undefined || data?.distance === undefined) {
    console.warn('[Route API] 이동시간 응답 형식 확인 필요', {
      url,
      requestBody,
      responseBody: data,
    })
  }

  return data
}

async function readResponseBody(response) {
  const contentType = response.headers.get('content-type') || ''

  try {
    if (contentType.includes('application/json')) {
      return await response.json()
    }

    return await response.text()
  } catch (error) {
    return {
      message: '응답 본문을 읽지 못했습니다.',
      error: error.message,
    }
  }
}
