import { useNavigate } from "react-router-dom";
import RoomListPage from "../room/RoomListPage";
function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="home-container">
      
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