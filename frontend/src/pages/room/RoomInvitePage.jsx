import { useState } from "react";
import { joinRoomByInviteCode } from "../../api/roomApi";
import { supabase } from "../../lib/supabaseClient";

function RoomInvitePage() {
  const [inviteCode, setInviteCode] = useState("");
  const [joinedRoom, setJoinedRoom] = useState(null);
  const [message, setMessage] = useState("");

  const handleJoinRoom = async () => {
    if (inviteCode.trim() === "") {
      alert("초대코드를 입력하세요.");
      return;
    }

    try {
      setMessage("사용자 인증 확인 중...");
      // 1. 현재 로그인한 사용자 Auth 계정 가져오기
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        alert("로그인이 필요합니다.");
        return;
      }

      // 💡 [핵심 추가] profiles 테이블에서 이 유저의 진짜 닉네임 낚아채기!
      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("nickname")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError) throw profileError;

      const userNickname = profileData?.nickname || "이름없는회원";

      // 💡 [개편] 기존에 id만 보내던 것에서, 방금 찾아낸 userNickname까지 같이 API로 쏴버립니다!
      // (만약 roomApi.js의 joinRoomByInviteCode 함수가 3번째 인자로 닉네임을 받게 설계되어 있어야 합니다)
      const result = await joinRoomByInviteCode(
        inviteCode,
        user.id,
        userNickname // 👈 닉네임 탑승!
      );

      setJoinedRoom(result.room);
      alert("방 입장 성공!");
    } catch (error) {
      alert(error.message);
      console.error(error);
    }
  };

  const handleGoRoom = () => {
    alert("RoomDetailPage는 다음 브랜치에서 구현 예정입니다.");
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

      <button onClick={handleJoinRoom}>
        방 입장하기
      </button>

      {joinedRoom && (
        <div>
          <h2>입장한 방</h2>

          <p>방 이름: {joinedRoom.roomname}</p>
          <p>초대코드: {joinedRoom.invitecode}</p>

          <button onClick={handleGoRoom}>
            방으로 바로가기
          </button>
        </div>
      )}
    </div>
  );
}

export default RoomInvitePage;