// Run the actual Express server and routes with only its DB-writing background job disabled.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const { createRequire } = require('module');
const serverFile = path.resolve(__dirname, '../backend/server.js');
const backendRequire = createRequire(serverFile);
const realExpress = backendRequire('express');
let server;
let ready;
const started = new Promise((resolve) => { ready = resolve; });
function express() {
  const app = realExpress();
  app.listen = () => { server = http.createServer(app).listen(0, '127.0.0.1', ready); return server; };
  return app;
}
express.json = realExpress.json;
const requireSafe = (name) => {
  if (name === 'express') return express;
  if (name === './jobs/voteJob') return { startVoteCloserJob: () => console.log('DB-writing vote job: disabled in smoke harness') };
  if (name === 'dotenv') return { config: () => ({}) };
  return backendRequire(name);
};
(async () => {
  try {
    vm.runInNewContext(fs.readFileSync(serverFile, 'utf8'), { require: requireSafe, console: { log() {} }, process, setInterval, setTimeout }, { filename: serverFile });
    await started;
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [route, method, body, expected] of [
      ['/', 'GET', null, 200],
      ['/api/route/time', 'POST', {}, 400],
      ['/api/google/place-rating', 'POST', {}, 400],
      ['/api/kakao/route', 'POST', {}, 400],
    ]) {
      const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      console.log(`${method} ${route}: ${response.status} (expected ${expected})`);
      if (response.status !== expected) process.exitCode = 1;
    }
  } finally { if (server) server.close(); }
})().catch((error) => { console.log('Smoke error: ' + error.code); process.exitCode = 1; });
