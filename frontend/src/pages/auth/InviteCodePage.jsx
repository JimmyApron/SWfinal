import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";

function InviteCodePage() {
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [step, setStep] = useState(1);

  const navigate = useNavigate();

  const handleVerifyCode = async (event) => {
    event.preventDefault();

    if (code.trim() === "") {
      setMessage("⚠️ 초대코드를 입력해 주세요.");
      return;
    }

    try {
      setMessage("초대코드 확인 중...");

      const { data, error } = await supabase
        .from("rooms")
        .select("invitecode")
        .eq("invitecode", code)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!data) {
        setMessage("❌ 존재하지 않는 초대코드입니다. 다시 확인해 주세요.");
        return;
      }

      setMessage("✅ 유효한 초대코드입니다. 입장 방식을 선택해 주세요.");
      setStep(2);
    } catch (err) {
      console.error(err);
      setMessage("서버 통신 중 오류가 발생했습니다.");
    }
  };

  return (
    <section
      style={{
        maxWidth: "400px",
        margin: "40px auto",
        padding: "20px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          opacity: step === 2 ? 0.5 : 1,
          pointerEvents: step === 2 ? "none" : "auto",
          marginBottom: "30px",
        }}
      >
        <h2>초대코드 입력</h2>

        <p
          style={{
            color: "#666",
            fontSize: "14px",
            marginBottom: "20px",
          }}
        >
          공유받으신 방의 초대코드를 입력하시면 입장 단계를 진행합니다.
        </p>

        <form onSubmit={handleVerifyCode}>
          <input
            type="text"
            placeholder="초대코드를 입력하세요"
            value={code}
            disabled={step === 2}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            style={{
              width: "100%",
              padding: "10px",
              fontSize: "16px",
              marginBottom: "10px",
              boxSizing: "border-box",
            }}
          />

          {step === 1 && (
            <button
              type="submit"
              style={{
                width: "100%",
                padding: "10px",
                fontSize: "16px",
                cursor: "pointer",
              }}
            >
              방 확인하기
            </button>
          )}
        </form>
      </div>

      {message && (
        <p
          style={{
            fontSize: "14px",
            marginBottom: "20px",
            fontWeight: "bold",
          }}
        >
          {message}
        </p>
      )}

      {step === 2 && (
        <div
          style={{
            borderTop: "1px dashed #ccc",
            paddingTop: "20px",
          }}
        >
          <h3 style={{ marginBottom: "20px" }}>입장 방식을 선택해 주세요</h3>

          <button
            onClick={() => navigate(`/login?inviteCode=${code}`)}
            style={{
              width: "100%",
              padding: "12px",
              marginBottom: "10px",
              cursor: "pointer",
            }}
          >
            기존 계정으로 로그인해서 입장
          </button>

          <button
            onClick={() => navigate(`login?inviteCode=${encodeURIComponent(code)}`)}
            style={{
              width: "100%",
              padding: "12px",
              marginBottom: "10px",
              cursor: "pointer",
            }}
          >
            새로 가입하고 입장
          </button>

          <button
            onClick={() => navigate(`/guest?inviteCode=${code}`)}
            style={{
              width: "100%",
              padding: "12px",
              marginBottom: "15px",
              cursor: "pointer",
            }}
          >
            로그인 없이 비회원으로 입장
          </button>

          <button
            type="button"
            onClick={() => {
              setStep(1);
              setMessage("");
            }}
            style={{
              background: "none",
              border: "none",
              color: "#999",
              textDecoration: "underline",
              cursor: "pointer",
              fontSize: "13px",
            }}
          >
            초대코드 다시 입력하기
          </button>
        </div>
      )}
    </section>
  );
}

export default InviteCodePage;