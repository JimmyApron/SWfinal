import FinalizedCoursePreview from "./FinalizedCoursePreview";
import { parseCourseShare } from "../utils/courseRoadmapUtils";

export default function CourseShareMessage({ content, roomId }) {
  const meta = parseCourseShare(content);
  if (!meta) return <>{content}</>;
  if (meta.invalid || String(meta.roomId) !== String(roomId)) return <p>이 코스 공유 정보를 확인할 수 없습니다.</p>;
  return <FinalizedCoursePreview roomId={roomId} scheduleId={meta.scheduleId} expectedCourseId={meta.courseId} shared />;
}
