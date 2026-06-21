import React, { useEffect, useState, useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { FiUser } from "react-icons/fi";
import { FaBell } from "react-icons/fa";

import { supabase } from "../../lib/supabaseClient";
import {
  transferRoomOwnership,
  updateRoomNameApi,
  updateRoomImageApi,
  kickParticipantApi
} from "../../api/roomApi";
import ScheduleTab from "./ScheduleTab";
import MapPage from "../../components/map/MapPage";
import ChatTab from "../Chat/ChatTab";
import VoteListPage from "../vote/VoteListPage";
import {
  getFriends,
  checkFriendStatus,
  sendFriendRequestById,
  cancelFriendRequest,
} from "../../api/friendApi";
import {
  createNotification,
  deleteNotification,
} from "../../api/notificationApi";

function cacheRoomPopupSetting(roomId, column, value) {
  if (!roomId || !column) return;

  try {
    const settings = JSON.parse(localStorage.getItem("room_popup_settings") || "{}");
    const roomKey = String(roomId);
    settings[roomKey] = {
      ...(settings[roomKey] || {}),
      [column]: value,
    };
    localStorage.setItem("room_popup_settings", JSON.stringify(settings));
  } catch (error) {
    console.warn("알림 설정 캐시 저장 실패:", error);
  }
}

async function copyTextToClipboard(text) {
  const value = String(text ?? "");
  if (!value) return false;

  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (error) {
      console.warn("Clipboard API copy failed, trying fallback:", error);
    }
  }

  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.top = "-9999px";
  textArea.style.left = "-9999px";

  const selection = document.getSelection();
  const selectedRange = selection?.rangeCount ? selection.getRangeAt(0) : null;
  const activeElement = document.activeElement;

  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    document.body.removeChild(textArea);
    if (selectedRange && selection) {
      selection.removeAllRanges();
      selection.addRange(selectedRange);
    }
    activeElement?.focus?.();
  }

  return copied;
}

function RoomDetailPage() {
  const navigate = useNavigate();
  const { roomId } = useParams();
  const [searchParams] = useSearchParams();

  const [room, setRoom] = useState(null);
  const [tab, setTab] = useState(searchParams.get("tab") || "schedule");
  const [currentUser, setCurrentUser] = useState(null);
  const [members, setMembers] = useState([]);
  const [guests, setGuests] = useState([]);
  const [myEntryId, setMyEntryId] = useState(null);

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [newRoomName, setNewRoomName] = useState("");
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [friendList, setFriendList] = useState([]);
  const [sentInvites, setSentInvites] = useState([]);
  const [invitingSending, setInvitingSending] = useState(false);
  const [memberPopup, setMemberPopup] = useState(null);
  const [selectedParticipantId, setSelectedParticipantId] = useState(null);
  const [isLeaving, setIsLeaving] = useState(false);
  const isLeavingRef = useRef(false);

  const [notifSettings, setNotifSettings] = useState({
    schedule: true,
    location: true,
    vote: true,
    chat: true,
  });

  useEffect(() => {
    const queryTab = searchParams.get("tab");
    if (["schedule", "location", "vote", "chat"].includes(queryTab)) {
      setTab(queryTab);
    }
  }, [searchParams]);

  const fetchRoomData = async () => {
    console.log("🚀 [RoomDetailPage] fetchRoomData 시작, roomId:", roomId);

    const { data: roomData, error: roomError } = await supabase
      .from("rooms").select(`*, room_members(count)`).eq("id", Number(roomId)).single();

    if (roomError) {
      console.error("❌ [RoomDetailPage] 방 정보 조회 실패:", roomError);
      return;
    }

    setRoom(roomData);
    setNewRoomName(roomData.roomname);

    const [{ data: memberData, error: mError }, { data: guestData, error: gError }] = await Promise.all([
      supabase.from("room_members").select(`id, nickname, userid, joinedat, profiles:userid(profileimageurl)`).eq("roomid", Number(roomId)),
      supabase.from("room_guests").select("id, nickname, createdat").eq("roomid", Number(roomId))
    ]);

    if (mError) console.error("❌ [RoomDetailPage] 멤버 조회 오류:", mError);
    if (gError) console.error("❌ [RoomDetailPage] 게스트 조회 오류:", gError);

    console.log("🚀 [RoomDetailPage] fetchRoomData - memberData:", memberData);
    console.log("🚀 [RoomDetailPage] fetchRoomData - guestData:", guestData);

    setMembers(memberData || []);
    setGuests(guestData || []);

    const { data: { user } } = await supabase.auth.getUser();
    const currentId = user?.id || localStorage.getItem("guest_id");

    if (currentId) {
      const isStillThere = [...(memberData || []), ...(guestData || [])].some(p => String(p.userid || p.id) === String(currentId));
      if (myEntryId && !isStillThere && !isLeavingRef.current) {
        console.warn("⚠️ [RoomDetailPage] 사용자가 목록에 없어 홈으로 튕겨냄");
        navigate("/home");
        return;
      }
    }

    if (user?.id) {
      const uId = user.id;
      setCurrentUser({ ...user, type: "member" });
      const me = memberData?.find(m => String(m.userid) === String(uId));
      if (me) setMyEntryId(me.id);

      const { data: sett } = await supabase.from("room_members").select("schedulenotifenabled, locationnotifenabled, votenotifenabled, chatnotifenabled").eq("roomid", Number(roomId)).eq("userid", uId).maybeSingle();
      if (sett) {
        const nextSettings = {
          schedule: sett.schedulenotifenabled !== false,
          location: sett.locationnotifenabled !== false,
          vote: sett.votenotifenabled !== false,
          chat: sett.chatnotifenabled !== false,
        };
        setNotifSettings(nextSettings);
        cacheRoomPopupSetting(roomId, "schedulenotifenabled", nextSettings.schedule);
        cacheRoomPopupSetting(roomId, "locationnotifenabled", nextSettings.location);
        cacheRoomPopupSetting(roomId, "votenotifenabled", nextSettings.vote);
        cacheRoomPopupSetting(roomId, "chatnotifenabled", nextSettings.chat);
      }
    } else {
      const guestId = localStorage.getItem("guest_id");
      if (guestId) {
        setCurrentUser({ id: guestId, type: "guest" });
        const { data: sett } = await supabase.from("room_guests").select("schedulenotifenabled, locationnotifenabled, votenotifenabled, chatnotifenabled").eq("id", guestId).maybeSingle();
        if (sett) {
          const nextSettings = {
            schedule: sett.schedulenotifenabled !== false,
            location: sett.locationnotifenabled !== false,
            vote: sett.votenotifenabled !== false,
            chat: sett.chatnotifenabled !== false,
          };
          setNotifSettings(nextSettings);
          cacheRoomPopupSetting(roomId, "schedulenotifenabled", nextSettings.schedule);
          cacheRoomPopupSetting(roomId, "locationnotifenabled", nextSettings.location);
          cacheRoomPopupSetting(roomId, "votenotifenabled", nextSettings.vote);
          cacheRoomPopupSetting(roomId, "chatnotifenabled", nextSettings.chat);
        }
      }
    }
  };

  useEffect(() => {
    fetchRoomData();

    const channels = [
      supabase.channel(`room_info_${roomId}`).on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` }, () => fetchRoomData()).subscribe(),
      supabase.channel(`room_parts_${roomId}`).on("postgres_changes", { event: "*", schema: "public", table: "room_members", filter: `roomid=eq.${roomId}` }, () => fetchRoomData())
      .on("postgres_changes", { event: "*", schema: "public", table: "room_guests", filter: `roomid=eq.${roomId}` }, () => fetchRoomData())
      .on("broadcast", { event: "PARTICIPANTS_CHANGED" }, () => fetchRoomData()).subscribe()
    ];

    return () => channels.forEach(c => supabase.removeChannel(c));
  }, [roomId, currentUser?.id]);

  useEffect(() => {
    if (!myEntryId || !roomId) return;
    const kickChannel = supabase.channel(`kick_${roomId}_${currentUser?.id}`).on("postgres_changes", { event: "DELETE", schema: "public", table: currentUser?.type === "member" ? "room_members" : "room_guests", filter: `id=eq.${myEntryId}` }, () => {
      if (!isLeavingRef.current) navigate("/home");
    }).subscribe();
    return () => { supabase.removeChannel(kickChannel); };
  }, [roomId, currentUser, myEntryId, navigate]);

  const handleCopyInviteCode = async () => {
    const inviteCode = room?.invitecode;

    try {
      const copied = await copyTextToClipboard(inviteCode);
      if (!copied) throw new Error("Clipboard copy returned false");
      alert("초대코드가 복사되었습니다.");
    } catch (error) {
      console.warn("초대코드 복사 실패:", error);
      alert("복사 실패");
    }
  };

  const handleOpenInviteModal = async () => {
    if (currentUser?.type === "guest") { alert("게스트는 친구 초대 불가"); return; }
    setShowInviteModal(true);
    try {
      const [friends, { data: pendingNotifs }] = await Promise.all([
        getFriends(currentUser.id),
        supabase.from("notifications").select("id, receiverid").eq("type", "room_invite").eq("roomid", Number(roomId)).eq("senderid", currentUser.id),
      ]);
      const memberIds = new Set(members.map(m => m.userid));
      const pendingReceiverIds = pendingNotifs?.map(n => n.receiverid) || [];
      let inviteProfiles = [];
      if (pendingReceiverIds.length > 0) {
        const { data: pro } = await supabase.from("profiles").select("id, nickname, profileimageurl").in("id", pendingReceiverIds);
        inviteProfiles = (pendingNotifs || []).map(n => ({ notifId: n.id, ...pro?.find(p => p.id === n.receiverid) }));
      }
      setSentInvites(inviteProfiles);
      setFriendList(friends.filter(f => !memberIds.has(f.id) && !pendingReceiverIds.includes(f.id)));
    } catch (e) { console.error(e); }
  };

  const handleInviteFriend = async (friend) => {
    setInvitingSending(true);
    try {
      const { data: senderProfile } = await supabase
        .from("profiles")
        .select("nickname")
        .eq("id", currentUser.id)
        .maybeSingle();
      const senderNickname =
        senderProfile?.nickname ||
        currentUser.user_metadata?.nickname ||
        currentUser.email ||
        "알 수 없음";
      await createNotification({ roomId: Number(roomId), receiverId: friend.id, senderId: currentUser.id, type: "room_invite", title: "🏠 방 초대", message: `${senderNickname} 님이 [${room.roomname}]에 초대했습니다`, link: `/rooms/${roomId}` });
      const { data: n } = await supabase.from("notifications").select("id").eq("type", "room_invite").eq("roomid", Number(roomId)).eq("senderid", currentUser.id).eq("receiverid", friend.id).order("createdat", { ascending: false }).limit(1).maybeSingle();
      setSentInvites(prev => [...prev, { notifId: n?.id, ...friend }]);
      setFriendList(prev => prev.filter(f => f.id !== friend.id));
      alert(`${friend.nickname}님 초대 완료`);
    } catch (e) { alert("초대 실패: " + e.message); } finally { setInvitingSending(false); }
  };

  const handleCancelInvite = async (invite) => {
    try {
      if (invite.notifId) await deleteNotification(invite.notifId);
      setSentInvites(prev => prev.filter(i => i.notifId !== invite.notifId));
      setFriendList(prev => [...prev, { id: invite.id, nickname: invite.nickname, profileimageurl: invite.profileimageurl }]);
    } catch (e) { alert(e.message); }
  };

  const handleClickParticipant = (p) => {
    const pUniqueId = p.type === "member" ? p.userid : p.id;
    const isMe = String(currentUser?.id) === String(pUniqueId);

    // 본인이 아니고 대상이 회원인 경우 친구 요청 팝업 허용
    if (p.type === "member" && currentUser?.type === "member" && !isMe) {
      setMemberPopup({ member: p, loading: true });
      checkFriendStatus(currentUser.id, p.userid).then(d => setMemberPopup({
        member: p,
        status: d?.status,
        requestId: d?.id,
        iSentRequest: d?.userid === currentUser.id,
        loading: false
      }));
    }
  };

  const handleToggleManagement = (e, pUniqueId) => {
    e.stopPropagation(); // 카드 클릭(친구 팝업) 방지
    setSelectedParticipantId(selectedParticipantId === pUniqueId ? null : pUniqueId);
  };

  const handleLeaveRoom = async () => {
    if (!window.confirm("정말 방을 나가시겠습니까?")) return;
    isLeavingRef.current = true;
    setIsLeaving(true);
    if (String(room?.createdby) === String(currentUser?.id)) {
      const others = members.filter(m => String(m.userid) !== String(currentUser.id)).sort((a, b) => new Date(a.joinedat) - new Date(b.joinedat));
      if (others.length > 0) await transferRoomOwnership(roomId, others[0].userid);
    }
    const table = currentUser.type === "member" ? "room_members" : "room_guests";
    const filter = currentUser.type === "member" ? { roomid: Number(roomId), userid: currentUser.id } : { roomid: Number(roomId), id: currentUser.id };
    await supabase.from(table).delete().match(filter);
    navigate("/home");
  };

  const handleKickParticipant = async (p) => {
    if (window.confirm(`${p.nickname}님을 추방하시겠습니까?`)) {
      try {
        const pId = p.type === "member" ? p.userid : p.id;
        await kickParticipantApi(Number(roomId), pId, p.type);
        const changedAt = new Date().toISOString();
        await supabase.from("room_messages").insert([{
          roomid: Number(roomId),
          userid: currentUser?.id || null,
          nickname: currentUser?.nickname || "system",
          content: JSON.stringify({
            __type: "participant_removed",
            participantId: String(pId),
            changedAt,
          }),
        }]);
        setSelectedParticipantId(null);
        fetchRoomData();
        window.dispatchEvent(new CustomEvent("roomParticipantsChanged", {
          detail: {
            roomId: Number(roomId),
            participantId: String(pId),
            changedAt,
          },
        }));
        supabase.channel(`room_parts_${roomId}`).send({ type: "broadcast", event: "PARTICIPANTS_CHANGED", payload: {} });
        await new Promise((resolve) => {
          if (window.requestAnimationFrame) window.requestAnimationFrame(resolve);
          else setTimeout(resolve, 0);
        });
        await createNotification({ roomId: Number(roomId), receiverId: pId, senderId: currentUser.id, type: "kick", title: "🚫 추방 알림", message: `방에서 추방되었습니다.`, link: "/home" });
        alert("추방 완료");
      } catch (e) { alert(e.message); }
    }
  };

  const handleTransferHost = async (p) => {
    if (window.confirm(`${p.nickname}님에게 방장 권한을 넘기시겠습니까?`)) {
      try {
        const pId = p.type === "member" ? p.userid : p.id;
        if (p.type === "guest") { alert("게스트에게는 방장을 넘길 수 없습니다."); return; }
        await transferRoomOwnership(Number(roomId), pId);
        alert("방장이 변경되었습니다.");
        setSelectedParticipantId(null);
        fetchRoomData();
      } catch (e) { alert(e.message); }
    }
  };

  const handleToggleNotification = async (tabName) => {
    const next = !notifSettings[tabName];
    const col = { schedule: "schedulenotifenabled", location: "locationnotifenabled", vote: "votenotifenabled", chat: "chatnotifenabled" }[tabName];
    const table = currentUser.type === "member" ? "room_members" : "room_guests";
    const filter = currentUser.type === "member" ? { roomid: Number(roomId), userid: currentUser.id } : { id: currentUser.id };
    const { error } = await supabase.from(table).update({ [col]: next }).match(filter);
    if (error) {
      alert("알림 설정 저장 실패: " + error.message);
      return;
    }
    setNotifSettings(prev => ({ ...prev, [tabName]: next }));
    cacheRoomPopupSetting(roomId, col, next);
    if (next) {
      window.dispatchEvent(new CustomEvent("popup-setting-enabled", {
        detail: { roomId: Number(roomId), tabName },
      }));
    }
  };

  if (!room) return <div>로딩 중...</div>;
  const isCurrentUserHost = String(room?.createdby) === String(currentUser?.id);
  const sortedParticipants = [
    ...members.map((m) => ({ ...m, type: "member", joinDate: m.joinedat })),
    ...guests.map((g) => ({ ...g, type: "guest", joinDate: g.createdat })),
  ].sort((a, b) => {
    const idA = a.type === "member" ? a.userid : a.id;
    const idB = b.type === "member" ? b.userid : b.id;

    const isHostA = String(room?.createdby) === String(idA);
    const isHostB = String(room?.createdby) === String(idB);

    if (isHostA) return -1;
    if (isHostB) return 1;
    return new Date(a.joinDate) - new Date(b.joinDate);
  });
  const isLocationTab = tab === "location";
  const isFixedHeightTab = isLocationTab || tab === "chat";

  return (
    <div
      style={{
        position: "relative",
        minHeight: isFixedHeightTab ? "100%" : "100vh",
        height: isFixedHeightTab ? "100%" : undefined,
        paddingBottom: isFixedHeightTab ? 0 : "90px",
        boxSizing: "border-box",
        backgroundColor: "#F7F7FA",
        overflow: isFixedHeightTab ? "hidden" : undefined,
        display: isFixedHeightTab ? "flex" : undefined,
        flexDirection: isFixedHeightTab ? "column" : undefined,
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", backgroundColor: "#fff", position: "sticky", top: 0, zIndex: 100, borderBottom: "1px solid #E5E7EB" }}>
        <button onClick={() => navigate("/home")} style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer" }}>←</button>
        <span style={{ fontWeight: "700", fontSize: "17px" }}>{room.roomname}</span>
        <button onClick={() => setIsSidebarOpen(true)} style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer" }}>⚙</button>
      </header>
      <div
        className={
          isLocationTab
            ? "room-location-tab-content"
            : tab === "chat"
              ? "room-chat-tab-content"
              : undefined
        }
        style={{
          padding: tab === "chat" || isLocationTab ? "0" : "0 16px",
          ...(isFixedHeightTab
            ? {
                flex: 1,
                minHeight: 0,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }
            : {}),
        }}
      >
        {tab === "schedule" && <ScheduleTab roomId={roomId} ownerUserId={room.createdby} roomName={room.roomname} />} 
        {tab === "location" && <MapPage roomId={roomId} />}
        {tab === "vote" && <VoteListPage roomid={roomId} />}
        {tab === "chat" && <ChatTab roomId={roomId} />}
      </div>
      {isSidebarOpen && (
        <div style={{ position: "fixed", top: 0, right: 0, width: "270px", height: "100vh", backgroundColor: "#fff", boxShadow: "-2px 0 5px rgba(0,0,0,0.2)", zIndex: 2000, padding: "20px", paddingBottom: "84px", display: "flex", flexDirection: "column", boxSizing: "border-box", overflowY: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>방 설정</h3>
            <button onClick={() => setIsSidebarOpen(false)} style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer", lineHeight: 1 }}>✕</button>
          </div>
          <hr style={{ margin: "12px 0" }} />
          <div style={{ textAlign: "center", marginBottom: "20px" }}>
            <div style={{ width: "100px", height: "100px", borderRadius: "24px", margin: "0 auto", overflow: "hidden", border: "1px solid #ddd", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "40px", backgroundColor: "#f3f4f6" }}>
              {room.roomimageurl ? <img src={room.roomimageurl} alt="방" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "🏠"}
            </div>
            {isCurrentUserHost && <label htmlFor="img-up" style={{ display: "block", marginTop: "8px", fontSize: "12px", cursor: "pointer", color: "#7C5CFF" }}>이미지 변경</label>}
            <input id="img-up" type="file" style={{ display: "none" }} onChange={async (e) => {
              const file = e.target.files[0]; if (!file) return;
              const res = await updateRoomImageApi(file, roomId, currentUser.id);
              if (res.success) setRoom({ ...room, roomimageurl: res.publicUrl });
            }} />
          </div>
          <div style={{ marginBottom: "20px" }}>
            <h4 style={{ display: "flex", alignItems: "center", gap: "6px" }}><FaBell size={13} color="#F59E0B" /> 알림 설정</h4>
            {["schedule", "location", "vote", "chat"].map(t => (
              <div key={t} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <span style={{ fontSize: "14px" }}>{t === "schedule" ? "일정" : t === "location" ? "장소" : t === "vote" ? "투표" : "채팅"} 알림</span>
                <button onClick={() => handleToggleNotification(t)} style={{ background: notifSettings[t] ? "#8366F4" : "#E0E0E0", color: "#fff", border: "none", borderRadius: "20px", padding: "4px 12px", width: "44px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>{notifSettings[t] ? "ON" : "OFF"}</button>
              </div>
            ))}
          </div>
          <button onClick={handleOpenInviteModal} style={{ width: "100%", padding: "10px", background: "#7c79ff", color: "#fff", border: "none", borderRadius: "8px", fontWeight: "bold", marginBottom: "20px" }}>친구 초대</button>
          <div style={{ background: "#f0f0f0", padding: "10px", borderRadius: "8px", marginBottom: "20px", display: "flex", justifyContent: "center", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "14px", fontWeight: "bold" }}>초대코드: {room.invitecode}</span>
            <button onClick={handleCopyInviteCode} style={{ background: "#fafafa", border: "1px solid #e0e0e0", borderRadius: "6px", padding: "4px 10px", fontSize: "12px", cursor: "pointer" }}>복사</button>
          </div>
          <div style={{ marginBottom: "25px" }}>
            <h4 style={{ margin: "0 0 10px 0" }}>
              👥 멤버 명단 ({members.length + guests.length}명)
            </h4>

            <div
              style={{
                maxHeight: "350px",
                overflowY: "auto",
                border: "1px solid #E5E7EB",
                padding: "10px",
                borderRadius: "5px",
                backgroundColor: "#fff",
              }}
            >
              {sortedParticipants.map((p) => {
                const participantUniqueId = p.type === "member" ? p.userid : p.id;
                const isHost = String(room?.createdby) === String(participantUniqueId);
                const isSelected = selectedParticipantId === participantUniqueId;
                const isMe = String(currentUser?.id) === String(participantUniqueId);

                const profileObj = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles;
                const profileImg = profileObj?.profileimageurl;

                return (
                  <div
                    key={`${p.type}-${p.id}`}
                    onClick={() => handleClickParticipant(p)}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      padding: "8px 0",
                      borderBottom: "1px solid #F3F4F6",
                      cursor:
                        p.type === "member" &&
                        currentUser?.type === "member" &&
                        !isMe
                          ? "pointer"
                          : "default",
                      backgroundColor: isSelected ? "#f0ebff" : "transparent",
                      borderRadius: "5px",
                      transition: "background-color 0.2s",
                      position: "relative", // 점 3개 버튼 배치를 위해 추가
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        padding: "0 5px",
                        paddingRight: (isCurrentUserHost && !isMe) ? "30px" : "5px", // 버튼 공간 확보
                        position: "relative",
                      }}
                    >
                      {p.type === "member" && p.nickname !== "알 수 없음" && profileImg ? (
                        <img
                          src={profileImg}
                          alt="프로필"
                          style={{
                            width: "32px",
                            height: "32px",
                            borderRadius: "50%",
                            objectFit: "cover",
                            border: "1px solid #E5E7EB",
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: "32px",
                            height: "32px",
                            borderRadius: "50%",
                            backgroundColor: "#F3F4F6",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "16px",
                            color: "#8B8799"
                          }}
                        >
                          <FiUser size={16} />
                        </div>
                      )}

                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                        }}
                      >
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
                            color:
                              p.type === "member" &&
                              currentUser?.type === "member" &&
                              !isMe
                                ? "#7c79ff"
                                : "#1F2937",
                            textDecoration:
                              p.type === "member" &&
                              currentUser?.type === "member" &&
                              !isMe
                                ? "underline"
                                : "none",
                          }}
                        >
                          {p.nickname || "이름없음"}
                          {isMe ? " (나)" : ""}
                        </span>

                        <span
                          style={{
                            fontSize: "11px",
                            color:
                              p.type === "member" ? "#8366F4" : "#e67e22",
                            fontWeight: "600",
                          }}
                        >
                          {p.type === "member" ? "회원" : "게스트"}
                        </span>
                      </div>

                      {/* 방장인 경우 점 3개 버튼 표시 (본인 제외) */}
                      {isCurrentUserHost && !isMe && (
                        <button
                          onClick={(e) => handleToggleManagement(e, participantUniqueId)}
                          style={{
                            position: "absolute",
                            right: "8px",
                            top: "50%",
                            transform: "translateY(-50%)",
                            background: "none",
                            border: "none",
                            fontSize: "18px",
                            color: "#9CA3AF",
                            cursor: "pointer",
                            padding: "4px 8px",
                          }}
                        >
                          ⋮
                        </button>
                      )}
                    </div>

                    {isSelected && (
                      <div style={{ marginTop: "8px", padding: "0 5px", display: "flex", gap: "8px" }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTransferHost(p);
                          }}
                          style={{
                            flex: 1,
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
                          위임
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleKickParticipant(p);
                          }}
                          style={{
                            flex: 1,
                            padding: "6px",
                            background: "#FEE2E2",
                            color: "#EF4444",
                            border: "1px solid #FCA5A5",
                            borderRadius: "5px",
                            fontSize: "12px",
                            fontWeight: "bold",
                            cursor: "pointer",
                          }}
                        >
                          추방
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
                    color: "#9CA3AF",
                    textAlign: "center",
                  }}
                >
                  멤버가 없습니다.
                </p>
              )}
            </div>
          </div>
          <button onClick={handleLeaveRoom} style={{ marginTop: "auto", padding: "12px", background: "#f44336", color: "#fff", border: "none", borderRadius: "8px", fontWeight: "bold" }}>방 나가기</button>
        </div>
      )}
      {showInviteModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", padding: "20px", borderRadius: "16px", width: "300px", maxHeight: "70vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "16px" }}><b>친구 초대</b><button onClick={() => setShowInviteModal(false)}>✕</button></div>

            {sentInvites.length > 0 && (
              <div style={{ marginBottom: "16px" }}>
                <p style={{ fontSize: "12px", fontWeight: "bold", color: "#8B8799", margin: "0 0 8px" }}>보낸 요청 ({sentInvites.length})</p>
                {sentInvites.map(inv => (
                  <div key={inv.notifId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      {inv.profileimageurl ? (
                        <img src={inv.profileimageurl} alt="" style={{ width: "28px", height: "28px", borderRadius: "50%", objectFit: "cover" }} />
                      ) : (
                        <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: "#F3F4F6", display: "flex", alignItems: "center", justifyContent: "center" }}><FiUser size={14} color="#8B8799" /></div>
                      )}
                      <span>{inv.nickname}</span>
                    </div>
                    <button onClick={() => handleCancelInvite(inv)} style={{ padding: "4px 8px", background: "#F3F4F6", color: "#6B7280", border: "none", borderRadius: "4px", fontSize: "12px", cursor: "pointer" }}>취소</button>
                  </div>
                ))}
                <hr style={{ margin: "12px 0", border: "none", borderTop: "1px solid #F3F4F6" }} />
              </div>
            )}

            <p style={{ fontSize: "12px", fontWeight: "bold", color: "#8B8799", margin: "0 0 8px" }}>초대 가능한 친구</p>
            {friendList.map(f => (
              <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
                <span>{f.nickname}</span>
                <button onClick={() => handleInviteFriend(f)} disabled={invitingSending} style={{ padding: "4px 8px", background: "#7C5CFF", color: "#fff", border: "none", borderRadius: "4px" }}>초대</button>
              </div>
            ))}
            {friendList.length === 0 && (
              <p style={{ fontSize: "13px", color: "#9CA3AF", textAlign: "center", padding: "8px 0" }}>초대 가능한 친구가 없습니다.</p>
            )}
          </div>
        </div>
      )}
      {memberPopup && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", padding: "24px", borderRadius: "20px", width: "260px", textAlign: "center", boxShadow: "0 10px 25px rgba(0,0,0,0.1)" }}>
            <div style={{ width: "60px", height: "60px", borderRadius: "50%", background: "#E5E7EB", margin: "0 auto 12px", overflow: "hidden" }}>
              {memberPopup.member.profiles?.profileimageurl ? <img src={memberPopup.member.profiles.profileimageurl} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: "30px", lineHeight: "60px" }}>👤</span>}
            </div>
            <h3 style={{ margin: "0 0 16px", fontSize: "18px" }}>{memberPopup.member.nickname}</h3>
            {memberPopup.loading ? (
              <p style={{ fontSize: "14px", color: "#6B7280" }}>상태 확인 중...</p>
            ) : (
              memberPopup.status === "accepted" ? (
                <p style={{ fontSize: "14px", color: "#7C5CFF", fontWeight: "bold" }}>친구가 된 사용자입니다.</p>
              ) : (
                <button
                  onClick={async () => {
                    try {
                      await sendFriendRequestById(currentUser.id, memberPopup.member.userid);
                      alert("친구 요청을 보냈습니다.");
                      setMemberPopup(null);
                    } catch(e) { alert("요청 실패"); }
                  }}
                  style={{ width: "100%", padding: "10px", background: "#7C5CFF", color: "#fff", border: "none", borderRadius: "10px", fontWeight: "bold", cursor: "pointer", marginBottom: "8px" }}
                >
                  친구 요청 보내기
                </button>
              )
            )}
            <button onClick={() => setMemberPopup(null)} style={{ width: "100%", padding: "10px", background: "#F3F4F6", color: "#4B5563", border: "none", borderRadius: "10px", fontWeight: "bold", cursor: "pointer" }}>닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default RoomDetailPage;
