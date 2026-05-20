import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { joinRoomByInviteCode } from "../../api/roomApi";
import { supabase } from "../../lib/supabaseClient";

function RoomInvitePage() {
  const navigate = useNavigate();
  const [inviteCode, setInviteCode] = useState("");

  const handleJoinRoom = async () => {
    if (inviteCode.trim() === "") {
      alert("초대코드를 입력하세요.");
      return;
    }

    try {
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

      navigate(`/rooms/${result.room.id}`);
    } catch (error) {
      alert(error.message);
      console.error(error);
    }
  };

  return (
    <div>
      <h1>초대코드로 방 입장</h1>

      <input
        type="text"
        placeholder="초대코드 입력"
        value={inviteCode}
        onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
      />

      <button onClick={handleJoinRoom}>방 입장하기</button>
    </div>
  );
}

export default RoomInvitePage;