const { createProxyMiddleware } = require('http-proxy-middleware')

module.exports = function (app) {
  // CRA's package.json proxy rewrites Origin to the backend URL. Google
  // popup code exchange must validate and use the browser's original origin.
  app.use(createProxyMiddleware('/api', {
    target: 'http://localhost:5000',
    changeOrigin: true,
  }))
}
