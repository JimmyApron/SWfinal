import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { FaHome, FaCalendarAlt, FaBell, FaCog } from "react-icons/fa";
import { supabase } from "../lib/supabaseClient";
import { getUnreadNotificationCount } from "../api/notificationApi";
import "./BottomNav.css";

function BottomNav() {
  const [currentUserId, setCurrentUserId] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const loadUserAndCount = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      let userId = user?.id;

      if (!userId) {
        userId = localStorage.getItem("guest_id");
      }

      if (!userId) return;

      setCurrentUserId(userId);

      const count = await getUnreadNotificationCount(userId);
      setUnreadCount(count);
    };

    loadUserAndCount();
  }, []);

  useEffect(() => {
    if (!currentUserId) return;

    const reloadUnreadCount = async () => {
      const count = await getUnreadNotificationCount(currentUserId);
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
  }, [currentUserId]);

  const displayCount = unreadCount > 9 ? "9+" : `+${unreadCount}`;

  return (
    <nav className="bottom-nav">
      <NavLink to="/home" className="bottom-nav-item">
        <FaHome />
        <span>홈</span>
      </NavLink>

      <NavLink to="/calendar" className="bottom-nav-item">
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

      <NavLink to="/settings" className="bottom-nav-item">
        <FaCog />
        <span>설정</span>
      </NavLink>
    </nav>
  );
}

export default BottomNav;