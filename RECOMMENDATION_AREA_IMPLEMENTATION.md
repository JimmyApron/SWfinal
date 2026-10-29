# 지도에서 추천 구역 선택

## 사용 흐름

추천 조건 화면에서 다음 순서로 사용한다.

1. 일정의 확정 장소에 유효한 좌표가 있으면 추천 중심으로 기본 선택한다.
2. 장소·지역을 검색하고 결과를 선택하거나 지도를 눌러 중심점을 지정한다. 장소 검색 0건이면 주소 검색으로 지역 위치를 찾는다.
3. 반경 500m~5km를 500m 단위로 조절한다. 기본 반경은 1.5km다.
4. 선택한 위치와 반경을 지도 마커·원으로 확인한다.
5. `이 구역에서 코스 추천받기`를 누른다.

지도에 기본으로 보이는 위치를 추천 중심으로 자동 간주하지 않는다. 중심이 없으면 먼저 선택하도록 안내하고 요청을 차단한다. 기존 지역 입력은 보조 메모로 남기되 실제 범위는 선택한 중심/반경으로 결정한다.

## 연결

조건에 `searchCenter: { lat, lng, name, address }`, `searchRadiusMeters`를 추가했다. 기존 일정별 localStorage 조건 저장·복구 및 결과 전달 흐름을 사용한다. 일정 좌표가 비동기로 복구되면 사용자가 이미 선택한 중심은 유지하고, 아직 중심이 없을 때만 일정 좌표를 채운다.

추천 엔진은 명시적으로 선택한 중심을 일정의 기존 좌표보다 우선 사용하고 반경을 Kakao 검색 래퍼에 전달한다. SDK 결과가 검색 원 밖의 장소를 포함하더라도 좌표 기반 거리 검사로 제외한다. 진단에는 좌표를 출력하지 않고 `areaExcluded`, `areaValid`만 추가했다. 원 안 후보가 모두 없어지면 outcome은 `area_empty`다.

식사·활동 필수 슬롯, 시간/이동/평점/예산 검사, 조합 중복 제거, 최대 5개 규칙은 유지한다. 따라서 구역을 정해도 해당 구역의 장소와 일정 조건을 함께 만족하지 못하면 추천이 0개일 수 있다.

## 파일

신규:

- frontend/src/components/RecommendationAreaPicker.jsx
- frontend/src/utils/recommendationAreaUtils.js
- frontend/src/components/RecommendationAreaPicker.test.jsx
- frontend/src/pages/course/CourseRecommendationConditionPage.test.jsx
- frontend/src/components/map/LocationPicker.test.jsx
- 이 문서

수정:

- CourseRecommendationConditionPage.jsx: 기본 중심, 지도 선택 UI, 반경, 유효성 검사 및 요청 연결
- KakaoMapView.jsx: 선택 범위를 나타내는 Circle과 범위 조정. 옵션을 전달하는 경우에만 사용
- LocationPicker.jsx: 선택적인 주소 검색 fallback 및 SDK 준비 전 검색 차단. 기존 다른 화면은 주소 검색을 자동 사용하지 않음
- courseRecommendationEngine.js: 선택 중심·반경 검색, 원 밖 후보 제외
- courseRecommendationDiagnostics.js: 구역별 안전한 건수
- courseRecommendationEngine.test.js, KakaoCourseMap.test.jsx: 중심 우선순위·반경·원 생성/갱신/해제 검증

기존 일정 177의 위치나 DB 행은 변경하지 않았다. DB 스키마·RLS/GRANT·키/.env도 변경하지 않았다. 이번 작업 중 실제 API 요청이나 채팅 전송도 실행하지 않았다.

## 검증

frontend에서 `CI=true npm test -- --watchAll=false --runInBand` 전체 실행: **17개 스위트 / 151개 테스트 통과, 실패 0개**.

`npm run build` 성공. 기존 다른 파일의 ESLint 및 Node deprecation 경고는 남아 있다.

검색/지도 클릭 선택, 반경 변경, 확정 장소 기본값, 미선택 시 차단, 실제 추천 요청·조건 저장, 선택 중심 우선 적용, 원 밖 후보 제외, 주소 검색 fallback, SDK Circle 생성·갱신·해제를 모의 테스트했다. 기존 투표·개인 확정·최종 확정·로드맵·채팅 회귀 테스트도 포함한다.

실제 브라우저·모바일 화면 및 Kakao API 실호출은 미검증이다. 브라우저에서 개발 서버를 다시 열고 모임 40·일정 177의 조건 화면에서 중심과 반경을 선택해 실행해야 한다. Console의 새 진단에서 `hasLocationBias=true`, 선택한 `radiusMeters`, 원 안/밖 후보 수를 확인할 수 있다. SDK/키/도메인 문제로 지도가 로드되지 않으면 먼저 해당 오류를 확인해야 한다.
