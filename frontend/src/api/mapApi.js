const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || "http://localhost:3000/api";

export async function saveMyLocation(locationData) {
  const response = await fetch(`${API_BASE_URL}/locations/me`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(locationData),
  });

  if (!response.ok) {
    throw new Error("내 위치 저장에 실패했습니다.");
  }

  return response.json();
}

export async function getMyLocation() {
  const response = await fetch(`${API_BASE_URL}/locations/me`, {
    method: "GET",
  });

  if (!response.ok) {
    throw new Error("내 위치 조회에 실패했습니다.");
  }

  return response.json();
}

export async function getRoomMemberLocations(roomId) {
  const response = await fetch(`${API_BASE_URL}/rooms/${roomId}/locations`, {
    method: "GET",
  });

  if (!response.ok) {
    throw new Error("방 멤버 위치 조회에 실패했습니다.");
  }

  return response.json();
}