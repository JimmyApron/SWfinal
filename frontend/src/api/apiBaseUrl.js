export function getApiBaseUrl() {
  const configuredBaseUrl = process.env.REACT_APP_API_BASE_URL || '/api'
  const normalizedBaseUrl = configuredBaseUrl.replace(/\/$/, '')

  if (normalizedBaseUrl !== '/api' || typeof window === 'undefined') {
    return normalizedBaseUrl
  }

  const { hostname, port } = window.location
  const isDevServer = port && port !== '80' && port !== '443'

  if (!isDevServer) {
    return normalizedBaseUrl
  }

  const backendHostname =
    hostname === '0.0.0.0' || hostname === '[::1]' ? 'localhost' : hostname

  return `http://${backendHostname}:5000/api`
}
