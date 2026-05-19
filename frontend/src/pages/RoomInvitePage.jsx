import { useState } from "react";
import { joinRoomByInviteCode } from "../api/roomApi";

function RoomInvitePage() {
  const [inviteCode, setInviteCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [joinedRoom, setJoinedRoom] = useState(null);

  const handleJoinRoom = async () => {
    if (inviteCode.trim() === "") {
      alert("초대코드를 입력하세요.");
      return;
    }

    if (nickname.trim() === "") {
      alert("닉네임을 입력하세요.");
      return;
    }

    try {
      const result = await joinRoomByInviteCode(inviteCode, null, nickname); 

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

      <input 
        type="text"
        placeholder="닉네임 입력"
        value={nickname}
        onChange={(e) => setNickname(e.target.value)}
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