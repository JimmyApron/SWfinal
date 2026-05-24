import { useNavigate } from "react-router-dom";
import RoomListPage from "../room/RoomListPage";
function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="home-container">
      
      {/* 👑 우측 상단 배치를 조율할 내비게이션 구역 */}
      <div className="home-navigation">
        <button 
          onClick={() => navigate("/settings")} // 👈 은혜님이 알려주신 세팅 페이지 경로로 변경!
          className="settings-button"
        >
          마이페이지 👤
        </button>
      </div>

      <h1>홈</h1>

      <RoomListPage />

      <button onClick={() => navigate("/rooms/create")}>
        방 만들기
      </button>

      <button onClick={() => navigate("/rooms/invite")}>
        초대코드 입력하기
      </button>
    </div>
  );
}

export default HomePage;