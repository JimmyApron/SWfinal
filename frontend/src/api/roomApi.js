export async function createRoom(roomData) {
  const response = await fetch("http://localhost:3000/rooms", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(roomData),
  });

  if (!response.ok) {
    throw new Error("방 생성 실패");
  }

  return await response.json();
}