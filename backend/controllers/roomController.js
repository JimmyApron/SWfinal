// const supabase = require("../supabaseClient");

// // 초대 코드 생성
// function makeInviteCode() {
//   return Math.random().toString(36).substring(2, 8).toUpperCase();
// }

// async function createRoom(req, res) {
//   console.log("POST /rooms 요청 들어옴");
//   console.log("req.body:", req.body);

//   const { roomName, description, userId } = req.body;

//   if (!roomName || !userId) {
//     return res.status(400).json({
//       message: "roomName과 userId가 필요합니다.",
//     });
//   }

//   const newRoom = {
//     roomname: roomName,
//     description: description || "",
//     invitecode: makeInviteCode(),
//     createdby: userId,
//   };

//   const { data: room, error } = await supabase
//     .from("rooms")
//     .insert([newRoom])
//     .select()
//     .single();

//   if (error) {
//     return res.status(500).json({
//       message: "방 생성 실패",
//       error: error.message,
//       details: error.details,
//       hint: error.hint,
//       code: error.code,
//     });
//   }

//   const { error: memberError } = await supabase
//     .from("room_members")
//     .upsert(
//       { //중복참가제거
//       roomid: room.id,
//       userid: userId,
//     },
//     {
//       onConflict: "roomid,userid",
//     }
//   );

//   if (memberError) {
//     return res.status(500).json({
//       message: "방은 생성됐지만 멤버 저장 실패",
//       error: memberError.message,
//     });
//   }

//   return res.status(201).json({
//     message: "방 생성 완료",
//     room,
//   });
// }

// async function joinRoom(req, res) {
//   console.log("POST /rooms/invite 요청 들어옴");
//   console.log("join body:", req.body);
//   const { inviteCode, userId } = req.body;

//   console.log("inviteCode:", inviteCode);
//   console.log("userId:", userId);

//   if (!inviteCode || !userId) {
//     console.log("inviteCode 또는 userId 없음");

//     return res.status(400).json({
//       message: "inviteCode와 userId가 필요합니다.",
//     });
//   }
//   console.log("rooms에서 초대코드 검색 시작");

//   const { data: room, error: roomError } = await supabase
//     .from("rooms")
//     .select("*")
//     .eq("invitecode", inviteCode)
//     .single();

//     console.log("검색된 room:", room);
//     console.log("roomError:", roomError);

//   if (roomError || !room) {
//     return res.status(404).json({
//       message: "존재하지 않는 초대코드입니다.",
//       error: roomError?.message,
//     });
//   }

//   console.log("room_members 저장 시작");

//   const { error: memberError } = await supabase
//     .from("room_members")
//     .upsert({
//       roomid: room.id,
//       userid: userId,
//     });

//   console.log("memberError:", memberError);

//   if (memberError) {
//     return res.status(500).json({
//       message: "방 참가 실패",
//       error: memberError.message,
//       details: memberError.details,
//       hint: memberError.hint,
//       code: memberError.code,
//     });
//   }

//   return res.json({
//     message: "방 참가 완료",
//     room,
//   });
// }

// module.exports = {
//   createRoom,
//   joinRoom,
// };