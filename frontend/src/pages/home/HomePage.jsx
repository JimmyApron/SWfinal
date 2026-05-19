import { useNavigate } from "react-router-dom";

function HomePage() {
  const navigate = useNavigate();

  return (
    <div>
      <h1>홈</h1>

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