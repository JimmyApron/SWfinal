import { useEffect, useState, useRef } from "react";
import DatePicker from "react-multi-date-picker";
import { useNavigate } from "react-router-dom";
import {
  getScheduleCandidates,
  getRoomMembers,
  getRoomGuests,
  getMemberAvailabilities,
  saveMemberAvailabilities,
  addScheduleCandidate,
  updateScheduleCandidate,
  deleteScheduleCandidate,
  getAdditionalConfirmedLocations,
  deleteMemberAvailabilities,
} from "../../api/scheduleApi";
import { updateRoomLastActivity } from "../../api/roomApi";
import { supabase } from "../../lib/supabaseClient";
import { createNotification, createRoomNotifications } from "../../api/notificationApi";
import ConfirmedScheduleCard from "../../components/ConfirmedScheduleCard";
import { getTodayStr } from "../../utils/scheduleUtils";

const memberColors = [
  "#7C5CFF",
  "#FF8A80",
  "#4DD0E1",
  "#81C784",
  "#FFD54F",
  "#BA68C8",
  "#FFB74D",
];

function ScheduleTab({ roomId, ownerUserId, roomName }) {
  const navigate = useNavigate();
  const [candidates, setCandidates] = useState([]);
  const [members, setMembers] = useState([]);
  const [guests, setGuests] = useState([]);
  const [availabilities, setAvailabilities] = useState([]);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedSlots, setSelectedSlots] = useState([]);
  const [dragMode, setDragMode] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [newDate, setNewDate] = useState("");
  const [newDates, setNewDates] = useState([]);
  const [newStartTime, setNewStartTime] = useState("");
  const [newEndTime, setNewEndTime] = useState("");
  const [newIsAllDay, setNewIsAllDay] = useState(false);
  const [editingCandidateId, setEditingCandidateId] = useState(null);
  const [showAllTimes, setShowAllTimes] = useState(true);
  const [activeDragCandidateId, setActiveDragCandidateId] = useState(null);
  const [clickedSlot, setClickedSlot] = useState(null); // { candidate, time, availableMembers, unavailableMembers }

  const [confirmedSchedules, setConfirmedSchedules] = useState([]);
  const [additionalLocations, setAdditionalLocations] = useState([]);
  const [showConfirmedForm, setShowConfirmedForm] = useState(false);
  const [showCandidateForm, setShowCandidateForm] = useState(false);
  const [showAddMethodSheet, setShowAddMethodSheet] = useState(false);
  const [candidateViewMode, setCandidateViewMode] = useState("timetable"); // "timetable" | "calendar"
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [confirmedTitle, setConfirmedTitle] = useState("");
  const [confirmedDate, setConfirmedDate] = useState("");
  const [confirmedStartTime, setConfirmedStartTime] = useState("");
  const [confirmedEndTime, setConfirmedEndTime] = useState("");
  const [confirmedIsAllDay, setConfirmedIsAllDay] = useState(false);
  const [isConfirmedExpanded, setIsConfirmedExpanded] = useState(false);

  const timetableScrollRef = useRef(null);

  const timeSlots = [];
  for (let hour = 0; hour < 24; hour++) {
    for (let minute of [0, 30]) {
      const h = String(hour).padStart(2, "0");
      const m = String(minute).padStart(2, "0");
      timeSlots.push(`${h}:${m}`);
    }
  }

  const filteredTimeSlots = showAllTimes
    ? timeSlots
    : timeSlots.filter((t) => t >= "09:00" && t <= "22:00");

  const getHeatmapColor = (count, total) => {
    if (count === 0) return "transparent";
    const ratio = count / total;
    let opacity = 0.2;
    if (ratio >= 1) opacity = 0.9;
    else if (ratio > 0.7) opacity = 0.7;
    else if (ratio > 0.4) opacity = 0.5;
    else if (ratio > 0.2) opacity = 0.3;
    
    return `rgba(109, 76, 255, ${opacity})`;
  };

  const getMemberColor = (userid) => {
    const allMembers = [
      ...members.map((m) => ({ id: m.userid, name: m.nickname })),
      ...guests.map((g) => ({ id: g.id, name: g.nickname })),
    ];
    const index = allMembers.findIndex((m) => m.id === userid);
    return memberColors[index >= 0 ? index % memberColors.length : 0];
  };

  const formatDateWithDay = (dateString) => {
    const date = new Date(dateString);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const days = ["일", "월", "화", "수", "목", "금", "토"];
    return `${month}.${day}(${days[date.getDay()]})`;
  };

  const getNextTime = (time) => {
    const [hour, minute] = time.split(":").map(Number);
    const date = new Date();
    date.setHours(hour);
    date.setMinutes(minute + 30);
    const h = String(date.getHours()).padStart(2, "0");
    const m = String(date.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  };

  const getSlotKey = (candidateId, time) => `${candidateId}-${time}`;

  const getSlotAvailabilities = (candidateId, time) => {
    return availabilities.filter(
      (item) =>
        item.candidateid === candidateId &&
        item.starttime?.slice(0, 5) <= time &&
        item.endtime?.slice(0, 5) > time
    );
  };

  const isTimeSelectable = (candidate, time) => {
    if (candidate.isallday) return true;
    const start = candidate.starttime?.slice(0, 5);
    const end = candidate.endtime?.slice(0, 5);
    return time >= start && time < end;
  };

  const handleSelectSlot = (candidate, time, mode) => {
    if (!isSelectMode) return;
    const key = getSlotKey(candidate.id, time);
    setSelectedSlots((prev) => {
      const alreadySelected = prev.some((slot) => slot.key === key);
      if (mode === "remove") return prev.filter((slot) => slot.key !== key);
      if (mode === "add" && !alreadySelected) {
        return [
          ...prev,
          {
            key,
            candidateId: candidate.id,
            date: candidate.date,
            starttime: time,
            endtime: getNextTime(time),
          },
        ];
      }
      return prev;
    });
  };

  const handleSaveAvailability = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      let userId, userNickname;

      if (user) {
        userId = user.id;
        userNickname = user.user_metadata?.nickname || user.email;
      } else {
        const guestId = localStorage.getItem("guest_id");
        const guestNickname = localStorage.getItem("guest_nickname");
        if (!guestId) {
          alert("로그인이 필요합니다.");
          return;
        }
        userId = guestId;
        userNickname = guestNickname;
      }

      const rows = selectedSlots.map((slot) => ({
        roomid: Number(roomId),
        candidateid: slot.candidateId,
        userid: userId,
        nickname: userNickname,
        date: slot.date,
        starttime: slot.starttime,
        endtime: slot.endtime,
      }));

      await saveMemberAvailabilities(roomId, userId, rows);
      await updateRoomLastActivity(roomId);

      alert("가능한 일정이 저장되었습니다.");
      setSelectedSlots([]);
      setIsSelectMode(false);

      const newAvailabilities = await getMemberAvailabilities(roomId);
      setAvailabilities(newAvailabilities);
    } catch (error) {
      console.error(error);
      alert("일정 저장 실패");
    }
  };

  const handleDeleteMyAvailability = async () => {
    if (!window.confirm("내가 등록한 모든 가능한 시간을 삭제할까요?")) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id || localStorage.getItem("guest_id");
      if (!userId) return;

      await deleteMemberAvailabilities(roomId, userId);
      await updateRoomLastActivity(roomId);

      alert("내 일정이 모두 삭제되었습니다.");
      setSelectedSlots([]);
      setIsSelectMode(false);
      const newAvailabilities = await getMemberAvailabilities(roomId);
      setAvailabilities(newAvailabilities);
    } catch (error) {
      console.error(error);
      alert("내 일정 삭제 실패");
    }
  };

  const getSelectedSummary = () => {
    if (selectedSlots.length === 0) return "선택한 시간이 없습니다.";
    const sorted = [...selectedSlots].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.starttime.localeCompare(b.starttime);
    });
    const first = sorted[0];
    const rangeText = `${first.starttime}~${first.endtime}`;
    return selectedSlots.length > 1 ? `${rangeText} 외 ${selectedSlots.length - 1}개` : rangeText;
  };

  const handleCellClick = (candidate, time) => {
    // 상세 팝업 제거
  };


  const reloadScheduleData = async () => {
    let candidateData = await getScheduleCandidates(roomId);
    const availabilityData = await getMemberAvailabilities(roomId);
    
    // 오늘 이전 후보 자동 삭제
    const today = getTodayStr();
    const expired = candidateData.filter((c) => c.date && c.date < today);
    if (expired.length > 0) {
      await Promise.all(expired.map((c) => deleteScheduleCandidate(c.id)));
      candidateData = await getScheduleCandidates(roomId);
    }
    
    setCandidates(candidateData);
    setAvailabilities(availabilityData);
  };

  const handleAddOrUpdateCandidate = async () => {
    try {
      if (!newIsAllDay) {
        if (!newStartTime || !newEndTime) {
          alert("시작 시간과 종료 시간을 선택하세요.");
          return;
        }
        if (newStartTime >= newEndTime) {
          alert("시작 시간은 종료 시간보다 빨라야 합니다.");
          return;
        }
      }

      if (editingCandidateId) {
        if (!newDate) { alert("날짜를 선택하세요."); return; }
        await updateScheduleCandidate(editingCandidateId, {
          roomid: Number(roomId),
          date: newDate,
          starttime: newIsAllDay ? null : newStartTime,
          endtime: newIsAllDay ? null : newEndTime,
          isallday: newIsAllDay,
        });
        alert("후보 일정이 수정되었습니다.");
      } else {
        if (!newDates || newDates.length === 0) {
          alert("날짜를 1개 이상 선택하세요.");
          return;
        }
        const dateStrings = newDates.map((d) => d.format ? d.format("YYYY-MM-DD") : String(d));
        const duplicates = dateStrings.filter((ds) => candidates.some((c) => c.date === ds));
        if (duplicates.length > 0) {
          alert(`이미 추가된 날짜가 있습니다: ${duplicates.join(", ")}`);
          return;
        }

        for (const dateStr of dateStrings) {
          await addScheduleCandidate({
            roomid: Number(roomId),
            date: dateStr,
            starttime: newIsAllDay ? null : newStartTime,
            endtime: newIsAllDay ? null : newEndTime,
            isallday: newIsAllDay,
          });
        }

        // 📢 새 일정 후보 추가 알림 전송
        try {
          await createRoomNotifications({
            roomId: Number(roomId),
            senderId: currentUser?.id,
            type: "schedule_new",
            title: "📅 새로운 일정 후보 등록",
            message: `[${roomName}] 방에 ${dateStrings.length}개의 새로운 일정 후보가 등록되었습니다. 가능한 시간을 표시해 주세요!`,
            link: `/rooms/${roomId}?tab=schedule`,
          });
        } catch (notifError) {
          console.error("일정 후보 알림 생성 실패:", notifError);
        }

        alert(`후보 일정 ${dateStrings.length}개가 추가되었습니다.`);
      }

      await updateRoomLastActivity(roomId);
      await reloadScheduleData();
      setNewDate(""); setNewDates([]); setNewStartTime(""); setNewEndTime(""); setNewIsAllDay(false); setEditingCandidateId(null);
      setShowCandidateForm(false);
    } catch (error) {
      console.error(error);
      alert("후보 일정 저장 실패");
    }
  };

  const handleEditCandidate = (candidate) => {
    setEditingCandidateId(candidate.id);
    setNewDate(candidate.date);
    setNewStartTime(candidate.starttime?.slice(0, 5) || "");
    setNewEndTime(candidate.endtime?.slice(0, 5) || "");
    setNewIsAllDay(candidate.isallday);
    setShowCandidateForm(true);
  };

  const handleDeleteCandidate = async (candidateId) => {
    if (!window.confirm("이 후보를 삭제하면 해당 후보에 등록된 멤버 일정도 함께 삭제됩니다. 삭제할까요?")) return;
    try {
      await deleteScheduleCandidate(candidateId);
      await updateRoomLastActivity(roomId);
      await reloadScheduleData();
      alert("후보 일정이 삭제되었습니다.");
    } catch (error) {
      console.error(error);
      alert("후보 일정 삭제 실패");
    }
  };

  const handleRequestSchedule = async (receiver) => {
    try {
      const senderId = currentUser?.id || localStorage.getItem("guest_id");
      if (!senderId) { alert("사용자 정보를 불러오는 중입니다."); return; }
      const receiverId = receiver.userid || receiver.id;
      await createNotification({
        roomId, receiverId, senderId,
        type: "schedule_request",
        title: "일정 등록 요청",
        message: "아직 가능한 일정을 등록하지 않았습니다. 일정을 등록해주세요!",
        link: `/rooms/${roomId}`,
      });
      alert(`${receiver.nickname || "상대방"}님에게 일정 등록 요청 알림을 보냈습니다.`);
    } catch (error) {
      console.error("일정 등록 요청 알림 전송 실패:", error);
      alert("일정 등록 요청 알림 전송에 실패했습니다.");
    }
  };

  const handleShowAvailableResult = () => {
    navigate(`/rooms/${roomId}/available-result`, {
      state: { availabilities, candidates },
    });
  };

  const loadConfirmedSchedules = async () => {
    const today = getTodayStr();
    const [{ data }, locations] = await Promise.all([
      supabase.from("confirmed_schedules").select("*").eq("roomid", roomId).or(`date.gte.${today},date.is.null`).order("date", { ascending: true }),
      getAdditionalConfirmedLocations(roomId),
    ]);
    setConfirmedSchedules(data || []);
    setAdditionalLocations(locations || []);
  };

  const handleAddConfirmedSchedule = async () => {
    if (!confirmedDate) { alert("날짜를 선택하세요."); return; }
    if (!confirmedIsAllDay && (!confirmedStartTime || !confirmedEndTime)) { alert("시작 시간과 종료 시간을 선택하세요."); return; }
    if (!confirmedIsAllDay && confirmedStartTime >= confirmedEndTime) { alert("시작 시간은 종료 시간보다 빨라야 합니다."); return; }

    const { error } = await supabase.from("confirmed_schedules").insert([{
      roomid: Number(roomId),
      title: confirmedTitle || null,
      date: confirmedDate,
      starttime: confirmedIsAllDay ? null : confirmedStartTime,
      endtime: confirmedIsAllDay ? null : confirmedEndTime,
      isallday: confirmedIsAllDay,
    }]);

    if (error) { alert("확정 일정 추가 실패"); return; }
    
    // 📢 확정 일정 추가 알림 전송
    try {
      const scheduleTitle = confirmedTitle?.trim() ? `'${confirmedTitle}' ` : "";
      await createRoomNotifications({
        roomId: Number(roomId),
        senderId: currentUser?.id,
        type: "schedule_confirmed",
        title: "🗓️ 일정 확정",
        message: `[${roomName}] 방에 ${scheduleTitle}일정이 확정되었습니다.`,
        link: `/rooms/${roomId}?tab=schedule`,
      });
    } catch (notifError) {
      console.error("확정 일정 알림 생성 실패:", notifError);
    }

    await updateRoomLastActivity(roomId);
    setConfirmedTitle(""); setConfirmedDate(""); setConfirmedStartTime(""); setConfirmedEndTime(""); setConfirmedIsAllDay(false);
    setShowConfirmedForm(false);
    await loadConfirmedSchedules();
  };

  const handleToggleAbsence = async (schedule) => {
    const userId = currentUser?.id;
    if (!userId) return;
    const absentees = schedule.absentees || [];
    const isAbsent = absentees.includes(userId);
    const updated = isAbsent ? absentees.filter((id) => id !== userId) : [...absentees, userId];
    await supabase.from("confirmed_schedules").update({ absentees: updated }).eq("id", schedule.id);
    await loadConfirmedSchedules();
  };

  const handleDeleteConfirmedSchedule = async (id) => {
    if (!window.confirm("이 일정을 삭제할까요? 모든 멤버에게 사라집니다.")) return;
    await supabase.from("confirmed_schedules").delete().eq("id", id);
    await updateRoomLastActivity(roomId);
    await loadConfirmedSchedules();
  };

  useEffect(() => {
    const loadData = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        let myUser = null;
        if (user) { myUser = { id: user.id, type: "member" }; }
        else {
          const guestId = localStorage.getItem("guest_id");
          if (guestId) { myUser = { id: guestId, type: "guest" }; }
        }
        setCurrentUser(myUser);

        const memberData = await getRoomMembers(roomId);
        const guestData = await getRoomGuests(roomId);
        setMembers(memberData);
        setGuests(guestData);
        
        await reloadScheduleData();
        await loadConfirmedSchedules();
      } catch (error) { console.error("데이터 로드 실패:", error); }
    };
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const myUserId = currentUser?.id || localStorage.getItem("guest_id");
  const myAvailability = availabilities.some((item) => item.userid === myUserId);

  return (
    <div>
      {/* 일정 추가 방법 선택 바텀시트 */}
      {showAddMethodSheet && (
        <>
          <div
            onClick={() => setShowAddMethodSheet(false)}
            style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", zIndex: 200 }}
          />
          <div
            style={{
              position: "fixed",
              top: "50%", left: "50%",
              transform: "translate(-50%, -50%)",
              backgroundColor: "#fff", borderRadius: "16px",
              padding: "24px 20px", zIndex: 201,
              width: "280px",
            }}
          >
            <p style={{ margin: "0 0 16px", fontWeight: "bold", fontSize: "16px", textAlign: "center" }}>일정 추가 방법</p>
            <button
              onClick={() => { setShowAddMethodSheet(false); setShowConfirmedForm(true); }}
              style={{ width: "100%", padding: "14px", marginBottom: "10px", backgroundColor: "#f9f9ff", border: "1px solid #d8d8ff", borderRadius: "12px", fontSize: "15px", color: "#333", cursor: "pointer", textAlign: "left" }}
            >
              ✏️ 직접 입력
            </button>
            <button
              onClick={() => { setShowAddMethodSheet(false); navigate(`/rooms/${roomId}/vote-create`, { state: { votePurpose: "schedule", voteType: "date", returnTab: "schedule" } }); }}
              style={{ width: "100%", padding: "14px", backgroundColor: "#f9f9ff", border: "1px solid #d8d8ff", borderRadius: "12px", fontSize: "15px", color: "#333", cursor: "pointer", textAlign: "left" }}
            >
              🗳️ 투표로 정하기
            </button>
          </div>
        </>
      )}

      {/* Confirmed schedules section */}
      <div style={{ marginBottom: "32px", marginTop: "24px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "16px" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "18px", fontWeight: "700", color: "#1F2933" }}>확정된 일정</h2>
            <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#6B7280" }}>다가오는 약속을 확인해보세요.</p>
          </div>
          <button
            onClick={() => {
              if (showConfirmedForm) {
                setShowConfirmedForm(false);
              } else {
                setShowAddMethodSheet(true);
              }
            }}
            style={{
              padding: "8px 16px",
              backgroundColor: "#F0ECFF",
              color: "#7C5CFF",
              border: "1px solid #7C5CFF",
              borderRadius: "20px",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: "600",
              transition: "all 0.2s",
            }}
          >
            {showConfirmedForm ? "취소" : "+ 일정 추가"}
          </button>
        </div>

        {showConfirmedForm && (
          <div style={{ backgroundColor: "#FFFFFF", borderRadius: "12px", padding: "16px", marginBottom: "16px", display: "flex", flexDirection: "column", gap: "10px", border: "1px solid #E5E7EB", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
            <input type="text" placeholder="일정 제목 (선택)" value={confirmedTitle} onChange={(e) => setConfirmedTitle(e.target.value)} style={{ padding: "10px 12px", border: "1px solid #E5E7EB", borderRadius: "8px", fontSize: "14px", outline: "none" }} />
            <input type="date" value={confirmedDate} onChange={(e) => setConfirmedDate(e.target.value)} style={{ padding: "10px 12px", border: "1px solid #E5E7EB", borderRadius: "8px", fontSize: "14px", outline: "none" }} />
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", color: "#1F2933", cursor: "pointer" }}>
              <input type="checkbox" checked={confirmedIsAllDay} onChange={(e) => setConfirmedIsAllDay(e.target.checked)} style={{ accentColor: "#7C5CFF" }} /> 하루종일
            </label>
            {!confirmedIsAllDay && (
              <div style={{ display: "flex", gap: "8px" }}>
                <select value={confirmedStartTime} onChange={(e) => setConfirmedStartTime(e.target.value)} style={{ flex: 1, padding: "10px", border: "1px solid #E5E7EB", borderRadius: "8px", fontSize: "14px", outline: "none", backgroundColor: "#FFFFFF" }}>
                  <option value="">시작 시간</option>
                  {timeSlots.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <select value={confirmedEndTime} onChange={(e) => setConfirmedEndTime(e.target.value)} style={{ flex: 1, padding: "10px", border: "1px solid #E5E7EB", borderRadius: "8px", fontSize: "14px", outline: "none", backgroundColor: "#FFFFFF" }}>
                  <option value="">종료 시간</option>
                  {timeSlots.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            )}
            <button onClick={handleAddConfirmedSchedule} style={{ padding: "12px", backgroundColor: "#7C5CFF", color: "#fff", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "14px", fontWeight: "700", marginTop: "4px" }}>추가하기</button>
          </div>
        )}

        {confirmedSchedules.length === 0 ? (
          <div style={{ padding: "32px 0", textAlign: "center", backgroundColor: "#FFFFFF", borderRadius: "12px", border: "1px dashed #E5E7EB" }}>
            <p style={{ color: "#6B7280", fontSize: "14px", margin: 0 }}>아직 확정된 일정이 없습니다.</p>
          </div>
        ) : (
          <div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              {(isConfirmedExpanded ? confirmedSchedules : confirmedSchedules.slice(0, 3)).map((s) => {
                const isAbsent = (s.absentees || []).includes(currentUser?.id);
                return (
                  <ConfirmedScheduleCard
                    key={s.id}
                    schedule={{
                      ...s,
                      roomname: roomName,
                      additionalLocations: additionalLocations.filter((location) => Number(location.scheduleid) === Number(s.id)),
                      isAbsent,
                    }}
                    onClick={() => navigate("/confirmed-schedule", { state: { schedule: { ...s, roomname: roomName } } })}
                  />
                );
              })}
            </div>
            {confirmedSchedules.length > 3 && (
              <button
                onClick={() => setIsConfirmedExpanded(!isConfirmedExpanded)}
                style={{
                  width: "100%",
                  padding: "12px",
                  marginTop: "8px",
                  backgroundColor: "transparent",
                  color: "#7C5CFF",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: "600",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                }}
              >
                {isConfirmedExpanded ? "접기 ▲" : `${confirmedSchedules.length - 3}개 더 보기 ▼`}
              </button>
            )}
            <div style={{ textAlign: "center", marginTop: "12px" }}>
              <span style={{ fontSize: "12px", color: "#9CA3AF" }}>총 {confirmedSchedules.length}개의 일정</span>
            </div>
          </div>
        )}
      </div>


      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "16px 0 10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <h2 style={{ margin: 0, fontSize: "18px", fontWeight: "700", color: "#1F2933" }}>일정 조율</h2>
          <button
            onClick={() => setShowCandidateForm(!showCandidateForm)}
            style={{
              padding: "4px 8px",
              backgroundColor: "transparent",
              color: "#7C5CFF",
              border: "none",
              borderRadius: "4px",
              fontSize: "13px",
              fontWeight: "600",
              cursor: "pointer",
            }}
          >
            {showCandidateForm ? "취소" : "+ 직접 시간 추가"}
          </button>
        </div>
        <div style={{ display: "flex", backgroundColor: "#F3F4F6", borderRadius: "8px", padding: "2px" }}>
          {["timetable", "calendar"].map((v) => (
            <button
              key={v}
              onClick={() => setCandidateViewMode(v)}
              style={{
                padding: "6px 12px",
                border: "none",
                borderRadius: "6px",
                backgroundColor: candidateViewMode === v ? "#FFFFFF" : "transparent",
                color: candidateViewMode === v ? "#1F2933" : "#6B7280",
                fontSize: "13px",
                cursor: "pointer",
                fontWeight: candidateViewMode === v ? "600" : "500",
                boxShadow: candidateViewMode === v ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                transition: "all 0.2s",
              }}
            >
              {v === "calendar" ? "달력" : "시간표"}
            </button>
          ))}
        </div>
      </div>

      {showCandidateForm && (
        <div style={{ backgroundColor: "#FFFFFF", borderRadius: "12px", padding: "16px", marginBottom: "16px", display: "flex", flexDirection: "column", gap: "10px", border: "1px solid #E5E7EB", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span style={{ fontSize: "12px", color: "#6B7280", fontWeight: "600" }}>날짜 선택 (여러 개 선택 가능)</span>
            <DatePicker
              multiple
              value={newDates}
              onChange={setNewDates}
              format="YYYY-MM-DD"
              minDate={new Date()}
              containerStyle={{ width: "100%" }}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "10px 12px",
                border: "1px solid #E5E7EB",
                borderRadius: "8px",
                fontSize: "14px",
              }}
              placeholder="날짜를 선택하세요"
            />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", color: "#1F2933", cursor: "pointer" }}>
            <input type="checkbox" checked={newIsAllDay} onChange={(e) => setNewIsAllDay(e.target.checked)} style={{ accentColor: "#7C5CFF" }} /> 하루종일
          </label>
          {!newIsAllDay && (
            <div style={{ display: "flex", gap: "8px" }}>
              <select value={newStartTime} onChange={(e) => setNewStartTime(e.target.value)} style={{ flex: 1, padding: "10px", border: "1px solid #E5E7EB", borderRadius: "8px", fontSize: "14px", outline: "none", backgroundColor: "#FFFFFF" }}>
                <option value="">시작 시간</option>
                {timeSlots.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select value={newEndTime} onChange={(e) => setNewEndTime(e.target.value)} style={{ flex: 1, padding: "10px", border: "1px solid #E5E7EB", borderRadius: "8px", fontSize: "14px", outline: "none", backgroundColor: "#FFFFFF" }}>
                <option value="">종료 시간</option>
                {timeSlots.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          )}
          <button onClick={handleAddOrUpdateCandidate} style={{ padding: "12px", backgroundColor: "#7C5CFF", color: "#fff", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "14px", fontWeight: "700", marginTop: "4px" }}>
            {editingCandidateId ? "수정하기" : "추가하기"}
          </button>
        </div>
      )}

      {candidateViewMode === "timetable" && (
        <div style={{ paddingBottom: isSelectMode ? "100px" : "0" }}>
          <p style={{ margin: "4px 0 0", fontSize: "14px", fontWeight: "600", color: "#1F2933" }}>
            위아래로 드래그해서 가능한 시간을 선택하세요.
          </p>
          <p style={{ margin: "2px 0 16px", fontSize: "12px", color: "#6B7280" }}>
            같은 날짜 안에서 세로 방향으로만 선택됩니다.
          </p>

          {/* 시간 선택 카드 그리드 */}
          <div
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: "16px",
              border: "1px solid #E5E7EB",
              boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
              overflow: "hidden",
              marginBottom: "20px",
            }}
          >
            <div
              ref={timetableScrollRef}
              style={{
                overflowX: "auto",
                maxWidth: "100%",
                position: "relative",
              }}
              onMouseLeave={() => { setIsDragging(false); setDragMode(null); setActiveDragCandidateId(null); }}
              onMouseUp={() => { setIsDragging(false); setDragMode(null); setActiveDragCandidateId(null); }}
            >
              <table style={{ borderCollapse: "separate", borderSpacing: 0, minWidth: "100%" }}>
                <thead>
                  <tr>
                    <th style={{
                      position: "sticky",
                      left: 0,
                      zIndex: 10,
                      backgroundColor: "#FFFFFF",
                      width: "60px",
                      padding: "12px 8px",
                      fontSize: "12px",
                      fontWeight: "600",
                      color: "#9CA3AF",
                      borderBottom: "1px solid #F3F4F6",
                      borderRight: "1px solid #F3F4F6",
                    }}>시간</th>
                    {candidates.map((candidate) => (
                      <th
                        key={candidate.id}
                        id={`candidate-col-${candidate.id}`}
                        style={{
                          minWidth: "120px",
                          padding: "12px 8px",
                          backgroundColor: "#FFFFFF",
                          borderBottom: "1px solid #F3F4F6",
                          borderRight: "1px solid #F3F4F6",
                        }}
                      >
                        <div style={{ fontSize: "13px", fontWeight: "700", color: "#1F2933" }}>{formatDateWithDay(candidate.date)}</div>
                        <div style={{ fontSize: "11px", color: "#6B7280", fontWeight: "500", marginTop: "2px" }}>
                          {candidate.isallday ? "하루종일" : `${candidate.starttime?.slice(0, 5)}~${candidate.endtime?.slice(0, 5)}`}
                        </div>
                        <div style={{ display: "flex", gap: "4px", justifyContent: "center", marginTop: "6px" }}>
                          <button
                            onClick={() => handleEditCandidate(candidate)}
                            style={{ fontSize: "10px", color: "#7C5CFF", background: "none", border: "none", cursor: "pointer", fontWeight: "600" }}
                          >수정</button>
                          <button
                            onClick={() => handleDeleteCandidate(candidate.id)}
                            style={{ fontSize: "10px", color: "#EF4444", background: "none", border: "none", cursor: "pointer", fontWeight: "600" }}
                          >삭제</button>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredTimeSlots.map((time, timeIdx) => (
                    <tr key={time}>
                      <td style={{
                        position: "sticky",
                        left: 0,
                        zIndex: 5,
                        backgroundColor: "#FFFFFF",
                        textAlign: "center",
                        fontSize: "11px",
                        fontWeight: "600",
                        color: time.endsWith(":00") ? "#4B5563" : "#D1D5DB",
                        borderRight: "1px solid #F3F4F6",
                        borderBottom: time.endsWith(":30") ? "1px solid #F3F4F6" : "none",
                        height: "28px",
                      }}>
                        {time.endsWith(":00") ? time : ""}
                      </td>
                      {candidates.map((candidate) => {
                        const key = getSlotKey(candidate.id, time);
                        const selectable = isTimeSelectable(candidate, time);
                        const isSelected = selectedSlots.some((slot) => slot.key === key);
                        const slotMembers = getSlotAvailabilities(candidate.id, time);
                        
                        const totalParticipants = members.length + guests.length;
                        const availableCount = slotMembers.length;
                        
                        const mySaved = !isSelectMode && slotMembers.some((member) => member.userid === currentUser?.id);
                        const showMySelection = isSelectMode ? isSelected : mySaved;
                        
                        // 자연스러운 연결을 위한 주변 상태 체크
                        const nextTime = filteredTimeSlots[timeIdx + 1];
                        const prevTime = filteredTimeSlots[timeIdx - 1];
                        const isNextMySelection = nextTime && (isSelectMode 
                          ? selectedSlots.some(s => s.key === getSlotKey(candidate.id, nextTime))
                          : getSlotAvailabilities(candidate.id, nextTime).some(m => m.userid === currentUser?.id));
                        const isPrevMySelection = prevTime && (isSelectMode 
                          ? selectedSlots.some(s => s.key === getSlotKey(candidate.id, prevTime))
                          : getSlotAvailabilities(candidate.id, prevTime).some(m => m.userid === currentUser?.id));

                        const isPastDate = candidate.date < getTodayStr();
                        const bgColor = !selectable 
                          ? (isPastDate ? "#F8F9FA" : "#D1D5DB") 
                          : (availableCount === 0 ? "#F4F5F7" : getHeatmapColor(availableCount, totalParticipants));

                        // 내 선택 외곽선 그림자 계산 (연결된 블록 효과)
                        const selectionShadows = [];
                        if (showMySelection) {
                          selectionShadows.push("inset 2.5px 0 0 #6D4CFF"); // Left
                          selectionShadows.push("inset -2.5px 0 0 #6D4CFF"); // Right
                          if (!isPrevMySelection) selectionShadows.push("inset 0 2.5px 0 #6D4CFF"); // Top
                          if (!isNextMySelection) selectionShadows.push("inset 0 -2.5px 0 #6D4CFF"); // Bottom
                        }

                        return (
                          <td
                            key={key}
                            onMouseDown={() => {
                              if (!isSelectMode || !selectable || isPastDate) return;
                              const mode = isSelected ? "remove" : "add";
                              setDragMode(mode);
                              setIsDragging(true);
                              setActiveDragCandidateId(candidate.id);
                              handleSelectSlot(candidate, time, mode);
                            }}
                            onMouseEnter={() => {
                              if (isDragging && dragMode && selectable && !isPastDate && activeDragCandidateId === candidate.id) {
                                handleSelectSlot(candidate, time, dragMode);
                              }
                            }}
                            onClick={() => handleCellClick(candidate, time)}
                            style={{
                              backgroundColor: bgColor,
                              borderRight: "1px solid #F3F4F6",
                              borderBottom: (showMySelection && isNextMySelection) ? "1px solid rgba(109, 76, 255, 0.1)" : "1px solid #F3F4F6",
                              borderTopLeftRadius: (showMySelection && !isPrevMySelection) ? "10px" : "0",
                              borderTopRightRadius: (showMySelection && !isPrevMySelection) ? "10px" : "0",
                              borderBottomLeftRadius: (showMySelection && !isNextMySelection) ? "10px" : "0",
                              borderBottomRightRadius: (showMySelection && !isNextMySelection) ? "10px" : "0",
                              boxShadow: selectionShadows.length > 0 ? selectionShadows.join(", ") : "none",
                              cursor: (selectable && !isPastDate) ? "pointer" : "default",
                              padding: 0,
                              height: "28px",
                              transition: "all 0.1s",
                              position: "relative",
                              zIndex: showMySelection ? 2 : 0,
                              opacity: isPastDate ? 0.6 : 1,
                            }}
                          >
                            {showMySelection && isNextMySelection && (
                              <div style={{
                                position: "absolute",
                                bottom: "-1px",
                                left: "2.5px",
                                right: "2.5px",
                                height: "1px",
                                backgroundColor: bgColor,
                                zIndex: 3
                              }} />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 범례 영역 삭제됨 */}
          </div>


          <div style={{ display: "flex", gap: "10px", marginBottom: "24px" }}>
            {!isSelectMode ? (
              <button
                onClick={() => {
                  const mySaveSlots = availabilities
                    .filter((item) => item.userid === myUserId)
                    .map((item) => ({
                      key: getSlotKey(item.candidateid, item.starttime.slice(0, 5)),
                      candidateId: item.candidateid,
                      date: item.date,
                      starttime: item.starttime.slice(0, 5),
                      endtime: item.endtime.slice(0, 5)
                    }));
                  setSelectedSlots(mySaveSlots);
                  setIsSelectMode(true);
                }}
                style={{
                  flex: 1,
                  padding: "14px",
                  backgroundColor: "#7C5CFF",
                  color: "#FFFFFF",
                  border: "none",
                  borderRadius: "12px",
                  fontSize: "15px",
                  fontWeight: "700",
                  cursor: "pointer",
                  boxShadow: "0 4px 12px rgba(124, 92, 255, 0.2)",
                }}
              >
                {myAvailability ? "내 일정 수정하기" : "내 일정 등록하기"}
              </button>
            ) : null}
          </div>

          {/* 참여자 현황 */}
          <div style={{ marginBottom: "20px" }}>
            <h3 style={{ fontSize: "14px", fontWeight: "700", color: "#1F2933", marginBottom: "12px" }}>참여자 현황</h3>
            <div style={{ display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "8px", scrollbarWidth: "none" }}>
              {members.map((member) => {
                const isRegistered = availabilities.some((item) => item.userid === member.userid);
                const isMe = !!currentUser?.id && member.userid === currentUser.id;
                const color = getMemberColor(member.userid);

                return (
                  <div
                    key={member.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "6px 12px",
                      backgroundColor: isMe ? "#F0ECFF" : "#FFFFFF",
                      border: `1px solid ${isMe ? "#7C5CFF" : "#E5E7EB"}`,
                      borderRadius: "20px",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    <div style={{
                      width: "20px",
                      height: "20px",
                      borderRadius: "50%",
                      backgroundColor: color,
                      color: "#FFFFFF",
                      fontSize: "10px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: "bold"
                    }}>
                      {(member.nickname || "?").charAt(0)}
                    </div>
                    <span style={{ fontSize: "13px", fontWeight: "600", color: isMe ? "#7C5CFF" : "#1F2933" }}>
                      {member.nickname || "닉네임 없음"}{isMe ? "(나)" : ""}
                    </span>
                    {!isRegistered && !isMe && (
                      <button
                        onClick={() => handleRequestSchedule(member)}
                        style={{
                          marginLeft: "4px",
                          padding: "2px 6px",
                          backgroundColor: "#F3F4F6",
                          border: "none",
                          borderRadius: "4px",
                          fontSize: "10px",
                          color: "#6B7280",
                          cursor: "pointer"
                        }}
                      >요청</button>
                    )}
                    {isRegistered && <span style={{ fontSize: "10px", color: "#10B981", fontWeight: "700" }}>✓</span>}
                  </div>
                );
              })}
              {guests.map((guest) => {
                const isRegistered = availabilities.some((item) => item.userid === guest.id);
                const guestId = localStorage.getItem("guest_id");
                const isMe = !!guestId && guest.id === guestId;
                const color = getMemberColor(guest.id);

                return (
                  <div
                    key={guest.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "6px 12px",
                      backgroundColor: isMe ? "#F0ECFF" : "#FFFFFF",
                      border: `1px solid ${isMe ? "#7C5CFF" : "#E5E7EB"}`,
                      borderRadius: "20px",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    <div style={{
                      width: "20px",
                      height: "20px",
                      borderRadius: "50%",
                      backgroundColor: color,
                      color: "#FFFFFF",
                      fontSize: "10px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: "bold"
                    }}>
                      {(guest.nickname || "?").charAt(0)}
                    </div>
                    <span style={{ fontSize: "13px", fontWeight: "600", color: isMe ? "#7C5CFF" : "#1F2933" }}>
                      {guest.nickname || "닉네임 없음"}{isMe ? "(나)" : ""}
                    </span>
                    {!isRegistered && !isMe && (
                      <button
                        onClick={() => handleRequestSchedule(guest)}
                        style={{
                          marginLeft: "4px",
                          padding: "2px 6px",
                          backgroundColor: "#F3F4F6",
                          border: "none",
                          borderRadius: "4px",
                          fontSize: "10px",
                          color: "#6B7280",
                          cursor: "pointer"
                        }}
                      >요청</button>
                    )}
                    {isRegistered && <span style={{ fontSize: "10px", color: "#10B981", fontWeight: "700" }}>✓</span>}
                  </div>
                );
              })}
            </div>
          </div>

          <button
            onClick={handleShowAvailableResult}
            style={{
              width: "100%",
              padding: "14px",
              backgroundColor: "#FFFFFF",
              color: "#7C5CFF",
              border: "1px solid #7C5CFF",
              borderRadius: "12px",
              fontSize: "15px",
              fontWeight: "700",
              cursor: "pointer",
              marginBottom: "40px",
            }}
          >
            가능한 시간 분석 보기
          </button>


          {/* 하단 선택 요약 영역 (선택 모드일 때만 표시) */}
          {isSelectMode && (
            <div
              style={{
                position: "fixed",
                bottom: "74px",
                left: "16px",
                right: "16px",
                backgroundColor: "#FFFFFF",
                padding: "16px",
                borderRadius: "16px",
                boxShadow: "0 -4px 20px rgba(0,0,0,0.12)",
                zIndex: 1000,
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                border: "1px solid #E5E7EB",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span style={{ fontSize: "13px", color: "#6B7280" }}>선택한 시간 {selectedSlots.length}개</span>
                  <p style={{ margin: "2px 0 0", fontSize: "15px", fontWeight: "700", color: "#1F2933" }}>
                    {getSelectedSummary()}
                  </p>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    onClick={() => setSelectedSlots([])}
                    style={{
                      padding: "6px 12px",
                      backgroundColor: "transparent",
                      color: "#6B7280",
                      border: "1px solid #E5E7EB",
                      borderRadius: "8px",
                      fontSize: "12px",
                      fontWeight: "600",
                      cursor: "pointer"
                    }}
                  >초기화</button>
                  <button
                    onClick={handleDeleteMyAvailability}
                    style={{
                      padding: "6px 12px",
                      backgroundColor: "transparent",
                      color: "#EF4444",
                      border: "1px solid #FCA5A5",
                      borderRadius: "8px",
                      fontSize: "12px",
                      fontWeight: "600",
                      cursor: "pointer"
                    }}
                  >내 일정 삭제</button>
                </div>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  onClick={() => setIsSelectMode(false)}
                  style={{
                    flex: 1,
                    padding: "12px",
                    backgroundColor: "#F3F4F6",
                    color: "#4B5563",
                    border: "none",
                    borderRadius: "10px",
                    fontSize: "14px",
                    fontWeight: "600",
                    cursor: "pointer"
                  }}
                >취소</button>
                <button
                  onClick={handleSaveAvailability}
                  style={{
                    flex: 2,
                    padding: "12px",
                    backgroundColor: "#7C5CFF",
                    color: "#FFFFFF",
                    border: "none",
                    borderRadius: "10px",
                    fontSize: "14px",
                    fontWeight: "700",
                    cursor: "pointer"
                  }}
                >선택 완료</button>
              </div>
            </div>
          )}
        </div>
      )}

      {candidateViewMode === "calendar" && (
        <CandidateCalendar
          candidates={candidates} availabilities={availabilities} calYear={calYear} calMonth={calMonth}
          onPrevMonth={() => { if (calMonth === 0) { setCalYear((y) => y - 1); setCalMonth(11); } else setCalMonth((m) => m - 1); }}
          onNextMonth={() => { if (calMonth === 11) { setCalYear((y) => y + 1); setCalMonth(0); } else setCalMonth((m) => m + 1); }}
          members={[...members, ...guests]}
        />
      )}

    </div>
  );
}

function MemberTimeline({ candidate, availabilities, members }) {
  const getColor = (uid) => {
    const idx = members.findIndex((m) => (m.userid || m.id) === uid);
    return memberColors[idx >= 0 ? idx % memberColors.length : 0];
  };

  const toDecimalHour = (timeStr) => {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(":").map(Number);
    return h + m / 60;
  };

  const startH = candidate.isallday ? 0 : toDecimalHour(candidate.starttime?.slice(0, 5));
  const endH = candidate.isallday ? 24 : toDecimalHour(candidate.endtime?.slice(0, 5));
  const range = endH - startH || 1;
  const slotsByMember = {};
  availabilities
    .filter((a) => a.candidateid === candidate.id)
    .forEach((a) => {
      if (!slotsByMember[a.userid]) slotsByMember[a.userid] = [];
      slotsByMember[a.userid].push(a);
    });

  const ticks = [];
  for (let h = Math.ceil(startH); h <= Math.floor(endH); h++) {
    ticks.push(h);
  }

  return (
    <div style={{ marginTop: "12px" }}>
      <div style={{ fontSize: "12px", fontWeight: "600", color: "#666", marginBottom: "8px" }}>
        멤버별 가능 시간
        <span style={{ fontWeight: "normal", color: "#aaa", marginLeft: "6px" }}>
          {candidate.isallday ? "00:00 ~ 24:00" : `${candidate.starttime?.slice(0, 5)} ~ ${candidate.endtime?.slice(0, 5)}`}
        </span>
      </div>
      <div style={{ marginLeft: "72px", position: "relative", height: "16px", marginBottom: "2px" }}>
        {ticks.map((h) => (
          <div
            key={h}
            style={{
              position: "absolute",
              left: `${((h - startH) / range) * 100}%`,
              transform: "translateX(-50%)",
              fontSize: "9px",
              color: "#bbb",
            }}
          >
            {h}
          </div>
        ))}
      </div>
      {members.map((member) => {
        const uid = member.userid || member.id;
        const slots = slotsByMember[uid] || [];
        const color = getColor(uid);
        return (
          <div key={uid} style={{ display: "flex", alignItems: "center", marginBottom: "5px" }}>
            <div
              style={{
                width: "64px",
                fontSize: "11px",
                color: "#555",
                textAlign: "right",
                paddingRight: "8px",
                flexShrink: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {member.nickname || "?"}
            </div>
            <div
              style={{
                flex: 1,
                height: "22px",
                backgroundColor: "#eeeeee",
                borderRadius: "4px",
                position: "relative",
                overflow: "hidden",
              }}
            >
              {slots.length === 0 && (
                <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", color: "#ccc" }}>
                  미등록
                </div>
              )}
              {slots.map((slot, si) => {
                const s = toDecimalHour(slot.starttime?.slice(0, 5));
                const e = toDecimalHour(slot.endtime?.slice(0, 5));
                const left = Math.max(0, ((s - startH) / range) * 100);
                const width = Math.min(100 - left, ((e - s) / range) * 100);
                return (
                  <div
                    key={si}
                    style={{
                      position: "absolute",
                      left: `${left}%`,
                      width: `${width}%`,
                      height: "100%",
                      backgroundColor: color,
                      opacity: 0.85,
                    }}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CandidateCalendar({ candidates, availabilities, calYear, calMonth, onPrevMonth, onNextMonth, members }) {
  const [selectedDate, setSelectedDate] = useState(null);
  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const cells = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const candidateMap = {};
  candidates.forEach((c) => {
    if (!candidateMap[c.date]) candidateMap[c.date] = [];
    candidateMap[c.date].push(c);
  });

  const availMap = {};
  availabilities.forEach(({ date, userid }) => {
    if (!availMap[date]) availMap[date] = new Set();
    availMap[date].add(userid);
  });

  const pad = (n) => String(n).padStart(2, "0");
  const dateKey = (d) => `${calYear}-${pad(calMonth + 1)}-${pad(d)}`;
  
  const selectedAvailUsers = selectedDate ? [...(availMap[selectedDate] || [])] : [];
  const selectedAvailCount = selectedAvailUsers.length;

  return (
    <div style={{ marginTop: "8px" }}>
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "6px", marginBottom: "12px" }}>
        <button onClick={onPrevMonth} style={{ border: "none", background: "none", fontSize: "20px", cursor: "pointer", lineHeight: 1, padding: "0 2px" }}>‹</button>
        <span style={{ fontWeight: "bold", fontSize: "16px" }}>{calYear}년 {calMonth + 1}월</span>
        <button onClick={onNextMonth} style={{ border: "none", background: "none", fontSize: "20px", cursor: "pointer", lineHeight: 1, padding: "0 2px" }}>›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: "4px" }}>
        {WEEKDAYS.map((d, i) => (
          <div key={d} style={{ textAlign: "center", fontSize: "12px", fontWeight: "600", color: i === 0 ? "#f44" : i === 6 ? "#7c79ff" : "#555", padding: "4px 0" }}>{d}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "2px" }}>
        {cells.map((d, i) => {
          const key = d ? dateKey(d) : null;
          const availUsers = key ? [...(availMap[key] || [])] : [];
          const availCount = availUsers.length;
          const hasCandidate = key ? !!candidateMap[key] : false;
          const isClickable = availCount > 0 || hasCandidate;
          const isToday = key === todayStr;
          const isSelected = key === selectedDate;
          const col = i % 7;

          return (
            <div
              key={i}
              onClick={() => d && isClickable && setSelectedDate(isSelected ? null : key)}
              style={{
                minHeight: "52px",
                padding: "4px",
                borderRadius: "8px",
                backgroundColor: isSelected ? "#f0f0ff" : hasCandidate ? "#fafaff" : "transparent",
                border: hasCandidate ? "1px solid #e0e0ff" : "1px solid transparent",
                cursor: isClickable ? "pointer" : "default",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              {d && (
                <>
                  <div
                    style={{
                      width: "24px",
                      height: "24px",
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: isToday ? "#7c79ff" : "transparent",
                      color: isToday ? "#fff" : col === 0 ? "#f44" : col === 6 ? "#7c79ff" : "#222",
                      fontSize: "12px",
                      fontWeight: isToday ? "bold" : "normal",
                    }}
                  >
                    {d}
                  </div>
                  {hasCandidate && (
                    <div style={{ alignSelf: "stretch", display: "flex", flexDirection: "column", gap: "2px", marginTop: "2px" }}>
                      {availUsers.slice(0, 3).map((uid) => {
                        const member = members.find((m) => (m.userid || m.id) === uid);
                        const colorIdx = members.findIndex((m) => (m.userid || m.id) === uid);
                        const color = memberColors[colorIdx >= 0 ? colorIdx % memberColors.length : 0];
                        return (
                          <div
                            key={uid}
                            style={{
                              height: "4px",
                              backgroundColor: color,
                              borderRadius: "2px",
                              width: "100%",
                            }}
                            title={member?.nickname || ""}
                          />
                        );
                      })}
                      {availCount > 3 && <div style={{ fontSize: "8px", color: "#888", textAlign: "center" }}>+{availCount - 3}</div>}
                      {availCount === 0 && <div style={{ fontSize: "9px", color: "#bbb", textAlign: "center" }}>후보</div>}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
      {selectedDate && (candidateMap[selectedDate] || selectedAvailCount > 0) && (
        <div style={{ marginTop: "12px", padding: "12px", backgroundColor: "#f5f5ff", borderRadius: "10px" }}>
          <p style={{ margin: "0 0 4px", fontWeight: "bold", fontSize: "14px", color: "#555" }}>
            {selectedDate}
            {selectedAvailCount > 0 && (
              <span style={{ marginLeft: "8px", fontSize: "12px", color: "#7c79ff", fontWeight: "normal" }}>
                👥 {selectedAvailCount}명 가능
              </span>
            )}
          </p>
          {(candidateMap[selectedDate] || []).map((candidate) => (
            <MemberTimeline key={candidate.id} candidate={candidate} availabilities={availabilities} members={members} />
          ))}
        </div>
      )}
    </div>
  );
}

const headerCellStyle = { width: "140px", height: "55px", border: "1px solid #d8d8ff", textAlign: "center", fontWeight: "bold" };
const timeCellStyle = { width: "80px", height: "32px", border: "1px solid #d8d8ff", textAlign: "center" };
const slotCellStyle = { width: "140px", height: "32px", border: "1px solid #d8d8ff", padding: 0 };

export default ScheduleTab;
