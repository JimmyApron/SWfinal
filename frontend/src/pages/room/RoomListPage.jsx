import { useEffect, useState } from "react";
import { getRooms } from "../../api/roomApi";
import { supabase } from "../../lib/supabaseClient";

function RoomListPage() {
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
  }, []);

  return (
    <div>
      <h1>방 목록</h1>

      {rooms.length === 0 ? (
        <p>생성된 방이 없습니다.</p>
      ) : (
        <ul>
          {rooms.map((room) => (
            <li key={room.id}>
              {room.roomname} {room.room_members?.[0]?.count || 0}명
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default RoomListPage;