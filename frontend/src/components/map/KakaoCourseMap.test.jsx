import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import KakaoMapView from "./KakaoMapView";

let overlays;
let polylines;
let map;
beforeEach(() => {
  overlays = [];
  polylines = [];
  map = { setBounds: jest.fn(), setCenter: jest.fn(), setLevel: jest.fn(), relayout: jest.fn() };
  jest.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(400);
  jest.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(300);
  window.kakao = { maps: {
    load: (callback) => callback(),
    Map: function () { return map; },
    LatLng: function (lat, lng) { this.getLat = () => lat; this.getLng = () => lng; },
    LatLngBounds: function () { this.extend = jest.fn(); },
    Marker: function (config) { this.getPosition = () => config.position; this.setOpacity = jest.fn(); this.setMap = jest.fn(); },
    MarkerImage: function () {}, Size: function () {}, Point: function () {},
    CustomOverlay: function (config) {
      overlays.push(config);
      this.setMap = (value) => { if (value && !config.content.parentNode) document.body.appendChild(config.content); else if (!value) config.content.remove(); };
      this.setPosition = jest.fn();
    },
    InfoWindow: function () { this.open = jest.fn(); this.close = jest.fn(); },
    Polyline: function (config) { polylines.push(config); this.setMap = jest.fn(); },
    event: { addListener: jest.fn(), removeListener: jest.fn() },
  } };
});
afterEach(() => { overlays.forEach((overlay) => overlay.content.remove()); delete window.kakao; jest.restoreAllMocks(); });
const places = [{ id: "a", name: "첫 장소", lat: 37, lng: 127, orderNumber: 1 }, { id: "b", name: "셋째 장소", lat: 37.1, lng: 127.1, orderNumber: 3 }];

test("실제 지도 컴포넌트의 번호 마커·직선 Polyline·전체 범위 설정", async () => {
  render(<KakaoMapView places={places} routePath={places} numberedPlaces />);
  expect(await screen.findByRole("button", { name: "1. 첫 장소" })).toHaveTextContent("1");
  expect(screen.getByRole("button", { name: "3. 셋째 장소" })).toHaveTextContent("3");
  expect(polylines[0].path).toHaveLength(2);
  expect(map.setBounds).toHaveBeenCalled();
});
test("마커 선택 콜백 및 타임라인에서 선택된 마커 강조", async () => {
  const select = jest.fn();
  const view = render(<KakaoMapView places={places} numberedPlaces onPlaceSelect={select} />);
  fireEvent.click(await screen.findByRole("button", { name: "3. 셋째 장소" }));
  expect(select).toHaveBeenCalledWith(places[1]);
  view.rerender(<KakaoMapView places={places} numberedPlaces onPlaceSelect={select} selectedPlace={places[1]} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "3. 셋째 장소" }).style.border).toContain("3px"));
});
test("SDK 없으면 오류 안내", async () => {
  delete window.kakao;
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  render(<KakaoMapView places={places} numberedPlaces />);
  expect(await screen.findByText("카카오맵을 불러오지 못했습니다.")).toBeInTheDocument();
  log.mockRestore();
});
test('추천 중심의 반경 원과 지도 범위 생성·반경 갱신·해제', async () => {
  const circles = [];
  window.kakao.maps.Circle = function (config) {
    this.setMap = jest.fn(); this.getBounds = () => 'circle-bounds';
    circles.push({ config, circle: this });
  };
  const view = render(<KakaoMapView searchArea={{ lat: 37, lng: 127, radius: 1500 }} />);
  await waitFor(() => expect(circles.length).toBeGreaterThan(0));
  expect(circles[0].config.radius).toBe(1500);
  expect(map.setBounds).toHaveBeenCalledWith('circle-bounds');
  view.rerender(<KakaoMapView searchArea={{ lat: 37, lng: 127, radius: 3000 }} />);
  expect(circles[circles.length - 1].config.radius).toBe(3000);
  view.unmount();
  expect(circles[circles.length - 1].circle.setMap).toHaveBeenCalledWith(null);
});
