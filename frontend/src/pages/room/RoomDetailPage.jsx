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

  // ⚙️ 기능 연동을 위한 추가 State들
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [newRoomName, setNewRoomName] = useState("");
  
  // 👥 회원 + 비회원 멤버 리스트 State
  const [members, setMembers] = useState([]);
  const [guests, setGuests] = useState([]);
  
  // 🔔 탭별 세부 알림 온오프 설정 State (기본값 true)
  const [notifSettings, setNotifSettings] = useState({
    schedule: true,
    location: true,
    vote: true,
    chat: true,
  });

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

  // 📥 방 정보 및 전체 멤버(회원+게스트) 가져오기 + 내 알림 설정 데이터 연동
  const fetchRoomData = async () => {
    // 1. 방 정보 및 회원 수 카운트
    const { data: roomData, error: roomError } = await supabase
      .from("rooms")
      .select(`*, room_members(count)`)
      .eq("id", roomId)
      .single();

    if (roomError) {
      console.error("방 정보 조회 실패:", roomError);
      return;
    }
    setRoom(roomData);
    setNewRoomName(roomData.roomname);

    // 2. room_members 외래키 연동을 통해 profiles 테이블의 profileimageurl 조인해서 땡겨오기
    const { data: memberData, error: memberError } = await supabase
      .from("room_members")
      .select(`
        id, 
        nickname, 
        userid,
        profiles (
          profileimageurl
        )
      `)
      .eq("roomid", roomId);

    if (!memberError) {
      setMembers(memberData || []);
    } else {
      console.error("회원 목록 조회 실패:", memberError);
    }

    // 3. room_guests 테이블에서 비회원 게스트 닉네임 목록 땡겨오기
    const { data: guestData, error: guestError } = await supabase
      .from("room_guests")
      .select("id, nickname")
      .eq("roomid", roomId);

    if (!guestError) {
      setGuests(guestData || []);
    }

    // 4. 🔔 내 알림 설정 데이터 연동 (회원 / 비회원 크로스 체크) ⭐
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      // 🟢 [회원] room_members에서 알림 정보 가져오기
      const { data: myMemberData, error: myMemberError } = await supabase
        .from("room_members")
        .select("schedulenotifenabled, locationnotifenabled, votenotifenabled, chatnotifenabled")
        .eq("roomid", roomId)
        .eq("userid", user.id)
        .single();

      if (!myMemberError && myMemberData) {
        setNotifSettings({
          schedule: myMemberData.schedulenotifenabled,
          location: myMemberData.locationnotifenabled,
          vote: myMemberData.votenotifenabled,
          chat: myMemberData.chatnotifenabled,
        });
      }
    } else {
      // 🟡 [비회원] sessionStorage에 있는 닉네임으로 room_guests에서 알림 정보 가져오기
      const guestNickname = sessionStorage.getItem("guestNickname");
      if (guestNickname) {
        const { data: myGuestData, error: myGuestError } = await supabase
          .from("room_guests")
          .select("schedulenotifenabled, locationnotifenabled, votenotifenabled, chatnotifenabled")
          .eq("roomid", roomId)
          .eq("nickname", guestNickname)
          .single();

        if (!myGuestError && myGuestData) {
          setNotifSettings({
            schedule: myGuestData.schedulenotifenabled,
            location: myGuestData.locationnotifenabled,
            vote: myGuestData.votenotifenabled,
            chat: myGuestData.chatnotifenabled,
          });
        }
      }
    }
  };

  useEffect(() => {
    fetchRoomData();
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

  // ✏️ 1. 방 제목 변경 기능
  const handleUpdateRoomName = async () => {
    if (!newRoomName.trim()) return;
    const { error } = await supabase
      .from("rooms")
      .update({ roomname: newRoomName })
      .eq("id", roomId);

    if (error) {
      alert("방 제목 변경 실패!");
      console.error(error);
    } else {
      setRoom({ ...room, roomname: newRoomName });
      setIsEditingTitle(false);
      alert("방 제목이 새롭게 변경되었습니다!");
    }
  };

  // 🔔 2. 탭별 알림 세부 설정 토글 함수 (회원 + 비회원 동시 커버 버전!) ⭐
  const handleToggleNotification = async (tabName) => {
    const { data: { user } } = await supabase.auth.getUser();
    
    // 바뀔 새로운 상태 계산 (기존 상태 반대로 뒤집기)
    const nextValue = !notifSettings[tabName];

    // DB 컬럼명 매핑 (언더바 없는 소문자 4종 세트)
    const dbColumnMap = {
      schedule: "schedulenotifenabled",
      location: "locationnotifenabled",
      vote: "votenotifenabled",
      chat: "chatnotifenabled",
    };
    const columnName = dbColumnMap[tabName];

    if (user) {
      // 🟢 [회원] room_members 테이블 업데이트
      const { error } = await supabase
        .from("room_members")
        .update({ [columnName]: nextValue })
        .eq("roomid", roomId)
        .eq("userid", user.id);

      if (error) {
        console.error("회원 알림 설정 저장 실패:", error);
        alert("알림 설정 변경에 실패했습니다.");
        return;
      }
    } else {
      // 🟡 [비회원] room_guests 테이블 업데이트
      const guestNickname = sessionStorage.getItem("guestNickname");
      if (!guestNickname) {
        alert("게스트 정보를 확인할 수 없어 설정을 변경할 수 없습니다.");
        return;
      }

      const { error } = await supabase
        .from("room_guests")
        .update({ [columnName]: nextValue })
        .eq("roomid", roomId)
        .eq("nickname", guestNickname);

      if (error) {
        console.error("게스트 알림 설정 저장 실패:", error);
        alert("알림 설정 변경에 실패했습니다.");
        return;
      }
    }

    // 🎯 DB에 정상적으로 저장이 성공 완료된 경우에만 리액트 화면 State 변경!
    setNotifSettings((prev) => ({
      ...prev,
      [tabName]: nextValue,
    }));
  };

  // 🚪 3. 방 나가기 기능
  const handleLeaveRoom = async () => {
    if (!window.confirm("정말 이 방을 나가시겠습니까? 나가면 내역이 삭제됩니다.")) return;

    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      const { error } = await supabase
        .from("room_members")
        .delete()
        .eq("roomid", roomId)
        .eq("userid", user.id);

      if (error) {
        alert("방 나가기 실패!");
        console.error(error);
        return;
      }
    } else {
      const guestNickname = sessionStorage.getItem("guestNickname");
      
      if (!guestNickname) {
        alert("게스트 정보를 찾을 수 없습니다.");
        return;
      }

      const { error } = await supabase
        .from("room_guests")
        .delete()
        .eq("roomid", roomId)
        .eq("nickname", guestNickname);

      if (error) {
        alert("게스트 퇴장 실패!");
        console.error(error);
        return;
      }
    }

    alert("방에서 성공적으로 퇴장했습니다.");
    navigate("/home");
  };

  if (!room) {
    return <div>로딩 중...</div>;
  }

  return (
    <div style={{ position: "relative", minHeight: "100vh", overflowX: "hidden" }}>
      {/* 헤더 영역 */}
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px", backgroundColor: "#f5f5f5" }}>
        <button onClick={() => navigate("/home")}>←</button>
        <span>{room.roomname}</span>
        <span>총 {members.length + guests.length}명</span>
        <button onClick={() => setIsSidebarOpen(true)}>⚙</button>
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

      <hr />

      <div>
        {tab === "schedule" && <ScheduleTab roomId={roomId} />}
        {tab === "location" && <MapPage roomId={roomId} />}
        {tab === "vote" && <VoteListPage roomid={roomId} />}
        {tab === "chat" && <ChatTab roomId={roomId} />}
      </div>

      {/* 우측 사이드바 드로어 UI */}
      {isSidebarOpen && (
        <div style={{
          position: "fixed", top: 0, right: 0, width: "270px", height: "100vh",
          backgroundColor: "white", boxShadow: "-2px 0 5px rgba(0,0,0,0.2)",
          zIndex: 1000, padding: "20px", display: "flex", flexDirection: "column", justifyContent: "space-between",
          boxSizing: "border-box"
        }}>
          <div>
            <button onClick={() => setIsSidebarOpen(false)} style={{ float: "right" }}>X</button>
            <h3 style={{ marginTop: 0 }}>방 설정</h3>
            <hr />

            {/* 1️⃣ 방 제목 실시간 변경 */}
            <div style={{ marginBottom: "25px" }}>
              <h4 style={{ margin: "0 0 10px 0" }}>✏️ 방 제목 변경</h4>
              {isEditingTitle ? (
                <div style={{ display: "flex", gap: "5px" }}>
                  <input 
                    type="text" 
                    value={newRoomName} 
                    onChange={(e) => setNewRoomName(e.target.value)} 
                    style={{ flex: 1, padding: "6px", border: "1px solid #ddd", borderRadius: "5px" }} 
                  />
                  <button onClick={handleUpdateRoomName} style={{ background: "#8366F4", color: "white", border: "none", borderRadius: "5px", padding: "6px 10px", cursor: "pointer", fontWeight: "600" }}>저장</button>
                  <button onClick={() => setIsEditingTitle(false)} style={{ background: "#F1F1F1", color: "#333", border: "none", borderRadius: "5px", padding: "6px 10px", cursor: "pointer" }}>취소</button>
                </div>
              ) : (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: "600" }}>{room.roomname}</span>
                  <button onClick={() => setIsEditingTitle(true)} style={{ background: "#8366F4", color: "white", border: "none", borderRadius: "5px", padding: "4px 10px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}>수정</button>
                </div>
              )}
            </div>

            {/* 2️⃣ 탭별 알림 세부 설정 (ON 단추 보라색 컬러 테마 매칭) */}
            <div style={{ marginBottom: "25px" }}>
              <h4 style={{ margin: "0 0 10px 0" }}>🔔 탭별 알림 온/오프</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {["schedule", "location", "vote", "chat"].map((t) => (
                  <div key={t} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "14px" }}>
                      {t === "schedule" && "📅 일정 알림"}
                      {t === "location" && "🗺️ 위치 알림"}
                      {t === "vote" && "🗳️ 투표 알림"}
                      {t === "chat" && "💬 채팅 알림"}
                    </span>
                    <button 
                      onClick={() => handleToggleNotification(t)}
                      style={{ 
                        background: notifSettings[t] ? "#8366F4" : "#E0E0E0", 
                        color: notifSettings[t] ? "white" : "#666", 
                        border: "none", borderRadius: "20px", 
                        padding: "4px 12px", cursor: "pointer", fontSize: "12px", fontWeight: "bold",
                        transition: "all 0.2s ease"
                      }}
                    >
                      {notifSettings[t] ? "ON" : "OFF"}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* 3️⃣ 참여자 명단 출력 */}
            <div style={{ marginBottom: "25px" }}>
              <h4 style={{ margin: "0 0 10px 0" }}>👥 참여자 명단 ({members.length + guests.length}명)</h4>
              <div style={{ maxHeight: "230px", overflowY: "auto", border: "1px solid #eee", padding: "10px", borderRadius: "5px", backgroundColor: "#fafafa" }}>
                
                {/* 🟢 회원 리스트 출력 */}
                {members.map((m) => {
                  const imageUrl = m.profiles?.profileimageurl;

                  return (
                    <div key={m.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "6px 0", borderBottom: "1px solid #f0f0f0" }}>
                      {imageUrl ? (
                        <img 
                          src={imageUrl} 
                          alt="프로필" 
                          style={{ width: "32px", height: "32px", borderRadius: "50%", objectFit: "cover", border: "1px solid #ddd" }} 
                        />
                      ) : (
                        <div style={{ width: "32px", height: "32px", borderRadius: "50%", backgroundColor: "#e0e0e0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px" }}>👤</div>
                      )}
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontSize: "14px", fontWeight: "600", color: "#333" }}>{m.nickname || "이름없음"}</span>
                        <span style={{ fontSize: "11px", color: "#8366F4", fontWeight: "600" }}>회원</span>
                      </div>
                    </div>
                  );
                })}

                {/* 🟡 비회원 게스트 리스트 출력 */}
                {guests.map((g) => (
                  <div key={g.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "6px 0", borderBottom: "1px solid #f0f0f0" }}>
                    <div style={{ width: "32px", height: "32px", borderRadius: "50%", backgroundColor: "#ffeaa7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px" }}>🐱</div>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: "14px", fontWeight: "600", color: "#555" }}>{g.nickname}</span>
                      <span style={{ fontSize: "11px", color: "#e67e22" }}>게스트</span>
                    </div>
                  </div>
                ))}

                {members.length === 0 && guests.length === 0 && (
                  <p style={{ fontSize: "13px", color: "#999", textAlign: "center" }}>참여자가 없습니다.</p>
                )}
              </div>
            </div>
          </div>

          {/* 4️⃣ 방 나가기 버튼 */}
          <div>
            <hr />
            <button 
              onClick={handleLeaveRoom}
              style={{ 
                width: "100%", padding: "12px", background: "#f44336", color: "white", 
                border: "none", borderRadius: "5px", fontWeight: "bold", cursor: "pointer", fontSize: "14px" 
              }}
            >
              🚪 방 나가기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default RoomDetailPage;