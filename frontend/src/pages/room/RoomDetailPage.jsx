import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import ScheduleTab from "./ScheduleTab";
import MapPage from "../../components/map/MapPage";
import ChatTab from "../Chat/ChatTab";
import VoteListPage from "../vote/VoteListPage";

function RoomDetailPage() {
  const navigate = useNavigate();
  const { roomId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const [room, setRoom] = useState(null);
  const [tab, setTab] = useState(searchParams.get("tab") || "schedule");

  useEffect(() => {
    const queryTab = searchParams.get("tab");

    if (
      queryTab === "schedule" ||
      queryTab === "location" ||
      queryTab === "vote" ||
      queryTab === "chat"
    ) {
      setTab(queryTab);
    }
  }, [searchParams]);

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

  const handleChangeTab = (nextTab) => {
    setTab(nextTab);
    setSearchParams({ tab: nextTab });
  };

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
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100dvh - 64px)" }}>
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
        <button onClick={() => handleChangeTab("schedule")}>일정</button>
        <button onClick={() => handleChangeTab("location")}>위치</button>
        <button onClick={() => handleChangeTab("vote")}>투표</button>
        <button onClick={() => handleChangeTab("chat")}>채팅</button>
      </div>

      <hr style={{ margin: "0" }} />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: tab === "chat" ? "hidden" : "auto" }}>
        {tab === "schedule" && <ScheduleTab roomId={roomId} />}
        {tab === "location" && <MapPage roomId={roomId} />}
        {tab === "vote" && <VoteListPage roomid={roomId} />}
        {tab === "chat" && <ChatTab roomId={roomId} />}
      </div>
    </div>
  );
}

export default RoomDetailPage;