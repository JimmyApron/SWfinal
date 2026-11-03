import { resolveApiBaseUrl } from './apiBaseUrl'

test.each([
  ['http://localhost:5000/api', 'https://meetup-syk15151.apps.dauai.org/rooms/40?tab=calendar', '/api'],
  ['http://127.0.0.1:5000/api', 'https://meetup-syk15151.apps.dauai.org', '/api'],
  ['https://localhost:5000/api', 'https://meetup-syk15151.apps.dauai.org', '/api'],
  ['http://localhost:5000/api', 'http://192.168.1.20:8080', '/api'],
  ['/api', 'http://localhost:8080', '/api'],
  ['/api/', 'https://meetup-syk15151.apps.dauai.org', '/api'],
  ['http://localhost:5000/api/', 'http://localhost:8080', 'http://localhost:5000/api'],
  ['https://backend.example.com/api', 'https://meetup-syk15151.apps.dauai.org', 'https://backend.example.com/api'],
])('resolves %s from %s to %s', (configured, page, expected) => {
  expect(resolveApiBaseUrl(configured, page)).toBe(expected)
})
