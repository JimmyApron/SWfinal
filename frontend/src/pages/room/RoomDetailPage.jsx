import React, { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { transferRoomOwnership } from "../../api/roomApi";
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

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [newRoomName, setNewRoomName] = useState("");

  const [members, setMembers] = useState([]);
  const [guests, setGuests] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [selectedParticipantId, setSelectedParticipantId] = useState(null);

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

  const fetchRoomData = async () => {
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

    const { data: memberData, error: memberError } = await supabase
      .from("room_members")
      .select(
        `
        id,
        nickname,
        userid,
        joinedat,
        profiles (
          profileimageurl
        )
      `
      )
      .eq("roomid", roomId);

    if (!memberError) {
      setMembers(memberData || []);
    } else {
      console.error("회원 목록 조회 실패:", memberError);
    }

    const { data: guestData, error: guestError } = await supabase
      .from("room_guests")
      .select("id, nickname, createdat")
      .eq("roomid", roomId);

    if (!guestError) {
      setGuests(guestData || []);
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user && user.id) {
      setCurrentUser({ id: user.id, type: "member" });
      const { data: myMemberData, error: myMemberError } = await supabase
        .from("room_members")
        .select(
          "schedulenotifenabled, locationnotifenabled, votenotifenabled, chatnotifenabled"
        )
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
      const guestId = localStorage.getItem("guest_id");
      const guestNickname = sessionStorage.getItem("guestNickname") || localStorage.getItem("guest_nickname");

      if (guestId) {
        setCurrentUser({ id: guestId, type: "guest" });
      }

      if (guestNickname) {
        const { data: myGuestData, error: myGuestError } = await supabase
          .from("room_guests")
          .select(
            "schedulenotifenabled, locationnotifenabled, votenotifenabled, chatnotifenabled"
          )
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

    // 실시간 구독 설정: 방 정보, 멤버, 게스트 변화 감지
    const channel = supabase
      .channel(`room_detail_realtime_${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${roomId}`,
        },
        (payload) => {
          console.log("Room updated:", payload);
          fetchRoomData();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_members",
          filter: `roomid=eq.${roomId}`,
        },
        (payload) => {
          console.log("Member changed:", payload);
          fetchRoomData();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_guests",
          filter: `roomid=eq.${roomId}`,
        },
        (payload) => {
          console.log("Guest changed:", payload);
          fetchRoomData();
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("Successfully subscribed to room changes");
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
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

  const handleUpdateRoomName = async () => {
    if (!newRoomName.trim()) return;

    const { error } = await supabase
      .from("rooms")
      .update({ roomname: newRoomName })
      .eq("id", roomId);

    if (error) {
      alert("방 제목 변경 실패!");
      console.error(error);
      return;
    }

    setRoom({ ...room, roomname: newRoomName });
    setIsEditingTitle(false);
    alert("방 제목이 새롭게 변경되었습니다!");
  };

  const handleToggleNotification = async (tabName) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const nextValue = !notifSettings[tabName];

    const dbColumnMap = {
      schedule: "schedulenotifenabled",
      location: "locationnotifenabled",
      vote: "votenotifenabled",
      chat: "chatnotifenabled",
    };

    const columnName = dbColumnMap[tabName];

    if (user && user.id) {
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
      const guestNickname = sessionStorage.getItem("guestNickname") || localStorage.getItem("guest_nickname");

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

    setNotifSettings((prev) => ({
      ...prev,
      [tabName]: nextValue,
    }));
  };

  const handleLeaveRoom = async () => {
    if (!window.confirm("정말 이 방을 나가시겠습니까? 나가면 내역이 삭제됩니다.")) {
      return;
    }

    const isHost = String(room?.createdby) === String(currentUser?.id);

    if (isHost) {
      const others = [
        ...members.map((m) => ({ ...m, type: "member", joinDate: m.joinedat })),
        ...guests.map((g) => ({ ...g, type: "guest", joinDate: g.createdat })),
      ]
        .filter(
          (p) =>
            String(p.type === "member" ? p.userid : p.id) !==
            String(currentUser?.id)
        )
        .sort((a, b) => new Date(a.joinDate) - new Date(b.joinDate));

      if (others.length > 0) {
        const nextHost = others[0];
        const nextHostId =
          nextHost.type === "member" ? nextHost.userid : nextHost.id;

        try {
          await transferRoomOwnership(roomId, nextHostId);
        } catch (error) {
          console.error("방장 자동 위임 실패:", error);
          alert("방장 위임 중 오류가 발생했습니다.");
          return;
        }
      }
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user && user.id) {
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
      const guestNickname =
        sessionStorage.getItem("guestNickname") ||
        localStorage.getItem("guest_nickname");

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

  const handleTransferHost = async (p) => {
    const newHostId = p.type === "member" ? p.userid : p.id;
    const confirmMessage = `방장 권한을 ${p.nickname}님에게 양도하시겠습니까?`;

    if (window.confirm(confirmMessage)) {
      try {
        await transferRoomOwnership(roomId, newHostId);
        alert("방장 권한이 양도되었습니다.");
        setRoom({ ...room, createdby: String(newHostId) });
        setSelectedParticipantId(null);
      } catch (error) {
        alert(error.message);
      }
    }
  };

  if (!room) {
    return <div>로딩 중...</div>;
  }

  const sortedParticipants = [
    ...members.map((m) => ({ ...m, type: "member", joinDate: m.joinedat })),
    ...guests.map((g) => ({ ...g, type: "guest", joinDate: g.createdat })),
  ].sort((a, b) => {
    const isHostA = String(room?.createdby) === String(a.type === "member" ? a.userid : a.id);
    const isHostB = String(room?.createdby) === String(b.type === "member" ? b.userid : b.id);

    if (isHostA) return -1;
    if (isHostB) return 1;

    return new Date(a.joinDate) - new Date(b.joinDate);
  });

  const isCurrentUserHost = String(room?.createdby) === String(currentUser?.id);

  return (
    <div
      style={
        tab === "chat"
          ? {
              position: "relative",
              height: "calc(100dvh - 64px)",
              paddingBottom: "0",
              boxSizing: "border-box",
              overflowX: "hidden",
              display: "flex",
              flexDirection: "column",
            }
          : {
              position: "relative",
              minHeight: "100vh",
              paddingBottom: "90px",
              boxSizing: "border-box",
              overflowX: "hidden",
            }
      }
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px",
          backgroundColor: "#f5f5f5",
        }}
      >
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

      <hr style={{ margin: "0" }} />

      <div
        style={
          tab === "chat"
            ? {
                flex: 1,
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
                overflow: "hidden",
              }
            : {}
        }
      >
        {tab === "schedule" && <ScheduleTab roomId={roomId} />}
        {tab === "location" && <MapPage roomId={roomId} />}
        {tab === "vote" && <VoteListPage roomid={roomId} />}
        {tab === "chat" && <ChatTab roomId={roomId} />}
      </div>

      {isSidebarOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            width: "270px",
            height: "calc(100vh - 64px)",
            backgroundColor: "white",
            boxShadow: "-2px 0 5px rgba(0,0,0,0.2)",
            zIndex: 2000,
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            boxSizing: "border-box",
            overflowY: "auto",
          }}
        >
          <div>
            <button
              onClick={() => setIsSidebarOpen(false)}
              style={{ float: "right" }}
            >
              X
            </button>

            <h3 style={{ marginTop: 0 }}>방 설정</h3>
            <hr />

            <div style={{ marginBottom: "25px" }}>
              <h4 style={{ margin: "0 0 10px 0" }}>✏️ 방 제목 변경</h4>

              {isEditingTitle ? (
                <div style={{ display: "flex", gap: "5px" }}>
                  <input
                    type="text"
                    value={newRoomName}
                    onChange={(e) => setNewRoomName(e.target.value)}
                    style={{
                      flex: 1,
                      padding: "6px",
                      border: "1px solid #ddd",
                      borderRadius: "5px",
                    }}
                  />

                  <button
                    onClick={handleUpdateRoomName}
                    style={{
                      background: "#8366F4",
                      color: "white",
                      border: "none",
                      borderRadius: "5px",
                      padding: "6px 10px",
                      cursor: "pointer",
                      fontWeight: "600",
                    }}
                  >
                    저장
                  </button>

                  <button
                    onClick={() => setIsEditingTitle(false)}
                    style={{
                      background: "#F1F1F1",
                      color: "#333",
                      border: "none",
                      borderRadius: "5px",
                      padding: "6px 10px",
                      cursor: "pointer",
                    }}
                  >
                    취소
                  </button>
                </div>
              ) : (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontWeight: "600" }}>{room.roomname}</span>

                  <button
                    onClick={() => setIsEditingTitle(true)}
                    style={{
                      background: "#8366F4",
                      color: "white",
                      border: "none",
                      borderRadius: "5px",
                      padding: "4px 10px",
                      cursor: "pointer",
                      fontSize: "13px",
                      fontWeight: "600",
                    }}
                  >
                    수정
                  </button>
                </div>
              )}
            </div>

            <div style={{ marginBottom: "25px" }}>
              <h4 style={{ margin: "0 0 10px 0" }}>🔔 탭별 알림 온/오프</h4>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {["schedule", "location", "vote", "chat"].map((t) => (
                  <div
                    key={t}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
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
                        border: "none",
                        borderRadius: "20px",
                        padding: "4px 12px",
                        cursor: "pointer",
                        fontSize: "12px",
                        fontWeight: "bold",
                      }}
                    >
                      {notifSettings[t] ? "ON" : "OFF"}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: "25px" }}>
              <h4 style={{ margin: "0 0 10px 0" }}>
                👥 참여자 명단 ({members.length + guests.length}명)
              </h4>

              <div
                style={{
                  maxHeight: "350px",
                  overflowY: "auto",
                  border: "1px solid #eee",
                  padding: "10px",
                  borderRadius: "5px",
                  backgroundColor: "#fafafa",
                }}
              >
                {sortedParticipants.map((p) => {
                  const participantUniqueId = p.type === "member" ? p.userid : p.id;
                  const isHost = String(room?.createdby) === String(participantUniqueId);
                  const isSelected = selectedParticipantId === participantUniqueId;

                  return (
                    <div
                      key={`${p.type}-${p.id}`}
                      onClick={() => {
                        if (isCurrentUserHost && !isHost) {
                          setSelectedParticipantId(
                            isSelected ? null : participantUniqueId
                          );
                        }
                      }}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        padding: "8px 0",
                        borderBottom: "1px solid #f0f0f0",
                        cursor: isCurrentUserHost && !isHost ? "pointer" : "default",
                        backgroundColor: isSelected ? "#f0ebff" : "transparent",
                        borderRadius: "5px",
                        transition: "background-color 0.2s",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          padding: "0 5px",
                        }}
                      >
                        {p.type === "member" ? (
                          p.profiles?.profileimageurl ? (
                            <img
                              src={p.profiles.profileimageurl}
                              alt="프로필"
                              style={{
                                width: "32px",
                                height: "32px",
                                borderRadius: "50%",
                                objectFit: "cover",
                                border: "1px solid #ddd",
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                width: "32px",
                                height: "32px",
                                borderRadius: "50%",
                                backgroundColor: "#e0e0e0",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "16px",
                              }}
                            >
                              👤
                            </div>
                          )
                        ) : (
                          <div
                            style={{
                              width: "32px",
                              height: "32px",
                              borderRadius: "50%",
                              backgroundColor: "#ffeaa7",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "16px",
                            }}
                          >
                            🐱
                          </div>
                        )}

                        <div style={{ display: "flex", flexDirection: "column" }}>
                          {isHost && (
                            <span
                              style={{
                                color: "#8366F4",
                                fontSize: "11px",
                                fontWeight: "bold",
                                marginBottom: "-2px",
                              }}
                            >
                              방장
                            </span>
                          )}
                          <span
                            style={{
                              fontSize: "14px",
                              fontWeight: "600",
                              color: "#333",
                            }}
                          >
                            {p.nickname || "이름없음"}
                          </span>

                          <span
                            style={{
                              fontSize: "11px",
                              color: p.type === "member" ? "#8366F4" : "#e67e22",
                              fontWeight: "600",
                            }}
                          >
                            {p.type === "member" ? "회원" : "게스트"}
                          </span>
                        </div>
                      </div>

                      {isSelected && (
                        <div style={{ marginTop: "8px", padding: "0 5px" }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTransferHost(p);
                            }}
                            style={{
                              width: "100%",
                              padding: "6px",
                              background: "#8366F4",
                              color: "white",
                              border: "none",
                              borderRadius: "5px",
                              fontSize: "12px",
                              fontWeight: "bold",
                              cursor: "pointer",
                            }}
                          >
                            방장 권한 주기
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

                {members.length === 0 && guests.length === 0 && (
                  <p
                    style={{
                      fontSize: "13px",
                      color: "#999",
                      textAlign: "center",
                    }}
                  >
                    참여자가 없습니다.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div>
            <hr />

            <button
              onClick={handleLeaveRoom}
              style={{
                width: "100%",
                padding: "12px",
                background: "#f44336",
                color: "white",
                border: "none",
                borderRadius: "5px",
                fontWeight: "bold",
                cursor: "pointer",
                fontSize: "14px",
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