const client = require('./db.js');

async function run() {
  try {
    await client.query('ALTER TABLE votes ADD COLUMN IF NOT EXISTS is_reminder_sent BOOLEAN DEFAULT FALSE;');
    console.log('✅ votes 테이블에 is_reminder_sent 컬럼 추가 성공!');

    await client.query('ALTER TABLE user_locations ADD COLUMN IF NOT EXISTS is_arrival_notified BOOLEAN DEFAULT FALSE;');
    console.log('✅ user_locations 테이블에 is_arrival_notified 컬럼 추가 성공!');
  } catch (err) {
    console.error('❌ 컬럼 추가 실패:', err);
  } finally {
    client.end();
  }
}

run();
