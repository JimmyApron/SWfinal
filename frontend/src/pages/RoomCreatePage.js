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
      });

      setCreatedRoom(result.room);
      alert("방이 생성되었습니다.");
    } catch (error) {
      alert("방 생성 실패");
      console.error(error);
    }
  };

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
          <p>방 이름: {createdRoom.roomName}</p>
          <p>설명: {createdRoom.description}</p>
          <p>초대코드: {createdRoom.inviteCode}</p>
        </div>
      )}
    </div>
  );
}

export default RoomCreatePage;