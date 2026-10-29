import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { FaListUl, FaCalendarAlt, FaMapMarkerAlt, FaRegClock, FaChevronRight, FaChevronDown } from "react-icons/fa";
import { supabase } from "../../lib/supabaseClient";
import { createVote } from "../../api/voteApi";
import { sendVoteNotification } from "../notification/VoteNotification";
import LocationPicker from "../../components/map/LocationPicker";
import CourseVoteComposer from "../../components/CourseVoteComposer";
import { getMemberAvailabilities, getScheduleCandidates } from "../../api/scheduleApi";
import { createCourseWithStops } from "../../api/courseApi";
import { getTopAvailableTimes, sortAvailableTimes, getTopConsecutiveDays } from "../../utils/scheduleUtils";
import { buildCourseVoteDbRows, getCourseVoteDefaults, normalizeCourseVoteSelection, isCourseVoteType } from "../../utils/courseVoteUtils";

const VOTE_TYPE_OPTIONS = [
  { value: "general", label: "일반 투표", icon: FaListUl, description: "메뉴/준비물 등 자유 선택" },
  { value: "schedule", label: "일정 확정", icon: FaCalendarAlt, description: "일정 후보 선택" },
  { value: "location", label: "장소 확정", icon: FaMapMarkerAlt, description: "장소 후보 선택" },
  { value: "course", label: "코스 투표", icon: FaListUl, description: "추천받거나 직접 만든 코스 선택" },
];

function VoteCreatePage() {
  const { roomid } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const selectedSchedules = location.state?.selectedSchedules || [];
  const selectedPlaces = location.state?.selectedPlaces || [];
  const selectedCourses = useMemo(() => location.state?.selectedCourses || [], [location.state?.selectedCourses]);
  const initialVoteType = location.state?.voteType || (selectedCourses.length > 0 ? "course" : "text");

  const initialVotePurpose =
    location.state?.votePurpose ||
    location.state?.votetype ||
    (selectedCourses.length > 0 ? "course" : (location.state?.voteType === "date" ? "schedule" : "general"));

  const returnTab = location.state?.returnTab || 'vote';
  const locationKind = location.state?.locationKind || null;
  const fromScheduleId = location.state?.fromScheduleId || (() => {
    try {
      const s = sessionStorage.getItem("confirmFromSchedule");
      return s ? JSON.parse(s).id : null;
    } catch { return null; }
  })();
  const [scheduleId, setScheduleId] = useState(location.state?.scheduleId || location.state?.courseVoteDraft?.scheduleId || fromScheduleId || null);
  const [courseSchedules, setCourseSchedules] = useState([]);
  const [courseSchedulesLoading, setCourseSchedulesLoading] = useState(false);
  const [courseScheduleError, setCourseScheduleError] = useState('');
  const [courseEditing, setCourseEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const scheduleTitle = location.state?.scheduleTitle || '';

  const [currentUser, setCurrentUser] = useState(null);
  const [showAvailModal, setShowAvailModal] = useState(false);
  const [availabilities, setAvailabilities] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [selectedAvailSlots, setSelectedAvailSlots] = useState([]);
  const [availMode, setAvailMode] = useState("당일");
  const [availNDays, setAvailNDays] = useState(2);
  const [selectedMultiDays, setSelectedMultiDays] = useState([]);
  const [nickname, setNickname] = useState("");
  const [roomName, setRoomName] = useState("");

  useEffect(() => {
    const fetchUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        setCurrentUser(user);
        const { data: profile } = await supabase
          .from("profiles")
          .select("nickname")
          .eq("id", user.id)
          .maybeSingle();
        setNickname(profile?.nickname || user.email);
      } else {
        const guestId = localStorage.getItem("guest_id");
        const guestNick = localStorage.getItem("guest_nickname") || "게스트";
        if (guestId) {
          setCurrentUser({ id: guestId, type: "guest" });
          setNickname(guestNick);
        }
      }
    };

    const fetchRoomName = async () => {
      if (!roomid) return;

      const { data, error } = await supabase
        .from("rooms")
        .select("roomname")
        .eq("id", Number(roomid))
        .single();

      if (error) {
        console.warn("방 이름 조회 실패:", error);
        setRoomName("참여 중인 방");
        return;
      }

      setRoomName(data?.roomname || "참여 중인 방");
    };

    fetchUser();
    fetchRoomName();
  }, [roomid]);

  const [title, setTitle] = useState(location.state?.courseVoteDraft?.title ?? location.state?.title ?? "");

  const [options, setOptions] = useState(() => {
    if (location.state?.courseVoteDraft) {
      return [...(location.state.courseVoteDraft.options || []), ...normalizeCourseVoteSelection(selectedCourses)];
    }
    if (selectedCourses.length > 0) {
      return normalizeCourseVoteSelection(selectedCourses);
    }

    if (selectedPlaces.length > 0) {
      return selectedPlaces.map((place) => ({
        optiontype: "place",
        optiontext: place.name || "",
        optiondate: "",
        starttime: "",
        endtime: "",
        availablecount: 0,
        placename: place.name || "",
        placeaddress: place.address || "",
        placelat: place.lat ?? "",
        placelng: place.lng ?? "",
        kakaomapurl: place.kakaoMapUrl || place.kakaomapurl || "",
        travelresults: place.travelResults || place.travelresults || null,
      }));
    }

    if (selectedSchedules.length > 0) {
      return selectedSchedules.map((schedule) => ({
        optiontype: "date",
        optiontext: "",
        optiondate: schedule.date,
        starttime: schedule.starttime,
        endtime: schedule.endtime,
        availablecount: schedule.availableCount || 0,
        placename: "",
        placeaddress: "",
        placelat: "",
        placelng: "",
        kakaomapurl: "",
      }));
    }

    return initialVotePurpose === 'course' ? [] : [makeEmptyOption(initialVoteType)];
  });

  const currentOptionType = options[0]?.optiontype || "text";

  const [votetype, setVotetype] = useState(initialVotePurpose);

  useEffect(() => {
    if (votetype === "course") {
      setIsmultiple(false);
      setIsanonymous(false);
      setAllowaddoption(false);
      setOptions((prev) => {
        if (prev.length > 0 && prev.every((option) => option.optiontype === "course")) {
          return prev;
        }
        if (!prev.length) return prev;
        return selectedCourses.length > 0 ? normalizeCourseVoteSelection(selectedCourses) : [];
      });
    }
  }, [selectedCourses, votetype]);

  useEffect(() => {
    if (votetype !== 'course') return;
    let active = true;
    setCourseSchedulesLoading(true);
    setCourseScheduleError('');
    supabase.from('confirmed_schedules').select('*').eq('roomid', Number(roomid)).order('date', { ascending: false })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) { setCourseScheduleError('확정 일정을 불러오지 못했습니다. 다시 시도해 주세요.'); return; }
        setCourseSchedules(data || []);
      }).catch(() => { if (active) setCourseScheduleError('확정 일정을 불러오지 못했습니다. 다시 시도해 주세요.'); })
      .finally(() => { if (active) setCourseSchedulesLoading(false); });
    return () => { active = false; };
  }, [votetype, roomid]);

  const courseSchedule = courseSchedules.find(item => String(item.id) === String(scheduleId)) || null;

  const [ismultiple, setIsmultiple] = useState(false);
  const [isanonymous, setIsanonymous] = useState(false);
  const [allowaddoption, setAllowaddoption] = useState(false);
  const [endtimeenabled, setEndtimeenabled] = useState(location.state?.courseVoteDraft?.endtimeenabled || false);
  const [endtime, setEndtime] = useState(location.state?.courseVoteDraft?.endtime || "");
  const [reminderenabled, setReminderenabled] = useState(location.state?.courseVoteDraft?.reminderenabled || false);
  const [openPlacePickerIndex, setOpenPlacePickerIndex] = useState(null);

  const handleVotetypeChange = (newType) => {
    setVotetype(newType);

    if (newType === "course") {
      setOptions(
        selectedCourses.length > 0
          ? normalizeCourseVoteSelection(selectedCourses)
          : []
      );
      return;
    }

    if (newType === "schedule") {
      setOptions((prev) =>
        prev.map((option) => ({
          ...makeEmptyOption("date"),
          optiondate: option.optiondate || "",
          starttime: option.starttime || "",
          endtime: option.endtime || "",
          availablecount: option.availablecount || 0,
        }))
      );
      return;
    }

    if (newType === "location") {
      setOptions((prev) =>
        prev.map((option) => ({
          ...makeEmptyOption("place"),
          optiontext: option.placename || option.optiontext || "",
          placename: option.placename || option.optiontext || "",
          placeaddress: option.placeaddress || "",
          placelat: option.placelat || "",
          placelng: option.placelng || "",
          kakaomapurl: option.kakaomapurl || "",
          travelresults: option.travelresults || null,
        }))
      );
      return;
    }

    setOptions((prev) =>
      prev.map((option) => ({
        ...makeEmptyOption("text"),
        optiontext: option.optiontext || option.placename || "",
      }))
    );
  };

  const handleChangeOption = (index, field, value) => {
    const newOptions = [...options];

    newOptions[index][field] = value;

    if (field === "placename") {
      newOptions[index].optiontext = value;
    }

    if (field === "optiontext" && newOptions[index].optiontype === "place") {
      newOptions[index].placename = value;
    }

    setOptions(newOptions);
  };

  const handleSelectPlaceOption = (index, name, address, place = {}) => {
    const newOptions = [...options];

    newOptions[index] = {
      ...newOptions[index],
      optiontext: name || "",
      placename: name || "",
      placeaddress: address || "",
      placelat: place.lat ?? "",
      placelng: place.lng ?? "",
      kakaomapurl: place.kakaoMapUrl || place.kakaomapurl || "",
      travelresults: null,
    };

    setOptions(newOptions);
    setOpenPlacePickerIndex(null);
  };

  const handleLoadAvailabilities = async () => {
    try {
      const [avail, cands] = await Promise.all([
        getMemberAvailabilities(roomid),
        getScheduleCandidates(roomid),
      ]);
      setAvailabilities(avail);
      setCandidates(cands);
      setSelectedAvailSlots([]);
      setSelectedMultiDays([]);
      setAvailMode("당일");
      setAvailNDays(2);
      setShowAvailModal(true);
    } catch {
      alert("가능 시간 불러오기 실패");
    }
  };

  const handleAddAvailSlotsAsOptions = () => {
    let newOpts = [];

    if (availMode === "당일") {
      newOpts = selectedAvailSlots.map((slot) => ({
        optiontype: "date",
        optiontext: "",
        optiondate: slot.date,
        starttime: slot.starttime,
        endtime: slot.endtime,
        isallday: false,
        availablecount: slot.availableCount || 0,
        placename: "", placeaddress: "", placelat: "", placelng: "", kakaomapurl: "",
      }));
    } else {
      newOpts = selectedMultiDays.flatMap((r) =>
        r.dates.map((date) => ({
          optiontype: "date",
          optiontext: "",
          optiondate: date,
          starttime: null,
          endtime: null,
          isallday: true,
          availablecount: r.availableCount || 0,
          placename: "", placeaddress: "", placelat: "", placelng: "", kakaomapurl: "",
        }))
      );
    }

    const existingKeys = new Set(
      options.filter((o) => o.optiondate).map((o) => `${o.optiondate}|${o.starttime || ""}`)
    );
    const filtered = newOpts.filter(
      (o) => !existingKeys.has(`${o.optiondate}|${o.starttime || ""}`)
    );
    setOptions((prev) => {
      const base = prev.filter((o) => o.optiondate || o.optiontext);
      return [...base, ...filtered];
    });
    setShowAvailModal(false);
  };

  const handleAddOption = () => {
    const currentType =
      votetype === "schedule"
        ? "date"
        : isLocationVoteType(votetype)
        ? "place"
        : options[0]?.optiontype || "text";
    setOptions([...options, makeEmptyOption(currentType)]);
  };

  const handleDeleteOption = (index) => {
    setOptions(options.filter((_, i) => i !== index));
  };

  const handleSubmitVote = async () => {
    if (!currentUser) {
      alert("로그인이 필요합니다.");
      return;
    }

    if (!roomid) {
      alert("방 정보를 찾을 수 없습니다.");
      return;
    }

    if (title.trim() === "") {
      alert("투표 제목을 입력하세요.");
      return;
    }

    let preparedOptions = options;

    if (votetype === "course") {
      try {
        if (courseEditing) { alert('편집 중인 코스를 후보에 반영하거나 편집을 취소해 주세요.'); return; }
        if (!courseSchedule || !options.length || options.some(option => !option.stops?.length)) {
          alert('확정 일정을 선택하고 장소가 있는 코스를 1개 이상 추가해 주세요.'); return;
        }
        if (new Set(options.map(option => option.course_name?.trim())).size !== options.length) {
          alert('후보마다 다른 코스 이름을 입력해 주세요.'); return;
        }
        const resolvedScheduleId = Number(scheduleId || fromScheduleId || null);
        if (!resolvedScheduleId) {
          alert("추천 코스 투표는 연결된 일정이 필요합니다.");
          return;
        }

        const persistedCourses = await Promise.all(
          options.map((option) => ({ ...option, id: option.courseid })).map(async (course) => {
            const normalized = {
              id: course?.id ?? course?.course_id ?? course?.courseId,
              name: course?.name ?? course?.course_name ?? course?.courseName ?? course?.optiontext,
              summary: course?.summary ?? course?.course_summary ?? "",
              totalDurationMin: course?.totalDurationMin ?? course?.total_duration_min ?? course?.totalDuration ?? 0,
              estimatedTravelTimeMin: course?.estimatedTravelTimeMin ?? course?.estimated_travel_time_min ?? course?.travel_time_min ?? 0,
              estimatedCostPerPerson: course?.estimatedCostPerPerson ?? course?.estimated_cost_per_person ?? course?.estimated_cost ?? null,
              stops: Array.isArray(course?.stops) ? course.stops : [],
            };

            const savedCourse = await createCourseWithStops({
              roomId: Number(roomid),
              scheduleId: resolvedScheduleId,
              courseName: normalized.name,
              recommendationCondition: normalized.summary,
              estimatedTotalDurationMin: normalized.totalDurationMin,
              estimatedTravelTimeMin: normalized.estimatedTravelTimeMin,
              estimatedCostPerPerson: normalized.estimatedCostPerPerson,
              stops: buildCourseVoteDbRows(normalized).stops,
            });

            return {
              ...normalized,
              id: savedCourse.id,
              course_id: savedCourse.id,
              courseId: savedCourse.id,
              courseid: savedCourse.id,
              stops: savedCourse.stops || normalized.stops,
            };
          })
        );

        preparedOptions = normalizeCourseVoteSelection(persistedCourses);
        setOptions(preparedOptions);
      } catch (error) {
        console.error("코스 저장 실패:", error);
        alert(error.message || "코스 저장에 실패했습니다.");
        return;
      }
    }

    if (isLocationVoteType(votetype)) {
      if (locationKind && !scheduleId) {
        alert("장소 투표를 저장할 대상 일정이 없습니다.");
        return;
      }

      const invalidPlaceOption = preparedOptions.some((option) => {
        if (option.optiontype !== "place") return false;

        return (
          !String(option.placename || option.optiontext || "").trim() ||
          !hasValue(option.placelat) ||
          !hasValue(option.placelng)
        );
      });

      if (invalidPlaceOption) {
        alert("투표 항목의 장소를 카카오맵에서 선택해주세요.");
        return;
      }
    }

    const validOptions = preparedOptions.filter((option) => {
      if (option.optiontype === "text") {
        return String(option.optiontext || "").trim() !== "";
      }

      if (option.optiontype === "course") {
        return String(option.optiontext || option.course_name || "").trim() !== "" || Boolean(option.courseid || option.id);
      }

      if (option.optiontype === "place") {
        return (
          String(option.placename || option.optiontext || "").trim() !== "" &&
          option.placelat !== "" &&
          option.placelng !== ""
        );
      }

      if (option.optiontype === "date") {
        return option.optiondate !== "" && (option.isallday || option.starttime !== "");
      }

      return false;
    });

    if (validOptions.length === 0) {
      alert("투표 항목을 1개 이상 입력하세요.");
      return;
    }

    let createdVoteId = null;

    try {
      const courseDefaults = getCourseVoteDefaults();
      const result = await createVote({
        roomid: Number(roomid),
        title: title.trim() || `${roomName || "모임"} 추천 코스 투표`,
        userid: currentUser.id,
        nickname,
        options: validOptions,
        ismultiple: votetype === "course" ? courseDefaults.ismultiple : ismultiple,
        isanonymous: votetype === "course" ? courseDefaults.isanonymous : isanonymous,
        allowaddoption: votetype === "course" ? courseDefaults.allowaddoption : allowaddoption,
        endtime: endtimeenabled && endtime ? endtime : null,
        endtimeenabled,
        reminderenabled,
        votetype,
        locationkind: votetype === 'location' ? locationKind : null,
        scheduleid: isLocationVoteType(votetype)
          ? scheduleId
          : (votetype === "course" ? (scheduleId || fromScheduleId || null) : (fromScheduleId || null)),
      });

      createdVoteId = result?.id || result?.data?.id || null;
    } catch (error) {
      console.error("투표 생성 자체 실패:", error);
      alert(error.message || "투표 생성 실패");
      return;
    }

    // 기존 확정일정에서 진입한 경우 → 확정일정의 voteid를 새 투표로 연결
    if (fromScheduleId && createdVoteId && votetype !== 'course') {
      await supabase
        .from("confirmed_schedules")
        .update({ voteid: createdVoteId })
        .eq("id", fromScheduleId);
      sessionStorage.removeItem("confirmFromSchedule");
    }

    await sendVoteNotification({
      roomid,
      title,
      createdVoteId,
      currentUser,
      roomName,
      endtimeenabled,
      reminderenabled,
      endtime,
      votetype,
    });

    alert("투표가 성공적으로 생성되었습니다.");
    navigate(`/rooms/${roomid}?tab=vote`);
  };

  const handleSubmit = async () => {
    if (submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    try { await handleSubmitVote(); }
    catch (error) { alert(error.message || '투표 생성 중 오류가 발생했습니다.'); }
    finally { submitLock.current = false; setSubmitting(false); }
  };

  const availTopTimes = sortAvailableTimes(getTopAvailableTimes(availabilities), "count");
  const availConsecutive = getTopConsecutiveDays(availabilities, candidates, availNDays);

  const makeAvailKey = (t) => `${t.date}_${t.starttime}_${t.endtime}`;
  const makeMultiKey = (r) => r.dates.join("_");

  const formatDate = (dateStr) => {
    if (!dateStr) return "";
    const d = new Date(dateStr + "T00:00:00");
    const days = ["일", "월", "화", "수", "목", "금", "토"];
    return `${dateStr} (${days[d.getDay()]})`;
  };

  const availSelectedCount = availMode === "당일" ? selectedAvailSlots.length : selectedMultiDays.length;

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#fff" }}>
      {showAvailModal && (
        <>
          <div
            onClick={() => setShowAvailModal(false)}
            style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", zIndex: 300 }}
          />
          <div
            style={{
              position: "fixed",
              bottom: 0, left: 0, right: 0,
              backgroundColor: "#fff",
              borderRadius: "20px 20px 0 0",
              padding: "0 0 80px",
              zIndex: 301,
              maxHeight: "80vh",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* 헤더 */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 20px 0" }}>
              <span style={{ fontSize: "16px", fontWeight: "bold" }}>가능 시간 선택</span>
              <button onClick={() => setShowAvailModal(false)} style={{ border: "none", background: "none", fontSize: "20px", cursor: "pointer", color: "#aaa" }}>✕</button>
            </div>

            {/* 당일 / 일별 탭 */}
            <div style={{ display: "flex", borderBottom: "1px solid #eee", margin: "12px 0 0" }}>
              {["당일", "일별"].map((tab) => (
                <button
                  key={tab}
                  onClick={() => { setAvailMode(tab); setSelectedAvailSlots([]); setSelectedMultiDays([]); }}
                  style={{
                    flex: 1, padding: "10px", border: "none",
                    borderBottom: availMode === tab ? "2px solid #7c79ff" : "2px solid transparent",
                    backgroundColor: "transparent",
                    color: availMode === tab ? "#7c79ff" : "#888",
                    fontWeight: availMode === tab ? "bold" : "normal",
                    fontSize: "15px", cursor: "pointer",
                  }}
                >{tab}</button>
              ))}
            </div>

            {/* 일별 N일 선택 */}
            {availMode === "일별" && (
              <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 20px 0" }}>
                <span style={{ fontSize: "14px", fontWeight: "600", color: "#333" }}>며칠 연속?</span>
                <input
                  type="number" min="2" max="30" value={availNDays}
                  onChange={(e) => { setAvailNDays(Math.max(2, Number(e.target.value))); setSelectedMultiDays([]); }}
                  style={{ width: "60px", padding: "6px 10px", fontSize: "15px", border: "1px solid #ddd", borderRadius: "8px", textAlign: "center" }}
                />
                <span style={{ fontSize: "14px", color: "#555" }}>일</span>
              </div>
            )}

            {/* 리스트 */}
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px 0" }}>
              {availMode === "당일" && availTopTimes.length > 0 && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
                  <button
                    type="button"
                    onClick={() =>
                      selectedAvailSlots.length === availTopTimes.length
                        ? setSelectedAvailSlots([])
                        : setSelectedAvailSlots([...availTopTimes])
                    }
                    style={{ fontSize: "13px", color: "#7c79ff", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                  >
                    {selectedAvailSlots.length === availTopTimes.length ? "모두 해제" : "모두 선택"}
                  </button>
                </div>
              )}
              {availMode === "당일" && (
                availTopTimes.length === 0
                  ? <p style={{ color: "#aaa", textAlign: "center", marginTop: "30px" }}>가능한 시간이 없습니다.</p>
                  : availTopTimes.map((time, index) => {
                    const key = makeAvailKey(time);
                    const checked = selectedAvailSlots.some((s) => makeAvailKey(s) === key);
                    const hours = Math.floor(time.duration / 60);
                    const mins = time.duration % 60;
                    return (
                      <label key={index} style={{ display: "flex", alignItems: "flex-start", gap: "12px", border: `1px solid ${checked ? "#7c79ff" : "#eee"}`, borderRadius: "12px", padding: "14px", marginBottom: "10px", backgroundColor: checked ? "#f5f5ff" : "#fff", cursor: "pointer" }}>
                        <input type="checkbox" checked={checked} onChange={() => setSelectedAvailSlots((prev) => checked ? prev.filter((s) => makeAvailKey(s) !== key) : [...prev, time])} style={{ marginTop: "3px", accentColor: "#7c79ff" }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontWeight: "bold", fontSize: "15px" }}>{index + 1}순위</span>
                            <span style={{ fontSize: "12px", backgroundColor: "#7c79ff", color: "#fff", borderRadius: "10px", padding: "2px 8px" }}>{time.availableCount}명 가능</span>
                          </div>
                          <p style={{ margin: "6px 0 2px", fontSize: "14px", color: "#333" }}>{formatDate(time.date)}</p>
                          <p style={{ margin: 0, fontSize: "13px", color: "#666" }}>
                            {time.starttime} ~ {time.endtime}
                            <span style={{ marginLeft: "8px", color: "#7c79ff" }}>({hours > 0 ? `${hours}시간 ` : ""}{mins > 0 ? `${mins}분` : ""})</span>
                          </p>
                        </div>
                      </label>
                    );
                  })
              )}
              {availMode === "일별" && availConsecutive.length > 0 && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
                  <button
                    type="button"
                    onClick={() =>
                      selectedMultiDays.length === availConsecutive.length
                        ? setSelectedMultiDays([])
                        : setSelectedMultiDays([...availConsecutive])
                    }
                    style={{ fontSize: "13px", color: "#7c79ff", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                  >
                    {selectedMultiDays.length === availConsecutive.length ? "모두 해제" : "모두 선택"}
                  </button>
                </div>
              )}
              {availMode === "일별" && (
                availConsecutive.length === 0
                  ? <p style={{ color: "#aaa", textAlign: "center", marginTop: "30px" }}>{availNDays}일 연속 가능한 조합이 없습니다.</p>
                  : availConsecutive.map((result, index) => {
                    const key = makeMultiKey(result);
                    const checked = selectedMultiDays.some((s) => makeMultiKey(s) === key);
                    return (
                      <label key={index} style={{ display: "flex", alignItems: "flex-start", gap: "12px", border: `1px solid ${checked ? "#7c79ff" : "#eee"}`, borderRadius: "12px", padding: "14px", marginBottom: "10px", backgroundColor: checked ? "#f5f5ff" : "#fff", cursor: "pointer" }}>
                        <input type="checkbox" checked={checked} onChange={() => setSelectedMultiDays((prev) => checked ? prev.filter((s) => makeMultiKey(s) !== key) : [...prev, result])} style={{ marginTop: "3px", accentColor: "#7c79ff" }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontWeight: "bold", fontSize: "15px" }}>{index + 1}순위</span>
                            <span style={{ fontSize: "12px", backgroundColor: "#7c79ff", color: "#fff", borderRadius: "10px", padding: "2px 8px" }}>{result.availableCount}명 가능</span>
                          </div>
                          <p style={{ margin: "6px 0 4px", fontSize: "14px", color: "#333" }}>{formatDate(result.startDate)} ~ {formatDate(result.endDate)}</p>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                            {result.dates.map((d) => (
                              <span key={d} style={{ fontSize: "12px", backgroundColor: "#f0f0ff", color: "#7c79ff", borderRadius: "6px", padding: "2px 7px" }}>{d}</span>
                            ))}
                          </div>
                        </div>
                      </label>
                    );
                  })
              )}
            </div>

            {/* 추가 버튼 */}
            <div style={{ padding: "12px 20px 0" }}>
              <button
                onClick={handleAddAvailSlotsAsOptions}
                disabled={availSelectedCount === 0}
                style={{
                  width: "100%", padding: "13px",
                  backgroundColor: availSelectedCount > 0 ? "#7c79ff" : "#eee",
                  color: availSelectedCount > 0 ? "#fff" : "#aaa",
                  border: "none", borderRadius: "10px", fontSize: "15px", fontWeight: "bold",
                  cursor: availSelectedCount > 0 ? "pointer" : "default",
                }}
              >
                {availSelectedCount > 0 ? `${availSelectedCount}개 투표 항목으로 추가` : "선택 후 추가"}
              </button>
            </div>
          </div>
        </>
      )}

      <div
        style={{
          height: "56px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          borderBottom: "1px solid #eee",
        }}
      >
        <button
          onClick={() => navigate(`/rooms/${roomid}?tab=${returnTab}`)}
          style={{
            border: "none",
            background: "none",
            fontSize: "24px",
            cursor: "pointer",
          }}
        >
          ←
        </button>

        <h3 style={{ margin: 0 }}>투표 작성하기</h3>

        <button
          onClick={handleSubmit}
          disabled={submitting || (votetype === 'course' && (courseEditing || courseSchedulesLoading))}
          style={{
            border: "none",
            background: "none",
            fontSize: "16px",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          {submitting ? '저장 중…' : '완료'}
        </button>
      </div>

      <div style={{ padding: "20px" }}>
        {isLocationVoteType(votetype) && locationKind && scheduleId && (
          <p
            style={{
              padding: "10px",
              border: "1px solid #d8d8ff",
              borderRadius: "8px",
              backgroundColor: "#f8f8ff",
              fontSize: "14px",
              color: "#555",
            }}
          >
            대상 일정: <strong>{scheduleTitle || "선택한 일정"}</strong>
            <br />
            확정된 장소는 이 일정에 자동 저장됩니다.
          </p>
        )}

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="투표 제목"
          style={{
            width: "100%",
            height: "52px",
            padding: "0 12px",
            fontSize: "18px",
            border: "1px solid #ddd",
            marginBottom: "16px",
            boxSizing: "border-box",
          }}
        />

        <p style={{ margin: "0 0 10px", fontSize: "15px", fontWeight: "700", color: "#1F2933" }}>
          투표 종류
        </p>

        <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
          {VOTE_TYPE_OPTIONS.map((type) => {
            const selected = isSelectedVoteType(votetype, type.value);
            const Icon = type.icon;

            return (
              <button
                key={type.value}
                type="button"
                onClick={() => handleVotetypeChange(type.value)}
                style={{
                  position: "relative",
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "6px",
                  padding: "16px 6px 12px",
                  borderRadius: "14px",
                  border: selected ? "2px solid #7c79ff" : "1px solid #E5E7EB",
                  backgroundColor: selected ? "#F5F4FF" : "#fff",
                  cursor: "pointer",
                }}
              >
                {selected && (
                  <span
                    style={{
                      position: "absolute",
                      top: "8px",
                      right: "8px",
                      width: "18px",
                      height: "18px",
                      borderRadius: "50%",
                      backgroundColor: "#7c79ff",
                      color: "#fff",
                      fontSize: "11px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    ✓
                  </span>
                )}

                <div
                  style={{
                    width: "40px",
                    height: "40px",
                    borderRadius: "50%",
                    backgroundColor: "#F0EEFF",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon size={18} color="#7c79ff" />
                </div>

                <span style={{ fontSize: "14px", fontWeight: "700", color: "#1F2933" }}>
                  {type.label}
                </span>

                <span style={{ fontSize: "11px", color: "#9CA3AF", textAlign: "center", lineHeight: 1.3 }}>
                  {type.description}
                </span>
              </button>
            );
          })}
        </div>

        {votetype === "general" && (
          <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
            <button
              type="button"
              onClick={() => {
                const updated = options.map((option) => ({
                  ...makeEmptyOption("text"),
                  optiontext: option.optiontext || option.placename || "",
                }));

                setOptions(updated);
              }}
              style={{
                padding: "10px 22px",
                borderRadius: "24px",
                cursor: "pointer",
                border:
                  currentOptionType === "text"
                    ? "2px solid #333"
                    : "1px solid #ddd",
                fontWeight: currentOptionType === "text" ? "bold" : "normal",
              }}
            >
              텍스트
            </button>

            <button
              type="button"
              onClick={() => {
                const updated = options.map((option) => ({
                  ...makeEmptyOption("date"),
                  optiondate: option.optiondate || "",
                  starttime: option.starttime || "",
                  endtime: option.endtime || "",
                }));

                setOptions(updated);
              }}
              style={{
                padding: "10px 22px",
                borderRadius: "24px",
                cursor: "pointer",
                border:
                  currentOptionType === "date"
                    ? "2px solid #333"
                    : "1px solid #ddd",
                fontWeight: currentOptionType === "date" ? "bold" : "normal",
              }}
            >
              날짜
            </button>
          </div>
        )}

        {selectedPlaces.length > 0 && isLocationVoteType(votetype) && (
          <p
            style={{
              padding: "10px",
              border: "1px solid #eee",
              borderRadius: "8px",
              backgroundColor: "#fafafa",
              fontSize: "14px",
              color: "#555",
              marginBottom: "16px",
            }}
          >
            장소 탭에서 선택한 중간장소 후보들이 투표 항목으로 추가되었습니다.
          </p>
        )}

        {selectedCourses.length > 0 && isCourseVoteType(votetype) && (
          <p
            style={{
              padding: "10px",
              border: "1px solid #d8d8ff",
              borderRadius: "8px",
              backgroundColor: "#f8f8ff",
              fontSize: "14px",
              color: "#555",
              marginBottom: "16px",
            }}
          >
            추천 코스가 후보에 추가되었습니다. 직접 만든 코스도 함께 추가하거나 후보를 수정할 수 있습니다.
          </p>
        )}

        {votetype === 'course' && <CourseVoteComposer
          schedules={courseSchedules} schedule={courseSchedule} scheduleId={scheduleId}
          loading={courseSchedulesLoading} error={courseScheduleError} options={options}
          onEditingChange={setCourseEditing} onChange={setOptions}
          onScheduleChange={id => { setScheduleId(id ? Number(id) : null); setOptions([]); }}
          onRecommend={() => navigate(`/rooms/${roomid}/course-recommendation`, {
            state: { schedule: courseSchedule, roomId: Number(roomid),
              courseVoteDraft: { title, options, scheduleId, endtimeenabled, endtime, reminderenabled } },
          })}
        />}

        {votetype !== 'course' && options.map((option, index) => (
          <div key={index} style={{ marginBottom: "10px" }}>
              {option.optiontype === "text" && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    border: "1px solid #E5E7EB",
                    borderRadius: "14px",
                    padding: "4px 14px",
                  }}
                >
                  <input
                    value={option.optiontext}
                    onChange={(e) =>
                      handleChangeOption(index, "optiontext", e.target.value)
                    }
                    placeholder="텍스트 입력"
                    style={{ ...plainRowInputStyle, border: "none", borderBottom: "none" }}
                  />

                  <button
                    type="button"
                    onClick={() => handleDeleteOption(index)}
                    style={{
                      border: "none",
                      background: "none",
                      fontSize: "18px",
                      cursor: "pointer",
                      color: "#9CA3AF",
                      padding: 0,
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </div>
              )}

              {option.optiontype === "date" && (
                <div
                  style={{
                    position: "relative",
                    border: "1px solid #E5E7EB",
                    borderRadius: "14px",
                    padding: "14px",
                    backgroundColor: "#fff",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => handleDeleteOption(index)}
                    style={{
                      position: "absolute",
                      top: "10px",
                      right: "10px",
                      border: "none",
                      background: "none",
                      fontSize: "18px",
                      cursor: "pointer",
                      color: "#9CA3AF",
                      padding: 0,
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>

                  <div style={{ display: "flex", alignItems: "center", gap: "8px", paddingRight: "24px" }}>
                    <input
                      type="date"
                      value={option.optiondate}
                      onChange={(e) =>
                        handleChangeOption(index, "optiondate", e.target.value)
                      }
                      style={{
                        flex: 1,
                        border: "none",
                        outline: "none",
                        fontSize: "15px",
                        color: option.optiondate ? "#1F2933" : "#9CA3AF",
                        padding: 0,
                        backgroundColor: "transparent",
                      }}
                    />

                    <button
                      type="button"
                      onClick={() => {
                        const newOptions = [...options];
                        const isAllDay = !newOptions[index].isallday;
                        newOptions[index].isallday = isAllDay;
                        if (isAllDay) {
                          newOptions[index].starttime = "";
                          newOptions[index].endtime = "";
                        }
                        setOptions(newOptions);
                      }}
                      style={{
                        padding: "4px 10px",
                        borderRadius: "20px",
                        border: "none",
                        cursor: "pointer",
                        backgroundColor: option.isallday ? "#7c79ff" : "#F0EEFF",
                        color: option.isallday ? "#fff" : "#7c79ff",
                        fontWeight: "600",
                        fontSize: "12px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      하루종일
                    </button>
                  </div>

                  {!option.isallday && (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "10px" }}>
                        <div
                          style={{
                            flex: 1,
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            border: "1px solid #E5E7EB",
                            borderRadius: "10px",
                            padding: "8px 10px",
                          }}
                        >
                          <FaRegClock size={13} color="#9CA3AF" />
                          <input
                            type="time"
                            value={option.starttime}
                            onChange={(e) =>
                              handleChangeOption(index, "starttime", e.target.value)
                            }
                            style={{
                              flex: 1,
                              border: "none",
                              outline: "none",
                              fontSize: "14px",
                              backgroundColor: "transparent",
                              color: option.starttime ? "#1F2933" : "#9CA3AF",
                            }}
                          />
                        </div>

                        <span style={{ color: "#9CA3AF", fontSize: "13px" }}>~</span>

                        <div
                          style={{
                            flex: 1,
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            border: "1px solid #E5E7EB",
                            borderRadius: "10px",
                            padding: "8px 10px",
                          }}
                        >
                          <FaRegClock size={13} color="#9CA3AF" />
                          <input
                            type="time"
                            value={option.endtime}
                            onChange={(e) =>
                              handleChangeOption(index, "endtime", e.target.value)
                            }
                            style={{
                              flex: 1,
                              border: "none",
                              outline: "none",
                              fontSize: "14px",
                              backgroundColor: "transparent",
                              color: option.endtime ? "#1F2933" : "#9CA3AF",
                            }}
                          />
                        </div>
                      </div>

                      <p style={{ margin: "8px 0 0", fontSize: "11px", color: "#bbb" }}>
                        종료시간은 선택사항입니다
                      </p>
                    </>
                  )}
                </div>
              )}

              {option.optiontype === "place" && (
                <div
                  style={{
                    position: "relative",
                    border: "1px solid #E5E7EB",
                    borderRadius: "14px",
                    padding: "14px",
                    backgroundColor: "#fff",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => handleDeleteOption(index)}
                    style={{
                      position: "absolute",
                      top: "10px",
                      right: "10px",
                      border: "none",
                      background: "none",
                      fontSize: "18px",
                      cursor: "pointer",
                      color: "#9CA3AF",
                      padding: 0,
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setOpenPlacePickerIndex((prev) =>
                        prev === index ? null : index
                      )
                    }
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "12px 0",
                      paddingRight: "20px",
                      border: "none",
                      borderBottom:
                        openPlacePickerIndex === index ||
                        (hasValue(option.placelat) && hasValue(option.placelng))
                          ? "1px solid #F3F4F6"
                          : "none",
                      backgroundColor: "transparent",
                      cursor: "pointer",
                      textAlign: "left",
                      boxSizing: "border-box",
                    }}
                  >
                    <FaMapMarkerAlt size={14} color="#9CA3AF" />

                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "14px", fontWeight: "700", color: "#1F2933" }}>
                        {openPlacePickerIndex === index ? "지도 검색 닫기" : "지도에서 장소 검색하기"}
                      </div>
                      <div style={{ fontSize: "12px", color: "#9CA3AF", marginTop: "2px" }}>
                        카카오맵에서 장소를 검색하고 선택할 수 있어요.
                      </div>
                    </div>

                    {openPlacePickerIndex === index ? (
                      <FaChevronDown size={12} color="#C0C5CC" />
                    ) : (
                      <FaChevronRight size={12} color="#C0C5CC" />
                    )}
                  </button>

                  {openPlacePickerIndex === index && (
                    <div style={{ padding: "12px 0" }}>
                      <LocationPicker
                        allowMapClick={false}
                        onSelect={(name, address, place) =>
                          handleSelectPlaceOption(index, name, address, place)
                        }
                      />
                    </div>
                  )}

                  {hasValue(option.placelat) && hasValue(option.placelng) && (
                    <>
                      <input
                        value={option.placename}
                        readOnly
                        style={{ ...plainRowInputStyle, fontWeight: "700" }}
                      />

                      <input
                        value={option.placeaddress}
                        readOnly
                        placeholder="주소 정보 없음"
                        style={{ ...plainRowInputStyle, borderBottom: "none" }}
                      />
                    </>
                  )}
                </div>
              )}
          </div>
        ))}

        {votetype !== 'course' && <button
          type="button"
          onClick={handleAddOption}
          style={{
            width: "100%",
            height: "48px",
            fontSize: "28px",
            border: "1px solid #ddd",
            borderRadius: "14px",
            backgroundColor: "#fff",
            marginBottom: votetype === "schedule" ? "8px" : "20px",
            cursor: "pointer",
          }}
        >
          +
        </button>}

        {votetype === "schedule" && (
          <button
            type="button"
            onClick={handleLoadAvailabilities}
            style={{
              width: "100%",
              padding: "12px",
              marginBottom: "20px",
              border: "1px solid #d8d8ff",
              borderRadius: "10px",
              backgroundColor: "#f9f9ff",
              color: "#5c58d8",
              fontSize: "14px",
              cursor: "pointer",
              fontWeight: "600",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
            }}
          >
            <FaCalendarAlt size={14} /> 가능 시간 불러오기
          </button>
        )}

        <label style={{ ...labelStyle, opacity: votetype === "course" ? 0.4 : 1 }}>
          <input
            type="checkbox"
            checked={ismultiple}
            onChange={(e) => setIsmultiple(e.target.checked)}
            disabled={votetype === "course"}
          />
          복수 선택
        </label>

        <label style={{ ...labelStyle, opacity: votetype === "course" ? 0.4 : 1 }}>
          <input
            type="checkbox"
            checked={isanonymous}
            onChange={(e) => setIsanonymous(e.target.checked)}
            disabled={votetype === "course"}
          />
          익명 투표
        </label>

        <label style={{ ...labelStyle, marginBottom: "16px", opacity: votetype === "course" ? 0.4 : 1 }}>
          <input
            type="checkbox"
            checked={allowaddoption}
            onChange={(e) => setAllowaddoption(e.target.checked)}
            disabled={votetype === "course"}
          />
          선택항목 추가 허용
        </label>

        <hr
          style={{
            border: "none",
            borderTop: "1px solid #eee",
            margin: "16px 0",
          }}
        />

        <label style={labelStyle}>
          <input
            type="checkbox"
            checked={endtimeenabled}
            onChange={(e) => {
              setEndtimeenabled(e.target.checked);
              if (!e.target.checked) {
                setEndtime("");
                setReminderenabled(false);
              }
            }}
          />
          투표 종료시간 설정
        </label>

        {endtimeenabled && (
          <input
            type="datetime-local"
            value={endtime}
            onChange={(e) => {
              setEndtime(e.target.value);
              if (!e.target.value) setReminderenabled(false);
            }}
            style={inputStyle}
          />
        )}

        {(() => {
          const disabled = !endtimeenabled || !endtime;

          let labelText = "종료 30분 전 알림";
          if (endtimeenabled && endtime) {
            const diff = (new Date(endtime).getTime() - new Date().getTime()) / (1000 * 60);
            if (diff > 0 && diff < 30) {
              labelText = `마감 임박 알림 (현재 약 ${Math.ceil(diff)}분 남음)`;
            }
          }

          return (
            <label
              style={{
                ...labelStyle,
                marginTop: "12px",
                opacity: disabled ? 0.4 : 1,
                cursor: disabled ? "not-allowed" : "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={reminderenabled}
                disabled={disabled}
                onChange={(e) => setReminderenabled(e.target.checked)}
              />
              {labelText}
            </label>
          );
        })()}
      </div>
    </div>
  );
}

function makeEmptyOption(optiontype) {
  return {
    optiontype,
    optiontext: "",
    optiondate: "",
    starttime: "",
    endtime: "",
    isallday: false,
    availablecount: 0,
    placename: "",
    placeaddress: "",
    placelat: "",
    placelng: "",
    kakaomapurl: "",
  };
}

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  return value !== "";
}

function isLocationVoteType(votetype) {
  return ["location", "middle_location", "additional_location"].includes(votetype);
}

function isSelectedVoteType(votetype, buttonType) {
  if (buttonType === "location") return isLocationVoteType(votetype);
  return votetype === buttonType;
}

const inputStyle = {
  width: "100%",
  height: "42px",
  padding: "0 12px",
  border: "1px solid #ddd",
  borderRadius: "6px",
  boxSizing: "border-box",
};

const labelStyle = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  marginBottom: "8px",
  cursor: "pointer",
};

const plainRowInputStyle = {
  width: "100%",
  border: "none",
  outline: "none",
  borderBottom: "1px solid #F3F4F6",
  padding: "12px 0",
  fontSize: "14px",
  backgroundColor: "transparent",
  color: "#1F2933",
  boxSizing: "border-box",
};

export default VoteCreatePage;
