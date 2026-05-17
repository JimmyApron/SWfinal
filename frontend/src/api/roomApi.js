export async function createRoom(roomData) {
  const response = await fetch("http://localhost:3000/rooms", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(roomData),
  });

  const result = await response.json();

  if (!response.ok) {
    console.error("방 생성 실패 상세:", result);
    throw new Error(result.message || "방 생성 실패");
  }

  return result;
}