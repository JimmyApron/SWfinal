const assert = require('node:assert/strict');
const express = require('express');
let db, operations, concurrentChange, failUpdate, denyMember;
const client = {
  auth: { getUser: async () => ({ data: { user: { id: 'member' } }, error: null }) },
  from(table) {
    const filters = [];
    let update, single = false;
    const query = {
      select: () => query,
      eq: (key, value) => { filters.push(row => String(row[key]) === String(value)); return query; },
      maybeSingle: () => { single = true; return query; },
      update: payload => { update = payload; return query; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          operations.push({ table, update });
          if (table === 'room_members' && denyMember) return { data: null, error: null };
          if (table === 'schedule_finalizations' && update) {
            if (concurrentChange) db.schedule_finalizations[0].course_id = 77;
            if (failUpdate) return { data: null, error: { message: 'write failure' } };
          }
          const rows = db[table].filter(row => filters.every(filter => filter(row)));
          if (update) rows.forEach(row => Object.assign(row, update));
          return { data: single ? (rows[0] ? { ...rows[0] } : null) : rows.map(row => ({ ...row })), error: null };
        }).then(resolve, reject);
      },
    };
    return query;
  },
};
const sdkPath = require.resolve('@supabase/supabase-js');
const sdk = require(sdkPath);
require.cache[sdkPath].exports = { createClient: () => client };
const router = require('./course');
require.cache[sdkPath].exports = sdk;
process.env.SUPABASE_URL = 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
const app = express(); app.use(express.json()); app.use(router);
function reset() {
  db = {
    confirmed_schedules: [{ id: 2, roomid: 1, title: 'Meeting' }],
    room_members: [{ userid: 'member', roomid: 1, nickname: 'Me' }], room_guests: [], rooms: [{ id: 1 }],
    courses: [{ id: 3, schedule_id: 2, room_id: 1 }], course_stops: [{ id: 1, course_id: 3 }],
    schedule_finalizations: [{ id: 5, schedule_id: 2, course_id: 9 }],
    votes: [{ scheduleid: 2, votetype: 'course', isclosed: false }],
  };
  operations = []; concurrentChange = false; failUpdate = false; denyMember = false;
}
const server = app.listen(0, '127.0.0.1', async () => {
  const request = async (body = {}, authenticated = true) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/replace-finalization`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer test' } : {}) },
      body: JSON.stringify({ scheduleId: 2, courseId: 3, expectedCourseId: 9, ...body }),
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    reset();
    assert.equal((await request()).status, 200);
    assert.equal(db.schedule_finalizations.length, 1);
    assert.equal(db.schedule_finalizations[0].id, 5);
    assert.equal(db.schedule_finalizations[0].course_id, 3);
    assert.equal(db.votes[0].isclosed, true);
    assert.equal((await request()).status, 200); // Retry after response loss.
    reset(); concurrentChange = true;
    assert.equal((await request()).status, 409);
    assert.equal(db.schedule_finalizations[0].course_id, 77);
    reset(); failUpdate = true;
    assert.equal((await request()).status, 500);
    assert.equal(db.schedule_finalizations[0].course_id, 9);
    reset(); db.courses[0].room_id = 99;
    assert.equal((await request()).status, 400);
    assert.equal(db.schedule_finalizations[0].course_id, 9);
    reset(); db.course_stops = [];
    assert.equal((await request()).status, 400);
    reset(); denyMember = true;
    assert.equal((await request()).status, 403);
    assert.equal(operations.some(operation => operation.update), false);
    reset();
    assert.equal((await request({}, false)).status, 401);
    assert.equal((await request({ courseId: -1 })).status, 400);
    console.log('course replacement tests passed (replacement, retry, concurrency, failure, scope and auth)');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { server.close(); }
});
