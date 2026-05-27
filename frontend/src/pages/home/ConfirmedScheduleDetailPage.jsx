import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { updateConfirmedScheduleLocation, cancelConfirmedSchedule } from "../../api/scheduleApi";
import { createRoomNotifications } from "../../api/notificationApi";
import LocationPicker from "../../components/map/LocationPicker";

function ConfirmedScheduleDetailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const schedule = location.state?.schedule;

  const [locationText, setLocationText] = useState(schedule?.location || "");
  const [locationAddress, setLocationAddress] = useState(schedule?.locationaddress || "");
  const [saving, setSaving] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [roomOwnerId, setRoomOwnerId] = useState(null);
  const [attendees, setAttendees] = useState([]);
  const [absentees, setAbsentees] = useState(schedule?.absentees || []);

  useEffect(() => {
    if (!schedule) { navigate(-1); return; }

    const fetchData = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUser(user);

      const [{ data: roomData }, { data: scheduleData }] = await Promise.all([
        supabase.from("rooms").select("createdby").eq("id", schedule.roomid).single(),
        supabase.from("confirmed_schedules").select("absentees").eq("id", schedule.id).single(),
      ]);

      if (roomData) setRoomOwnerId(roomData.createdby);
      if (scheduleData) setAbsentees(scheduleData.absentees || []);

      if (!schedule.voteid) return;

      const { data: vote } = await supabase
        .from("votes")
        .select("confirmedoptionid")
        .eq("id", schedule.voteid)
        .single();

      if (vote?.confirmedoptionid) {
        const { data: responses } = await supabase
          .from("voteresponses")
          .select("userid")
          .eq("optionid", vote.confirmedoptionid);

        if (responses) {
          const uniqueIds = [...new Set(responses.map((r) => r.userid))];
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, nickname")
            .in("id", uniqueIds);

          const profileMap = Object.fromEntries((profiles || []).map((p) => [p.id, p.nickname]));
          setAttendees(uniqueIds.map((uid) => ({ userid: uid, nickname: profileMap[uid] || uid })));
        }
      }
    };

    fetchData();
  }, [schedule, navigate]);

  if (!schedule) return null;

  const isRoomOwner = currentUser?.id && currentUser.id === roomOwnerId;
  const isAbsent = absentees.includes(currentUser?.id);

  const handleToggleAbsence = async () => {
    const userId = currentUser?.id;
    if (!userId) return;
    const updated = isAbsent
      ? absentees.filter((id) => id !== userId)
      : [...absentees, userId];

    await supabase.from("confirmed_schedules").update({ absentees: updated }).eq("id", schedule.id);
    setAbsentees(updated);

    if (!isAbsent) {
      const { data: memberRows } = await supabase
        .from("room_members")
        .select("userid")
        .eq("roomid", schedule.roomid);

      const totalMembers = (memberRows || []).length;
      if (totalMembers - updated.length <= 1) {
        await cancelConfirmedSchedule(schedule.id, schedule.voteid);
        await createRoomNotifications({
          roomId: schedule.roomid,
          senderId: userId,
          type: "schedule_cancelled",
          title: "확정 일정이 취소되었습니다",
          message: `참여 인원 부족으로 "${schedule.title || schedule.date}" 일정이 자동 취소되었습니다.`,
          link: `/rooms/${schedule.roomid}?tab=vote`,
        });
        alert("참여 인원이 1명만 남아 일정이 자동 취소되었습니다.");
        navigate(-1);
      }
    }
  };

  const dateLabel = schedule.isallday
    ? `${schedule.date} (하루종일)`
    : `${schedule.date} ${schedule.starttime ?? ""} ~${schedule.endtime ? ` ${schedule.endtime}` : ""}`;

  const handleSave = async () => {
    if (!locationText.trim()) { alert("위치를 입력하세요."); return; }
    try {
      setSaving(true);
      await updateConfirmedScheduleLocation(schedule.id, locationText.trim(), locationAddress);
      alert("위치가 저장되었습니다.");
      navigate(-1);
    } catch (error) {
      alert("위치 저장 실패: " + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async () => {
    if (!window.confirm("확정된 일정을 취소할까요? 모든 멤버에게 알림이 전송됩니다.")) return;
    try {
      await cancelConfirmedSchedule(schedule.id, schedule.voteid);
      await createRoomNotifications({
        roomId: schedule.roomid,
        senderId: currentUser?.id,
        type: "schedule_cancelled",
        title: "확정 일정이 취소되었습니다",
        message: `"${schedule.title || dateLabel}" 일정 확정이 취소되었습니다.`,
        link: `/rooms/${schedule.roomid}?tab=vote`,
      });
      alert("일정 확정이 취소되었습니다.");
      navigate(-1);
    } catch (error) {
      alert("취소 실패: " + error.message);
    }
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#fff" }}>
      <div style={{
        height: "56px", display: "flex", alignItems: "center",
        padding: "0 16px", borderBottom: "1px solid #eee", gap: "12px",
      }}>
        <button onClick={() => navigate(-1)} style={{ border: "none", background: "none", fontSize: "24px" }}>←</button>
        <h3 style={{ margin: 0 }}>확정 일정 상세</h3>
      </div>

      <div style={{ padding: "20px" }}>
        <p style={{ color: "#888", fontSize: "13px", marginBottom: "4px" }}>{schedule.roomname}</p>
        {schedule.title && <h2 style={{ marginBottom: "2px" }}>{schedule.title}</h2>}
        <p style={{ color: "#555", marginBottom: "16px" }}>{dateLabel}</p>

        {attendees.length > 0 && (
          <div style={{ marginBottom: "20px", padding: "12px 14px", backgroundColor: "#f9f9ff", borderRadius: "12px" }}>
            <p style={{ fontWeight: "bold", marginBottom: "8px" }}>참여 멤버 ({attendees.length}명)</p>
            {attendees.map((a) => (
              <p key={a.userid} style={{ margin: "4px 0", fontSize: "14px", color: "#333" }}>
                · {a.nickname || a.userid}
              </p>
            ))}
          </div>
        )}

        {schedule.location && (
          <p style={{ color: "#7c79ff", marginBottom: "20px" }}>📍 현재 위치: {schedule.location}</p>
        )}

        <p style={{ fontWeight: "bold", marginBottom: "12px" }}>만날 위치 설정</p>
        <input
          type="text"
          placeholder="위치를 직접 입력하세요 (예: 홍대입구역 2번 출구)"
          value={locationText}
          onChange={(e) => { setLocationText(e.target.value); setLocationAddress(""); }}
          style={{
            width: "100%", padding: "12px", fontSize: "14px",
            border: "1px solid #ddd", borderRadius: "10px",
            boxSizing: "border-box", marginBottom: "4px",
          }}
        />
        {locationAddress && (
          <p style={{ fontSize: "12px", color: "#888", marginBottom: "12px", paddingLeft: "4px" }}>
            상세주소: {locationAddress}
          </p>
        )}
        {!locationAddress && <div style={{ marginBottom: "12px" }} />}
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            width: "100%", padding: "12px", marginBottom: "8px",
            backgroundColor: "#7c79ff", color: "#fff",
            border: "none", borderRadius: "10px", fontSize: "15px", cursor: "pointer",
          }}
        >
          {saving ? "저장 중..." : "위치 저장"}
        </button>
        <button
          onClick={() => setShowMap((prev) => !prev)}
          style={{
            width: "100%", padding: "12px", marginBottom: "8px",
            backgroundColor: "#f5f5f5", color: "#333",
            border: "none", borderRadius: "10px", fontSize: "15px", cursor: "pointer",
          }}
        >
          {showMap ? "지도 닫기" : "지도에서 위치 선택하기"}
        </button>

        {showMap && (
          <LocationPicker
            onSelect={(name, address) => {
              setLocationText(name);
              setLocationAddress(address || "");
              setShowMap(false);
            }}
          />
        )}

        <div style={{ marginBottom: "24px" }} />

        {currentUser && (
          <button
            onClick={handleToggleAbsence}
            style={{
              width: "100%", padding: "12px", marginBottom: "8px",
              backgroundColor: "#fff", color: isAbsent ? "#7c79ff" : "#f44",
              border: `1px solid ${isAbsent ? "#7c79ff" : "#f44"}`, borderRadius: "10px", fontSize: "15px", cursor: "pointer",
            }}
          >
            {isAbsent ? "참석으로 변경" : "일정 취소"}
          </button>
        )}
        {isRoomOwner && (
          <>
            <button
              onClick={handleCancel}
              style={{
                width: "100%", padding: "12px",
                backgroundColor: "#fff", color: "#f44",
                border: "1px solid #f44", borderRadius: "10px", fontSize: "15px", cursor: "pointer",
              }}
            >
              일정 삭제
            </button>
            <p style={{ textAlign: "center", fontSize: "12px", color: "#aaa", marginTop: "6px" }}>
              삭제하면 모든 멤버의 화면에서 사라집니다
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default ConfirmedScheduleDetailPage;
