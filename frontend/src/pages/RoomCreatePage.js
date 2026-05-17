import { useState } from "react";

function RoomCreatePage() {
  const [roomName, setRoomName] = useState("");

  const createRoom = async () => {
    await fetch("http://localhost:3000/rooms", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        roomName,
      }),
    });
  };

  return (
    <div>
      <h1>방 생성</h1>

      <input
        type="text"
        value={roomName}
        onChange={(e) => setRoomName(e.target.value)}
      />

      <button onClick={createRoom}>
        방 만들기
      </button>
    </div>
  );
}

export default RoomCreatePage;