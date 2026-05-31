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
import {
  getRoomMemberLocations,
  getRoomParticipants,
  updateRoomLocationTransportModes,
} from "../../api/mapApi";
import { getRouteTime } from "../../api/routeTimeApi";
import { decodePolyline } from "../../utils/decodePolyline";
import KakaoMapView from "../../components/map/KakaoMapView";
import LocationPicker from "../../components/map/LocationPicker";

function ConfirmedScheduleDetailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const schedule = location.state?.schedule;

  const [locationText, setLocationText] = useState(schedule?.location || "");
  const [locationAddress, setLocationAddress] = useState(
    schedule?.locationaddress || ""
  );
  const [saving, setSaving] = useState(false);
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
  const [showTransportModes, setShowTransportModes] = useState(false);
  const [roomParticipants, setRoomParticipants] = useState([]);
  const [memberLocations, setMemberLocations] = useState([]);
  const [routeEstimates, setRouteEstimates] = useState([]);
  const [memberRoutePaths, setMemberRoutePaths] = useState([]);
  const [refreshingRoutes, setRefreshingRoutes] = useState(false);

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

    Promise.all([
      getRoomParticipants(schedule.roomid),
      getRoomMemberLocations(schedule.roomid),
    ])
      .then(([participants, locations]) => {
        setRoomParticipants(participants);
        setMemberLocations(locations);
      })
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

  const dateLabel = !schedule.date
    ? "일정 미정"
    : schedule.isallday
    ? `${schedule.date} (하루종일)`
    : `${schedule.date} ${schedule.starttime ?? ""} ~${
        schedule.endtime ? ` ${schedule.endtime}` : ""
      }`;

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

  const getParticipantKey = (participant) =>
    participant.userid || participant.guestid || participant.id;

  const hasSameId = (left, right) =>
    left != null && right != null && String(left) === String(right);

  const getParticipantLocation = (participant) =>
    memberLocations.find((memberLocation) =>
      participant.userid
        ? hasSameId(memberLocation.userid, participant.userid)
        : hasSameId(memberLocation.guestid, participant.guestid)
    );

  const refreshRouteEstimates = async (
    place = selectedMeetingPlace,
    changedParticipant = null,
    changedMode = null
  ) => {
    if (place?.lat == null || place?.lng == null) return;

    try {
      setRefreshingRoutes(true);

      const pathResults = [];
      const estimates = await Promise.all(
        memberLocations
          .filter(
            (memberLocation) =>
              memberLocation.latitude != null && memberLocation.longitude != null
          )
          .map(async (memberLocation) => {
          const isChangedParticipant = changedParticipant?.userid
            ? hasSameId(memberLocation.userid, changedParticipant.userid)
            : hasSameId(memberLocation.guestid, changedParticipant?.guestid);
          const mode = isChangedParticipant
            ? changedMode
            : memberLocation.transportmode || "transit";
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

      setRouteEstimates(estimates);
      setMemberRoutePaths(pathResults);
    } catch (error) {
      console.error("경로 재검색 실패:", error);
    } finally {
      setRefreshingRoutes(false);
    }
  };

  const handleChangeTransportMode = async (participant, mode) => {
    await updateRoomLocationTransportModes(schedule.roomid, [{
      userid: participant.userid,
      guestid: participant.guestid,
      mode,
    }]);

    setMemberLocations((locations) =>
      locations.map((memberLocation) => {
        const isSameParticipant = participant.userid
          ? hasSameId(memberLocation.userid, participant.userid)
          : hasSameId(memberLocation.guestid, participant.guestid);

        return isSameParticipant
          ? { ...memberLocation, transportmode: mode }
          : memberLocation;
      })
    );

    await refreshRouteEstimates(selectedMeetingPlace, participant, mode);
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
        message: `"${schedule.title || dateLabel}" 일정 확정이 취소되었습니다.`,
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
            message: `참여 인원 부족으로 "${
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
        <p style={{ color: "#7c79ff", marginBottom: "12px" }}>
          📍 현재 위치: {schedule.location}
        </p>
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
            <p key={place.id} style={{ margin: "4px 0", color: "var(--secondary-text)" }}>
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
          backgroundColor: "var(--btn-bg)",
          color: "var(--text-color)",
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
      <div style={{ minHeight: "100vh", backgroundColor: "var(--bg-color)" }}>
        <div
          style={{
            height: "56px",
            display: "flex",
            alignItems: "center",
            padding: "0 16px",
            borderBottom: "1px solid var(--border-color)",
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
          <p style={{ color: "var(--secondary-text)", fontSize: "13px", marginBottom: "4px" }}>
            {schedule.roomname}
          </p>

          <h2 style={{ marginBottom: "2px" }}>일정 미정</h2>

          <p style={{ color: "var(--secondary-text)", marginBottom: "16px" }}>
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
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg-color)" }}>
      <div
        style={{
          height: "56px",
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          borderBottom: "1px solid var(--border-color)",
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
        <p style={{ color: "var(--secondary-text)", fontSize: "13px", marginBottom: "4px" }}>
          {schedule.roomname}
        </p>

        {schedule.title && <h2 style={{ marginBottom: "2px" }}>{schedule.title}</h2>}

        <p style={{ color: "var(--secondary-text)", marginBottom: "16px" }}>{dateLabel}</p>

        {attendees.length > 0 && (
          <div
            style={{
              marginBottom: "20px",
              padding: "12px 14px",
              backgroundColor: "var(--card-bg)",
              borderRadius: "12px",
            }}
          >
            <p style={{ fontWeight: "bold", marginBottom: "8px" }}>
              참여 멤버 ({attendees.length}명)
            </p>

            {attendees.map((attendee) => (
              <p
                key={attendee.userid}
                style={{ margin: "4px 0", fontSize: "14px", color: "var(--text-color)" }}
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
              color: "var(--secondary-text)",
              marginBottom: "12px",
              paddingLeft: "4px",
            }}
          >
            상세주소: {locationAddress}
          </p>
        )}

        {!locationAddress && <div style={{ marginBottom: "12px" }} />}

        <button onClick={handleSave} disabled={saving} style={primaryButtonStyle}>
          {saving ? "저장 중..." : "위치 저장"}
        </button>

        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={() => setShowMap((prev) => !prev)}
            style={{ ...secondaryButtonStyle, flex: 1 }}
          >
            {showMap ? "지도 닫기" : "지도에서 위치 선택하기"}
          </button>

          <button
            onClick={() => {
              setShowTransportModes((visible) => {
                if (!visible) refreshRouteEstimates();
                return !visible;
              });
            }}
            style={{
              ...secondaryButtonStyle,
              width: "auto",
              padding: "12px 10px",
              fontSize: "12px",
              whiteSpace: "nowrap",
            }}
          >
            {showTransportModes ? "이동수단 접기" : "이동수단"}
          </button>
        </div>

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

        {showTransportModes && (
          <div
            style={{
              marginBottom: "12px",
              padding: "10px",
              border: "1px solid var(--border-color)",
              borderRadius: "10px",
            }}
          >
            {roomParticipants.map((participant) => {
              const participantLocation = getParticipantLocation(participant);
              const estimate = routeEstimates.find((route) =>
                participant.userid
                  ? hasSameId(route.userid, participant.userid)
                  : hasSameId(route.guestid, participant.guestid)
              );

              return (
                <div
                  key={`transport-${getParticipantKey(participant)}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "8px",
                    marginBottom: "6px",
                  }}
                >
                  <span style={{ fontSize: "13px" }}>
                    {participant.nickname ||
                      participant.profiles?.nickname ||
                      "닉네임 없음"}
                    {estimate ? ` · ${estimate.durationMinutes}분` : ""}
                  </span>

                  <select
                    value={participantLocation?.transportmode || "transit"}
                    disabled={!participantLocation || refreshingRoutes}
                    onChange={(event) =>
                      handleChangeTransportMode(participant, event.target.value)
                    }
                    style={{ padding: "3px 6px", fontSize: "12px" }}
                  >
                    <option value="transit">대중교통</option>
                    <option value="car">자동차</option>
                  </select>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ marginBottom: "24px" }} />

        {currentUser && (
          <button
            onClick={handleToggleAbsence}
            style={{
              width: "100%",
              padding: "12px",
              marginBottom: "8px",
              backgroundColor: "var(--bg-color)",
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
                backgroundColor: "var(--bg-color)",
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
                color: "var(--secondary-text)",
                marginTop: "6px",
              }}
            >
              삭제하면 모든 멤버의 화면에서 사라집니다
            </p>
          </>
        )}

        {currentUser && (
          <button
            onClick={handleDismiss}
            style={{
              width: "100%",
              padding: "12px",
              marginTop: "8px",
              backgroundColor: "var(--btn-bg)",
              color: "var(--secondary-text)",
              border: "none",
              borderRadius: "10px",
              fontSize: "15px",
              cursor: "pointer",
            }}
          >
            내 홈에서 숨기기
          </button>
        )}
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "12px",
  marginBottom: "8px",
  border: "1px solid var(--border-color)",
  borderRadius: "10px",
  boxSizing: "border-box",
  backgroundColor: "var(--bg-color)",
  color: "var(--text-color)",
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
  backgroundColor: "var(--btn-bg)",
  color: "var(--text-color)",
  border: "none",
  borderRadius: "10px",
  fontSize: "15px",
  cursor: "pointer",
};

export default ConfirmedScheduleDetailPage;
