import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import {
  addAdditionalConfirmedLocation,
  cancelConfirmedSchedule,
  createConfirmedScheduleForRoom,
  dismissConfirmedSchedule,
  getAdditionalConfirmedLocations,
  updateConfirmedScheduleLocation,
} from "../../api/scheduleApi";
import { createRoomNotifications } from "../../api/notificationApi";
import KakaoMapView from "../../components/map/KakaoMapView";
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
  const [voteCreatorId, setVoteCreatorId] = useState(null);
  const [attendees, setAttendees] = useState([]);
  const [scheduleForm, setScheduleForm] = useState({
    title: "",
    date: "",
    starttime: "",
    endtime: "",
  });
  const [additionalLocations, setAdditionalLocations] = useState([]);
  const [additionalPlace, setAdditionalPlace] = useState(null);
  const [showAdditionalPicker, setShowAdditionalPicker] = useState(false);

  useEffect(() => {
    if (!schedule) { navigate("/home"); return; }

    const fetchData = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUser(user);

      if (!schedule.voteid) return;

      const { data: vote } = await supabase
        .from("votes")
        .select("userid, confirmedoptionid")
        .eq("id", schedule.voteid)
        .single();

      if (!vote) return;
      setVoteCreatorId(vote.userid);

      if (vote.confirmedoptionid) {
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

  useEffect(() => {
    if (!schedule?.roomid) return;

    getAdditionalConfirmedLocations(schedule.roomid)
      .then(setAdditionalLocations)
      .catch((error) => console.error("추가 위치 조회 실패:", error));

    if (schedule.isLocationOnly) {
      const draftTitle = localStorage.getItem(
        `appointment_draft_title_${Number(schedule.roomid)}`
      );
      if (draftTitle) {
        setScheduleForm((form) => ({ ...form, title: draftTitle }));
      }
    }
  }, [schedule]);

  if (!schedule) return null;

  const isCreator = currentUser?.id === voteCreatorId;
  const isLocationOnly = Boolean(schedule.isLocationOnly);

  const dateLabel = !schedule.date
    ? "일정 미정"
    : schedule.isallday
    ? `${schedule.date} (하루종일)`
    : `${schedule.date} ${schedule.starttime ?? ""} ~${schedule.endtime ? ` ${schedule.endtime}` : ""}`;

  const handleSave = async () => {
    if (!locationText.trim()) { alert("위치를 입력하세요."); return; }
    try {
      setSaving(true);
      await updateConfirmedScheduleLocation(schedule.id, locationText.trim(), locationAddress);
      alert("위치가 저장되었습니다.");
      navigate("/home");
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
      navigate("/home");
    } catch (error) {
      alert("취소 실패: " + error.message);
    }
  };

  const handleCreateSchedule = async () => {
    if (!scheduleForm.date) {
      alert("일정을 입력하세요.");
      return;
    }

    try {
      setSaving(true);
      await createConfirmedScheduleForRoom(schedule.roomid, {
        ...scheduleForm,
        location: schedule.location,
        locationaddress: schedule.locationaddress,
      });
      localStorage.removeItem(
        `appointment_draft_title_${Number(schedule.roomid)}`
      );
      alert("일정이 저장되었습니다.");
      navigate("/home");
    } catch (error) {
      alert("일정 저장 실패: " + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddLocation = async () => {
    if (!additionalPlace?.name) {
      alert("추가할 위치를 선택하세요.");
      return;
    }

    try {
      setSaving(true);
      const savedLocation = await addAdditionalConfirmedLocation(
        schedule.roomid,
        additionalPlace.name
      );
      setAdditionalLocations((locations) => [...locations, savedLocation]);
      setAdditionalPlace(null);
      setShowAdditionalPicker(false);
      alert("추가 위치가 저장되었습니다.");
    } catch (error) {
      alert("추가 위치 저장 실패: " + error.message);
    } finally {
      setSaving(false);
    }
  };

  const middlePlace = schedule.middlePlace;
  const canShowMiddlePlaceMap =
    middlePlace &&
    Number.isFinite(Number(middlePlace.lat)) &&
    Number.isFinite(Number(middlePlace.lng));

  const middlePlaceSection = (
    <>
      {schedule.location && (
        <p style={{ color: "#7c79ff", marginBottom: "12px" }}>
          📍 {middlePlace ? "중간위치" : "현재 위치"}: {schedule.location}
        </p>
      )}
      {canShowMiddlePlaceMap && (
        <div style={{ marginBottom: "20px" }}>
          <KakaoMapView places={[middlePlace]} selectedPlace={middlePlace} />
        </div>
      )}
      {additionalLocations.length > 0 && (
        <div style={{ marginBottom: "12px" }}>
          <p style={{ fontWeight: "bold", marginBottom: "8px" }}>추가 위치</p>
          {additionalLocations.map((place) => (
            <p key={place.id} style={{ margin: "4px 0", color: "#555" }}>
              📍 {place.placename}
            </p>
          ))}
        </div>
      )}
      <button
        onClick={() => setShowAdditionalPicker((visible) => !visible)}
        style={{
          width: "100%", padding: "12px", marginBottom: "8px",
          backgroundColor: "#f5f5f5", color: "#333",
          border: "none", borderRadius: "10px", fontSize: "15px", cursor: "pointer",
        }}
      >
        위치 추가하기
      </button>
      {showAdditionalPicker && (
        <>
          <LocationPicker
            onSelect={(name, address, place = {}) =>
              setAdditionalPlace({ ...place, name, address })
            }
          />
          {additionalPlace && (
            <p style={{ color: "#7c79ff", margin: "8px 0" }}>
              선택한 위치: {additionalPlace.name}
            </p>
          )}
          <button
            onClick={handleAddLocation}
            disabled={saving || !additionalPlace}
            style={{
              width: "100%", padding: "12px", marginBottom: "8px",
              backgroundColor: "#7c79ff", color: "#fff",
              border: "none", borderRadius: "10px", fontSize: "15px", cursor: "pointer",
            }}
          >
            추가 위치 저장
          </button>
        </>
      )}
    </>
  );

  if (isLocationOnly) {
    return (
      <div style={{ minHeight: "100vh", backgroundColor: "#fff" }}>
        <div style={{
          height: "56px", display: "flex", alignItems: "center",
          padding: "0 16px", borderBottom: "1px solid #eee", gap: "12px",
        }}>
          <button onClick={() => navigate("/home")} style={{ border: "none", background: "none", fontSize: "24px" }}>←</button>
          <h3 style={{ margin: 0 }}>확정 일정 상세</h3>
        </div>

        <div style={{ padding: "20px" }}>
          <p style={{ color: "#888", fontSize: "13px", marginBottom: "4px" }}>{schedule.roomname}</p>
          <h2 style={{ marginBottom: "2px" }}>일정 미정</h2>
          <p style={{ color: "#aaa", marginBottom: "16px" }}>아직 확정된 일정이 없습니다.</p>
          <p style={{ fontWeight: "bold", marginBottom: "8px" }}>일정 입력하기</p>
          <input
            type="text"
            placeholder="일정 제목 (선택)"
            value={scheduleForm.title}
            onChange={(event) =>
              setScheduleForm((form) => ({ ...form, title: event.target.value }))
            }
            style={{
              width: "100%", padding: "12px", marginBottom: "8px",
              border: "1px solid #ddd", borderRadius: "10px", boxSizing: "border-box",
            }}
          />
          <input
            type="date"
            value={scheduleForm.date}
            onChange={(event) =>
              setScheduleForm((form) => ({ ...form, date: event.target.value }))
            }
            style={{
              width: "100%", padding: "12px", marginBottom: "8px",
              border: "1px solid #ddd", borderRadius: "10px", boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
            <input
              type="time"
              value={scheduleForm.starttime}
              onChange={(event) =>
                setScheduleForm((form) => ({ ...form, starttime: event.target.value }))
              }
              style={{
                width: "50%", padding: "12px",
                border: "1px solid #ddd", borderRadius: "10px", boxSizing: "border-box",
              }}
            />
            <input
              type="time"
              value={scheduleForm.endtime}
              onChange={(event) =>
                setScheduleForm((form) => ({ ...form, endtime: event.target.value }))
              }
              style={{
                width: "50%", padding: "12px",
                border: "1px solid #ddd", borderRadius: "10px", boxSizing: "border-box",
              }}
            />
          </div>
          <button
            onClick={handleCreateSchedule}
            disabled={saving}
            style={{
              width: "100%", padding: "12px", marginBottom: "20px",
              backgroundColor: "#7c79ff", color: "#fff",
              border: "none", borderRadius: "10px", fontSize: "15px", cursor: "pointer",
            }}
          >
            {saving ? "저장 중..." : "일정 저장"}
          </button>
          {middlePlaceSection}
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#fff" }}>
      <div style={{
        height: "56px", display: "flex", alignItems: "center",
        padding: "0 16px", borderBottom: "1px solid #eee", gap: "12px",
      }}>
        <button onClick={() => navigate("/home")} style={{ border: "none", background: "none", fontSize: "24px" }}>←</button>
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

        {middlePlaceSection}

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

        <button
          onClick={isCreator ? handleCancel : async () => {
            if (!window.confirm("일정 확정을 취소할까요?")) return;
            try {
              await dismissConfirmedSchedule(currentUser.id, schedule.id);
              navigate("/home");
            } catch (error) {
              alert("취소 실패: " + error.message);
            }
          }}
          style={{
            width: "100%", padding: "12px",
            backgroundColor: "#fff", color: "#f44",
            border: "1px solid #f44", borderRadius: "10px", fontSize: "15px", cursor: "pointer",
          }}
        >
          일정 확정 취소
        </button>
        {isCreator && (
          <p style={{ textAlign: "center", fontSize: "12px", color: "#aaa", marginTop: "6px" }}>
            취소하면 모든 멤버의 화면에서 삭제됩니다
          </p>
        )}
      </div>
    </div>
  );
}

export default ConfirmedScheduleDetailPage;
