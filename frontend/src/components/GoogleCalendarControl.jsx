import { useState } from "react";
import { useGoogleLogin } from "@react-oauth/google";
import "../pages/room/RoomCalendar.css";

const isTokenValid = () =>
  Boolean(localStorage.getItem("google_calendar_token")) &&
  Date.now() < Number(localStorage.getItem("google_calendar_token_expiry") || 0);

// 홈 캘린더와 방 공용 캘린더가 같은 토큰/자동 추가 설정(localStorage)을 공유하는 구글 캘린더 연동 버튼.
// inline: 절대 위치 대신 현재 위치에 배치 / onAutoSyncEnabled: 자동 추가를 켤 때 한 번 실행할 작업(예: 기존 일정 일괄 추가)
export default function GoogleCalendarControl({ onChange, onAutoSyncEnabled, inline = false, panel = false, autoSyncLabel = "일정 자동 추가", connectedHint = "내 구글 캘린더 일정이 캘린더에 나만 보기로 표시돼요." }) {
  const [open, setOpen] = useState(false);
  const [connected, setConnected] = useState(isTokenValid);
  const [autoSync, setAutoSync] = useState(() => localStorage.getItem("google_calendar_auto_sync") === "true");
  const [message, setMessage] = useState("");

  const googleLogin = useGoogleLogin({
    scope: "https://www.googleapis.com/auth/calendar.events",
    onSuccess: (tokenResponse) => {
      localStorage.setItem("google_calendar_token", tokenResponse.access_token);
      localStorage.setItem("google_calendar_token_expiry", String(Date.now() + tokenResponse.expires_in * 1000));
      setConnected(true);
      setMessage("");
      onChange?.();
    },
    onError: () => setMessage("구글 캘린더 연결에 실패했습니다."),
  });

  function disconnect() {
    ["google_calendar_token", "google_calendar_token_expiry", "google_calendar_auto_sync"].forEach((key) => localStorage.removeItem(key));
    setConnected(false);
    setAutoSync(false);
    onChange?.();
  }

  async function toggleAutoSync() {
    const next = !autoSync;
    localStorage.setItem("google_calendar_auto_sync", String(next));
    setAutoSync(next);
    if (next) await onAutoSyncEnabled?.();
  }

  // panel: 사이드 패널 안에서 팝업 대신 버튼 아래로 펼쳐지는 형태
  return <div className={`room-tool ${inline ? "inline" : ""} ${panel ? "panel" : ""}`}>
    <button type="button" className={`room-tool-button ${connected ? "on" : ""}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      {panel ? `구글 동기화${connected ? " · 연결됨" : ""}` : `구글${connected ? " 연결됨" : ""}`}
    </button>
    {open && <>
      {!panel && <div className="room-tool-backdrop" onClick={() => setOpen(false)} />}
      <div className="room-tool-popover" role="dialog" aria-label="구글 캘린더 연동">
        <strong>구글 캘린더 연동</strong>
        {connected ? <>
          <span>{connectedHint}</span>
          <div className="room-tool-row"><span>{autoSyncLabel}</span>
            <button type="button" role="switch" aria-checked={autoSync} aria-label={autoSyncLabel} className={`room-tool-switch ${autoSync ? "on" : ""}`} onClick={toggleAutoSync}><i /></button>
          </div>
          <small>켜면 새로 만드는 일정이 내 구글 캘린더에도 추가돼요.</small>
          <button type="button" className="room-tool-danger" onClick={disconnect}>연결 해제</button>
        </> : <>
          <span>연결하면 내 구글 캘린더 일정을 이 캘린더에서 함께 볼 수 있어요. 나에게만 보여요.</span>
          <button type="button" className="room-tool-primary" onClick={() => googleLogin()}>구글 캘린더 연결</button>
        </>}
        {message && <small className="room-drive-backup-error" role="alert">{message}</small>}
      </div>
    </>}
  </div>;
}
