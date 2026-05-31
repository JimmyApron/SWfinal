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

  // 고정된 방 관리 (Local Storage 사용)
  const [pinnedRooms, setPinnedRooms] = useState(() => {
    const saved = localStorage.getItem("pinned_rooms");
    return saved ? JSON.parse(saved) : {}; // { roomId: pinnedAt }
  });

  const [contextMenu, setContextMenu] = useState(null); // { x, y, roomId }

  // 고정 토글 함수
  const togglePin = (roomId) => {
    const isPinned = !!pinnedRooms[roomId];
    const newPinned = { ...pinnedRooms };

    if (isPinned) {
      delete newPinned[roomId];
    } else {
      // 최대 3개 제한
      const pinnedIds = Object.keys(newPinned);
      if (pinnedIds.length >= 3) {
        alert("방 고정은 최대 3개까지만 가능합니다.");
        return;
      }
      newPinned[roomId] = new Date().toISOString();
    }

    setPinnedRooms(newPinned);
    localStorage.setItem("pinned_rooms", JSON.stringify(newPinned));
    setContextMenu(null);
  };

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

  // 정렬된 방 목록 계산
  const sortedRooms = [...rooms].sort((a, b) => {
    const pinA = pinnedRooms[a.id];
    const pinB = pinnedRooms[b.id];

    // 1. 둘 다 고정된 경우: 최신 고정 순 (가장 최근에 고정한 게 위로)
    if (pinA && pinB) {
      return new Date(pinB).getTime() - new Date(pinA).getTime();
    }
    // 2. 하나만 고정된 경우: 고정된 방이 우선
    if (pinA) return -1;
    if (pinB) return 1;

    // 3. 둘 다 고정 안 된 경우: 기존 카톡 방식 정렬 (1: unreadCount, 2: time)
    if ((b.unreadCount || 0) !== (a.unreadCount || 0)) {
      return (b.unreadCount || 0) - (a.unreadCount || 0);
    }
    const tA = new Date(a.lastactivityat || a.createdat).getTime();
    const tB = new Date(b.lastactivityat || b.createdat).getTime();
    return tB - tA;
  });

  useEffect(() => {
    const handleOutsideClick = () => setContextMenu(null);
    window.addEventListener("click", handleOutsideClick);
    return () => window.removeEventListener("click", handleOutsideClick);
  }, []);

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
    if (!userId) return;

    const channelName = `room-list-engine-${userId}-${Date.now()}`;
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
          if (payload.eventType === "INSERT") {
            const newNotif = payload.new;
            if (newNotif.roomid) {
              setRooms((prevRooms) => {
                const targetIdx = prevRooms.findIndex(r => String(r.id) === String(newNotif.roomid));
                
                if (targetIdx === -1) {
                  handleGetRooms(); 
                  return prevRooms;
                }

                const targetRoom = prevRooms[targetIdx];
                const updatedRoom = {
                  ...targetRoom,
                  unreadCount: (targetRoom.unreadCount || 0) + 1,
                  lastactivityat: newNotif.createdat || new Date().toISOString()
                };

                const filtered = prevRooms.filter(r => String(r.id) !== String(newNotif.roomid));
                return [updatedRoom, ...filtered];
              });
            }
          } else {
            handleGetRooms();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, handleGetRooms]);

  if (loading) {
    return <div style={{ padding: "20px", textAlign: "center" }}>로딩 중...</div>;
  }

  return (
    <div style={{ padding: "0", backgroundColor: "#fff", minHeight: "100vh", position: "relative" }}>
      <header style={{ 
        padding: "20px", 
        borderBottom: "1px solid #eee",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center"
      }}>
        <h1 style={{ margin: 0, fontSize: "24px" }}>방 목록</h1>
      </header>

      {sortedRooms.length === 0 ? (
        <div style={{ padding: "40px 20px", textAlign: "center", color: "#888" }}>
          <p>참여 중인 방이 없습니다.</p>
        </div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {sortedRooms.map((room) => {
            const isPinned = !!pinnedRooms[room.id];
            
            return (
              <li 
                key={room.id}
                onClick={() => navigate(`/rooms/${room.id}`)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, roomId: room.id });
                }}
                style={{
                  padding: "16px 20px",
                  borderBottom: "1px solid #f5f5f5",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  transition: "background-color 0.2s",
                  backgroundColor: isPinned ? "#fcfcff" : "transparent"
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = isPinned ? "#f5f5ff" : "#f9f9f9"}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = isPinned ? "#fcfcff" : "transparent"}
              >
                <div style={{
                  width: "50px",
                  height: "50px",
                  borderRadius: "18px",
                  backgroundColor: isPinned ? "#7c79ff" : "#e0e0ff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "24px",
                  marginRight: "15px",
                  flexShrink: 0,
                  position: "relative"
                }}>
                  🏠
                  {isPinned && (
                    <div style={{
                      position: "absolute",
                      bottom: "-2px",
                      right: "-2px",
                      backgroundColor: "#fff",
                      borderRadius: "50%",
                      width: "18px",
                      height: "18px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "10px",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.2)"
                    }}>
                      📌
                    </div>
                  )}
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
                          fontSize: "10px",
                          fontWeight: "bold",
                          marginLeft: "8px",
                          minWidth: "16px",
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
            );
          })}
        </ul>
      )}

      {/* 우클릭 메뉴 (Context Menu) */}
      {contextMenu && (
        <div style={{
          position: "fixed",
          top: contextMenu.y,
          left: contextMenu.x,
          backgroundColor: "#fff",
          boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
          borderRadius: "8px",
          padding: "4px 0",
          zIndex: 1000,
          minWidth: "120px"
        }} onClick={(e) => e.stopPropagation()}>
          <button 
            onClick={() => togglePin(contextMenu.roomId)}
            style={{
              width: "100%",
              padding: "10px 16px",
              border: "none",
              background: "none",
              textAlign: "left",
              fontSize: "14px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px"
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#f5f5f5"}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
          >
            {pinnedRooms[contextMenu.roomId] ? "📌 고정 해제" : "📌 상단 고정"}
          </button>
        </div>
      )}
    </div>
  );
}

export default RoomListPage;
