import { useEffect, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import ScheduleTab from "./ScheduleTab";
import VoteListPage from "../vote/VoteListPage";

function RoomDetailPage() {
  const navigate = useNavigate();
  const { roomId } = useParams();
  const location = useLocation();

  const [room, setRoom] = useState(null);
  const [tab, setTab] = useState(location.state?.selectedTab || "schedule");

  useEffect(() => {
    const fetchRoom = async () => {
      const { data, error } = await supabase
        .from("rooms")
        .select(`
          *,
          room_members(count)
        `)
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

  if (!room) {
    return <div>로딩 중...</div>;
  }

  return (
    <div>
      <header>
        <button onClick={() => navigate("/home")}>←</button>

        <span>{room.roomname}</span>

        <span>{room.room_members?.[0]?.count || 0}명</span>

        <button>⚙</button>
      </header>

      <div>
        <p>초대코드: {room.invitecode}</p>
        <button onClick={handleCopyInviteCode}>초대코드 복사하기</button>
      </div>

      <div>
        <button onClick={() => setTab("schedule")}>일정</button>
        <button onClick={() => setTab("location")}>위치</button>
        <button onClick={() => setTab("vote")}>투표</button>
        <button onClick={() => setTab("chat")}>채팅</button>
      </div>

      <hr />

      {tab === "schedule" && <ScheduleTab roomId={roomId} />}
      {tab === "location" && <div>위치 기능 준비 중</div>}
      {tab === "vote" && <VoteListPage roomid={roomId} />}
      {tab === "chat" && <div>채팅 기능 준비 중</div>}
    </div>
  );
}

export default RoomDetailPage;