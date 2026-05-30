import { useEffect, useState } from "react";
import { getRooms } from "../../api/roomApi";
import { supabase } from "../../lib/supabaseClient";
import { useNavigate } from "react-router-dom";

function RoomListPage() {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState([]);

  const handleGetRooms = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setRooms([]);
        return;
      }

      const result = await getRooms(user.id);

      setRooms(result.rooms);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    handleGetRooms();

    // 실시간 구독: 내가 속한 방의 멤버 변화가 생기면 목록 갱신
    const channel = supabase
      .channel("room_list_realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_members",
        },
        () => {
          handleGetRooms();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div>
      <h1>방 목록</h1>

      {rooms.length === 0 ? (
        <p>생성된 방이 없습니다.</p>
      ) : (
        <ul>
          {rooms.map((room) => (
            <li 
              key={room.id}
              onClick={() => navigate(`/rooms/${room.id}`)}
            >
              {room.roomname} {(room.room_members?.[0]?.count || 0) + (room.room_guests?.[0]?.count || 0)}명
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default RoomListPage;