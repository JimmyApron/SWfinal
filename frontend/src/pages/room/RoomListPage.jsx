import { useEffect, useState, useCallback } from "react";
import { getRooms } from "../../api/roomApi";
import { supabase } from "../../lib/supabaseClient";
import { useNavigate } from "react-router-dom";

function formatRelativeTime(dateStr) {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  if (diffHr < 24) return `${diffHr}시간 전`;
  if (diffDay < 7) return `${diffDay}일 전`;
  
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function RoomListPage() {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState([]);
  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);

  // 방 목록 동기화 함수
  const handleGetRooms = useCallback(async (currentId) => {
    const id = currentId || userId;
    if (!id) return;
    try {
      const result = await getRooms(id);
      if (result && result.rooms) {
        setRooms(result.rooms);
      }
    } catch (e) {
      console.error("방 목록 로딩 실패:", e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      let currentId = user?.id || localStorage.getItem("guest_id");

      if (currentId) {
        setUserId(currentId);
        handleGetRooms(currentId);
      } else {
        setLoading(false);
      }
    };
    init();
  }, [handleGetRooms]);

  useEffect(() => {
    if (!userId) {
      console.log("[RoomList] userId가 없어서 구독을 보류합니다.");
      return;
    }

    console.log(`[RoomList] 실시간 구독 시작. 대상 userId: ${userId}`);
    const channelName = `room-list-engine-${userId}-${Date.now()}`; // 충돌 방지를 위해 Date.now() 추가
    const channel = supabase.channel(channelName);

    channel
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `receiverid=eq.${userId}`,
        },
        (payload) => {
          console.log("[RoomList] 🚀 알림 테이블 신호 수신:", payload);

          if (payload.eventType === "INSERT") {
            const newNotif = payload.new;
            console.log("[RoomList] INSERT 이벤트 처리 중... roomid:", newNotif.roomid);
            
            if (newNotif.roomid) {
              setRooms((prevRooms) => {
                const targetIdx = prevRooms.findIndex(r => String(r.id) === String(newNotif.roomid));
                
                if (targetIdx === -1) {
                  console.log(`[RoomList] ⚠️ 목록에 없는 방(${newNotif.roomid})입니다. 동기화를 요청합니다.`);
                  handleGetRooms(); 
                  return prevRooms;
                }

                console.log(`[RoomList] ✅ 방(${newNotif.roomid}) 발견! 즉시 숫자를 올립니다.`);
                const targetRoom = prevRooms[targetIdx];
                const updatedRoom = {
                  ...targetRoom,
                  unreadCount: (targetRoom.unreadCount || 0) + 1,
                  lastactivityat: newNotif.createdat || new Date().toISOString()
                };

                const filtered = prevRooms.filter(r => String(r.id) !== String(newNotif.roomid));
                return [updatedRoom, ...filtered];
              });
            } else {
              console.log("[RoomList] ⚠️ 알림에 roomid가 없습니다.");
            }
          } else {
            console.log(`[RoomList] ${payload.eventType} 이벤트 발생. 백그라운드 동기화 요청.`);
            handleGetRooms();
          }
        }
      )
      .subscribe((status) => {
        console.log(`[RoomList] 채널(${channelName}) 연결 상태:`, status);
      });

    return () => {
      console.log(`[RoomList] 채널(${channelName}) 구독 해제.`);
      supabase.removeChannel(channel);
    };
  }, [userId, handleGetRooms]);

  if (loading) {
    return <div style={{ padding: "20px", textAlign: "center" }}>로딩 중...</div>;
  }

  return (
    <div style={{ padding: "0", backgroundColor: "#fff", minHeight: "100vh" }}>
      <header style={{ 
        padding: "20px", 
        borderBottom: "1px solid #eee",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center"
      }}>
        <h1 style={{ margin: 0, fontSize: "24px" }}>방 목록</h1>
      </header>

      {rooms.length === 0 ? (
        <div style={{ padding: "40px 20px", textAlign: "center", color: "#888" }}>
          <p>참여 중인 방이 없습니다.</p>
        </div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {rooms.map((room) => (
            <li 
              key={room.id}
              onClick={() => navigate(`/rooms/${room.id}`)}
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid #f5f5f5",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                transition: "background-color 0.2s"
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#f9f9f9"}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
            >
              <div style={{
                width: "50px",
                height: "50px",
                borderRadius: "18px",
                backgroundColor: "#e0e0ff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "24px",
                marginRight: "15px",
                flexShrink: 0
              }}>
                🏠
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <div style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
                    <span style={{ 
                      fontWeight: "bold", 
                      fontSize: "16px", 
                      overflow: "hidden", 
                      textOverflow: "ellipsis", 
                      whiteSpace: "nowrap" 
                    }}>
                      {room.roomname}
                    </span>
                    <span style={{ marginLeft: "6px", color: "#bbb", fontSize: "14px", flexShrink: 0 }}>
                      {(room.room_members?.[0]?.count || 0) + (room.room_guests?.[0]?.count || 0)}
                    </span>
                    
                    {room.unreadCount > 0 && (
                      <div style={{
                        backgroundColor: "#ff4d4f",
                        color: "white",
                        borderRadius: "10px",
                        padding: "1px 6px",
                        fontSize: "11px",
                        fontWeight: "bold",
                        marginLeft: "8px",
                        minWidth: "18px",
                        textAlign: "center",
                        flexShrink: 0,
                        lineHeight: "1.4"
                      }}>
                        {room.unreadCount > 99 ? "99+" : room.unreadCount}
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: "12px", color: "#aaa", flexShrink: 0 }}>
                    {formatRelativeTime(room.lastactivityat)}
                  </span>
                </div>
                
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "14px", color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {room.unreadCount > 0 ? "새로운 알림이 있습니다." : "최근 활동 없음"}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default RoomListPage;
