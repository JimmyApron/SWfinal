import { useState } from "react";
import { createRoom } from "../api/roomApi";

function RoomCreatePage() {
  const [roomName, setRoomName] = useState("");
  const [description, setDescription] = useState("");
  const [createdRoom, setCreatedRoom] = useState(null);

  const handleCreateRoom = async () => {
    if (roomName.trim() === "") {
      alert("방 이름을 입력하세요.");
      return;
    }

    try {
      const result = await createRoom({
        roomName,
        description,
        userId: "test-user-1"
      });

      setCreatedRoom(result.room);
      alert("방이 생성되었습니다.");
    } catch (error) {
      alert("방 생성 실패");
      console.error(error);
    }
  };

  const handleCopyInviteCode = async () => {
    try {
      await navigator.clipboard.writeText(createdRoom.inviteCode);
      alert("초대코드가 복사되었습니다.");
    } catch (error) {
      alert("복사에 실패했습니다.");
      console.error(error);
    }
  };

  const handleGoRoom = () => {
    alert("방 상세 페이지는 다음 브랜치에서 구현 예정입니다.");
  };
  //const handleGoRoom = () => {
  //window.location.href = `/rooms/${createdRoom.id}`;
  //}; 방페이지 생성 후 연결
  return (
    <div>
      <h1>방 생성</h1>

      <input
        type="text"
        placeholder="방 이름"
        value={roomName}
        onChange={(e) => setRoomName(e.target.value)}
      />

      <textarea
        placeholder="방 설명"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <button onClick={handleCreateRoom}>방 만들기</button>

      {createdRoom && (
        <div>
          <h2>생성된 방</h2>
          <p>방 이름: {createdRoom.roomname}</p>
          <p>설명: {createdRoom.description}</p>
          <p>초대코드: {createdRoom.invitecode}</p>

          <button onClick={handleCopyInviteCode}>
            초대코드 복사하기
          </button>

          <button onClick={handleGoRoom}>
            생성된 방으로 바로가기
          </button>
        </div>
      )}
    </div>
  );
}

export default RoomCreatePage;