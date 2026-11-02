import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import FinalizedCourseEditor from "./FinalizedCourseEditor";
import { updateFinalizedCourseStops } from "../api/courseRoadmapApi";

jest.mock("../api/courseRoadmapApi", () => ({ updateFinalizedCourseStops: jest.fn() }));
jest.mock("./map/KakaoMapView", () => () => <div data-testid="map" />);
jest.mock("./map/LocationPicker", () => ({ onSelect }) => (
  <button type="button" onClick={() => onSelect("새 장소", "새 주소", { id: "9", lat: 37.52, lng: 127.02 })}>장소 추가 테스트</button>
));

const stop = (order, name, extra = {}) => ({ place_id: String(order), place_source: "kakao", place_name: name, place_address: `${name} 주소`,
  latitude: 37.5 + order / 100, longitude: 127 + order / 100, stop_order: order, expected_stay_min: 60, visit_start_time: "10:00:00", estimated_cost: 10000, ...extra });
const course = { course_name: "코스 A", stops: [stop(1, "첫 장소"), stop(2, "둘째 장소")] };
const schedule = { isallday: true };

beforeEach(() => updateFinalizedCourseStops.mockReset().mockResolvedValue({ updated: true }));

test("장소 순서를 바꾸고 저장하면 새 순서와 시간표로 전송하고 기존 비용은 유지", async () => {
  const onSaved = jest.fn().mockResolvedValue();
  render(<FinalizedCourseEditor scheduleId={3} course={course} schedule={schedule} onSaved={onSaved} onCancel={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "1번째 장소 아래로" }));
  fireEvent.click(screen.getByRole("button", { name: "수정 완료" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  const [scheduleId, payload] = updateFinalizedCourseStops.mock.calls[0];
  expect(scheduleId).toBe(3);
  expect(payload.stops.map((item) => [item.stop_order, item.place_name, item.estimated_cost])).toEqual([[1, "둘째 장소", 10000], [2, "첫 장소", 10000]]);
  expect(payload.estimated_cost_per_person).toBe(20000);
  expect(payload.stops[0].visit_start_time).toBe("10:00");
});

test("장소를 추가·삭제할 수 있고 비용을 모르는 새 장소가 있으면 1인당 비용은 비움", async () => {
  render(<FinalizedCourseEditor scheduleId={3} course={course} schedule={schedule} onSaved={jest.fn().mockResolvedValue()} onCancel={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "장소 추가 테스트" }));
  fireEvent.click(screen.getByRole("button", { name: "1번째 장소 삭제" }));
  fireEvent.click(screen.getByRole("button", { name: "수정 완료" }));
  await waitFor(() => expect(updateFinalizedCourseStops).toHaveBeenCalled());
  const payload = updateFinalizedCourseStops.mock.calls[0][1];
  expect(payload.stops.map((item) => item.place_name)).toEqual(["둘째 장소", "새 장소"]);
  expect(payload.estimated_cost_per_person).toBeNull();
});

test("모든 장소를 지우면 저장할 수 없고 저장 실패는 안내", async () => {
  render(<FinalizedCourseEditor scheduleId={3} course={{ ...course, stops: [stop(1, "하나")] }} schedule={schedule} onSaved={jest.fn()} onCancel={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "1번째 장소 삭제" }));
  expect(screen.getByRole("button", { name: "수정 완료" })).toBeDisabled();
});

test("저장 실패 메시지를 보여 주고 다시 시도 가능", async () => {
  updateFinalizedCourseStops.mockRejectedValue(new Error("저장 실패"));
  render(<FinalizedCourseEditor scheduleId={3} course={course} schedule={schedule} onSaved={jest.fn()} onCancel={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "수정 완료" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("저장 실패");
  expect(screen.getByRole("button", { name: "수정 완료" })).toBeEnabled();
});
