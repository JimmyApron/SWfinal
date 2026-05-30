import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { FaHome, FaCalendarAlt, FaBell, FaCog } from "react-icons/fa";
import { supabase } from "../lib/supabaseClient";
import {
  getUnreadNotificationCount,
  getUnreadGuestNotificationCount,
} from "../api/notificationApi";
import "./BottomNav.css";

function BottomNav() {
  const navigate = useNavigate();
  const [currentUserId, setCurrentUserId] = useState(null);
  const [isGuestUser, setIsGuestUser] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showGuestModal, setShowGuestModal] = useState(false);

  useEffect(() => {
    const loadUserAndCount = async (userParam) => {
      let userId = null;
      let isGuest = false;

      if (userParam && userParam.id) {
        userId = userParam.id;
      } else {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        userId = user?.id;
      }

      if (!userId) {
        const guestId = localStorage.getItem("guest_id");
        if (guestId) {
          userId = guestId;
          isGuest = true;
        }
      }

      if (!userId) return;

      setCurrentUserId(userId);
      setIsGuestUser(isGuest);

      const count = isGuest
        ? await getUnreadGuestNotificationCount(userId)
        : await getUnreadNotificationCount(userId);

      setUnreadCount(count);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        localStorage.removeItem("guest_id");
      }
      loadUserAndCount(session?.user ?? null);
    });

    // initial load
    loadUserAndCount();

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!currentUserId) return;

    const reloadUnreadCount = async () => {
      const count = isGuestUser
        ? await getUnreadGuestNotificationCount(currentUserId)
        : await getUnreadNotificationCount(currentUserId);
      setUnreadCount(count);
    };

    const channel = supabase
      .channel(`bottom-notifications-${currentUserId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `receiverid=eq.${currentUserId}`,
        },
        () => {
          reloadUnreadCount();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId, isGuestUser]);

  const displayCount = unreadCount > 9 ? "9+" : `+${unreadCount}`;

  const handleRestrictedClick = async (e, path) => {
    e.preventDefault();
    // 세션이 있으면 로그인 유저 → 이동
    const { data: { user} } = await supabase.auth.getUser();
    if (user) { navigate(path); return; }
    // guest_id가 없으면 로그인 시도한 유저 (OAuth 등) → 이동
    const guestId = localStorage.getItem("guest_id");
    if (!guestId) { navigate(path); return; }
    // guest_id만 있는 진짜 비회원 → 모달
    setShowGuestModal(true);
  };

  return (
    <>
      <nav className="bottom-nav">
        <NavLink to="/home" className="bottom-nav-item" onClick={(e) => handleRestrictedClick(e, "/home")}>
          <FaHome />
          <span>홈</span>
        </NavLink>

        <NavLink to="/calendar" className="bottom-nav-item" onClick={(e) => handleRestrictedClick(e, "/calendar")}>
          <FaCalendarAlt />
          <span>캘린더</span>
        </NavLink>

        <NavLink to="/notifications" className="bottom-nav-item">
          <div className="bottom-nav-icon-wrap">
            <FaBell />
            {unreadCount > 0 && (
              <span className="bottom-nav-badge">{displayCount}</span>
            )}
          </div>
          <span>알림</span>
        </NavLink>

        <NavLink to="/settings" className="bottom-nav-item" onClick={(e) => handleRestrictedClick(e, "/settings")}>
          <FaCog />
          <span>설정</span>
        </NavLink>
      </nav>

      {showGuestModal && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
          <div style={{ backgroundColor: "#fff", borderRadius: "16px", padding: "28px 24px", width: "300px", textAlign: "center" }}>
            <p style={{ fontSize: "15px", fontWeight: "bold", marginBottom: "6px" }}>회원만 가능한 기능입니다</p>
            <p style={{ fontSize: "13px", color: "#888", marginBottom: "24px" }}>로그인 또는 회원가입 후 이용해주세요.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <button
                onClick={() => { setShowGuestModal(false); navigate("/login"); }}
                style={{ padding: "12px", backgroundColor: "#7c79ff", color: "#fff", border: "none", borderRadius: "10px", fontSize: "15px", cursor: "pointer", fontWeight: "bold" }}
              >
                로그인
              </button>
              <button
                onClick={() => { setShowGuestModal(false); navigate("/signup"); }}
                style={{ padding: "12px", backgroundColor: "#f0f0ff", color: "#7c79ff", border: "none", borderRadius: "10px", fontSize: "15px", cursor: "pointer", fontWeight: "bold" }}
              >
                회원가입
              </button>
              <button
                onClick={() => setShowGuestModal(false)}
                style={{ padding: "10px", backgroundColor: "transparent", color: "#aaa", border: "none", fontSize: "14px", cursor: "pointer" }}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default BottomNav;
