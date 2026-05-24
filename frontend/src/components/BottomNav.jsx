import { NavLink } from "react-router-dom";
import { FaHome, FaCalendarAlt, FaBell, FaCog } from "react-icons/fa";
import "./BottomNav.css";

function BottomNav() {
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
        <FaBell />
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