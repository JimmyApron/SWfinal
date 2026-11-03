export async function readApiJson(response, failureMessage) {
  const contentType = response.headers.get('content-type') || ''
  if (!/\bapplication\/(?:[\w.-]+\+)?json\b/i.test(contentType)) {
    throw new Error('API 서버에 연결하지 못했습니다. 새로고침 후 다시 시도해 주세요.')
  }
  let result
  try { result = await response.json() }
  catch { throw new Error('서버 응답을 읽지 못했습니다. 다시 시도해 주세요.') }
  if (!response.ok) throw new Error(result?.message || failureMessage)
  return result
}
