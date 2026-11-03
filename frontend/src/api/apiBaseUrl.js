export function getApiBaseUrl() {
  return resolveApiBaseUrl(process.env.REACT_APP_API_BASE_URL || '/api',
    typeof window === 'undefined' ? null : window.location.href)
}

export function resolveApiBaseUrl(configuredBaseUrl, pageUrl) {
  const normalizedBaseUrl = configuredBaseUrl.replace(/\/$/, '')
  if (!pageUrl) return normalizedBaseUrl

  const page = new URL(pageUrl)
  const api = new URL(normalizedBaseUrl, page)
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]'])
  const pointsToVisitorsComputer = loopbackHosts.has(api.hostname) && !loopbackHosts.has(page.hostname)
  const mixedContent = page.protocol === 'https:' && api.protocol === 'http:'
  // Both the public site and the local development server proxy /api to Express.
  if (pointsToVisitorsComputer || mixedContent) return '/api'
  return normalizedBaseUrl
}
