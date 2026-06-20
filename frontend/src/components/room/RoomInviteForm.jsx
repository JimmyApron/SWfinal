import { useState } from "react";
import { joinRoomByInviteCode } from "../../api/roomApi";
import { supabase } from "../../lib/supabaseClient";

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #E5E7EB",
  borderRadius: "10px",
  fontSize: "14px",
  outline: "none",
  boxSizing: "border-box",
};

const primaryButtonStyle = {
  flex: 1,
  padding: "12px",
  backgroundColor: "#7C5CFF",
  color: "#fff",
  border: "none",
  borderRadius: "10px",
  fontSize: "14px",
  fontWeight: "700",
  cursor: "pointer",
};

const secondaryButtonStyle = {
  flex: 1,
  padding: "12px",
  backgroundColor: "#F5F5F5",
  color: "#333",
  border: "none",
  borderRadius: "10px",
  fontSize: "14px",
  fontWeight: "700",
  cursor: "pointer",
};

function RoomInviteForm({ onJoined, onCancel }) {
  const [inviteCode, setInviteCode] = useState("");
  const [joining, setJoining] = useState(false);

  const handleJoinRoom = async () => {
    if (inviteCode.trim() === "") {
      alert("초대코드를 입력하세요.");
      return;
    }

    try {
      setJoining(true);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        alert("로그인이 필요합니다.");
        return;
      }

      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("nickname")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError) throw profileError;

      const userNickname = profileData?.nickname || "이름없는회원";

      const result = await joinRoomByInviteCode(
        inviteCode,
        user.id,
        userNickname
      );

      onJoined?.(result.room.id);
    } catch (error) {
      alert(error.message);
      console.error(error);
    } finally {
      setJoining(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <label style={{ fontSize: "13px", fontWeight: "700", color: "#1F2933" }}>초대코드</label>
        <input
          type="text"
          placeholder="초대코드를 입력하세요"
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && handleJoinRoom()}
          style={inputStyle}
        />
      </div>

      <div style={{ display: "flex", gap: "8px" }}>
        {onCancel && (
          <button type="button" onClick={onCancel} style={secondaryButtonStyle}>
            취소
          </button>
        )}
        <button type="button" onClick={handleJoinRoom} disabled={joining} style={primaryButtonStyle}>
          {joining ? "입장 중..." : "방 입장하기"}
        </button>
      </div>
    </div>
  );
}

export default RoomInviteForm;
