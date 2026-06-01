import { useEffect, useState } from "react";
import DatePicker from "react-multi-date-picker";
import { useNavigate } from "react-router-dom";
import {
  getScheduleCandidates,
  getRoomMembers,
  getRoomGuests,
  getMemberAvailabilities,
  saveMemberAvailabilities,
  updateRoomLastActivity,
  addScheduleCandidate,
  updateScheduleCandidate,
  deleteScheduleCandidate,
  getAdditionalConfirmedLocations,
} from "../../api/scheduleApi";
import { supabase } from "../../lib/supabaseClient";
import { createNotification } from "../../api/notificationApi";
import ConfirmedScheduleCard from "../../components/ConfirmedScheduleCard";

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

  const [confirmedSchedules, setConfirmedSchedules] = useState([]);
  const [additionalLocations, setAdditionalLocations] = useState([]);
  const [showConfirmedForm, setShowConfirmedForm] = useState(false);
  const [candidateViewMode, setCandidateViewMode] = useState("timetable"); // "timetable" | "calendar"
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [confirmedTitle, setConfirmedTitle] = useState("");
  const [confirmedDate, setConfirmedDate] = useState("");
  const [confirmedStartTime, setConfirmedStartTime] = useState("");
  const [confirmedEndTime, setConfirmedEndTime] = useState("");
  const [confirmedIsAllDay, setConfirmedIsAllDay] = useState(false);

  const memberColors = [
    "#7c79ff",
    "#ff8a80",
    "#4dd0e1",
    "#81c784",
    "#ffd54f",
    "#ba68c8",
    "#ffb74d",
  ];

  const timeSlots = [];

  for (let hour = 0; hour < 24; hour++) {
    for (let minute of [0, 30]) {
      const h = String(hour).padStart(2, "0");
      const m = String(minute).padStart(2, "0");
      timeSlots.push(`${h}:${m}`);
    }
  }

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

  const getSlotKey = (candidateId, time) => {
    return `${candidateId}-${time}`;
  };

  const getSlotAvailabilities = (candidateId, time) => {
    return availabilities.filter(
      (item) =>
        item.candidateid === candidateId &&
        item.starttime?.slice(0, 5) <= time &&
        item.endtime?.slice(0, 5) > time
    );
  };

  const isTimeSelectable = (candidate, time) => {
    if (candidate.isallday) {
      return true;
    }

    const start = candidate.starttime?.slice(0, 5);
    const end = candidate.endtime?.slice(0, 5);

    return time >= start && time < end;
  };

  const handleSelectSlot = (candidate, time, mode) => {
    if (!isSelectMode) return;

    const key = getSlotKey(candidate.id, time);

    setSelectedSlots((prev) => {
      const alreadySelected = prev.some((slot) => slot.key === key);

      if (mode === "remove") {
        return prev.filter((slot) => slot.key !== key);
      }

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

  const handleSelectAllCandidateSlots = (candidate) => {
    if (!isSelectMode) return;

    const candidateSlots = timeSlots
      .filter((time) => isTimeSelectable(candidate, time))
      .map((time) => ({
        key: getSlotKey(candidate.id, time),
        candidateId: candidate.id,
        date: candidate.date,
        starttime: time,
        endtime: getNextTime(time),
      }));

    setSelectedSlots((prev) => {
      const selectedKeys = new Set(prev.map((slot) => slot.key));
      const newSlots = candidateSlots.filter((slot) => !selectedKeys.has(slot.key));

      return [...prev, ...newSlots];
    });
  };

  const handleSaveAvailability = async () => {
    try {
      if (selectedSlots.length === 0) {
        alert("선택한 시간이 없습니다.");
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

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
        // 수정 모드: 단일 날짜
        if (!newDate) {
          alert("날짜를 선택하세요.");
          return;
        }
        await updateScheduleCandidate(editingCandidateId, {
          roomid: Number(roomId),
          date: newDate,
          starttime: newIsAllDay ? null : newStartTime,
          endtime: newIsAllDay ? null : newEndTime,
          isallday: newIsAllDay,
        });
        alert("후보 일정이 수정되었습니다.");
      } else {
        // 추가 모드: 여러 날짜
        if (!newDates || newDates.length === 0) {
          alert("날짜를 1개 이상 선택하세요.");
          return;
        }

        const dateStrings = newDates.map((d) =>
          d.format ? d.format("YYYY-MM-DD") : String(d)
        );

        const duplicates = dateStrings.filter((ds) =>
          candidates.some((c) => c.date === ds)
        );

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

        alert(`후보 일정 ${dateStrings.length}개가 추가되었습니다.`);
      }

      await updateRoomLastActivity(roomId);
      await reloadScheduleData();

      setNewDate("");
      setNewDates([]);
      setNewStartTime("");
      setNewEndTime("");
      setNewIsAllDay(false);
      setEditingCandidateId(null);
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
  };

  const handleDeleteCandidate = async (candidateId) => {
    try {
      const confirmDelete = window.confirm(
        "이 후보를 삭제하면 해당 후보에 등록된 멤버 일정도 함께 삭제됩니다. 삭제할까요?"
      );

      if (!confirmDelete) return;

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

      if (!senderId) {
        alert("사용자 정보를 불러오는 중입니다.");
        return;
      }

      const receiverId = receiver.userid || receiver.id;

      await createNotification({
        roomId,
        receiverId,
        senderId,
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
      state: {
        availabilities: availabilities,
        candidates: candidates,
      },
    });
  };

  const loadConfirmedSchedules = async () => {
    const now = new Date();
    const today = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");

    const [{ data }, locations] = await Promise.all([
      supabase
        .from("confirmed_schedules")
        .select("*")
        .eq("roomid", roomId)
        .or(`date.gte.${today},date.is.null`)
        .order("date", { ascending: true }),
      getAdditionalConfirmedLocations(roomId),
    ]);
    setConfirmedSchedules(data || []);
    setAdditionalLocations(locations || []);
  };

  const handleAddConfirmedSchedule = async () => {
    if (!confirmedDate) { alert("날짜를 선택하세요."); return; }
    if (!confirmedIsAllDay && (!confirmedStartTime || !confirmedEndTime)) {
      alert("시작 시간과 종료 시간을 선택하세요."); return;
    }
    if (!confirmedIsAllDay && confirmedStartTime >= confirmedEndTime) {
      alert("시작 시간은 종료 시간보다 빨라야 합니다."); return;
    }

    const { error } = await supabase.from("confirmed_schedules").insert([{
      roomid: Number(roomId),
      title: confirmedTitle || null,
      date: confirmedDate,
      starttime: confirmedIsAllDay ? null : confirmedStartTime,
      endtime: confirmedIsAllDay ? null : confirmedEndTime,
      isallday: confirmedIsAllDay,
    }]);

    if (error) { alert("확정 일정 추가 실패"); return; }

    await updateRoomLastActivity(roomId);
    setConfirmedTitle("");
    setConfirmedDate("");
    setConfirmedStartTime("");
    setConfirmedEndTime("");
    setConfirmedIsAllDay(false);
    setShowConfirmedForm(false);
    await loadConfirmedSchedules();
  };

  const handleToggleAbsence = async (schedule) => {
    const userId = currentUser?.id;
    if (!userId) return;
    const absentees = schedule.absentees || [];
    const isAbsent = absentees.includes(userId);
    const updated = isAbsent
      ? absentees.filter((id) => id !== userId)
      : [...absentees, userId];
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
        const {
          data: { user },
        } = await supabase.auth.getUser();

        setCurrentUser(user);

        const candidateData = await getScheduleCandidates(roomId);
        const memberData = await getRoomMembers(roomId);
        const guestData = await getRoomGuests(roomId);
        const availabilityData = await getMemberAvailabilities(roomId);

        setCandidates(candidateData);
        setMembers(memberData);
        setGuests(guestData);
        setAvailabilities(availabilityData);
        await loadConfirmedSchedules();
      } catch (error) {
        console.error(error);
      }
    };

    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const myUserId = currentUser?.id || localStorage.getItem("guest_id");
  const myAvailability = availabilities.some(
    (item) => item.userid === myUserId
  );

  return (
    <div>
      {/* Confirmed schedules section */}
      <div style={{ marginBottom: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
          <h2 style={{ margin: 0 }}>확정된 일정</h2>
          <button
            onClick={() => setShowConfirmedForm((v) => !v)}
            style={{ padding: "6px 14px", backgroundColor: "#7c79ff", color: "#fff", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "13px" }}
          >
            {showConfirmedForm ? "취소" : "+ 일정 추가"}
          </button>
        </div>

        {showConfirmedForm && (
          <div style={{ backgroundColor: "#f8f8ff", borderRadius: "10px", padding: "14px", marginBottom: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <input
              type="text"
              placeholder="일정 제목 (선택)"
              value={confirmedTitle}
              onChange={(e) => setConfirmedTitle(e.target.value)}
              style={{ padding: "7px 10px", border: "1px solid #d8d8ff", borderRadius: "6px", fontSize: "14px" }}
            />
            <input
              type="date"
              value={confirmedDate}
              onChange={(e) => setConfirmedDate(e.target.value)}
              style={{ padding: "7px 10px", border: "1px solid #d8d8ff", borderRadius: "6px", fontSize: "14px" }}
            />
            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "14px" }}>
              <input
                type="checkbox"
                checked={confirmedIsAllDay}
                onChange={(e) => setConfirmedIsAllDay(e.target.checked)}
              />
              하루종일
            </label>
            {!confirmedIsAllDay && (
              <div style={{ display: "flex", gap: "8px" }}>
                <select
                  value={confirmedStartTime}
                  onChange={(e) => setConfirmedStartTime(e.target.value)}
                  style={{ flex: 1, padding: "7px", border: "1px solid #d8d8ff", borderRadius: "6px", fontSize: "14px" }}
                >
                  <option value="">시작 시간</option>
                  {timeSlots.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <select
                  value={confirmedEndTime}
                  onChange={(e) => setConfirmedEndTime(e.target.value)}
                  style={{ flex: 1, padding: "7px", border: "1px solid #d8d8ff", borderRadius: "6px", fontSize: "14px" }}
                >
                  <option value="">종료 시간</option>
                  {timeSlots.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            )}
            <button
              onClick={handleAddConfirmedSchedule}
              style={{ padding: "8px", backgroundColor: "#7c79ff", color: "#fff", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "14px", fontWeight: "bold" }}
            >
              추가하기
            </button>
          </div>
        )}

        {confirmedSchedules.length === 0 ? (
          <p style={{ color: "#aaa", fontSize: "13px", margin: 0 }}>아직 확정된 일정이 없습니다.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {confirmedSchedules.map((s) => {
              const isAbsent = (s.absentees || []).includes(currentUser?.id);
              const isOwner = currentUser?.id && currentUser.id === ownerUserId;
              return (
                <ConfirmedScheduleCard
                  key={s.id}
                  schedule={{
                    ...s,
                    roomname: roomName,
                    additionalLocations: additionalLocations.filter(
                      (location) => Number(location.scheduleid) === Number(s.id)
                    ),
                    isAbsent,
                  }}
                  onClick={() =>
                    navigate("/confirmed-schedule", {
                      state: { schedule: { ...s, roomname: roomName } },
                    })
                  }
                />
              );
            })}
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "16px 0 10px" }}>
        <h2 style={{ margin: 0 }}>일정 후보</h2>
        <div style={{ display: "flex", border: "1px solid #ddd", borderRadius: "8px", overflow: "hidden" }}>
          {["timetable", "calendar"].map((v) => (
            <button
              key={v}
              onClick={() => setCandidateViewMode(v)}
              style={{
                padding: "6px 14px",
                border: "none",
                backgroundColor: candidateViewMode === v ? "#7c79ff" : "#fff",
                color: candidateViewMode === v ? "#fff" : "#666",
                fontSize: "13px",
                cursor: "pointer",
                fontWeight: candidateViewMode === v ? "600" : "normal",
              }}
            >
              {v === "calendar" ? "달력" : "타임테이블"}
            </button>
          ))}
        </div>
      </div>

      {/* 타임테이블 모드 */}
      {candidateViewMode === "timetable" && (
        <>
          {/* 후보 추가 폼 */}
          <div>
            {editingCandidateId ? (
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                style={{ padding: "8px", border: "1px solid #ddd", borderRadius: "8px", marginBottom: "8px" }}
              />
            ) : (
              <DatePicker
                multiple
                value={newDates}
                onChange={setNewDates}
                format="YYYY-MM-DD"
                minDate={new Date()}
                placeholder="날짜 여러 개 선택 가능"
                style={{ padding: "8px", border: "1px solid #ddd", borderRadius: "8px", width: "100%", marginBottom: "8px" }}
              />
            )}

            <label style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
              <input
                type="checkbox"
                checked={newIsAllDay}
                onChange={(e) => setNewIsAllDay(e.target.checked)}
              />
              하루종일
            </label>

            {!newIsAllDay && (
              <>
                <select value={newStartTime} onChange={(e) => setNewStartTime(e.target.value)}>
                  <option value="">시작 시간</option>
                  {timeSlots.map((time) => <option key={time} value={time}>{time}</option>)}
                </select>
                <select value={newEndTime} onChange={(e) => setNewEndTime(e.target.value)}>
                  <option value="">종료 시간</option>
                  {timeSlots.map((time) => <option key={time} value={time}>{time}</option>)}
                </select>
              </>
            )}

            <button onClick={handleAddOrUpdateCandidate}>
              {editingCandidateId ? "후보 수정 완료" : "후보 추가"}
            </button>

            {editingCandidateId && (
              <button
                onClick={() => {
                  setEditingCandidateId(null);
                  setNewDate("");
                  setNewDates([]);
                  setNewStartTime("");
                  setNewEndTime("");
                  setNewIsAllDay(false);
                }}
              >
                수정 취소
              </button>
            )}
          </div>

          {/* 타임테이블 */}
          <div
            style={{ overflowX: "auto", maxWidth: "100%" }}
            onMouseLeave={() => { setIsDragging(false); setDragMode(null); }}
            onMouseUp={() => { setIsDragging(false); setDragMode(null); }}
          >
            <table style={{ borderCollapse: "collapse", minWidth: "800px" }}>
              <thead>
                <tr>
                  <th style={headerCellStyle}>시간</th>
                  {candidates.map((candidate) => (
                    <th key={candidate.id} style={headerCellStyle}>
                      <div>{formatDateWithDay(candidate.date)}</div>
                      <div>
                        {candidate.isallday
                          ? "하루종일"
                          : `${candidate.starttime?.slice(0, 5)} ~ ${candidate.endtime?.slice(0, 5)}`}
                      </div>
                      <button onClick={() => handleEditCandidate(candidate)}>수정</button>
                      <button onClick={() => handleDeleteCandidate(candidate.id)}>삭제</button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {timeSlots.map((time) => (
                  <tr key={time}>
                    <td style={timeCellStyle}>{time}</td>
                    {candidates.map((candidate) => {
                      const key = getSlotKey(candidate.id, time);
                      const selectable = isTimeSelectable(candidate, time);
                      const isSelected = selectedSlots.some((slot) => slot.key === key);
                      const slotMembers = getSlotAvailabilities(candidate.id, time);
                      const mySaved = slotMembers.some((member) => member.userid === currentUser?.id);
                      return (
                        <td
                          key={key}
                          onMouseDown={() => {
                            if (!isSelectMode || !selectable) return;
                            const mode = isSelected ? "remove" : "add";
                            setDragMode(mode);
                            setIsDragging(true);
                            handleSelectSlot(candidate, time, mode);
                          }}
                          onMouseEnter={() => {
                            if (isDragging && dragMode && selectable) {
                              handleSelectSlot(candidate, time, dragMode);
                            }
                          }}
                          onMouseUp={() => { setIsDragging(false); setDragMode(null); }}
                          style={{
                            ...slotCellStyle,
                            backgroundColor: !selectable ? "#f1f1f1" : isSelectMode ? isSelected ? "#dcdcff" : "white" : mySaved ? "#7c79ff" : "white",
                            cursor: isSelectMode && selectable ? "pointer" : "not-allowed",
                          }}
                        >
                          {!isSelectMode && (
                            <div style={{ display: "flex", height: "100%" }}>
                              {slotMembers.map((member) => (
                                <div
                                  key={member.id}
                                  title={member.nickname}
                                  style={{ flex: 1, backgroundColor: getMemberColor(member.userid) }}
                                />
                              ))}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 일정 등록 버튼 */}
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
                    endtime: item.endtime.slice(0, 5),
                  }));
                setSelectedSlots(mySaveSlots);
                setIsSelectMode(true);
              }}
            >
              {myAvailability ? "내 일정 수정하기" : "내 일정 등록하기"}
            </button>
          ) : (
            <div>
              <button onClick={handleSaveAvailability}>저장하기</button>
              <button onClick={() => { setSelectedSlots([]); setIsSelectMode(false); }}>취소</button>
            </div>
          )}

          {/* 멤버 등록 현황 */}
          <h3>멤버 일정 등록 현황</h3>
          {members.map((member) => {
            const isRegistered = availabilities.some((item) => item.userid === member.userid);
            const isMe = !!currentUser?.id && member.userid === currentUser.id;
            return (
              <div key={member.id} style={{ display: "flex", gap: "10px" }}>
                <span>👤</span>
                <span>{member.nickname || "닉네임 없음"}</span>
                <span>{isRegistered ? "등록 완료" : isMe ? "내 일정 미등록" : "일정 등록 안 함"}</span>
                {!isRegistered && !isMe && (
                  <button onClick={() => handleRequestSchedule(member)}>일정 등록 요청</button>
                )}
              </div>
            );
          })}
          {guests.map((guest) => {
            const isRegistered = availabilities.some((item) => item.userid === guest.id);
            const guestId = localStorage.getItem("guest_id");
            const isMe = !!guestId && guest.id === guestId;
            return (
              <div key={guest.id} style={{ display: "flex", gap: "10px" }}>
                <span>👤</span>
                <span>{guest.nickname || "닉네임 없음"}</span>
                <span>{isRegistered ? "등록 완료" : isMe ? "내 일정 미등록" : "일정 등록 안 함"}</span>
                {!isRegistered && !isMe && (
                  <button onClick={() => handleRequestSchedule(guest)}>일정 등록 요청</button>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* 달력 모드 */}
      {candidateViewMode === "calendar" && (
        <CandidateCalendar
          candidates={candidates}
          availabilities={availabilities}
          calYear={calYear}
          calMonth={calMonth}
          onPrevMonth={() => {
            if (calMonth === 0) { setCalYear((y) => y - 1); setCalMonth(11); }
            else setCalMonth((m) => m - 1);
          }}
          onNextMonth={() => {
            if (calMonth === 11) { setCalYear((y) => y + 1); setCalMonth(0); }
            else setCalMonth((m) => m + 1);
          }}
          members={[...members, ...guests]}
        />
      )}

      <button onClick={handleShowAvailableResult}>가능한 시간 보기</button>
    </div>
  );
}

function MemberTimeline({ candidate, availabilities, members }) {
  const COLORS = ["#7c79ff", "#ff8a80", "#4dd0e1", "#81c784", "#ffd54f", "#ba68c8", "#ffb74d"];

  const getColor = (uid) => {
    const idx = members.findIndex((m) => (m.userid || m.id) === uid);
    return COLORS[idx >= 0 ? idx % COLORS.length : 0];
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

      {/* 시간 축 */}
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

      {/* 멤버 행 */}
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

  // 날짜별 후보 맵
  const candidateMap = {};
  candidates.forEach((c) => {
    if (!candidateMap[c.date]) candidateMap[c.date] = [];
    candidateMap[c.date].push(c);
  });

  // 날짜별 가능 인원 맵
  const availMap = {};
  availabilities.forEach(({ date, userid }) => {
    if (!availMap[date]) availMap[date] = new Set();
    availMap[date].add(userid);
  });

  const COLORS = ["#7c79ff", "#ff8a80", "#4dd0e1", "#81c784", "#ffd54f", "#ba68c8", "#ffb74d"];

  const pad = (n) => String(n).padStart(2, "0");
  const dateKey = (d) => `${calYear}-${pad(calMonth + 1)}-${pad(d)}`;

  const selectedAvailUsers = selectedDate ? [...(availMap[selectedDate] || [])] : [];
  const selectedAvailCount = selectedAvailUsers.length;
  // 선택 날짜의 가능 멤버 닉네임
  const selectedAvailNicknames = selectedAvailUsers.map((uid) => {
    const m = members.find((m) => (m.userid || m.id) === uid);
    return m?.nickname || uid;
  });

  return (
    <div style={{ marginTop: "8px" }}>
      {/* 월 네비게이션 - 날짜 바로 옆에 버튼 */}
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "6px", marginBottom: "12px" }}>
        <button onClick={onPrevMonth} style={{ border: "none", background: "none", fontSize: "20px", cursor: "pointer", lineHeight: 1, padding: "0 2px" }}>‹</button>
        <span style={{ fontWeight: "bold", fontSize: "16px" }}>{calYear}년 {calMonth + 1}월</span>
        <button onClick={onNextMonth} style={{ border: "none", background: "none", fontSize: "20px", cursor: "pointer", lineHeight: 1, padding: "0 2px" }}>›</button>
      </div>

      {/* 요일 헤더 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: "4px" }}>
        {WEEKDAYS.map((d, i) => (
          <div key={d} style={{ textAlign: "center", fontSize: "12px", fontWeight: "600", color: i === 0 ? "#f44" : i === 6 ? "#7c79ff" : "#555", padding: "4px 0" }}>{d}</div>
        ))}
      </div>

      {/* 날짜 그리드 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "2px" }}>
        {cells.map((d, i) => {
          const key = d ? dateKey(d) : null;
          const availUsers = key ? [...(availMap[key] || [])] : [];
          const availCount = availUsers.length;
          const hasAvail = availCount > 0;
          const hasCandidate = key ? !!candidateMap[key] : false;
          const isClickable = hasAvail || hasCandidate;
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
                  <div style={{
                    width: "24px", height: "24px", borderRadius: "50%",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    backgroundColor: isToday ? "#7c79ff" : "transparent",
                    color: isToday ? "#fff" : col === 0 ? "#f44" : col === 6 ? "#7c79ff" : "#222",
                    fontSize: "12px", fontWeight: isToday ? "bold" : "normal",
                  }}>
                    {d}
                  </div>
                  {hasCandidate && (
                    <div style={{ alignSelf: "stretch", display: "flex", flexDirection: "column", gap: "1px", marginTop: "2px" }}>
                      {availUsers.slice(0, 3).map((uid) => {
                        const member = members.find((m) => (m.userid || m.id) === uid);
                        const colorIdx = members.findIndex((m) => (m.userid || m.id) === uid);
                        const color = COLORS[colorIdx >= 0 ? colorIdx % COLORS.length : 0];
                        return (
                          <div
                            key={uid}
                            style={{
                              height: "13px",
                              backgroundColor: color,
                              borderRadius: "3px",
                              fontSize: "9px",
                              color: "#fff",
                              paddingLeft: "3px",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              lineHeight: "13px",
                            }}
                          >
                            {member?.nickname || ""}
                          </div>
                        );
                      })}
                      {availCount > 3 && (
                        <div style={{ fontSize: "9px", color: "#888", paddingLeft: "2px" }}>+{availCount - 3}명 더</div>
                      )}
                      {availCount === 0 && (
                        <div style={{ fontSize: "9px", color: "#bbb", textAlign: "center" }}>후보</div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* 선택된 날짜 상세 - 타임라인 뷰 */}
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
            <MemberTimeline
              key={candidate.id}
              candidate={candidate}
              availabilities={availabilities}
              members={members}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const headerCellStyle = {
  width: "140px",
  height: "55px",
  border: "1px solid #d8d8ff",
  textAlign: "center",
  fontWeight: "bold",
};

const timeCellStyle = {
  width: "80px",
  height: "32px",
  border: "1px solid #d8d8ff",
  textAlign: "center",
};

const slotCellStyle = {
  width: "140px",
  height: "32px",
  border: "1px solid #d8d8ff",
  padding: 0,
};

export default ScheduleTab;
