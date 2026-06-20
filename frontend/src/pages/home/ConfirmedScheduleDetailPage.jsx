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
  if (date === today) return "오늘 일정";
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
  const [memberRouteResults, setMemberRouteResults] = useState([]);
  const [voteExists, setVoteExists] = useState(null); // null=嚥≪뮆逾ヤ빳? true/false
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
      .catch((error) => console.error("?곕떽? ?關??鈺곌퀬????쎈솭:", error));

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
      .catch((error) => console.error("??猷??롫뼊 ?類ｋ궖 鈺곌퀬????쎈솭:", error));
  }, [schedule]);

  useEffect(() => {
    if (selectedMeetingPlace && memberLocations.length > 0) {
      refreshRouteEstimates(selectedMeetingPlace);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberLocations]);

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
    ? "날짜 미정"
    : scheduleTiming.isallday
    ? `${scheduleTiming.date} (하루종일)`
    : `${scheduleTiming.date} ${scheduleTiming.starttime ?? ""} ~${
        scheduleTiming.endtime ? ` ${scheduleTiming.endtime}` : ""
      }`;

  const handleSaveTiming = async () => {
    if (!timingDraft.date) {
      alert("?醫롮?????낆젾??곻폒?紐꾩뒄.");
      return;
    }

    if (
      !timingDraft.isallday &&
      (!timingDraft.starttime || !timingDraft.endtime)
    ) {
      alert("??뽰삂 ??볦퍢???ル굝利???볦퍢????낆젾??곻폒?紐꾩뒄.");
      return;
    }

    if (
      !timingDraft.isallday &&
      timingDraft.starttime >= timingDraft.endtime
    ) {
      alert("?ル굝利???볦퍢?? ??뽰삂 ??볦퍢癰귣?????堉????몃빍??");
      return;
    }

    try {
      setSaving(true);
      await updateConfirmedScheduleTiming(schedule.id, timingDraft);
      setScheduleTiming(timingDraft);
      setIsEditingTiming(false);
      setShowEditChoice(false);
      alert("??깆젟 ?醫롮??? ??볦퍢????륁젟??됰뮸??덈뼄.");
    } catch (error) {
      alert(error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!locationText.trim()) {
      alert("?關?쇘몴???낆젾??뤾쉭??");
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

      alert("?關?쇔첎? ???貫由??됰뮸??덈뼄.");
    } catch (error) {
      alert("?關????????쎈솭: " + error.message);
    } finally {
      setSaving(false);
    }
  };

  const refreshRouteEstimates = async (place = selectedMeetingPlace) => {
    if (place?.lat == null || place?.lng == null) {
      setMemberRoutePaths([]);
      setMemberRouteResults([]);
      return;
    }

    try {
      const pathResults = [];
      const routeResults = [];
      await Promise.all(
        memberLocations
          .filter(
            (memberLocation) =>
              memberLocation.latitude != null &&
              memberLocation.longitude != null &&
              memberLocation.transportmode
          )
          .map(async (memberLocation) => {
            const mode = normalizeTransportMode(memberLocation.transportmode);
            if (!mode) return null;

            const origin = {
              lat: Number(memberLocation.latitude),
              lng: Number(memberLocation.longitude),
            };
            const destination = {
              lat: Number(place.lat),
              lng: Number(place.lng),
            };

            let hasPath = false;
            const routeResult = {
              userid: memberLocation.userid,
              guestid: memberLocation.guestid,
              mode,
              duration: null,
              distance: null,
              durationMinutes: null,
              distanceKm: null,
            };

            let result = null;

            if (mode === "transit") {
              result = await getRouteTime({
                origin,
                destination,
                mode,
              }).catch((error) => {
              console.error("筌롢끇苡???猷??볦퍢 ?④쑴沅???쎈솭:", error);
              return null;
            });

            }

            if (result) {
              routeResult.duration = result.duration ?? null;
              routeResult.distance = result.distance ?? null;
              routeResult.durationMinutes = result.duration
                ? Math.round(result.duration / 60)
                : null;
              routeResult.distanceKm = result.distance
                ? (result.distance / 1000).toFixed(1)
                : null;
            }

            if (mode === "transit" && result) {
              const transitPath = result.encodedPolyline
                ? decodePolyline(result.encodedPolyline)
                : (result.steps || [])
                    .map((step) => step.encodedPolyline)
                    .filter(Boolean)
                    .flatMap((encodedPath) => decodePolyline(encodedPath));

              if (transitPath.length > 0) {
                pathResults.push({
                  userid: memberLocation.userid,
                  guestid: memberLocation.guestid,
                  mode,
                  path: transitPath,
                });
                hasPath = true;
              }
            }

            if (mode === "car") {
              const apiBaseUrl = getApiBaseUrl();
              const url = `${apiBaseUrl}/kakao/route`;
              const requestBody = {
                origin,
                destination,
              };
              const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(requestBody),
              }).catch((error) => {
                console.error("[Kakao Route API] 筌롢끇苡??癒?짗筌?野껋럥以????뺤쒔 ?怨뚭퍙 ??쎈솭:", {
                  url,
                  requestBody,
                  error,
                });
                return null;
              });

              if (response?.ok) {
                const pathResult = await response.json();

                if (pathResult.path?.length > 0) {
                  routeResult.duration = pathResult.duration ?? null;
                  routeResult.distance = pathResult.distance ?? null;
                  routeResult.durationMinutes = pathResult.duration
                    ? Math.round(pathResult.duration / 60)
                    : null;
                  routeResult.distanceKm = pathResult.distance
                    ? (pathResult.distance / 1000).toFixed(1)
                    : null;
                  pathResults.push({
                    userid: memberLocation.userid,
                    guestid: memberLocation.guestid,
                    mode,
                    path: pathResult.path,
                  });
                  hasPath = true;
                }
              } else if (response) {
                const responseBody = await readRouteResponseBody(response);

                console.error("[Kakao Route API] 筌롢끇苡??癒?짗筌?野껋럥以???④쑴沅???쎈솭:", {
                  url,
                  status: response.status,
                  statusText: response.statusText,
                  requestBody,
                  responseBody,
                });
              }
            }

            if (!hasPath) {
              routeResult.error = "野껋럥以?野꺜???븍뜃?";
            }

            routeResults.push(routeResult);
            return routeResult;
          })
      );

      setMemberRoutePaths(pathResults);
      setMemberRouteResults(routeResults);
    } catch (error) {
      console.error("野껋럥以????????쎈솭:", error);
    }
  };

  const handleCancel = async () => {
    if (
      !window.confirm(
        "?類ㅼ젟????깆젟???띯뫁??醫됲돱?? 筌뤴뫀諭?筌롢끇苡?癒?쓺 ???뵝???袁⑸꽊??몃빍??"
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
        title: "일정 취소",
        message: `"${schedule.title || dateLabel}" 일정이 취소되었습니다.`,
        link: `/rooms/${schedule.roomid}?tab=vote`,
      });

      alert("일정이 취소되었습니다.");
      navigate(-1);
    } catch (error) {
      alert("?띯뫁????쎈솭: " + error.message);
    }
  };

  const handleDismiss = async () => {
    if (!window.confirm("?????遺얇늺?癒?퐣 ????깆젟????ｋ쭔繹먮슣??")) return;

    try {
      await dismissConfirmedSchedule(schedule.id, currentUser?.id);
      alert("?????遺얇늺?癒?퐣 ??? 筌ｌ꼶???뤿???щ빍??");
      navigate("/home");
    } catch (error) {
      alert("??? 筌ｌ꼶????쎈솭: " + error.message);
    }
  };

  const handleToggleAbsence = async () => {
    const userId = currentUser?.id;

    if (!userId) {
      alert("嚥≪뮄??紐꾩뵠 ?袁⑹뒄??몃빍??");
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
            title: "일정 취소",
            message: `참석 가능한 멤버가 부족해 "${
              schedule.title || schedule.date
            }" 일정이 자동 취소되었습니다.`,
            link: `/rooms/${schedule.roomid}?tab=vote`,
          });

          alert("참석 가능한 멤버가 1명 이하라 일정이 자동 취소되었습니다.");
          navigate(-1);
        }
      }
    } catch (error) {
      alert("筌〓챷苑??怨밴묶 癰궰野???쎈솭: " + error.message);
    }
  };

  const handleCreateSchedule = async () => {
    if (!scheduleForm.date) {
      alert("??깆젟????낆젾??뤾쉭??");
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

      alert("??깆젟?????貫由??됰뮸??덈뼄.");
      navigate("/home");
    } catch (error) {
      alert("??깆젟 ??????쎈솭: " + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddLocation = async () => {
    if (!additionalPlace?.name) {
      alert("?곕떽????關?쇘몴??醫뤾문??뤾쉭??");
      return;
    }

    try {
      setSaving(true);

      const savedLocation = await addAdditionalConfirmedLocation(
        schedule.roomid,
        schedule.id,
        additionalPlace
      );

      setAdditionalLocations((locations) => [...locations, savedLocation]);
      setAdditionalPlace(null);
      setShowAdditionalPicker(false);

      alert("?곕떽? ?關?쇔첎? ???貫由??됰뮸??덈뼄.");
    } catch (error) {
      alert("?곕떽? ?關????????쎈솭: " + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAdditionalLocation = async (locationId) => {
    if (!window.confirm("???關?쇘몴?????醫됲돱??")) return;

    try {
      await deleteAdditionalConfirmedLocation(locationId);
      setAdditionalLocations((locations) =>
        locations.filter((location) => location.id !== locationId)
      );
    } catch (error) {
      alert("?關????????쎈솭: " + error.message);
    }
  };

  const openInScheduleTab = () => {
    sessionStorage.setItem(
      "confirmFromSchedule",
      JSON.stringify({
        id: schedule.id,
        title: schedule.title || "??깆젟",
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
  const additionalMapPlaces = additionalLocations
    .map(toMapPlace)
    .filter((place) => Number.isFinite(Number(place.lat)) && Number.isFinite(Number(place.lng)));

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
            places={additionalMapPlaces}
            selectedPlace={middlePlace}
            confirmedMeetingPlace={middlePlace}
            memberRoutePaths={memberRoutePaths}
            memberRouteResults={memberRouteResults}
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
            ??
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
              일정 투표 만들기
            </button>
          </div>

          <p style={{ fontWeight: "bold", fontSize: "14px", marginBottom: "6px" }}>
            일정 정보 입력
          </p>

          <input
            type="text"
            placeholder="??깆젟 ??뺛걠 (?醫뤾문)"
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
          ??
        </button>

        <h3 style={{ margin: 0, flex: 1, textAlign: "center", fontSize: "15px", color: "#1F2933" }}>?類ㅼ젟 ??깆젟 ?怨멸쉭</h3>

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
              ?類ㅼ젟 ??깆젟: {dateLabel}
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
            {isDateUndecided ? "?源낆쨯" : "??륁젟"}
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
            筌왖????깆젟??낅빍?? ?醫롮?夷?袁⑺뒄 ??륁젟?? ?븍뜃???몃빍??
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
            {/* ?냈??곷뮞 1: ??紐닸에???밴쉐 + ??紐?鈺곕똻??*/}
            {voteExists === true && (
              <button
                type="button"
                onClick={() =>
                  navigate(`/rooms/${schedule.roomid}/votes/${schedule.voteid}`)
                }
                style={shortcutButtonStyle}
              >
                ??紐닸에????툡揶쎛疫?
              </button>
            )}
            {/* ?냈??곷뮞 2: ??紐닸에???밴쉐 + ??紐??????*/}
            {voteExists === false && (
              <button
                type="button"
                onClick={openInScheduleTab}
                style={{ ...shortcutButtonStyle, color: "#f44", borderColor: "#ffcccc" }}
              >
                ??깆젟 ??肉???類λ릭疫?
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
                  ?維?
                </div>
                <span style={{ fontWeight: "700", fontSize: "14px", color: "#1F2933" }}>
                  筌〓챷肉?筌롢끇苡?{attendingCount}筌?
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
                ??
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
          /* 筌왖????깆젟: 揶쏆뮇??筌?꼶??遺용퓠??뺤춸 ????(癰귣챷??癒?쓺筌??怨몄뒠) */
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
                ??깆젟 ????
              </button>
              <p
                style={{
                  textAlign: "center",
                  fontSize: "11px",
                  color: "#aaa",
                  marginTop: "5px",
                }}
              >
                ??筌?꼶??遺용퓠??뺤춸 ?????몃빍??
              </p>
            </>
          )
        ) : (
          /* ?袁⑹삺/沃섎챶????깆젟: 疫꿸퀣??甕곌쑵???醫? */
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
                {isAbsent ? "참석으로 변경" : "일정 불참"}
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
                  ??깆젟 ????
                </button>
                <p
                  style={{
                    textAlign: "center",
                    fontSize: "11px",
                    color: "#aaa",
                    marginTop: "5px",
                  }}
                >
                  ?????롢늺 筌뤴뫀諭?筌롢끇苡???遺얇늺?癒?퐣 ???わ쭪臾먮빍??
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
                  ?類ㅼ젟 ??깆젟 ??륁젟
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
                  ??롳펷?ル굞??
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
                痍⑥냼
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveTiming}
                    disabled={saving}
                    style={{ ...primaryButtonStyle, marginBottom: 0 }}
                  >
                    {saving ? "?源낆쨯 餓?.." : "?源낆쨯"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 style={{ margin: "0 0 12px", fontSize: "15px", color: "#1F2933" }}>
                  {isDateUndecided
                    ? "??깆젟????堉멨칰??源낆쨯?醫됲돱??"
                    : "??깆젟????堉멨칰???륁젟?醫됲돱??"}
                </h3>

                <button
                  type="button"
                  onClick={() => {
                    setTimingDraft(scheduleTiming);
                    setIsEditingTiming(true);
                  }}
                  style={{ ...primaryButtonStyle, marginBottom: "8px" }}
                >
                  {isDateUndecided ? "筌욊낯???源낆쨯" : "筌욊낯????륁젟"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowEditChoice(false);
                    openInScheduleTab();
                  }}
                  style={{ ...secondaryButtonStyle, marginBottom: 0 }}
                >
                  ??깆젟 ??肉????용┛
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
                  筌띾슢沅??關???醫뤾문
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
                痍⑥냼
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    style={{ ...primaryButtonStyle, marginBottom: 0 }}
                  >
                    {saving ? "??륁젟 餓?.." : "??륁젟"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 style={{ margin: "0 0 12px", fontSize: "14px", color: "#1F2933" }}>
                  {isLocationUndecided
                    ? "筌띾슢沅??關?쇘몴???堉멨칰??源낆쨯?醫됲돱??"
                    : "筌띾슢沅??關?쇘몴???堉멨칰???륁젟?醫됲돱??"}
                </h3>

                <button
                  type="button"
                  onClick={() => setIsEditingLocationMap(true)}
                  style={{ ...primaryButtonStyle, marginBottom: "8px" }}
                >
                  筌왖?袁⑸퓠???關???醫뤾문??띾┛
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowLocationEditChoice(false);
                    navigate(`/rooms/${schedule.roomid}?tab=location`);
                  }}
                  style={{ ...secondaryButtonStyle, marginBottom: 0 }}
                >
                  ?袁⑺뒄 ??肉????용┛
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
  padding: "5px 8px",
  border: "1px solid #d8d8ff",
  borderRadius: "6px",
  backgroundColor: "#f9f9ff",
  color: "#5c58d8",
  cursor: "pointer",
  fontSize: "12px",
};

function getApiBaseUrl() {
  return (process.env.REACT_APP_API_BASE_URL || "http://localhost:5000/api").replace(/\/$/, "");
}

async function readRouteResponseBody(response) {
  const contentType = response.headers.get("content-type") || "";

  try {
    if (contentType.includes("application/json")) {
      return await response.json();
    }

    return await response.text();
  } catch (error) {
    return {
      message: "?臾먮뼗 癰귣챶揆????? 筌륁궢六??щ빍??",
      error: error.message,
    };
  }
}

function normalizeTransportMode(mode) {
  if (mode === "car" || mode === "자동차") return "car";
  if (mode === "transit" || mode === "대중교통") return "transit";
  return mode || "";
}

function toMapPlace(place = {}) {
  return {
    ...place,
    id: place.id || place.placeid || place.kakaoPlaceId || place.placename || place.name,
    name: place.name || place.placename || place.place_name || "Place",
    address: place.address || place.placeaddress || place.locationaddress || "",
    lat: Number(place.lat ?? place.latitude ?? place.placelat ?? place.locationlat),
    lng: Number(place.lng ?? place.longitude ?? place.placelng ?? place.locationlng),
    kakaoMapUrl: place.kakaoMapUrl || place.kakaomapurl || "",
  };
}

function isValidMapPoint(lat, lng) {
  return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
}

export default ConfirmedScheduleDetailPage;
