import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";

function RoomDetailPage() {
  const navigate = useNavigate();
  const { roomId } = useParams();

  const [room, setRoom] = useState(null);
  const [tab, setTab] = useState("schedule");

  useEffect(() => {
    const fetchRoom = async () => {
      const { data, error } = await supabase
        .from("rooms")
        .select("*")
        .eq("id", roomId)
        .single();

      if (error) {
        console.error("방 정보 조회 실패:", error);
        return;
      }

      setRoom(data);
    };

    fetchRoom();
  }, [roomId]);

  const handleCopyInviteCode = async () => {
    if (!room) return;

    try {
      await navigator.clipboard.writeText(room.invitecode);
      alert("초대코드가 복사되었습니다.");
    } catch (error) {
      alert("복사에 실패했습니다.");
      console.error(error);
    }
  };

  return (
    <div>
      <button onClick={() => navigate("/home")}>← 홈으로</button>

      <h1>방 상세 페이지</h1>

      {room && (
        <div>
          <p>초대코드: {room.invitecode}</p>
          <button onClick={handleCopyInviteCode}>초대코드 복사하기</button>
        </div>
      )}

      <div>
        <button onClick={() => setTab("schedule")}>일정</button>
        <button onClick={() => setTab("location")}>위치</button>
        <button onClick={() => setTab("vote")}>투표</button>
        <button onClick={() => setTab("chat")}>채팅</button>
      </div>

      <hr />

      {tab === "schedule" && <div>일정 기능 들어올 자리</div>}
      {tab === "location" && <div>위치 기능 들어올 자리</div>}
      {tab === "vote" && <div>투표 기능 들어올 자리</div>}
      {tab === "chat" && <div>채팅 기능 들어올 자리</div>}
    </div>
  );
}

export default RoomDetailPage;