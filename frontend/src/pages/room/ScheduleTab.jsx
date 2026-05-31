import { useEffect, useState } from "react";
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
  const [newStartTime, setNewStartTime] = useState("");
  const [newEndTime, setNewEndTime] = useState("");
  const [newIsAllDay, setNewIsAllDay] = useState(false);
  const [editingCandidateId, setEditingCandidateId] = useState(null);

  const [confirmedSchedules, setConfirmedSchedules] = useState([]);
  const [additionalLocations, setAdditionalLocations] = useState([]);
  const [showConfirmedForm, setShowConfirmedForm] = useState(false);
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
      if (!newDate) {
        alert("날짜를 선택하세요.");
        return;
      }

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

      const candidateData = {
        roomid: Number(roomId),
        date: newDate,
        starttime: newIsAllDay ? null : newStartTime,
        endtime: newIsAllDay ? null : newEndTime,
        isallday: newIsAllDay,
      };

      if (editingCandidateId) {
        await updateScheduleCandidate(editingCandidateId, candidateData);
        alert("후보 일정이 수정되었습니다.");
      } else {
        const duplicated = candidates.some(
          (candidate) => candidate.date === newDate
        );

        if (duplicated) {
          alert("이미 추가된 날짜입니다.");
          return;
        }

        await addScheduleCandidate(candidateData);
        alert("후보 일정이 추가되었습니다.");
      }

      await updateRoomLastActivity(roomId);
      await reloadScheduleData();

      setNewDate("");
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
                  actions={
                    <>
                      {currentUser && (
                        <button
                          onClick={() => handleToggleAbsence(s)}
                          style={{ background: "none", border: `1px solid ${isAbsent ? "#7c79ff" : "#ddd"}`, color: isAbsent ? "#7c79ff" : "#999", cursor: "pointer", fontSize: "12px", padding: "3px 8px", borderRadius: "6px" }}
                        >
                          {isAbsent ? "참석으로 변경" : "일정 취소"}
                        </button>
                      )}
                      {isOwner && (
                        <button
                          onClick={() => handleDeleteConfirmedSchedule(s.id)}
                          style={{ background: "none", border: "1px solid #ffcccc", color: "#e57373", cursor: "pointer", fontSize: "12px", padding: "3px 8px", borderRadius: "6px" }}
                        >
                          일정 삭제
                        </button>
                      )}
                    </>
                  }
                />
              );
            })}
          </div>
        )}
      </div>

      <h2>일정 후보</h2>

      <div>
        <input
          type="date"
          value={newDate}
          onChange={(e) => setNewDate(e.target.value)}
        />

        <label>
          <input
            type="checkbox"
            checked={newIsAllDay}
            onChange={(e) => setNewIsAllDay(e.target.checked)}
          />
          하루종일
        </label>

        {!newIsAllDay && (
          <>
            <select
              value={newStartTime}
              onChange={(e) => setNewStartTime(e.target.value)}
            >
              <option value="">시작 시간</option>

              {timeSlots.map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </select>

            <select
              value={newEndTime}
              onChange={(e) => setNewEndTime(e.target.value)}
            >
              <option value="">종료 시간</option>

              {timeSlots.map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
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
              setNewStartTime("");
              setNewEndTime("");
              setNewIsAllDay(false);
            }}
          >
            수정 취소
          </button>
        )}
      </div>

      <div
        style={{ overflowX: "auto", maxWidth: "100%" }}
        onMouseLeave={() => {
          setIsDragging(false);
          setDragMode(null);
        }}
        onMouseUp={() => {
          setIsDragging(false);
          setDragMode(null);
        }}
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

                  <button onClick={() => handleEditCandidate(candidate)}>
                    수정
                  </button>
                  <button onClick={() => handleDeleteCandidate(candidate.id)}>
                    삭제
                  </button>
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
                  const isSelected = selectedSlots.some(
                    (slot) => slot.key === key
                  );

                  const slotMembers = getSlotAvailabilities(candidate.id, time);

                  const mySaved = slotMembers.some(
                    (member) => member.userid === currentUser?.id
                  );

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
                      onMouseUp={() => {
                        setIsDragging(false);
                        setDragMode(null);
                      }}
                      style={{
                        ...slotCellStyle,
                        backgroundColor: !selectable
                          ? "#f1f1f1"
                          : isSelectMode
                          ? isSelected
                            ? "#dcdcff"
                            : "white"
                          : mySaved
                          ? "#7c79ff"
                          : "white",
                        cursor:
                          isSelectMode && selectable ? "pointer" : "not-allowed",
                      }}
                    >
                      {!isSelectMode && (
                        <div style={{ display: "flex", height: "100%" }}>
                          {slotMembers.map((member) => (
                            <div
                              key={member.id}
                              title={member.nickname}
                              style={{
                                flex: 1,
                                backgroundColor: getMemberColor(member.userid),
                              }}
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
          <button
            onClick={() => {
              setSelectedSlots([]);
              setIsSelectMode(false);
            }}
          >
            취소
          </button>
        </div>
      )}

      <h3>멤버 일정 등록 현황</h3>

      {members.map((member) => {
        const isRegistered = availabilities.some(
          (item) => item.userid === member.userid
        );

        const isMe = !!currentUser?.id && member.userid === currentUser.id;

        return (
          <div key={member.id} style={{ display: "flex", gap: "10px" }}>
            <span>👤</span>
            <span>{member.nickname || "닉네임 없음"}</span>
            <span>
              {isRegistered
                ? "등록 완료"
                : isMe
                ? "내 일정 미등록"
                : "일정 등록 안 함"}
            </span>

            {!isRegistered && !isMe && (
              <button onClick={() => handleRequestSchedule(member)}>
                일정 등록 요청
              </button>
            )}
          </div>
        );
      })}

      {guests.map((guest) => {
        const isRegistered = availabilities.some(
          (item) => item.userid === guest.id
        );

        const guestId = localStorage.getItem("guest_id");
        const isMe = !!guestId && guest.id === guestId;

        return (
          <div key={guest.id} style={{ display: "flex", gap: "10px" }}>
            <span>👤</span>
            <span>{guest.nickname || "닉네임 없음"}</span>
            <span>
              {isRegistered
                ? "등록 완료"
                : isMe
                ? "내 일정 미등록"
                : "일정 등록 안 함"}
            </span>

            {!isRegistered && !isMe && (
              <button onClick={() => handleRequestSchedule(guest)}>
                일정 등록 요청
              </button>
            )}
          </div>
        );
      })}

      <button onClick={handleShowAvailableResult}>가능한 시간 보기</button>
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
