// Only GET metadata, never fetch rows or issue mutation requests. Never log secrets.
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { classify } = require('./step09-diagnose.cjs');
const root = path.resolve(__dirname, '..');
const frontend = dotenv.parse(fs.readFileSync(path.join(root, 'frontend/.env')));
const backend = dotenv.parse(fs.readFileSync(path.join(root, 'backend/.env')));
const tables = ['confirmed_schedules', 'schedule_creation_records', 'courses', 'course_stops', 'votes', 'voteoptions', 'vote_course_links', 'voteresponses', 'course_member_confirmations', 'schedule_finalizations', 'room_members', 'room_guests', 'room_messages'];
(async () => {
  console.log('Frontend/backend same Supabase URL: ' + (frontend.REACT_APP_SUPABASE_URL === backend.SUPABASE_URL));
  try {
    const key = frontend.REACT_APP_SUPABASE_ANON_KEY;
    const headers = { apikey: key, Accept: 'application/openapi+json' };
    if (key?.split('.').length === 3) headers.Authorization = `Bearer ${key}`;
    const response = await fetch(frontend.REACT_APP_SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/', {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    console.log('Supabase OpenAPI GET status: ' + response.status);
    if (!response.ok) {
      let body = {}; try { body = await response.json(); } catch {}
      console.log('Sanitized error: ' + JSON.stringify(classify(body)));
      process.exitCode = 1; return;
    }
    const spec = await response.json();
    const result = Object.fromEntries(tables.map((table) => [table, spec.definitions?.[table]?.properties || null]));
    // Definitions contain schema metadata only; discard server info, example rows and credentials.
    fs.writeFileSync(path.join(root, 'STEP08_SCHEMA_METADATA.json'), JSON.stringify(result, null, 2));
    for (const [table, properties] of Object.entries(result)) console.log(table + ': ' + (properties ? Object.keys(properties).join(', ') : 'not exposed to anonymous OpenAPI'));
  } catch (error) {
    console.log('Metadata request failed: ' + (error.cause?.code || error.name));
    process.exitCode = 2;
  }
})();
