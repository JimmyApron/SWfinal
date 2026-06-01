import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import {
  addAdditionalConfirmedLocation,
  cancelConfirmedSchedule,
  createConfirmedScheduleForRoom,
  dismissConfirmedSchedule,
  getAdditionalConfirmedLocations,
  updateConfirmedScheduleTiming,
  updateConfirmedScheduleLocation,
} from "../../api/scheduleApi";
import { createRoomNotifications } from "../../api/notificationApi";
import {
  getRoomMemberLocations,
} from "../../api/mapApi";
import { getRouteTime } from "../../api/routeTimeApi";
import { decodePolyline } from "../../utils/decodePolyline";
import KakaoMapView from "../../components/map/KakaoMapView";
import LocationPicker from "../../components/map/LocationPicker";

function getTodayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function getTimeUntil(date, starttime) {
  const today = getTodayStr();
  if (date === today) return "오늘 약속입니다";
  const target = new Date(`${date}T${starttime || "00:00:00"}`);
  const diff = target - new Date();
  if (diff < 0) return "지난 일정입니다";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (days > 0) return `일정 ${days}일 ${hours}시간 전입니다`;
  if (hours > 0) return `일정 ${hours}시간 ${minutes}분 전입니다`;
  return `일정 ${minutes}분 전입니다`;
}

function ConfirmedScheduleDetailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const schedule = location.state?.schedule;

  const [locationText, setLocationText] = useState(schedule?.location || "");
  const [locationAddress, setLocationAddress] = useState(
    schedule?.locationaddress || ""
  );
  const [saving, setSaving] = useState(false);
  const [isEditingTiming, setIsEditingTiming] = useState(false);
  const [scheduleTiming, setScheduleTiming] = useState({
    date: schedule?.date || "",
    starttime: schedule?.starttime || "",
    endtime: schedule?.endtime || "",
    isallday: Boolean(schedule?.isallday),
  });
  const [timingDraft, setTimingDraft] = useState(scheduleTiming);
  const [showMap, setShowMap] = useState(
    schedule?.locationlat != null && schedule?.locationlng != null
  );
  const [currentUser, setCurrentUser] = useState(null);
  const [roomOwnerId, setRoomOwnerId] = useState(null);
  const [attendees, setAttendees] = useState([]);
  const [absentees, setAbsentees] = useState(schedule?.absentees || []);

  const [scheduleForm, setScheduleForm] = useState({
    title: "",
    date: "",
    starttime: "",
    endtime: "",
  });

  const [additionalLocations, setAdditionalLocations] = useState([]);
  const [additionalPlace, setAdditionalPlace] = useState(null);
  const [showAdditionalPicker, setShowAdditionalPicker] = useState(false);
  const [selectedMeetingPlace, setSelectedMeetingPlace] = useState(
    schedule?.locationlat != null && schedule?.locationlng != null
      ? {
          name: schedule.location,
          address: schedule.locationaddress || "",
          lat: schedule.locationlat,
          lng: schedule.locationlng,
        }
      : null
  );
  const [memberLocations, setMemberLocations] = useState([]);
  const [memberRoutePaths, setMemberRoutePaths] = useState([]);

  useEffect(() => {
    if (!schedule) {
      navigate(-1);
      return;
    }

    const fetchData = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      setCurrentUser(user);

      const [{ data: roomData }, { data: scheduleData }] = await Promise.all([
        supabase
          .from("rooms")
          .select("createdby")
          .eq("id", schedule.roomid)
          .single(),
        supabase
          .from("confirmed_schedules")
          .select("absentees")
          .eq("id", schedule.id)
          .maybeSingle(),
      ]);

      if (roomData) {
        setRoomOwnerId(roomData.createdby);
      }

      if (scheduleData) {
        setAbsentees(scheduleData.absentees || []);
      }

      const { data: memberData } = await supabase
        .from("room_members")
        .select("userid")
        .eq("roomid", schedule.roomid);

      const memberIds = (memberData || []).map((m) => m.userid).filter(Boolean);
      if (memberIds.length === 0) return;

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, nickname")
        .in("id", memberIds);

      const profileMap = Object.fromEntries(
        (profiles || []).map((p) => [p.id, p.nickname])
      );

      setAttendees(
        memberIds.map((uid) => ({
          userid: uid,
          nickname: profileMap[uid] || uid,
        }))
      );
    };

    fetchData();
  }, [schedule, navigate]);

  useEffect(() => {
    if (!schedule?.roomid) return;

    getAdditionalConfirmedLocations(schedule.roomid, schedule.id)
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

  useEffect(() => {
    if (!schedule?.roomid) return;

    getRoomMemberLocations(schedule.roomid)
      .then(setMemberLocations)
      .catch((error) => console.error("이동수단 정보 조회 실패:", error));
  }, [schedule]);

  useEffect(() => {
    if (selectedMeetingPlace && memberLocations.length > 0) {
      refreshRouteEstimates(selectedMeetingPlace);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberLocations]);

  useEffect(() => {
    if (selectedMeetingPlace || !schedule?.location) return;

    let isCancelled = false;

    const findSavedMeetingPlace = () => {
      if (!window.kakao?.maps?.services) {
        setTimeout(findSavedMeetingPlace, 100);
        return;
      }

      const placesService = new window.kakao.maps.services.Places();

      placesService.keywordSearch(schedule.location, (data, status) => {
        if (
          isCancelled ||
          status !== window.kakao.maps.services.Status.OK ||
          !data?.[0]
        ) {
          return;
        }

        const place = data[0];
        const resolvedPlace = {
          name: place.place_name || schedule.location,
          address:
            place.road_address_name ||
            place.address_name ||
            schedule.locationaddress ||
            "",
          lat: Number(place.y),
          lng: Number(place.x),
        };

        setSelectedMeetingPlace(resolvedPlace);
        setLocationText(resolvedPlace.name);
        setLocationAddress(resolvedPlace.address);
        setShowMap(true);
      });
    };

    findSavedMeetingPlace();

    return () => {
      isCancelled = true;
    };
  }, [schedule, selectedMeetingPlace]);

  if (!schedule) return null;

  const isRoomOwner = currentUser?.id && currentUser.id === roomOwnerId;
  const isLocationOnly = Boolean(schedule.isLocationOnly);
  const isAbsent = currentUser?.id ? absentees.includes(currentUser.id) : false;

  const dateLabel = !scheduleTiming.date
    ? "일정 미정"
    : scheduleTiming.isallday
    ? `${scheduleTiming.date} (하루종일)`
    : `${scheduleTiming.date} ${scheduleTiming.starttime ?? ""} ~${
        scheduleTiming.endtime ? ` ${scheduleTiming.endtime}` : ""
      }`;

  const handleSaveTiming = async () => {
    if (!timingDraft.date) {
      alert("날짜를 입력해주세요.");
      return;
    }

    if (
      !timingDraft.isallday &&
      (!timingDraft.starttime || !timingDraft.endtime)
    ) {
      alert("시작 시간과 종료 시간을 입력해주세요.");
      return;
    }

    if (
      !timingDraft.isallday &&
      timingDraft.starttime >= timingDraft.endtime
    ) {
      alert("종료 시간은 시작 시간보다 늦어야 합니다.");
      return;
    }

    try {
      setSaving(true);
      await updateConfirmedScheduleTiming(schedule.id, timingDraft);
      setScheduleTiming(timingDraft);
      setIsEditingTiming(false);
      alert("일정 날짜와 시간을 수정했습니다.");
    } catch (error) {
      alert(error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!locationText.trim()) {
      alert("위치를 입력하세요.");
      return;
    }

    try {
      setSaving(true);

      await updateConfirmedScheduleLocation(
        schedule.id,
        locationText.trim(),
        locationAddress,
        selectedMeetingPlace?.lat ?? null,
        selectedMeetingPlace?.lng ?? null
      );

      await refreshRouteEstimates(selectedMeetingPlace);

      alert("위치가 저장되었습니다.");
    } catch (error) {
      alert("위치 저장 실패: " + error.message);
    } finally {
      setSaving(false);
    }
  };

  const refreshRouteEstimates = async (place = selectedMeetingPlace) => {
    if (place?.lat == null || place?.lng == null) return;

    try {
      const pathResults = [];
      await Promise.all(
        memberLocations
          .filter(
            (memberLocation) =>
              memberLocation.latitude != null &&
              memberLocation.longitude != null &&
              memberLocation.transportmode
          )
          .map(async (memberLocation) => {
          const mode = memberLocation.transportmode;
          const result = await getRouteTime({
            origin: {
              lat: Number(memberLocation.latitude),
              lng: Number(memberLocation.longitude),
            },
            destination: {
              lat: Number(place.lat),
              lng: Number(place.lng),
            },
            mode,
          });

          if (mode === "transit" && result.encodedPolyline) {
            pathResults.push({
              userid: memberLocation.userid,
              guestid: memberLocation.guestid,
              mode,
              path: decodePolyline(result.encodedPolyline),
            });
          }

          if (mode === "car") {
            const apiBaseUrl = process.env.REACT_APP_API_BASE_URL;
            const response = await fetch(`${apiBaseUrl}/kakao/route`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                origin: {
                  lat: Number(memberLocation.latitude),
                  lng: Number(memberLocation.longitude),
                },
                destination: {
                  lat: Number(place.lat),
                  lng: Number(place.lng),
                },
              }),
            });

            if (response.ok) {
              const pathResult = await response.json();

              if (pathResult.path?.length > 0) {
                pathResults.push({
                  userid: memberLocation.userid,
                  guestid: memberLocation.guestid,
                  mode,
                  path: pathResult.path,
                });
              }
            }
          }

          return {
            userid: memberLocation.userid,
            guestid: memberLocation.guestid,
            mode,
            durationMinutes: Math.round(result.duration / 60),
          };
          })
      );

      setMemberRoutePaths(pathResults);
    } catch (error) {
      console.error("경로 재검색 실패:", error);
    }
  };

  const handleCancel = async () => {
    if (
      !window.confirm(
        "확정된 일정을 취소할까요? 모든 멤버에게 알림이 전송됩니다."
      )
    ) {
      return;
    }

    try {
      await cancelConfirmedSchedule(schedule.id, schedule.voteid);

      await createRoomNotifications({
        roomId: schedule.roomid,
        senderId: currentUser?.id,
        type: "schedule_cancelled",
        title: "확정 일정이 취소되었습니다",
        message: `방의 "${schedule.title || dateLabel}" 일정 확정이 취소되었습니다.`,
        link: `/rooms/${schedule.roomid}?tab=vote`,
      });

      alert("일정 확정이 취소되었습니다.");
      navigate(-1);
    } catch (error) {
      alert("취소 실패: " + error.message);
    }
  };

  const handleDismiss = async () => {
    if (!window.confirm("내 홈 화면에서 이 일정을 숨길까요?")) return;

    try {
      await dismissConfirmedSchedule(schedule.id, currentUser?.id);
      alert("내 홈 화면에서 숨김 처리되었습니다.");
      navigate("/home");
    } catch (error) {
      alert("숨김 처리 실패: " + error.message);
    }
  };

  const handleToggleAbsence = async () => {
    const userId = currentUser?.id;

    if (!userId) {
      alert("로그인이 필요합니다.");
      return;
    }

    const updated = isAbsent
      ? absentees.filter((id) => id !== userId)
      : [...absentees, userId];

    try {
      await supabase
        .from("confirmed_schedules")
        .update({ absentees: updated })
        .eq("id", schedule.id);

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
            message: `방의 참여 인원 부족으로 "${
              schedule.title || schedule.date
            }" 일정이 자동 취소되었습니다.`,
            link: `/rooms/${schedule.roomid}?tab=vote`,
          });

          alert("참여 인원이 1명만 남아 일정이 자동 취소되었습니다.");
          navigate(-1);
        }
      }
    } catch (error) {
      alert("참석 상태 변경 실패: " + error.message);
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
        schedule.id,
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

  const middlePlace = schedule.middlePlace || selectedMeetingPlace;

  const canShowMiddlePlaceMap =
    middlePlace &&
    Number.isFinite(Number(middlePlace.lat)) &&
    Number.isFinite(Number(middlePlace.lng));

  const middlePlaceSection = (
    <>
      {schedule.location && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "8px",
            marginBottom: "12px",
          }}
        >
          <p style={{ color: "#7c79ff", margin: 0 }}>
            📍 현재 위치: {schedule.location}
          </p>
          <button
            type="button"
            onClick={() => navigate(`/rooms/${schedule.roomid}?tab=location`)}
            style={shortcutButtonStyle}
          >
            위치탭 바로가기
          </button>
        </div>
      )}

      {canShowMiddlePlaceMap && (
        <div style={{ marginBottom: "20px" }}>
          <KakaoMapView
            memberLocations={memberLocations}
            places={[middlePlace]}
            selectedPlace={middlePlace}
            memberRoutePaths={memberRoutePaths}
          />
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
          width: "100%",
          padding: "12px",
          marginBottom: "8px",
          backgroundColor: "#f5f5f5",
          color: "#333",
          border: "none",
          borderRadius: "10px",
          fontSize: "15px",
          cursor: "pointer",
        }}
      >
        주변 위치 추가하기
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
              width: "100%",
              padding: "12px",
              marginBottom: "8px",
              backgroundColor: "#7c79ff",
              color: "#fff",
              border: "none",
              borderRadius: "10px",
              fontSize: "15px",
              cursor: "pointer",
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
        <div
          style={{
            height: "56px",
            display: "flex",
            alignItems: "center",
            padding: "0 16px",
            borderBottom: "1px solid #eee",
            gap: "12px",
          }}
        >
          <button
            onClick={() => navigate("/home")}
            style={{ border: "none", background: "none", fontSize: "24px" }}
          >
            ←
          </button>

          <h3 style={{ margin: 0 }}>확정 일정 상세</h3>
        </div>

        <div style={{ padding: "20px" }}>
          <p style={{ color: "#888", fontSize: "13px", marginBottom: "4px" }}>
            {schedule.roomname}
          </p>

          <h2 style={{ marginBottom: "2px" }}>일정 미정</h2>

          <p style={{ color: "#aaa", marginBottom: "16px" }}>
            아직 확정된 일정이 없습니다.
          </p>

          <p style={{ fontWeight: "bold", marginBottom: "8px" }}>
            일정 입력하기
          </p>

          <input
            type="text"
            placeholder="일정 제목 (선택)"
            value={scheduleForm.title}
            onChange={(event) =>
              setScheduleForm((form) => ({
                ...form,
                title: event.target.value,
              }))
            }
            style={inputStyle}
          />

          <input
            type="date"
            value={scheduleForm.date}
            onChange={(event) =>
              setScheduleForm((form) => ({
                ...form,
                date: event.target.value,
              }))
            }
            style={inputStyle}
          />

          <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
            <input
              type="time"
              value={scheduleForm.starttime}
              onChange={(event) =>
                setScheduleForm((form) => ({
                  ...form,
                  starttime: event.target.value,
                }))
              }
              style={{ ...inputStyle, width: "50%" }}
            />

            <input
              type="time"
              value={scheduleForm.endtime}
              onChange={(event) =>
                setScheduleForm((form) => ({
                  ...form,
                  endtime: event.target.value,
                }))
              }
              style={{ ...inputStyle, width: "50%" }}
            />
          </div>

          <button
            onClick={handleCreateSchedule}
            disabled={saving}
            style={primaryButtonStyle}
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
      <div
        style={{
          height: "56px",
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          borderBottom: "1px solid #eee",
          gap: "12px",
        }}
      >
        <button
          onClick={() => navigate(-1)}
          style={{ border: "none", background: "none", fontSize: "24px" }}
        >
          ←
        </button>

        <h3 style={{ margin: 0 }}>확정 일정 상세</h3>
      </div>

      <div style={{ padding: "20px" }}>
        <p style={{ color: "#888", fontSize: "13px", marginBottom: "4px" }}>
          {schedule.roomname}
        </p>

        {schedule.title && <h2 style={{ marginBottom: "2px" }}>{schedule.title}</h2>}

        <p style={{ color: "#555", marginBottom: schedule.date ? "4px" : "16px" }}>{dateLabel}</p>

        {schedule.date && (
          <p
            style={{
              margin: "0 0 4px",
              fontSize: "13px",
              fontWeight: schedule.date === getTodayStr() ? "bold" : "normal",
              color: schedule.date === getTodayStr() ? "#7c79ff" : "#f90",
            }}
          >
            {getTimeUntil(schedule.date, schedule.starttime)}
          </p>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "8px",
            marginBottom: "16px",
          }}
        >
          <button
            type="button"
            onClick={() => navigate(`/rooms/${schedule.roomid}?tab=schedule`)}
            style={shortcutButtonStyle}
          >
            일정탭 바로가기
          </button>
          <button
            type="button"
            onClick={() => {
              setTimingDraft(scheduleTiming);
              setIsEditingTiming(true);
            }}
            style={shortcutButtonStyle}
          >
            수정하기
          </button>
        </div>

        {isEditingTiming && (
          <div
            style={{
              marginBottom: "16px",
              padding: "12px",
              border: "1px solid #e0e0ff",
              borderRadius: "10px",
              backgroundColor: "#f9f9ff",
            }}
          >
            <input
              type="date"
              value={timingDraft.date}
              onChange={(event) =>
                setTimingDraft((draft) => ({
                  ...draft,
                  date: event.target.value,
                }))
              }
              style={inputStyle}
            />

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                marginBottom: "8px",
              }}
            >
              <input
                type="checkbox"
                checked={timingDraft.isallday}
                onChange={(event) =>
                  setTimingDraft((draft) => ({
                    ...draft,
                    isallday: event.target.checked,
                  }))
                }
              />
              하루종일
            </label>

            {!timingDraft.isallday && (
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="time"
                  value={timingDraft.starttime}
                  onChange={(event) =>
                    setTimingDraft((draft) => ({
                      ...draft,
                      starttime: event.target.value,
                    }))
                  }
                  style={{ ...inputStyle, width: "50%" }}
                />
                <input
                  type="time"
                  value={timingDraft.endtime}
                  onChange={(event) =>
                    setTimingDraft((draft) => ({
                      ...draft,
                      endtime: event.target.value,
                    }))
                  }
                  style={{ ...inputStyle, width: "50%" }}
                />
              </div>
            )}

            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                onClick={() => setIsEditingTiming(false)}
                style={{ ...secondaryButtonStyle, marginBottom: 0 }}
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSaveTiming}
                disabled={saving}
                style={{ ...primaryButtonStyle, marginBottom: 0 }}
              >
                {saving ? "등록 중..." : "등록"}
              </button>
            </div>
          </div>
        )}

        {attendees.length > 0 && (
          <div
            style={{
              marginBottom: "20px",
              padding: "12px 14px",
              backgroundColor: "#f9f9ff",
              borderRadius: "12px",
            }}
          >
            <p style={{ fontWeight: "bold", marginBottom: "8px" }}>
              참여 멤버 ({attendees.length}명)
            </p>

            {attendees.map((attendee) => (
              <p
                key={attendee.userid}
                style={{ margin: "4px 0", fontSize: "14px", color: "#333" }}
              >
                · {attendee.nickname || attendee.userid}
                {absentees.includes(attendee.userid) && (
                  <span style={{ color: "#f44", marginLeft: "6px" }}>
                    불참
                  </span>
                )}
              </p>
            ))}
          </div>
        )}

        {middlePlaceSection}

        <p style={{ fontWeight: "bold", marginBottom: "12px" }}>
          만날 위치 설정
        </p>

        <input
          type="text"
          placeholder="지도에서 위치를 선택하세요"
          value={locationText}
          readOnly
          style={inputStyle}
        />

        {locationAddress && (
          <p
            style={{
              fontSize: "12px",
              color: "#888",
              marginBottom: "12px",
              paddingLeft: "4px",
            }}
          >
            상세주소: {locationAddress}
          </p>
        )}

        {!locationAddress && <div style={{ marginBottom: "12px" }} />}

        <button
          onClick={() => setShowMap((prev) => !prev)}
          style={secondaryButtonStyle}
        >
          {showMap ? "지도 닫기" : "지도에서 위치 선택하기"}
        </button>

        {showMap && (
          <LocationPicker
            initialPlace={selectedMeetingPlace}
            onSelect={(name, address, place = {}) => {
              setLocationText(name);
              setLocationAddress(address || place.address || "");
              setSelectedMeetingPlace({
                name,
                address: address || place.address || "",
                lat: place.lat,
                lng: place.lng,
              });
              refreshRouteEstimates(place);
            }}
          />
        )}

        <button onClick={handleSave} disabled={saving} style={primaryButtonStyle}>
          {saving ? "저장 중..." : "위치 저장"}
        </button>

        <div style={{ marginBottom: "24px" }} />

        {currentUser && (
          <button
            onClick={handleToggleAbsence}
            style={{
              width: "100%",
              padding: "12px",
              marginBottom: "8px",
              backgroundColor: "#fff",
              color: isAbsent ? "#7c79ff" : "#f44",
              border: `1px solid ${isAbsent ? "#7c79ff" : "#f44"}`,
              borderRadius: "10px",
              fontSize: "15px",
              cursor: "pointer",
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
                width: "100%",
                padding: "12px",
                backgroundColor: "#fff",
                color: "#f44",
                border: "1px solid #f44",
                borderRadius: "10px",
                fontSize: "15px",
                cursor: "pointer",
              }}
            >
              일정 삭제
            </button>

            <p
              style={{
                textAlign: "center",
                fontSize: "12px",
                color: "#aaa",
                marginTop: "6px",
              }}
            >
              삭제하면 모든 멤버의 화면에서 사라집니다
            </p>
          </>
        )}

      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "12px",
  marginBottom: "8px",
  border: "1px solid #ddd",
  borderRadius: "10px",
  boxSizing: "border-box",
};

const primaryButtonStyle = {
  width: "100%",
  padding: "12px",
  marginBottom: "8px",
  backgroundColor: "#7c79ff",
  color: "#fff",
  border: "none",
  borderRadius: "10px",
  fontSize: "15px",
  cursor: "pointer",
};

const secondaryButtonStyle = {
  width: "100%",
  padding: "12px",
  marginBottom: "8px",
  backgroundColor: "#f5f5f5",
  color: "#333",
  border: "none",
  borderRadius: "10px",
  fontSize: "15px",
  cursor: "pointer",
};

const shortcutButtonStyle = {
  flexShrink: 0,
  padding: "5px 8px",
  border: "1px solid #d8d8ff",
  borderRadius: "7px",
  backgroundColor: "#f9f9ff",
  color: "#5c58d8",
  cursor: "pointer",
  fontSize: "12px",
};

export default ConfirmedScheduleDetailPage;