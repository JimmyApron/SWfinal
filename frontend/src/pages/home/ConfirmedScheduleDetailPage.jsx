import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FaCalendarAlt, FaMapMarkerAlt, FaBell } from "react-icons/fa";
import { supabase } from "../../lib/supabaseClient";
import {
  addAdditionalConfirmedLocation,
  cancelConfirmedSchedule,
  createConfirmedScheduleForRoom,
  deleteAdditionalConfirmedLocation,
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
import { getTodayStr } from "../../utils/scheduleUtils";

function getTimeUntil(date, starttime) {
  if (!date || !date.match(/^\d{4}-\d{2}-\d{2}$/)) return null;
  const today = getTodayStr();
  if (date === today) return "당일 일정";
  const target = new Date(`${date}T${starttime || "00:00:00"}`);
  if (isNaN(target.getTime())) return null;
  const diff = target - new Date();
  if (diff < 0) return "지난 일정";
  const totalMinutes = Math.floor(diff / (1000 * 60));
  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) {
    return `${String(totalHours).padStart(2, "0")}시간 ${String(minutes).padStart(2, "0")}분 전`;
  }
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return `${days}일 ${hours}시간 전`;
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
  const [draftMeetingPlace, setDraftMeetingPlace] = useState(
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
  const [voteExists, setVoteExists] = useState(null); // null=로딩중, true/false
  const [showEditChoice, setShowEditChoice] = useState(false);
  const [showAttendees, setShowAttendees] = useState(false);
  const [showLocationEditChoice, setShowLocationEditChoice] = useState(false);
  const [isEditingLocationMap, setIsEditingLocationMap] = useState(false);

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

      if (schedule.voteid) {
        const { data: voteData } = await supabase
          .from("votes")
          .select("id")
          .eq("id", schedule.voteid)
          .maybeSingle();
        setVoteExists(Boolean(voteData));
      } else {
        setVoteExists(false);
      }

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
        .select("id, nickname, profileimageurl")
        .in("id", memberIds);

      const profileMap = Object.fromEntries(
        (profiles || []).map((p) => [p.id, p])
      );

      setAttendees(
        memberIds.map((uid) => ({
          userid: uid,
          nickname: profileMap[uid]?.nickname || uid,
          profileimageurl: profileMap[uid]?.profileimageurl || null,
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
        setDraftMeetingPlace(resolvedPlace);
        setLocationText(resolvedPlace.name);
        setLocationAddress(resolvedPlace.address);
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
  const attendingCount = attendees.filter(
    (attendee) => !absentees.includes(attendee.userid)
  ).length;

  const isPastSchedule = (() => {
    if (!scheduleTiming.date) return false;
    const today = getTodayStr();
    return scheduleTiming.date < today;
  })();

  const isDateUndecided = !scheduleTiming.date;

  const dateLabel = isDateUndecided
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
      setShowEditChoice(false);
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
        draftMeetingPlace?.lat ?? null,
        draftMeetingPlace?.lng ?? null
      );

      setSelectedMeetingPlace(draftMeetingPlace);
      setIsEditingLocationMap(false);
      setShowLocationEditChoice(false);
      await refreshRouteEstimates(draftMeetingPlace);

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

      await updateConfirmedScheduleTiming(schedule.id, {
        ...scheduleForm,
        isallday: !scheduleForm.starttime,
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

  const handleDeleteAdditionalLocation = async (locationId) => {
    if (!window.confirm("이 장소를 삭제할까요?")) return;

    try {
      await deleteAdditionalConfirmedLocation(locationId);
      setAdditionalLocations((locations) =>
        locations.filter((location) => location.id !== locationId)
      );
    } catch (error) {
      alert("장소 삭제 실패: " + error.message);
    }
  };

  const openInScheduleTab = () => {
    sessionStorage.setItem(
      "confirmFromSchedule",
      JSON.stringify({
        id: schedule.id,
        title: schedule.title || "일정",
        hasLocation: !!schedule.location,
        roomid: schedule.roomid,
      })
    );
    navigate(`/rooms/${schedule.roomid}?tab=schedule`);
  };

  const middlePlace = schedule.middlePlace || selectedMeetingPlace;

  const canShowMiddlePlaceMap =
    middlePlace &&
    Number.isFinite(Number(middlePlace.lat)) &&
    Number.isFinite(Number(middlePlace.lng));

  const isLocationUndecided = !(selectedMeetingPlace?.name || schedule.location);

  const middlePlaceSection = (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "8px",
          marginBottom: "10px",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              color: "#1F2933",
              margin: 0,
              fontSize: "14px",
              display: "flex",
              alignItems: "center",
              gap: "5px",
            }}
          >
            <FaMapMarkerAlt color="#7C5CFF" size={13} />
            {isLocationUndecided
              ? "만날 장소: 미등록"
              : `만날 장소: ${selectedMeetingPlace?.name || schedule.location}`}
          </p>
          {!isLocationUndecided && (selectedMeetingPlace?.address || locationAddress) && (
            <p style={{ margin: "3px 0 0", fontSize: "12px", color: "#9CA3AF" }}>
              {selectedMeetingPlace?.address || locationAddress}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            if (isPastSchedule) return;
            setIsEditingLocationMap(false);
            setShowLocationEditChoice(true);
          }}
          disabled={isPastSchedule}
          style={{
            border: "none",
            background: "none",
            color: "#7C5CFF",
            fontSize: "13px",
            fontWeight: "600",
            cursor: isPastSchedule ? "not-allowed" : "pointer",
            opacity: isPastSchedule ? 0.4 : 1,
            padding: 0,
          }}
        >
          {isLocationUndecided ? "등록" : "수정"}
        </button>
      </div>

      {canShowMiddlePlaceMap && (
        <div style={{ marginBottom: "14px" }}>
          <KakaoMapView
            memberLocations={memberLocations}
            places={[middlePlace]}
            selectedPlace={middlePlace}
            memberRoutePaths={memberRoutePaths}
            mapHeight="220px"
          />
        </div>
      )}

      <div
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: "14px",
          border: "1px solid #E5E7EB",
          boxShadow: "0 2px 10px rgba(0,0,0,0.04)",
          padding: "10px 12px",
          marginBottom: "10px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <FaMapMarkerAlt color="#7C5CFF" size={13} />
            <p style={{ color: "#1F2933", margin: 0, fontSize: "14px" }}>
              함께 가고 싶은 장소
              {additionalLocations.length > 0 && (
                <span style={{ color: "#7C5CFF" }}> {additionalLocations.length}</span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (isPastSchedule) return;
              setAdditionalPlace(null);
              setShowAdditionalPicker(true);
            }}
            disabled={isPastSchedule}
            style={{
              border: "none",
              background: "none",
              color: "#7C5CFF",
              fontSize: "12px",
              fontWeight: "600",
              cursor: isPastSchedule ? "not-allowed" : "pointer",
              opacity: isPastSchedule ? 0.4 : 1,
              padding: 0,
            }}
          >
            추가
          </button>
        </div>

        {additionalLocations.length > 0 && (
          <>
            <div style={{ height: "1px", backgroundColor: "#E5E7EB", margin: "8px -12px" }} />
            <div>
              {additionalLocations.map((place) => (
                <div
                  key={place.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "8px",
                    paddingLeft: "18px",
                  }}
                >
                  <p style={{ margin: "3px 0", fontSize: "12px", color: "#4B5563" }}>
                    - {place.placename}
                  </p>
                  <button
                    type="button"
                    onClick={() => handleDeleteAdditionalLocation(place.id)}
                    style={{
                      border: "none",
                      background: "none",
                      color: "#EF4444",
                      fontSize: "11px",
                      cursor: "pointer",
                      padding: "4px",
                      flexShrink: 0,
                    }}
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {showAdditionalPicker && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 3000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={() => {
            setShowAdditionalPicker(false);
            setAdditionalPlace(null);
          }}
        >
          <div
            style={{
              background: "#fff",
              padding: "18px",
              borderRadius: "18px",
              width: "min(90vw, 300px)",
              maxHeight: "85vh",
              overflowY: "auto",
              boxShadow: "0 10px 25px rgba(0,0,0,0.1)",
              boxSizing: "border-box",
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 10px", fontSize: "15px", color: "#1F2933", textAlign: "center" }}>
              가고 싶은 장소 추가
            </h3>

            <LocationPicker
              mapHeight="170px"
              onSelect={(name, address, place = {}) =>
                setAdditionalPlace({ ...place, name, address })
              }
            />

            {additionalPlace && (
              <p style={{ color: "#7C5CFF", margin: "8px 0", fontSize: "12px" }}>
                선택한 위치: {additionalPlace.name}
              </p>
            )}

            <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
              <button
                type="button"
                onClick={() => {
                  setShowAdditionalPicker(false);
                  setAdditionalPlace(null);
                }}
                style={{ ...secondaryButtonStyle, marginBottom: 0 }}
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleAddLocation}
                disabled={saving || !additionalPlace}
                style={{ ...primaryButtonStyle, marginBottom: 0 }}
              >
                {saving ? "추가 중..." : "추가"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  if (isLocationOnly) {
    return (
      <div style={{ minHeight: "100vh", backgroundColor: "#fff" }}>
        <div
          style={{
            height: "48px",
            display: "flex",
            alignItems: "center",
            padding: "0 14px",
            borderBottom: "1px solid #eee",
            gap: "10px",
          }}
        >
          <button
            onClick={() => navigate("/home")}
            style={{ border: "none", background: "none", fontSize: "20px" }}
          >
            ←
          </button>

          <h3 style={{ margin: 0, fontSize: "15px" }}>확정 일정 상세</h3>
        </div>

        <div style={{ padding: "16px" }}>
          <p style={{ color: "#888", fontSize: "12px", marginBottom: "4px" }}>
            {schedule.roomname}
          </p>

          <h2 style={{ marginBottom: "2px", fontSize: "18px" }}>일정 미정</h2>

          <p style={{ color: "#aaa", fontSize: "13px", marginBottom: "10px" }}>
            아직 확정된 일정이 없습니다.
          </p>

          <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
            <button
              type="button"
              onClick={() =>
                navigate(`/rooms/${schedule.roomid}/vote-create`, {
                  state: {
                    fromScheduleId: schedule.id,
                    votePurpose: "schedule",
                    voteType: "date",
                    returnTab: "schedule",
                  },
                })
              }
              style={shortcutButtonStyle}
            >
              새 투표 만들기
            </button>
          </div>

          <p style={{ fontWeight: "bold", fontSize: "14px", marginBottom: "6px" }}>
            직접 입력하기
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

  const timeUntil = getTimeUntil(schedule.date, schedule.starttime);

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#F7F7FA" }}>
      <div
        style={{
          height: "48px",
          display: "flex",
          alignItems: "center",
          padding: "0 14px",
          backgroundColor: "#fff",
          borderBottom: "1px solid #E5E7EB",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <button
          onClick={() => navigate(-1)}
          style={{ border: "none", background: "none", fontSize: "20px", color: "#1F2933", flex: "0 0 28px" }}
        >
          ←
        </button>

        <h3 style={{ margin: 0, flex: 1, textAlign: "center", fontSize: "15px", color: "#1F2933" }}>확정 일정 상세</h3>

        <div style={{ flex: "0 0 28px" }} />
      </div>

      <div style={{ padding: "14px", paddingBottom: "24px" }}>
        <p style={{ color: "#7C5CFF", fontSize: "12px", fontWeight: "700", margin: "0 0 4px" }}>
          {schedule.roomname}
        </p>

        {schedule.title && (
          <h2 style={{ margin: "0 0 4px", fontSize: "18px", color: "#1F2933" }}>{schedule.title}</h2>
        )}

        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px", marginBottom: "10px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              style={{
                margin: 0,
                color: "#1F2933",
                fontSize: "14px",
                display: "flex",
                alignItems: "center",
                gap: "5px",
              }}
            >
              <FaCalendarAlt color="#7C5CFF" size={13} />
              확정 일정: {dateLabel}
            </p>
            {timeUntil && (
              <p
                style={{
                  margin: "3px 0 0",
                  fontSize: "12px",
                  color: "#F59E0B",
                  fontWeight: "500",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <FaBell size={11} color="#F59E0B" />
                <span>{timeUntil}</span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              if (isPastSchedule) return;
              setIsEditingTiming(false);
              setShowEditChoice(true);
            }}
            disabled={isPastSchedule}
            style={{
              border: "none",
              background: "none",
              color: "#7C5CFF",
              fontSize: "13px",
              fontWeight: "550",
              cursor: isPastSchedule ? "not-allowed" : "pointer",
              opacity: isPastSchedule ? 0.4 : 1,
              padding: 0,
            }}
          >
            {isDateUndecided ? "등록" : "수정"}
          </button>
        </div>

        {isPastSchedule && (
          <div
            style={{
              padding: "8px 12px",
              marginBottom: "10px",
              backgroundColor: "#F3F4F6",
              borderRadius: "10px",
              fontSize: "12px",
              color: "#6B7280",
            }}
          >
            지난 일정입니다. 날짜·위치 수정은 불가합니다.
          </div>
        )}

        {schedule.voteid && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "12px",
            }}
          >
            {/* 케이스 1: 투표로 생성 + 투표 존재 */}
            {voteExists === true && (
              <button
                type="button"
                onClick={() =>
                  navigate(`/rooms/${schedule.roomid}/votes/${schedule.voteid}`)
                }
                style={shortcutButtonStyle}
              >
                투표로 돌아가기
              </button>
            )}
            {/* 케이스 2: 투표로 생성 + 투표 삭제됨 */}
            {voteExists === false && (
              <button
                type="button"
                onClick={openInScheduleTab}
                style={{ ...shortcutButtonStyle, color: "#f44", borderColor: "#ffcccc" }}
              >
                일정 탭에서 정하기
              </button>
            )}
          </div>
        )}

        {attendees.length > 0 && (
          <div
            style={{
              marginBottom: "10px",
              padding: "10px 12px",
              backgroundColor: "#FFFFFF",
              borderRadius: "14px",
              border: "1px solid #E5E7EB",
              boxShadow: "0 2px 10px rgba(0,0,0,0.04)",
            }}
          >
            <div
              onClick={() => setShowAttendees((prev) => !prev)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: showAttendees ? "8px" : 0,
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <div
                  style={{
                    width: "24px",
                    height: "24px",
                    borderRadius: "7px",
                    backgroundColor: "#F0ECFF",
                    color: "#7C5CFF",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "12px",
                  }}
                >
                  👥
                </div>
                <span style={{ fontWeight: "700", fontSize: "14px", color: "#1F2933" }}>
                  참여 멤버 {attendingCount}명
                </span>
              </div>
              <span
                style={{
                  color: "#9CA3AF",
                  fontSize: "14px",
                  display: "inline-block",
                  transform: showAttendees ? "rotate(90deg)" : "rotate(0deg)",
                  transition: "transform 0.15s ease",
                }}
              >
                ›
              </span>
            </div>

            {showAttendees &&
              attendees.map((attendee) => (
                <div
                  key={attendee.userid}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "6px 0 6px 30px",
                  }}
                >
                  <div
                    style={{
                      width: "26px",
                      height: "26px",
                      borderRadius: "50%",
                      backgroundColor: "#E5E7EB",
                      flexShrink: 0,
                      overflow: "hidden",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {attendee.profileimageurl ? (
                      <img
                        src={attendee.profileimageurl}
                        alt={attendee.nickname}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    ) : (
                      <span style={{ fontSize: "14px" }}>👤</span>
                    )}
                  </div>
                  <span style={{ fontSize: "13px", color: "#4B5563" }}>
                    {attendee.nickname || attendee.userid}
                  </span>
                  {absentees.includes(attendee.userid) && (
                    <span style={{ color: "#EF4444", fontSize: "11px" }}>불참</span>
                  )}
                </div>
              ))}
          </div>
        )}

        {middlePlaceSection}

        <div style={{ marginBottom: "16px" }} />

        {isPastSchedule ? (
          /* 지난 일정: 개인 캘린더에서만 삭제 (본인에게만 적용) */
          currentUser && (
            <>
              <button
                onClick={handleDismiss}
                style={{
                  width: "100%",
                  padding: "10px",
                  backgroundColor: "#fff",
                  color: "#f44",
                  border: "1px solid #f44",
                  borderRadius: "10px",
                  fontSize: "14px",
                  cursor: "pointer",
                }}
              >
                일정 삭제
              </button>
              <p
                style={{
                  textAlign: "center",
                  fontSize: "11px",
                  color: "#aaa",
                  marginTop: "5px",
                }}
              >
                내 캘린더에서만 삭제됩니다
              </p>
            </>
          )
        ) : (
          /* 현재/미래 일정: 기존 버튼 유지 */
          <>
            {currentUser && (
              <button
                onClick={handleToggleAbsence}
                style={{
                  width: "100%",
                  padding: "10px",
                  marginBottom: "8px",
                  backgroundColor: "#fff",
                  color: isAbsent ? "#7c79ff" : "#f44",
                  border: `1px solid ${isAbsent ? "#7c79ff" : "#f44"}`,
                  borderRadius: "10px",
                  fontSize: "14px",
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
                    padding: "10px",
                    backgroundColor: "#fff",
                    color: "#f44",
                    border: "1px solid #f44",
                    borderRadius: "10px",
                    fontSize: "14px",
                    cursor: "pointer",
                  }}
                >
                  일정 삭제
                </button>
                <p
                  style={{
                    textAlign: "center",
                    fontSize: "11px",
                    color: "#aaa",
                    marginTop: "5px",
                  }}
                >
                  삭제하면 모든 멤버의 화면에서 사라집니다
                </p>
              </>
            )}
          </>
        )}

      </div>

      {showEditChoice && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 3000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={() => {
            setShowEditChoice(false);
            setIsEditingTiming(false);
          }}
        >
          <div
            style={{
              background: "#fff",
              padding: "18px",
              borderRadius: "18px",
              width: isEditingTiming ? "260px" : "230px",
              textAlign: isEditingTiming ? "left" : "center",
              boxShadow: "0 10px 25px rgba(0,0,0,0.1)",
            }}
            onClick={(event) => event.stopPropagation()}
          >
            {isEditingTiming ? (
              <>
                <h3 style={{ margin: "0 0 12px", fontSize: "15px", color: "#1F2933", textAlign: "center" }}>
                  확정 일정 수정
                </h3>

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

                <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingTiming(false);
                      setShowEditChoice(false);
                    }}
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
              </>
            ) : (
              <>
                <h3 style={{ margin: "0 0 12px", fontSize: "15px", color: "#1F2933" }}>
                  {isDateUndecided
                    ? "일정을 어떻게 등록할까요?"
                    : "일정을 어떻게 수정할까요?"}
                </h3>

                <button
                  type="button"
                  onClick={() => {
                    setTimingDraft(scheduleTiming);
                    setIsEditingTiming(true);
                  }}
                  style={{ ...primaryButtonStyle, marginBottom: "8px" }}
                >
                  {isDateUndecided ? "직접 등록" : "직접 수정"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowEditChoice(false);
                    openInScheduleTab();
                  }}
                  style={{ ...secondaryButtonStyle, marginBottom: 0 }}
                >
                  일정 탭에서 열기
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {showLocationEditChoice && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 3000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={() => {
            setShowLocationEditChoice(false);
            setIsEditingLocationMap(false);
          }}
        >
          <div
            style={{
              background: "#fff",
              padding: "18px",
              borderRadius: "18px",
              width: isEditingLocationMap ? "min(94vw, 380px)" : "270px",
              maxHeight: "85vh",
              overflowY: "auto",
              textAlign: isEditingLocationMap ? "left" : "center",
              boxShadow: "0 10px 25px rgba(0,0,0,0.1)",
              boxSizing: "border-box",
            }}
            onClick={(event) => event.stopPropagation()}
          >
            {isEditingLocationMap ? (
              <>
                <h3 style={{ margin: "0 0 10px", fontSize: "15px", color: "#1F2933", textAlign: "center" }}>
                  만날 장소 선택
                </h3>

                <LocationPicker
                  initialPlace={draftMeetingPlace || selectedMeetingPlace}
                  prefillKeywordFromInitialPlace={false}
                  mapHeight="170px"
                  onSelect={(name, address, place = {}) => {
                    setLocationText(name);
                    setLocationAddress(address || place.address || "");
                    setDraftMeetingPlace({
                      name,
                      address: address || place.address || "",
                      lat: place.lat,
                      lng: place.lng,
                    });
                  }}
                />

                <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingLocationMap(false);
                      setShowLocationEditChoice(false);
                    }}
                    style={{ ...secondaryButtonStyle, marginBottom: 0 }}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    style={{ ...primaryButtonStyle, marginBottom: 0 }}
                  >
                    {saving ? "수정 중..." : "수정"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 style={{ margin: "0 0 12px", fontSize: "14px", color: "#1F2933" }}>
                  {isLocationUndecided
                    ? "만날 장소를 어떻게 등록할까요?"
                    : "만날 장소를 어떻게 수정할까요?"}
                </h3>

                <button
                  type="button"
                  onClick={() => setIsEditingLocationMap(true)}
                  style={{ ...primaryButtonStyle, marginBottom: "8px" }}
                >
                  지도에서 장소 선택하기
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowLocationEditChoice(false);
                    navigate(`/rooms/${schedule.roomid}?tab=location`);
                  }}
                  style={{ ...secondaryButtonStyle, marginBottom: 0 }}
                >
                  위치 탭에서 열기
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "10px",
  marginBottom: "8px",
  border: "1px solid #ddd",
  borderRadius: "10px",
  boxSizing: "border-box",
  fontSize: "14px",
};

const primaryButtonStyle = {
  width: "100%",
  padding: "10px",
  marginBottom: "8px",
  backgroundColor: "#7c79ff",
  color: "#fff",
  border: "none",
  borderRadius: "10px",
  fontSize: "14px",
  cursor: "pointer",
};

const secondaryButtonStyle = {
  width: "100%",
  padding: "10px",
  marginBottom: "8px",
  backgroundColor: "#f5f5f5",
  color: "#333",
  border: "none",
  borderRadius: "10px",
  fontSize: "14px",
  cursor: "pointer",
};

const shortcutButtonStyle = {
  flexShrink: 0,
  padding: "4px 7px",
  border: "1px solid #d8d8ff",
  borderRadius: "6px",
  backgroundColor: "#f9f9ff",
  color: "#5c58d8",
  cursor: "pointer",
  fontSize: "11px",
};

export default ConfirmedScheduleDetailPage;
