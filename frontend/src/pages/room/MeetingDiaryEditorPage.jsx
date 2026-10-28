import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { getRoomDiaryIdentity, getRoomMeetings } from "../../api/meetupDiaryApi";
import { supabase } from "../../lib/supabaseClient";
import DiaryEditor from "./DiaryEditor";
import "./MeetingDiaryDetailPage.css";

const dateLabel = (value) => value ? new Intl.DateTimeFormat("ko-KR", {
  year: "numeric", month: "long", day: "numeric", weekday: "long", timeZone: "Asia/Seoul",
}).format(new Date(`${value}T12:00:00+09:00`)) : "";

export default function MeetingDiaryEditorPage() {
  const { roomId, meetingId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [identity, setIdentity] = useState(null);
  const [profileImageUrl, setProfileImageUrl] = useState("");
  const [roomName, setRoomName] = useState("");
  const [meeting, setMeeting] = useState(null);
  const [ordinal, setOrdinal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [auth, meetings, { data: room, error: roomError }] = await Promise.all([
          getRoomDiaryIdentity(roomId),
          getRoomMeetings(roomId),
          supabase.from("rooms").select("roomname").eq("id", Number(roomId)).single(),
        ]);
        if (roomError) throw roomError;
        if (!auth.user || !auth.identityId) throw new Error("로그인이 필요합니다.");
        const { data: profile } = await supabase
          .from("profiles")
          .select("profileimageurl")
          .eq("id", auth.user.id)
          .maybeSingle();
        if (!auth.user || !auth.identityId) throw new Error("이 방의 회원만 기록을 작성할 수 있습니다.");
        const found = meetings.find((item) => item.id === meetingId);
        if (!found) throw new Error("이 방에서 만남을 찾을 수 없습니다.");
        if (active) {
          setIdentity(auth.identityId);
          setProfileImageUrl(profile?.profileimageurl || auth.user.user_metadata?.avatar_url || auth.user.user_metadata?.picture || "");
          setRoomName(room?.roomname || "모임");
          setMeeting(found);
          setOrdinal(meetings.findIndex((item) => item.id === meetingId) + 1);
        }
      } catch (loadError) {
        if (active) setError(loadError.message || "기록 작성 화면을 불러오지 못했습니다.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [roomId, meetingId]);

  const back = ({ saved = false } = {}) => navigate(location.state?.from || `/rooms/${roomId}?tab=calendar`, {
    replace: !location.state?.from,
    state: saved ? { diaryAutoSavedToast: true } : undefined,
  });

  if (loading) return <main className="diary-fullscreen-loading">기록을 불러오는 중…</main>;
  if (error || !meeting || !identity) return <main className="diary-fullscreen-loading"><button className="meeting-diary-back" onClick={back}>×</button><p role="alert">{error || "기록을 불러오지 못했습니다."}</p></main>;

  return <DiaryEditor
    key={`${meetingId}:${identity}`}
    roomId={roomId}
    meeting={meeting}
    identityId={identity}
    profileImageUrl={profileImageUrl}
    fullScreen
    roomName={roomName}
    dateSubtitle={`${dateLabel(meeting.meeting_date)} · ${ordinal}번째 만남`}
    onClose={back}
    onPublished={() => navigate(`/rooms/${roomId}/meetings/${meetingId}/diary`, { replace: true, state: { from: location.state?.from } })}
  />;
}
