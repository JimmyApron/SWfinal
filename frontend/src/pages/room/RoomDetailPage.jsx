import React, { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import ScheduleTab from "./ScheduleTab";
import MapPage from "../../components/map/MapPage";
import ChatTab from "../Chat/ChatTab";
import VoteListPage from "../vote/VoteListPage";
import { getFriends, checkFriendStatus, sendFriendRequestById } from "../../api/friendApi";
import { createNotification } from "../../api/notificationApi";

function RoomDetailPage() {
  const navigate = useNavigate();
  const { roomId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const [room, setRoom] = useState(null);
  const [tab, setTab] = useState(searchParams.get("tab") || "schedule");

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [newRoomName, setNewRoomName] = useState("");
  const [currentUser, setCurrentUser] = useState(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [friendList, setFriendList] = useState([]);
  const [invitingSending, setInvitingSending] = useState(false);
  const [memberPopup, setMemberPopup] = useState(null);

  const [members, setMembers] = useState([]);
  const [guests, setGuests] = useState([]);

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
      .select("id, nickname")
      .eq("roomid", roomId);

    if (!guestError) {
      setGuests(guestData || []);
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) setCurrentUser(user);

    if (user && user.id) {
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
      const guestNickname = sessionStorage.getItem("guestNickname");

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

  const handleOpenInviteModal = async () => {
    if (!currentUser) return;
    setShowInviteModal(true);
    try {
      const friends = await getFriends(currentUser.id);
      // 이미 방에 있는 멤버 제외
      const memberIds = new Set(members.map((m) => m.userid));
      setFriendList(friends.filter((f) => !memberIds.has(f.id)));
    } catch (e) {
      console.error(e);
    }
  };

  const handleInviteFriend = async (friend) => {
    if (!currentUser || !room) return;
    setInvitingSending(true);
    try {
      const { data: senderProfile } = await supabase
        .from("profiles")
        .select("nickname")
        .eq("id", currentUser.id)
        .single();
      const senderNickname =
        senderProfile?.nickname || currentUser.user_metadata?.nickname || currentUser.email;
      await createNotification({
        roomId: Number(roomId),
        receiverId: friend.id,
        senderId: currentUser.id,
        type: "room_invite",
        title: "🏠 방 초대",
        message: `${senderNickname}님이 [${room.roomname}]에 초대했습니다`,
        link: `/rooms/${roomId}`,
      });
      alert(`${friend.nickname}님에게 초대를 보냈습니다.`);
    } catch (e) {
      alert("초대 전송 실패: " + e.message);
    } finally {
      setInvitingSending(false);
    }
  };

  const handleClickMember = async (member) => {
    if (!currentUser || member.userid === currentUser.id) return;
    setMemberPopup({ member, status: null, loading: true });
    const data = await checkFriendStatus(currentUser.id, member.userid);
    setMemberPopup({ member, status: data?.status || null, loading: false });
  };

  const handleAddFriendFromRoom = async () => {
    if (!memberPopup || !currentUser) return;
    try {
      await sendFriendRequestById(currentUser.id, memberPopup.member.userid);
      setMemberPopup((prev) => ({ ...prev, status: "pending" }));
      alert(`${memberPopup.member.nickname}님에게 친구 요청을 보냈습니다.`);
    } catch (e) {
      alert(e.message);
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

    setNotifSettings((prev) => ({
      ...prev,
      [tabName]: nextValue,
    }));
  };

  const handleLeaveRoom = async () => {
    if (!window.confirm("정말 이 방을 나가시겠습니까? 나가면 내역이 삭제됩니다.")) {
      return;
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
        {currentUser && <button onClick={() => navigate("/home")}>←</button>}
        <span>{room.roomname}</span>
        <span>총 {members.length + guests.length}명</span>
        <button onClick={() => setIsSidebarOpen(true)}>⚙</button>
      </header>

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
        {tab === "schedule" && <ScheduleTab roomId={roomId} ownerUserId={room?.createdby} roomName={room?.roomname} />}
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
              <h4 style={{ margin: "0 0 10px 0" }}>👥 친구 초대</h4>
              <button
                onClick={handleOpenInviteModal}
                style={{ width: "100%", padding: "10px", backgroundColor: "#7c79ff", color: "#fff", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: "bold", fontSize: "14px" }}
              >
                친구 초대하기
              </button>
            </div>

            <div style={{ marginBottom: "25px" }}>
              <h4 style={{ margin: "0 0 10px 0" }}>🔗 초대코드</h4>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px", backgroundColor: "#f5f5f5", borderRadius: "8px" }}>
                <span style={{ flex: 1, fontSize: "15px", fontWeight: "bold", letterSpacing: "2px", color: "#333" }}>{room.invitecode}</span>
                <button onClick={handleCopyInviteCode} style={{ padding: "6px 12px", backgroundColor: "#7c79ff", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px", whiteSpace: "nowrap" }}>복사</button>
              </div>
            </div>

            <div style={{ marginBottom: "25px" }}>
              <h4 style={{ margin: "0 0 10px 0" }}>
                👥 참여자 명단 ({members.length + guests.length}명)
              </h4>

              <div
                style={{
                  maxHeight: "230px",
                  overflowY: "auto",
                  border: "1px solid #eee",
                  padding: "10px",
                  borderRadius: "5px",
                  backgroundColor: "#fafafa",
                }}
              >
                {members.map((m) => {
                  const imageUrl = m.profiles?.profileimageurl;
                  const isMe = currentUser && m.userid === currentUser.id;

                  return (
                    <div
                      key={m.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        padding: "6px 0",
                        borderBottom: "1px solid #f0f0f0",
                      }}
                    >
                      {imageUrl ? (
                        <img
                          src={imageUrl}
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
                      )}

                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span
                          onClick={() => !isMe && handleClickMember(m)}
                          style={{
                            fontSize: "14px",
                            fontWeight: "600",
                            color: isMe ? "#333" : "#7c79ff",
                            cursor: isMe ? "default" : "pointer",
                            textDecoration: isMe ? "none" : "underline",
                          }}
                        >
                          {m.nickname || "이름없음"}{isMe ? " (나)" : ""}
                        </span>

                        <span
                          style={{
                            fontSize: "11px",
                            color: "#8366F4",
                            fontWeight: "600",
                          }}
                        >
                          회원
                        </span>
                      </div>
                    </div>
                  );
                })}

                {guests.map((g) => (
                  <div
                    key={g.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "6px 0",
                      borderBottom: "1px solid #f0f0f0",
                    }}
                  >
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

                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span
                        style={{
                          fontSize: "14px",
                          fontWeight: "600",
                          color: "#555",
                        }}
                      >
                        {g.nickname}
                      </span>

                      <span style={{ fontSize: "11px", color: "#e67e22" }}>
                        게스트
                      </span>
                    </div>
                  </div>
                ))}

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
      {/* 친구 초대 모달 */}
      {showInviteModal && (
        <>
          <div onClick={() => setShowInviteModal(false)} style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", zIndex: 3000 }} />
          <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", backgroundColor: "#fff", borderRadius: "16px", padding: "24px", width: "300px", maxHeight: "70vh", display: "flex", flexDirection: "column", zIndex: 3001, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <span style={{ fontSize: "16px", fontWeight: "bold" }}>친구 초대</span>
              <button onClick={() => setShowInviteModal(false)} style={{ border: "none", background: "none", fontSize: "20px", cursor: "pointer", color: "#aaa" }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {friendList.length === 0 ? (
                <p style={{ color: "#aaa", textAlign: "center", fontSize: "14px", marginTop: "20px" }}>초대할 수 있는 친구가 없습니다</p>
              ) : (
                friendList.map((friend) => (
                  <div key={friend.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 0", borderBottom: "1px solid #f5f5f5" }}>
                    {friend.profileimageurl ? (
                      <img src={friend.profileimageurl} alt={friend.nickname} style={{ width: "38px", height: "38px", borderRadius: "50%", objectFit: "cover" }} />
                    ) : (
                      <div style={{ width: "38px", height: "38px", borderRadius: "50%", backgroundColor: "#e0e0ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px" }}>👤</div>
                    )}
                    <span style={{ flex: 1, fontSize: "14px" }}>{friend.nickname}</span>
                    <button
                      onClick={() => handleInviteFriend(friend)}
                      disabled={invitingSending}
                      style={{ padding: "6px 14px", backgroundColor: "#7c79ff", color: "#fff", border: "none", borderRadius: "8px", fontSize: "13px", cursor: "pointer" }}
                    >
                      초대
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
      {/* 멤버 클릭 팝업 */}
      {memberPopup && (
        <>
          <div onClick={() => setMemberPopup(null)} style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", zIndex: 3000 }} />
          <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", backgroundColor: "#fff", borderRadius: "16px", padding: "24px", width: "260px", zIndex: 3001, boxShadow: "0 8px 32px rgba(0,0,0,0.18)", textAlign: "center" }}>
            <div style={{ fontSize: "36px", marginBottom: "8px" }}>👤</div>
            <p style={{ margin: "0 0 4px", fontSize: "16px", fontWeight: "bold" }}>{memberPopup.member.nickname}</p>
            <p style={{ margin: "0 0 20px", fontSize: "12px", color: "#8366F4" }}>회원</p>

            {memberPopup.loading ? (
              <p style={{ fontSize: "13px", color: "#aaa" }}>확인 중...</p>
            ) : memberPopup.status === "accepted" ? (
              <p style={{ fontSize: "13px", color: "#4CAF50", fontWeight: "600" }}>✓ 이미 친구입니다</p>
            ) : memberPopup.status === "pending" ? (
              <p style={{ fontSize: "13px", color: "#f90", fontWeight: "600" }}>요청 대기 중</p>
            ) : (
              <button
                onClick={handleAddFriendFromRoom}
                style={{ width: "100%", padding: "10px", backgroundColor: "#7c79ff", color: "#fff", border: "none", borderRadius: "10px", fontSize: "14px", fontWeight: "bold", cursor: "pointer" }}
              >
                친구 추가
              </button>
            )}

            <button onClick={() => setMemberPopup(null)} style={{ marginTop: "10px", width: "100%", padding: "8px", backgroundColor: "#f5f5f5", color: "#555", border: "none", borderRadius: "10px", fontSize: "13px", cursor: "pointer" }}>
              닫기
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default RoomDetailPage;