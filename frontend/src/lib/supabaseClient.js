import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        detectSessionInUrl: true,   // ← URL의 토큰 자동 감지
        persistSession: true,        // ← 세션 로컬스토리지에 저장
        autoRefreshToken: true,      // ← 토큰 자동 갱신
  }
});
