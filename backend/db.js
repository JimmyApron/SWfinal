require('dotenv').config();

const { Client } = require('pg');

const client = new Client({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  ssl: {
    rejectUnauthorized: false,
  },
});

client.connect()
  .then(() => console.log('✅ Supabase 연결 성공'))
  .catch(err => console.error('❌ 연결 실패', err));

module.exports = client;