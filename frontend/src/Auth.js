import React, { useState } from "react";
import { supabase } from "./lib/supabaseClient";

function Auth() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // 1. 회원가입 로직
  const handleSignUp = async (e) => {
    e.preventDefault();
    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      alert(`회원가입 실패: ${error.message}`);
    } else {
      alert("회원가입 성공! 가입하신 이메일의 인증 메일함을 확인하거나, Supabase 설정에 따라 바로 로그인해보세요.");
      console.log("가입 유저 정보:", data.user);
    }
    setLoading(false);
  };

  // 2. 로그인 로직
  const handleSignIn = async (e) => {
    e.preventDefault();
    setLoading(true);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      alert(`로그인 실패: ${error.message}`);
    } else {
      alert("로그인 성공!");
      console.log("로그인 유저 정보:", data.user);
    }
    setLoading(false);
  };

  return (
    <div style={{ maxWidth: "400px", margin: "50px auto", padding: "20px", border: "1px solid #ccc", borderRadius: "8px" }}>
      <h2>Supabase 인증 테스트</h2>
      <form style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <input
          type="email"
          placeholder="이메일 입력"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{ padding: "10px" }}
        />
        <input
          type="password"
          placeholder="비밀번호 입력"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={{ padding: "10px" }}
        />
        
        <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
          <button type="button" onClick={handleSignIn} disabled={loading} style={{ flex: 1, padding: "10px", backgroundColor: "#007bff", color: "white", border: "none", cursor: "pointer" }}>
            {loading ? "로딩 중..." : "로그인"}
          </button>
          <button type="button" onClick={handleSignUp} disabled={loading} style={{ flex: 1, padding: "10px", backgroundColor: "#28a745", color: "white", border: "none", cursor: "pointer" }}>
            {loading ? "로딩 중..." : "회원가입"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default Auth;