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
} from "../../api/scheduleApi";
import { updateRoomLastActivity } from "../../api/roomApi";
import { supabase } from "../../lib/supabaseClient";
import { createNotification, createRoomNotifications } from "../../api/notificationApi";
import ConfirmedScheduleCard from "../../components/ConfirmedScheduleCard";
import { FiCalendar, FiClock, FiPlus, FiChevronLeft, FiChevronRight, FiEdit2, FiTrash2, FiMoreVertical } from "react-icons/fi";
import { getTodayStr } from "../../utils/scheduleUtils";

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
  const [activeCandidateMenu, setActiveCandidateMenu] = useState(null); // 추가: 후보지 메뉴 상태

  const [confirmedSchedules, setConfirmedSchedules] = useState([]);
  const [additionalLocations, setAdditionalLocations] = useState([]);
  const [showConfirmedForm, setShowConfirmedForm] = useState(false);
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
  const [showAddCandidateForm, setShowAddCandidateForm] = useState(false); // 추가: 후보지 추가 폼 표시 여부
  const [showEditCandidateModal, setShowEditCandidateModal] = useState(false); // 추가: 후보지 수정 팝업(중앙) 표시 여부

  const timetableScrollRef = useRef(null);

  const memberColors = [
    "#7C5CFF",
    "#FF8A80",
    "#4DD0E1",
    "#81C784",
    "#FFD54F",
    "#BA68C8",
    "#FFB74D",
  ];

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

  // 모든 후보 일정이 공통으로 선택 불가능한 이른/늦은 시간대는 표에서 정리한다.
  const hasAllDayCandidate = candidates.some((c) => c.isallday);
  const earliestStartMinutes = candidates.reduce((min, c) => {
    if (c.isallday || !c.starttime) return min;
    const [h, m] = c.starttime.slice(0, 5).split(":").map(Number);
    const minutes = h * 60 + m;
    return min === null ? minutes : Math.min(min, minutes);
  }, null);
  const latestEndMinutes = candidates.reduce((max, c) => {
    if (c.isallday || !c.endtime) return max;
    const [h, m] = c.endtime.slice(0, 5).split(":").map(Number);
    return Math.max(max, h * 60 + m);
  }, 0);
  const minutesToTime = (mins) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };
  // 위/아래 모두 공통으로 선택 불가능한 시간대면 펼치기 없이 바로 잘라낸다.
  const startCutoff =
    hasAllDayCandidate || earliestStartMinutes === null
      ? null
      : minutesToTime(earliestStartMinutes);
  const endCutoff =
    hasAllDayCandidate || candidates.length === 0
      ? null
      : minutesToTime(Math.max(0, latestEndMinutes - 30));

  const visibleTimeSlots = filteredTimeSlots.filter(
    (t) => (!startCutoff || t >= startCutoff) && (!endCutoff || t <= endCutoff)
  );

  const getHeatmapColor = (count, total) => {
    const ratio = count / total;
    if (ratio >= 1) return "#7C5CFF"; // 전원 가능
    if (ratio >= 0.75) return "#C8B5FF"; // 많이 겹침
    if (ratio >= 0.4) return "#E2D6FF"; // 2명 이상
    return "#F3EEFF"; // 1명 가능
  };

  const getMemberColor = (userid) => {
    const allIds = [
      ...members.map((m) => m.userid),
      ...guests.map((g) => g.id),
    ];
    const index = allIds.findIndex((id) => id === userid);
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

  const scrollToCandidate = (candidateId) => {
    const element = document.getElementById(`candidate-col-${candidateId}`);
    if (element && timetableScrollRef.current) {
      const offsetLeft = element.offsetLeft;
      timetableScrollRef.current.scrollTo({
        left: offsetLeft - 100,
        behavior: "smooth",
      });
    }
  };

  const handleCellClick = (candidate, time) => {
    if (isSelectMode) return;

    const slotAvails = getSlotAvailabilities(candidate.id, time);
    const availableIds = slotAvails.map(a => a.userid);
    const allParticipants = [
      ...members.map(m => ({ id: m.userid, nickname: m.nickname, type: 'member' })),
      ...guests.map(g => ({ id: g.id, nickname: g.nickname, type: 'guest' }))
    ];

    const available = allParticipants.filter(p => availableIds.includes(p.id));
    const unavailable = allParticipants.filter(p => !availableIds.includes(p.id));

    setClickedSlot({
      candidate,
      time,
      available,
      unavailable
    });
  };


  const reloadScheduleData = async () => {
    const candidateData = await getScheduleCandidates(roomId);
    const availabilityData = await getMemberAvailabilities(roomId);
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
        setShowEditCandidateModal(false);
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
    setShowEditCandidateModal(true); // 수정 시 중앙 팝업 표시
  };

  const closeEditCandidateModal = () => {
    setShowEditCandidateModal(false);
    setEditingCandidateId(null);
    setNewDate(""); setNewStartTime(""); setNewEndTime(""); setNewIsAllDay(false);
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
    const now = new Date();
    const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
    const [{ data }, locations] = await Promise.all([
      supabase.from("confirmed_schedules").select("*").eq("roomid", roomId).or(`date.gte.${today},date.is.null`).order("date", { ascending: true }),
      getAdditionalConfirmedLocations(roomId),
    ]);
    setConfirmedSchedules(data || []);
    setAdditionalLocations(locations || []);
  };

  const handleAddConfirmedSchedule = async () => {
    if (!confirmedDate) { alert("날짜를 선택하세요."); return; }
    if (confirmedDate < getTodayStr()) { alert("과거 날짜는 선택할 수 없습니다."); return; }
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
      const scheduleMessage = `[${roomName}] 방에 ${scheduleTitle}일정이 확정되었습니다.`;
      await createRoomNotifications({
        roomId: Number(roomId),
        senderId: currentUser?.id || localStorage.getItem("guest_id"),
        type: "schedule_confirmed",
        title: "🗓️ 일정 확정",
        message: scheduleMessage,
        link: `/rooms/${roomId}?tab=schedule`,
        includeSender: true,
      });
      window.dispatchEvent(new CustomEvent("app-toast", {
        detail: {
          message: scheduleMessage,
          link: `/rooms/${roomId}?tab=schedule`,
          roomId: Number(roomId),
          type: "schedule_confirmed",
        },
      }));
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

        let candidateData = await getScheduleCandidates(roomId);
        const memberData = await getRoomMembers(roomId);
        const guestData = await getRoomGuests(roomId);
        const availabilityData = await getMemberAvailabilities(roomId);

        // 오늘 이전 후보 자동 삭제 (확정일정과 무관)
        const today = new Date().toISOString().slice(0, 10);
        const expired = candidateData.filter((c) => c.date && c.date < today);
        if (expired.length > 0) {
          await Promise.all(expired.map((c) => deleteScheduleCandidate(c.id)));
          candidateData = await getScheduleCandidates(roomId);
        }
        setCandidates(candidateData);
        setMembers(memberData);
        setGuests(guestData);
        setAvailabilities(availabilityData);
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
            style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", zIndex: 200 }}
          />
          <div
            style={{
              position: "fixed",
              top: "50%", left: "50%",
              transform: "translate(-50%, -50%)",
              backgroundColor: "#fff", borderRadius: "20px",
              padding: "24px", zIndex: 201,
              width: "260px",
              boxShadow: "0 10px 25px rgba(0,0,0,0.1)",
            }}
          >
            <p style={{ margin: "0 0 16px", fontWeight: "bold", fontSize: "16px", color: "#1F2933", textAlign: "center" }}>일정 추가 방법</p>
            <button
              onClick={() => { setShowAddMethodSheet(false); setShowConfirmedForm(true); }}
              style={{ width: "100%", padding: "12px", marginBottom: "8px", backgroundColor: "#7c79ff", border: "none", borderRadius: "10px", fontSize: "15px", color: "#fff", cursor: "pointer" }}
            >
              직접 입력
            </button>
            <button
              onClick={() => { setShowAddMethodSheet(false); navigate(`/rooms/${roomId}/vote-create`, { state: { votePurpose: "schedule", voteType: "date", returnTab: "schedule" } }); }}
              style={{ width: "100%", padding: "12px", backgroundColor: "#f5f5f5", border: "none", borderRadius: "10px", fontSize: "15px", color: "#333", cursor: "pointer" }}
            >
              투표로 정하기
            </button>
          </div>
        </>
      )}

      {/* Confirmed schedules section */}
      <div style={{ marginBottom: "9px", marginTop: "20px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "9px" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "18px", fontWeight: "700", color: "#1F2933" }}>
              확정 일정{" "}
              <span style={{ fontSize: "13px", fontWeight: "500", color: "#9CA3AF" }}>
                총 {confirmedSchedules.length}개의 일정
              </span>
            </h2>
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
              padding: "5px 15px",
              backgroundColor: "#F0ECFF",
              color: "#7C5CFF",
              border: "1px solid #7C5CFF",
              borderRadius: "20px",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: "600",
              transition: "all 0.2s",
              position: "relative",
              top: "-4px",
            }}
          >
            {showConfirmedForm ? "취소" : "+ 새 일정"}
          </button>
        </div>

        {showConfirmedForm && (
          <div style={{ backgroundColor: "#FFFFFF", borderRadius: "12px", padding: "16px", marginBottom: "16px", display: "flex", flexDirection: "column", gap: "10px", border: "1px solid #E5E7EB", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
            <input type="text" placeholder="일정 제목 (선택)" value={confirmedTitle} onChange={(e) => setConfirmedTitle(e.target.value)} style={{ padding: "10px 12px", border: "1px solid #E5E7EB", borderRadius: "8px", fontSize: "14px", outline: "none" }} />
            <input type="date" min={getTodayStr()} value={confirmedDate} onChange={(e) => setConfirmedDate(e.target.value)} style={{ padding: "10px 12px", border: "1px solid #E5E7EB", borderRadius: "8px", fontSize: "14px", outline: "none" }} />
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
              {(isConfirmedExpanded ? confirmedSchedules : confirmedSchedules.slice(0, 1)).map((s) => {
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
            {confirmedSchedules.length > 1 && (
              <button
                onClick={() => setIsConfirmedExpanded(!isConfirmedExpanded)}
                style={{
                  width: "100%",
                  padding: "8px",
                  marginTop: "8px",
                  backgroundColor: "transparent",
                  color: "#7C5CFF",
                  border: "none",
                  borderTop: "1px solid #E5E7EB",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: "bold",
                }}
              >
                {isConfirmedExpanded ? "접기 ▲" : `더보기 (+${confirmedSchedules.length - 1}) ▼`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* 일정 조율 섹션 시작 */}
      <div style={{ marginTop: "4px", marginBottom: "16px" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "12px" }}>
          <div style={{ display: "flex", backgroundColor: "#F3F4F6", borderRadius: "10px", padding: "4px", width: "100%", maxWidth: "300px" }}>
            {["timetable", "calendar"].map((v) => (
              <button
                key={v}
                onClick={() => setCandidateViewMode(v)}
                style={{
                  flex: 1,
                  padding: "8px",
                  border: "none",
                  borderRadius: "8px",
                  backgroundColor: candidateViewMode === v ? "#FFFFFF" : "transparent",
                  color: candidateViewMode === v ? "#7C5CFF" : "#6B7280",
                  fontSize: "14px",
                  cursor: "pointer",
                  fontWeight: "700",
                  boxShadow: candidateViewMode === v ? "0 2px 6px rgba(0,0,0,0.08)" : "none",
                  transition: "all 0.2s",
                }}
              >
                {v === "calendar" ? "달력" : "시간표"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 직접 시간 추가 바텀시트 */}
      {showAddCandidateForm && (
        <>
          <div
            onClick={() => setShowAddCandidateForm(false)}
            style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", zIndex: 3000, backdropFilter: "blur(2px)" }}
          />
          <div
            style={{
              position: "fixed",
              bottom: 0, left: 0, right: 0,
              backgroundColor: "#FFFFFF",
              borderTopLeftRadius: "24px", borderTopRightRadius: "24px",
              padding: "24px 20px 40px", zIndex: 3001,
              boxShadow: "0 -4px 20px rgba(0,0,0,0.15)",
              animation: "slideUp 0.3s ease-out",
            }}
          >
            <div style={{ width: "40px", height: "4px", backgroundColor: "#E5E7EB", borderRadius: "2px", margin: "0 auto 20px" }} />
            <h3 style={{ margin: "0 0 8px", fontSize: "18px", fontWeight: "700", color: "#1F2933" }}>
              직접 시간 추가
            </h3>
            <p style={{ margin: "0 0 24px", fontSize: "14px", color: "#6B7280", fontWeight: "500" }}>
              정확한 시간을 알고 있다면 직접 입력할 수 있어요.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "14px", fontWeight: "700", color: "#1F2933" }}>날짜 선택</label>
                {editingCandidateId ? (
                  <div style={{
                    padding: "12px",
                    backgroundColor: "#F9FAFB",
                    border: "1px solid #E5E7EB",
                    borderRadius: "12px",
                    fontSize: "14px",
                    fontWeight: "600",
                    color: "#1F2933"
                  }}>
                    {formatDateWithDay(newDate)}
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "4px", scrollbarWidth: "none" }}>
                    <DatePicker
                      multiple
                      value={newDates}
                      onChange={setNewDates}
                      format="YYYY-MM-DD"
                      minDate={new Date()}
                      containerStyle={{ width: "100%" }}
                      render={(value, openCalendar) => (
                        <div style={{ display: "flex", gap: "8px", flexWrap: "nowrap" }}>
                          {newDates.length > 0 ? (
                            newDates.map((d, idx) => (
                              <div key={idx} style={{
                                padding: "8px 16px",
                                backgroundColor: "#F0ECFF",
                                color: "#7C5CFF",
                                borderRadius: "20px",
                                fontSize: "13px",
                                fontWeight: "600",
                                border: "1px solid #7C5CFF",
                                whiteSpace: "nowrap"
                              }}>
                                {d.format ? d.format("MM.DD") : String(d).slice(5)}
                              </div>
                            ))
                        ) : null}
                        <button
                          onClick={openCalendar}
                          style={{
                            padding: "8px 16px",
                            backgroundColor: "#FFFFFF",
                            border: "1px dashed #D1D5DB",
                            borderRadius: "20px",
                            fontSize: "13px",
                            fontWeight: "600",
                            color: "#6B7280",
                            whiteSpace: "nowrap",
                            cursor: "pointer",
                          }}
                        >
                          + 날짜 선택
                        </button>
                      </div>
                    )}
                  />
                </div>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <label style={{ fontSize: "14px", fontWeight: "700", color: "#1F2933" }}>하루종일</label>
                <div
                  onClick={() => setNewIsAllDay(!newIsAllDay)}
                  style={{
                    width: "48px",
                    height: "24px",
                    backgroundColor: newIsAllDay ? "#7C5CFF" : "#E5E7EB",
                    borderRadius: "12px",
                    position: "relative",
                    cursor: "pointer",
                    transition: "background-color 0.2s"
                  }}
                >
                  <div style={{
                    width: "20px",
                    height: "20px",
                    backgroundColor: "#FFFFFF",
                    borderRadius: "50%",
                    position: "absolute",
                    top: "2px",
                    left: newIsAllDay ? "26px" : "2px",
                    transition: "left 0.2s"
                  }} />
                </div>
              </div>

              {!newIsAllDay && (
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", fontSize: "12px", color: "#6B7280", marginBottom: "6px", fontWeight: "600" }}>시작 시간</label>
                    <select
                      value={newStartTime}
                      onChange={(e) => setNewStartTime(e.target.value)}
                      style={{ width: "100%", padding: "12px", border: "1px solid #E5E7EB", borderRadius: "12px", fontSize: "15px", outline: "none", backgroundColor: "#F9FAFB", appearance: "none", textAlign: "center", fontWeight: "600" }}
                    >
                      <option value="">시작</option>
                      {timeSlots.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <span style={{ marginTop: "20px", color: "#9CA3AF" }}>~</span>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", fontSize: "12px", color: "#6B7280", marginBottom: "6px", fontWeight: "600" }}>종료 시간</label>
                    <select
                      value={newEndTime}
                      onChange={(e) => setNewEndTime(e.target.value)}
                      style={{ width: "100%", padding: "12px", border: "1px solid #E5E7EB", borderRadius: "12px", fontSize: "15px", outline: "none", backgroundColor: "#F9FAFB", appearance: "none", textAlign: "center", fontWeight: "600" }}
                    >
                      <option value="">종료</option>
                      {timeSlots.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: "10px", marginTop: "12px" }}>
                <button
                  onClick={() => setShowAddCandidateForm(false)}
                  style={{ flex: 1, padding: "14px", backgroundColor: "#FFFFFF", color: "#4B5563", border: "1px solid #E5E7EB", borderRadius: "12px", fontSize: "15px", fontWeight: "700", cursor: "pointer" }}
                >
                  취소
                </button>
                <button
                  onClick={handleAddOrUpdateCandidate}
                  style={{ flex: 2, padding: "14px", backgroundColor: "#7C5CFF", color: "#FFFFFF", border: "none", borderRadius: "12px", fontSize: "15px", fontWeight: "700", cursor: "pointer", boxShadow: "0 4px 12px rgba(124, 92, 255, 0.2)" }}
                >
                  추가하기
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* 후보 일정 수정 팝업 (중앙) */}
      {showEditCandidateModal && (
        <>
          <div
            onClick={closeEditCandidateModal}
            style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", zIndex: 3000, backdropFilter: "blur(2px)" }}
          />
          <div
            style={{
              position: "fixed",
              top: "50%", left: "50%",
              transform: "translate(-50%, -50%)",
              backgroundColor: "#FFFFFF",
              borderRadius: "20px",
              padding: "24px 20px",
              zIndex: 3001,
              width: "min(320px, 90vw)",
              boxShadow: "0 8px 30px rgba(0,0,0,0.2)",
            }}
          >
            <h3 style={{ margin: "0 0 8px", fontSize: "18px", fontWeight: "700", color: "#1F2933" }}>
              시간 수정하기
            </h3>

            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "14px", fontWeight: "700", color: "#1F2933" }}>날짜</label>
                <div style={{
                  padding: "12px",
                  backgroundColor: "#F9FAFB",
                  border: "1px solid #E5E7EB",
                  borderRadius: "12px",
                  fontSize: "14px",
                  fontWeight: "600",
                  color: "#1F2933"
                }}>
                  {newDate ? formatDateWithDay(newDate) : ""}
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <label style={{ fontSize: "14px", fontWeight: "700", color: "#1F2933" }}>하루종일</label>
                <div
                  onClick={() => setNewIsAllDay(!newIsAllDay)}
                  style={{
                    width: "48px",
                    height: "24px",
                    backgroundColor: newIsAllDay ? "#7C5CFF" : "#E5E7EB",
                    borderRadius: "12px",
                    position: "relative",
                    cursor: "pointer",
                    transition: "background-color 0.2s"
                  }}
                >
                  <div style={{
                    width: "20px",
                    height: "20px",
                    backgroundColor: "#FFFFFF",
                    borderRadius: "50%",
                    position: "absolute",
                    top: "2px",
                    left: newIsAllDay ? "26px" : "2px",
                    transition: "left 0.2s"
                  }} />
                </div>
              </div>

              {!newIsAllDay && (
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", fontSize: "12px", color: "#6B7280", marginBottom: "6px", fontWeight: "600" }}>시작 시간</label>
                    <select
                      value={newStartTime}
                      onChange={(e) => setNewStartTime(e.target.value)}
                      style={{ width: "100%", padding: "12px", border: "1px solid #E5E7EB", borderRadius: "12px", fontSize: "15px", outline: "none", backgroundColor: "#F9FAFB", appearance: "none", textAlign: "center", fontWeight: "600" }}
                    >
                      <option value="">시작</option>
                      {timeSlots.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <span style={{ marginTop: "20px", color: "#9CA3AF" }}>~</span>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", fontSize: "12px", color: "#6B7280", marginBottom: "6px", fontWeight: "600" }}>종료 시간</label>
                    <select
                      value={newEndTime}
                      onChange={(e) => setNewEndTime(e.target.value)}
                      style={{ width: "100%", padding: "12px", border: "1px solid #E5E7EB", borderRadius: "12px", fontSize: "15px", outline: "none", backgroundColor: "#F9FAFB", appearance: "none", textAlign: "center", fontWeight: "600" }}
                    >
                      <option value="">종료</option>
                      {timeSlots.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
                <button
                  onClick={closeEditCandidateModal}
                  style={{ flex: 1, padding: "14px", backgroundColor: "#FFFFFF", color: "#4B5563", border: "1px solid #E5E7EB", borderRadius: "12px", fontSize: "15px", fontWeight: "700", cursor: "pointer" }}
                >
                  취소
                </button>
                <button
                  onClick={handleAddOrUpdateCandidate}
                  style={{ flex: 2, padding: "14px", backgroundColor: "#7C5CFF", color: "#FFFFFF", border: "none", borderRadius: "12px", fontSize: "15px", fontWeight: "700", cursor: "pointer", boxShadow: "0 4px 12px rgba(124, 92, 255, 0.2)" }}
                >
                  수정하기
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {candidateViewMode === "timetable" && (
        <div style={{ paddingBottom: isSelectMode ? "120px" : "40px" }}>
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
            {/* 시간표 카드 헤더 (날짜 추가 버튼) */}
            <div style={{
              display: "flex",
              justifyContent: "flex-start",
              alignItems: "center",
              padding: "14px 16px 10px",
            }}>
              <button
                onClick={() => {
                  setEditingCandidateId(null);
                  setNewDates([]);
                  setNewDate("");
                  setShowAddCandidateForm(true);
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: "28px",
                  padding: "0 10px",
                  border: "1px solid #7c5cff",
                  borderRadius: "999px",
                  background: "#ffffff",
                  color: "#7c5cff",
                  fontSize: "12px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                + 날짜 추가
              </button>
            </div>

            <div
              ref={timetableScrollRef}
              style={{
                overflowX: "auto",
                maxWidth: "100%",
                position: "relative",
                userSelect: "none",
                WebkitUserSelect: "none",
                msUserSelect: "none",
              }}
              onDragStart={(e) => e.preventDefault()}
              onMouseLeave={() => { setIsDragging(false); setDragMode(null); setActiveDragCandidateId(null); }}
              onMouseUp={() => { setIsDragging(false); setDragMode(null); setActiveDragCandidateId(null); }}
            >
              <table style={{ borderCollapse: "separate", borderSpacing: 0, minWidth: "100%", userSelect: "none" }}>
                <thead>
                  <tr>
                    <th style={{
                      position: "sticky",
                      left: 0,
                      zIndex: 10,
                      backgroundColor: "#FFFFFF",
                      width: "60px",
                      padding: "16px 8px",
                      fontSize: "12px",
                      fontWeight: "600",
                      color: "#9CA3AF",
                      borderBottom: "1px solid #D1D5DB",
                      borderRight: "1px solid #D1D5DB",
                    }}>일정</th>
                    {candidates.map((candidate) => (
                      <th
                        key={candidate.id}
                        id={`candidate-col-${candidate.id}`}
                        style={{
                          minWidth: "120px",
                          padding: "16px 8px",
                          backgroundColor: "#FFFFFF",
                          borderBottom: "1px solid #D1D5DB",
                          borderRight: "1px solid #D1D5DB",
                          position: "relative",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "center", alignItems: "flex-start" }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: "15px", fontWeight: "800", color: "#1F2933" }}>
                              {candidate.date.split("-").slice(1).join(".")}
                            </div>
                            <div style={{ fontSize: "11px", color: "#6B7280", fontWeight: "600", marginTop: "2px" }}>
                              {["일", "월", "화", "수", "목", "금", "토"][new Date(candidate.date).getDay()]} · {candidate.isallday ? "하루종일" : `${candidate.starttime?.slice(0, 5)}~${candidate.endtime?.slice(0, 5)}`}
                            </div>
                          </div>

                          <div style={{ position: "relative" }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveCandidateMenu(activeCandidateMenu === candidate.id ? null : candidate.id);
                              }}
                              style={{
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                padding: "4px",
                                color: "#9CA3AF",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                borderRadius: "4px",
                                transition: "background-color 0.2s"
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#F3F4F6"}
                              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
                            >
                              <FiMoreVertical size={16} />
                            </button>

                            {activeCandidateMenu === candidate.id && (
                              <>
                                <div
                                  onClick={() => setActiveCandidateMenu(null)}
                                  style={{ position: "fixed", inset: 0, zIndex: 100 }}
                                />
                                <div style={{
                                  position: "absolute",
                                  top: "100%",
                                  right: 0,
                                  backgroundColor: "#FFFFFF",
                                  borderRadius: "8px",
                                  boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
                                  zIndex: 101,
                                  minWidth: "100px",
                                  padding: "4px",
                                  border: "1px solid #E5E7EB"
                                }}>
                                  <button
                                    onClick={() => {
                                      handleEditCandidate(candidate);
                                      setActiveCandidateMenu(null);
                                    }}
                                    style={{
                                      width: "100%",
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "8px",
                                      padding: "8px 12px",
                                      border: "none",
                                      background: "none",
                                      fontSize: "12px",
                                      fontWeight: "600",
                                      color: "#4B5563",
                                      cursor: "pointer",
                                      borderRadius: "4px",
                                      textAlign: "left"
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#F9FAFB"}
                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
                                  >
                                    <FiEdit2 size={12} /> 수정
                                  </button>
                                  <button
                                    onClick={() => {
                                      handleDeleteCandidate(candidate.id);
                                      setActiveCandidateMenu(null);
                                    }}
                                    style={{
                                      width: "100%",
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "8px",
                                      padding: "8px 12px",
                                      border: "none",
                                      background: "none",
                                      fontSize: "12px",
                                      fontWeight: "600",
                                      color: "#EF4444",
                                      cursor: "pointer",
                                      borderRadius: "4px",
                                      textAlign: "left"
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#FEF2F2"}
                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
                                  >
                                    <FiTrash2 size={12} /> 삭제
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleTimeSlots.map((time, timeIdx) => (
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
                        borderRight: "1px solid #D1D5DB",
                        borderBottom: time.endsWith(":30") ? "1px solid #D1D5DB" : "none",
                        height: "20px",
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
                        const nextTime = visibleTimeSlots[timeIdx + 1];
                        const prevTime = visibleTimeSlots[timeIdx - 1];
                        const isNextMySelection = nextTime && (isSelectMode
                          ? selectedSlots.some(s => s.key === getSlotKey(candidate.id, nextTime))
                          : getSlotAvailabilities(candidate.id, nextTime).some(m => m.userid === currentUser?.id));
                        const isPrevMySelection = prevTime && (isSelectMode
                          ? selectedSlots.some(s => s.key === getSlotKey(candidate.id, prevTime))
                          : getSlotAvailabilities(candidate.id, prevTime).some(m => m.userid === currentUser?.id));

                        const bgColor = !selectable
                          ? "#E5E7EB" // 선택 불가: 회색
                          : (availableCount === 0
                            ? "#FFFFFF" // 선택 가능 but 비어 있음: 흰색
                            : getHeatmapColor(availableCount, totalParticipants)); // 누군가 선택함: 보라색 gradient

                        const isSegmentStart = showMySelection && !isPrevMySelection;
                        const isSegmentMiddle = showMySelection && isPrevMySelection && isNextMySelection;
                        const isSegmentEnd = showMySelection && isPrevMySelection && !isNextMySelection;
                        const isSegmentSingle = showMySelection && !isPrevMySelection && !isNextMySelection;

                        return (
                          <td
                            key={key}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              if (!isSelectMode || !selectable) return;
                              const mode = isSelected ? "remove" : "add";
                              setDragMode(mode);
                              setIsDragging(true);
                              setActiveDragCandidateId(candidate.id);
                              handleSelectSlot(candidate, time, mode);
                            }}
                            onMouseEnter={() => {
                              if (isDragging && dragMode && selectable && activeDragCandidateId === candidate.id) {
                                handleSelectSlot(candidate, time, dragMode);
                              }
                            }}
                            style={{
                              backgroundColor: bgColor,
                              // Seamless block styling
                              position: "relative",
                              borderTop: showMySelection && (isSegmentStart || isSegmentSingle) ? "2px solid #7C5CFF" : "none",
                              borderBottom: showMySelection && (isSegmentEnd || isSegmentSingle) ? "2px solid #7C5CFF" : (time.endsWith(":30") ? "1px solid #D1D5DB" : "1px solid #F3F4F6"),
                              borderLeft: showMySelection ? "2px solid #7C5CFF" : "none",
                              borderRight: showMySelection ? "2px solid #7C5CFF" : "1px solid #D1D5DB",

                              cursor: selectable ? "pointer" : "default",
                              padding: 0,
                              height: "20px",
                              transition: "all 0.1s",
                              zIndex: showMySelection ? 10 : 0,
                            }}
                          >
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 범례 영역 */}
            <div style={{ padding: "12px 16px", backgroundColor: "#F9FAFB", display: "flex", gap: "12px", flexWrap: "wrap", borderTop: "1px solid #D1D5DB" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <div style={{ width: "12px", height: "12px", borderRadius: "3px", backgroundColor: "#FFFFFF", border: "1.5px solid #7C5CFF" }} />
                <span style={{ fontSize: "11px", color: "#6B7280", fontWeight: "600" }}>내 선택</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <div style={{ width: "12px", height: "12px", borderRadius: "3px", backgroundColor: "#FFFFFF", border: "1px solid #E5E7EB" }} />
                <span style={{ fontSize: "11px", color: "#6B7280", fontWeight: "600" }}>선택 가능</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <div style={{ width: "12px", height: "12px", borderRadius: "3px", backgroundColor: "#E5E7EB" }} />
                <span style={{ fontSize: "11px", color: "#6B7280", fontWeight: "600" }}>선택 불가</span>
              </div>
            </div>
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

          {/* 슬롯 상세 정보 팝업 (바텀 시트 느낌) */}
          {clickedSlot && (
            <>
              <div
                onClick={() => setClickedSlot(null)}
                style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", zIndex: 2000 }}
              />
              <div
                style={{
                  position: "fixed",
                  bottom: 0, left: 0, right: 0,
                  backgroundColor: "#fff",
                  borderTopLeftRadius: "24px", borderTopRightRadius: "24px",
                  padding: "24px 20px 40px", zIndex: 2001,
                  boxShadow: "0 -4px 20px rgba(0,0,0,0.15)",
                  maxHeight: "80vh", overflowY: "auto"
                }}
              >
                <div style={{ width: "40px", height: "4px", backgroundColor: "#E5E7EB", borderRadius: "2px", margin: "0 auto 20px" }} />
                <h3 style={{ margin: "0 0 4px", fontSize: "18px", fontWeight: "700", color: "#1F2933" }}>
                  {formatDateWithDay(clickedSlot.candidate.date)}
                </h3>
                <p style={{ margin: "0 0 24px", fontSize: "14px", color: "#6B7280", fontWeight: "500" }}>
                  {clickedSlot.time} ~ {getNextTime(clickedSlot.time)}
                </p>

                <div style={{ marginBottom: "20px" }}>
                  <p style={{ fontSize: "13px", fontWeight: "700", color: "#7C5CFF", marginBottom: "12px" }}>
                    가능한 멤버 ({clickedSlot.available.length}명)
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {clickedSlot.available.length > 0 ? (
                      clickedSlot.available.map(p => (
                        <div key={p.id} style={{ padding: "6px 12px", backgroundColor: "#F0ECFF", color: "#7C5CFF", borderRadius: "20px", fontSize: "13px", fontWeight: "600" }}>
                          {p.nickname}{p.id === currentUser?.id ? "(나)" : ""}
                        </div>
                      ))
                    ) : (
                      <span style={{ fontSize: "13px", color: "#9CA3AF" }}>가능한 멤버가 없습니다.</span>
                    )}
                  </div>
                </div>

                <div>
                  <p style={{ fontSize: "13px", fontWeight: "700", color: "#6B7280", marginBottom: "12px" }}>
                    미등록 멤버 ({clickedSlot.unavailable.length}명)
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {clickedSlot.unavailable.length > 0 ? (
                      clickedSlot.unavailable.map(p => (
                        <div key={p.id} style={{ padding: "6px 12px", backgroundColor: "#F3F4F6", color: "#6B7280", borderRadius: "20px", fontSize: "13px", fontWeight: "500" }}>
                          {p.nickname}{p.id === currentUser?.id ? "(나)" : ""}
                        </div>
                      ))
                    ) : (
                      <span style={{ fontSize: "13px", color: "#9CA3AF" }}>모두가 가능합니다!</span>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => setClickedSlot(null)}
                  style={{ width: "100%", marginTop: "32px", padding: "14px", backgroundColor: "#F3F4F6", color: "#1F2933", border: "none", borderRadius: "12px", fontSize: "15px", fontWeight: "700", cursor: "pointer" }}
                >
                  닫기
                </button>
              </div>
            </>
          )}

          {/* 참여자 현황 */}
          <div style={{ marginBottom: "13px" }}>
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
              marginBottom: "0px",
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
  const COLORS = ["#7c79ff", "#ff8a80", "#4dd0e1", "#81c784", "#ffd54f", "#ba68c8", "#ffb74d"];
  const getColor = (uid) => { const idx = members.findIndex((m) => (m.userid || m.id) === uid); return COLORS[idx >= 0 ? idx % COLORS.length : 0]; };
  const toDecimalHour = (timeStr) => { if (!timeStr) return 0; const [h, m] = timeStr.split(":").map(Number); return h + m / 60; };
  const startH = candidate.isallday ? 0 : toDecimalHour(candidate.starttime?.slice(0, 5));
  const endH = candidate.isallday ? 24 : toDecimalHour(candidate.endtime?.slice(0, 5));
  const range = endH - startH || 1;
  const slotsByMember = {};
  availabilities.filter((a) => a.candidateid === candidate.id).forEach((a) => { if (!slotsByMember[a.userid]) slotsByMember[a.userid] = []; slotsByMember[a.userid].push(a); });
  const ticks = [];
  for (let h = Math.ceil(startH); h <= Math.floor(endH); h++) { ticks.push(h); }

  return (
    <div style={{ marginTop: "12px" }}>
      <div style={{ fontSize: "12px", fontWeight: "600", color: "#666", marginBottom: "8px" }}>
        멤버별 가능 시간
        <span style={{ fontWeight: "normal", color: "#aaa", marginLeft: "6px" }}>{candidate.isallday ? "00:00 ~ 24:00" : `${candidate.starttime?.slice(0, 5)} ~ ${candidate.endtime?.slice(0, 5)}`}</span>
      </div>
      <div style={{ marginLeft: "72px", position: "relative", height: "16px", marginBottom: "2px" }}>
        {ticks.map((h) => (<div key={h} style={{ position: "absolute", left: `${((h - startH) / range) * 100}%`, transform: "translateX(-50%)", fontSize: "9px", color: "#bbb" }}>{h}</div>))}
      </div>
      {members.map((member) => {
        const uid = member.userid || member.id;
        const slots = slotsByMember[uid] || [];
        const color = getColor(uid);
        return (
          <div key={uid} style={{ display: "flex", alignItems: "center", marginBottom: "5px" }}>
            <div style={{ width: "64px", fontSize: "11px", color: "#555", textAlign: "right", paddingRight: "8px", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{member.nickname || "?"}</div>
            <div style={{ flex: 1, height: "22px", backgroundColor: "#eeeeee", borderRadius: "4px", position: "relative", overflow: "hidden" }}>
              {slots.length === 0 && <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", color: "#ccc" }}>미등록</div>}
              {slots.map((slot, si) => {
                const s = toDecimalHour(slot.starttime?.slice(0, 5)); const e = toDecimalHour(slot.endtime?.slice(0, 5));
                const left = Math.max(0, ((s - startH) / range) * 100); const width = Math.min(100 - left, ((e - s) / range) * 100);
                return (<div key={si} style={{ position: "absolute", left: `${left}%`, width: `${width}%`, height: "100%", backgroundColor: color, opacity: 0.85 }} />);
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
  const candidateMap = {}; candidates.forEach((c) => { if (!candidateMap[c.date]) candidateMap[c.date] = []; candidateMap[c.date].push(c); });
  const availMap = {}; availabilities.forEach(({ date, userid }) => { if (!availMap[date]) availMap[date] = new Set(); availMap[date].add(userid); });
  const COLORS = ["#7c79ff", "#ff8a80", "#4dd0e1", "#81c784", "#ffd54f", "#ba68c8", "#ffb74d"];
  const pad = (n) => String(n).padStart(2, "0");
  const dateKey = (d) => `${calYear}-${pad(calMonth + 1)}-${pad(d)}`;
  const selectedAvailUsers = selectedDate ? [...(availMap[selectedDate] || [])] : [];
  const selectedAvailCount = selectedAvailUsers.length;

  return (
    <div
      style={{
        marginTop: "8px",
        backgroundColor: "#FFFFFF",
        borderRadius: "16px",
        border: "1px solid #E5E7EB",
        boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
        padding: "16px",
        marginBottom: "20px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "6px", marginBottom: "12px" }}>
        <button onClick={onPrevMonth} style={{ border: "none", background: "none", fontSize: "20px", cursor: "pointer", lineHeight: 1, padding: "0 2px" }}>‹</button>
        <span style={{ fontWeight: "bold", fontSize: "16px" }}>{calYear}년 {calMonth + 1}월</span>
        <button onClick={onNextMonth} style={{ border: "none", background: "none", fontSize: "20px", cursor: "pointer", lineHeight: 1, padding: "0 2px" }}>›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: "4px" }}>
        {WEEKDAYS.map((d, i) => (<div key={d} style={{ textAlign: "center", fontSize: "12px", fontWeight: "600", color: i === 0 ? "#f44" : i === 6 ? "#7c79ff" : "#555", padding: "4px 0" }}>{d}</div>))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "2px" }}>
        {cells.map((d, i) => {
          const key = d ? dateKey(d) : null;
          const availUsers = key ? [...(availMap[key] || [])] : []; const availCount = availUsers.length; const hasCandidate = key ? !!candidateMap[key] : false;
          const isClickable = availCount > 0 || hasCandidate; const isToday = key === todayStr; const isSelected = key === selectedDate; const col = i % 7;
          return (
            <div key={i} onClick={() => d && isClickable && setSelectedDate(isSelected ? null : key)} style={{ minHeight: "52px", padding: "4px", borderRadius: "8px", backgroundColor: isSelected ? "#f0f0ff" : hasCandidate ? "#fafaff" : "transparent", border: hasCandidate ? "1px solid #e0e0ff" : "1px solid transparent", cursor: isClickable ? "pointer" : "default", display: "flex", flexDirection: "column", alignItems: "center" }}>
              {d && (
                <>
                  <div style={{ width: "24px", height: "24px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: isToday ? "#7c79ff" : "transparent", color: isToday ? "#fff" : col === 0 ? "#f44" : col === 6 ? "#7c79ff" : "#222", fontSize: "12px", fontWeight: isToday ? "bold" : "normal" }}>{d}</div>
                  {hasCandidate && (
                    <div style={{ alignSelf: "stretch", display: "flex", flexDirection: "column", gap: "1px", marginTop: "2px" }}>
                      {availUsers.slice(0, 3).map((uid) => {
                        const member = members.find((m) => (m.userid || m.id) === uid);
                        const colorIdx = members.findIndex((m) => (m.userid || m.id) === uid);
                        const color = COLORS[colorIdx >= 0 ? colorIdx % COLORS.length : 0];
                        return (<div key={uid} style={{ height: "13px", backgroundColor: color, borderRadius: "3px", fontSize: "9px", color: "#fff", paddingLeft: "3px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: "13px" }}>{member?.nickname || ""}</div>);
                      })}
                      {availCount > 3 && <div style={{ fontSize: "9px", color: "#888", paddingLeft: "2px" }}>+{availCount - 3}명 더</div>}
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
          <p style={{ margin: "0 0 4px", fontWeight: "bold", fontSize: "14px", color: "#555" }}>{selectedDate}{selectedAvailCount > 0 && <span style={{ marginLeft: "8px", fontSize: "12px", color: "#7c79ff", fontWeight: "normal" }}>👥 {selectedAvailCount}명 가능</span>}</p>
          {(candidateMap[selectedDate] || []).map((candidate) => (<MemberTimeline key={candidate.id} candidate={candidate} availabilities={availabilities} members={members} />))}
        </div>
      )}
    </div>
  );
}

const headerCellStyle = { width: "140px", height: "55px", border: "1px solid #d8d8ff", textAlign: "center", fontWeight: "bold" };
const timeCellStyle = { width: "80px", height: "32px", border: "1px solid #d8d8ff", textAlign: "center" };
const slotCellStyle = { width: "140px", height: "32px", border: "1px solid #d8d8ff", padding: 0 };

export default ScheduleTab;
