import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import FinalizedCourseRoadmapPage from "./FinalizedCourseRoadmapPage";
import FinalizedCoursePreview from "../../components/FinalizedCoursePreview";
import CourseShareMessage from "../../components/CourseShareMessage";
import { getFinalizedRoadmap, shareFinalizedCourse } from "../../api/courseRoadmapApi";
import { useNavigate } from "react-router-dom";

jest.mock("../../api/courseRoadmapApi", () => ({ getFinalizedRoadmap: jest.fn(), shareFinalizedCourse: jest.fn() }));
jest.mock("react-router-dom", () => ({
  useParams: () => ({ roomid: "2", scheduleid: "3" }),
  useNavigate: jest.fn(),
  Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>,
}), { virtual: true });
jest.mock("../../components/map/KakaoMapView", () => function MockMap({ places, onPlaceSelect, selectedPlace }) {
  return <div aria-label="테스트 지도">{places.map((place) => <button key={place.id} onClick={() => onPlaceSelect(place)}>{`지도 ${place.orderNumber}`}</button>)}{selectedPlace && <span>선택 {selectedPlace.name}</span>}</div>;
});
let roadmap;
let navigate;
const content = JSON.stringify({ __type: "finalized_course", version: 1, roomId: "2", scheduleId: "3", courseId: "20" });
beforeEach(() => {
  navigate = jest.fn();
  useNavigate.mockReturnValue(navigate);
  roadmap = { schedule_id: 3, course_id: 20, schedule: { title: "일정", date: "2026-11-01" }, room: { roomname: "모임" },
    course: { course_name: "코스 A", stops: [
      { id: 1, roadmapId: "a", roadmapNumber: 1, place_name: "첫 장소", latitude: null, longitude: 127 },
      { id: 2, roadmapId: "b", roadmapNumber: 2, place_name: "둘째 장소", latitude: 37, longitude: 127 },
    ] } };
  getFinalizedRoadmap.mockReset().mockImplementation(async () => roadmap);
  shareFinalizedCourse.mockReset().mockResolvedValue({ sent: true });
});
function page() {
  return render(<FinalizedCourseRoadmapPage />);
}
const wrap = (ui) => render(ui);

test("직접 URL의 모임·일정으로 복구, 최종 코스와 누락 정보 표시", async () => {
  page();
  expect(await screen.findByRole("heading", { name: "코스 A" })).toBeInTheDocument();
  expect(getFinalizedRoadmap).toHaveBeenCalledWith("2", "3");
  expect(screen.getByText("최종 확정 완료")).toBeInTheDocument();
  expect(screen.getAllByText(/정보 없음/).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "지도 2" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "지도 1" })).not.toBeInTheDocument();
});
test("확정 전에는 완료 상태나 공유 버튼 없음", async () => {
  roadmap = null;
  page();
  await screen.findByText("아직 최종 확정된 코스가 없습니다.");
  expect(screen.queryByText("최종 확정 완료")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "채팅방에 코스 공유하기" })).not.toBeInTheDocument();
});
test("좌표가 없어도 타임라인은 유지하며 지도 대신 안내", async () => {
  roadmap.course.stops.forEach((stop) => { stop.latitude = null; });
  page();
  expect(await screen.findByText("지도에 표시할 좌표가 없습니다. 아래 방문 장소 목록을 확인해 주세요.")).toBeInTheDocument();
  expect(screen.getByText("첫 장소")).toBeInTheDocument();
  expect(screen.queryByLabelText("테스트 지도")).not.toBeInTheDocument();
});
test("지도·타임라인 선택 양방향 동기화", async () => {
  page();
  fireEvent.click(await screen.findByRole("button", { name: "지도 2" }));
  expect(screen.getByText("둘째 장소", { selector: "strong" }).closest("button")).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "1 첫 장소" }));
  expect(screen.queryByText("선택 둘째 장소")).not.toBeInTheDocument();
});
test("일정 미리보기는 정확한 로드맵 링크", async () => {
  wrap(<FinalizedCoursePreview roomId={2} scheduleId={3} />);
  expect(await screen.findByRole("link", { name: "전체 코스 보기" })).toHaveAttribute("href", "/rooms/2/schedules/3/final-course");
});
test("공유 카드는 DB 결과로 렌더링하고 정확한 링크", async () => {
  wrap(<CourseShareMessage content={content} roomId={2} />);
  expect(await screen.findByRole("link", { name: "코스 자세히 보기" })).toHaveAttribute("href", "/rooms/2/schedules/3/final-course");
  expect(getFinalizedRoadmap).toHaveBeenCalledWith(2, "3", "20");
});
test("다른 모임 공유 메시지는 조회하지 않고 차단", () => {
  wrap(<CourseShareMessage content={content} roomId={99} />);
  expect(screen.getByText("이 코스 공유 정보를 확인할 수 없습니다.")).toBeInTheDocument();
  expect(getFinalizedRoadmap).not.toHaveBeenCalled();
});
test("잘못된 메타데이터를 그대로 노출하지 않음", () => {
  wrap(<CourseShareMessage content={'{"__type":"finalized_course",'} roomId={2} />);
  expect(screen.getByText("이 코스 공유 정보를 확인할 수 없습니다.")).toBeInTheDocument();
  expect(screen.queryByText(/__type/)).not.toBeInTheDocument();
});
test("기존 일반 텍스트 그대로 표시", () => {
  wrap(<CourseShareMessage content="안녕하세요" roomId={2} />);
  expect(screen.getByText("안녕하세요")).toBeInTheDocument();
});
test("삭제·접근 불가 일정은 대체 안내", async () => {
  getFinalizedRoadmap.mockRejectedValue(new Error("삭제됨"));
  wrap(<CourseShareMessage content={content} roomId={2} />);
  expect(await screen.findByRole("status")).toHaveTextContent("최종 코스를 조회할 수 없습니다");
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
test("공유 버튼 중복 클릭 방지와 성공 후 해당 모임 채팅방 이동", async () => {
  let complete;
  shareFinalizedCourse.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
  page();
  const button = await screen.findByRole("button", { name: "채팅방에 코스 공유하기" });
  fireEvent.click(button); fireEvent.click(button);
  expect(shareFinalizedCourse).toHaveBeenCalledTimes(1);
  expect(button).toBeDisabled();
  expect(navigate).not.toHaveBeenCalled();
  complete({ sent: true });
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/rooms/2?tab=chat'));
});
test("공유 전송 실패는 오류 안내", async () => {
  shareFinalizedCourse.mockRejectedValue(new Error("전송 실패 · 중복 전송 가능"));
  page();
  fireEvent.click(await screen.findByRole("button", { name: "채팅방에 코스 공유하기" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("전송 실패"));
  expect(navigate).not.toHaveBeenCalled();
});
