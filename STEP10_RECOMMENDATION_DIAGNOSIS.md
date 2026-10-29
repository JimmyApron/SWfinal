# STEP 10 추천 결과 0개 진단

## 현재 결론

후속으로 사용자가 제공한 실제 개발 Console 진단에서 모임 40·일정 177의 이번 실행은 **기준 좌표 없음 → 지역 문자열 단독 검색 1회 → SDK ZERO_RESULT → 검색 후보 0개**임을 확인했다. 시간·예산·평점 조건으로 걸러진 결과가 아니다. 아래 초기 조사 기록에 이어 문서 마지막에 관측 수치와 최소 수정 내용을 추가했다. 일정 177, DB 데이터, RLS/GRANT, API 키 및 .env는 변경하지 않았다.

사용자가 제공한 Console에는 Kakao SDK document.write 경고, Supabase 네트워크 접속 불가, 토큰 갱신 HTTP 400이 있다. 원문에는 식별 정보가 있어 보고서에 복사하지 않았다.

- document.write 경고 자체는 실제 검색 실패·차단을 확정하는 메시지가 아니다.
- Supabase 오류는 별도 연결 문제로 관찰되지만 추천 0개와의 인과관계는 확인되지 않았다. 사용자가 courses limit(0) HTTP 200을 확인한 사실과 서로 다른 시점/요청의 네트워크 실패를 구분해야 한다.
- 최초 제공 로그에는 새 진단 결과가 없었으며, 후속으로 안전한 진단 JSON을 받아 아래 8절에서 실제 검색 상태와 건수를 확인했다.

## 1. 실제 호출 경로

`CourseRecommendationConditionPage.handleSaveAndReturn`
→ 입력 유효성 검사 및 조건 payload
→ `courseRecommendationApi.generateRecommendationResult`
→ `courseRecommendationEngine.generateCourseRecommendations`
→ 검색어 생성 / `gatherPlacePool`
→ `kakaoPlacesApi.searchPlacesByKeyword`
→ `window.kakao.maps.services.Places().keywordSearch`
→ 장소 정규화·중복/좌표 제거
→ 평점/비용/식사/활동 후보 검사
→ 필수 슬롯·체류/이동/시간/예산 조합 탐색
→ 결과를 state로 결과 화면에 전달
→ 결과 화면의 state/localStorage 복구 및 동일 조합 제거.

엔진·추천 API·Kakao 래퍼에는 Supabase 요청이 없다. 조건 화면에서 일정 state가 없을 때의 일정 조회와 추천 계산은 서로 다른 단계다. 결과 화면 새로고침은 저장 결과를 복구할 수 있으며 **추천을 재실행하지 않는다**.

현재 증상의 `조건과 일정 범위에 맞는 서로 다른 코스를 찾지 못했습니다`는 엔진에서 좌표 유효 후보가 1개 이상인 뒤 조합 결과가 0개일 때 만든 문구다. **현재 실행에서 갓 생성된 결과라면** 검색 전체 실패/검색 결과 전체 0개 경로와 구분된다. 과거 state/캐시 문구일 수 있으므로 문구만으로 이번 요청 성공을 확정하면 안 된다.

## 2. 코드에서 확인되는 후보 및 제약

- 기준 좌표가 있으면 선택 활동의 검색어 수 + 선택 식사의 검색어 수만큼 요청한다. 선택 활동이 없으면 기본 활동 검색어 3개, 식사 선택이 없으면 기본 식사 검색어 2개다. 지역 문자열이 있으면 지역 요청 1개를 추가한다. 같은 검색어의 중복 요청도 현재 그대로 남아 있으며 계획/실행 건수에 반영한다.
- 기준 좌표가 없으면 현재 코드에서는 지역 검색 1개 또는 기본 맛집 검색 1개만 실행하고 기본 중심/반경을 사용한다. 이 경우 선택 활동/식사 후보가 부족할 수 있다. 실제 실행에서는 `usesFallbackCenter`로 확인한다.
- 활동 검색어에는 cafe, park, nature, activity, travel 등 영어 키워드가 포함된다. 실제 한국어 검색 결과·카테고리와의 매칭률은 미검증이며 검색어 변경도 이번에 하지 않았다.
- 필수 슬롯은 선택 식사 수 + 중복 제거한 선택 활동 수다. 식사 종류별 매칭과 각 활동 매칭이 각각 필요하다. 한 장소를 여러 슬롯에 재사용하지 않는다.
- 실제 채울 장소 수는 `min(후보 수, max(3, 필수 슬롯 수))`다. 필수 슬롯이 1개라도 후보가 충분하면 기본적으로 3개 장소를 채운다.
- 기본 활동 체류는 60분, 아침/점심/저녁 식사는 45/60/75분이다. 기본 3개 활동은 이동 제외 최소 180분이 필요하다. 이것은 일정 177의 시간이라는 뜻이 아니라 코드의 하한이다.
- 알려진 평점 미달·개별 비용 초과와 총비용 초과를 제외한다. 평점/비용 누락은 이전 정책대로 후보를 유지하고 확인 불가 안내를 제공한다.
- 일정 시간 형식/범위, 각 구간 이동 한도, 누적 방문 종료, 동일 장소/동일 코스 조합, 5,000회 탐색 한도가 적용된다.

이 조건 중 어느 것이 일정 177을 차단했는지는 실제 진단 숫자로 확인해야 한다.

## 3. 추가된 개발 전용 진단

`NODE_ENV === 'development'`에서만 console.info를 출력한다. test/production에서는 출력하지 않는다. 반환 데이터 형식에 진단 필드를 넣거나 진단을 저장하지 않는다.

출력 구분:

- `[MeetUP course diagnostic start]`: 실행 번호, 허용 목록의 활동/식사/이동 유형, 계획 요청 수
- `[MeetUP course search]`: 요청 번호별 완료 결과. 키워드 원문 대신 허용된 고정 유형 또는 region_or_other만 표시
- `[MeetUP course diagnostic]`: 최종 건수·제외 단계·결과 분류 JSON

주소·장소명·장소 ID·모임/일정/회원 ID·원본 조건·원본 응답·오류 객체·키·토큰·Authorization을 출력하지 않는다. 기존 엔진의 `console.warn(query, error)`도 제거해 검색어/주소나 SDK 오류 원문이 노출되지 않게 했다. 앱의 기존 다른 로그까지 정리하거나 인증 코드를 변경한 것은 아니다.

주요 필드:

| 영역 | 필드 및 의미 |
| --- | --- |
| request | 요청 활동/식사 유형. 알 수 없는 사용자 입력은 unknown |
| search | planned/succeeded/failed/empty, 요청별 sdkStatus/outcome/resultCount/failureStage |
| search | rawCount → uniqueCount, duplicateExcluded, coordinateExcluded → coordinateValid |
| filter | ratingExcluded → priceExcluded → categoryExcluded → candidates. 순서대로 적용되는 장소별 제외 수 |
| filter | missingRating/missingPrice: 좌표 유효 후보의 정보 누락 수. 제외 수가 아님 |
| filter | requiredSlots/targetSlots, slotMatches의 슬롯별 수치 필터 전후 매칭 수 |
| filter | availableMinutes/minimumStayMinutes/invalidTimeRange. 절대 시작·종료 시각은 출력하지 않음 |
| combination | usedExcluded/slotMismatchExcluded/invalidTravelExcluded/travelLimitExcluded/timeLimitExcluded/totalBudgetExcluded |
| combination | visits/duplicateExcluded/accepted/searchLimitReached |

**집계 해석:** search와 filter는 장소 집합의 건수다. combination은 재귀 탐색의 후보 시도 횟수이므로 동일 장소가 여러 분기에서 반복 집계된다. 두 영역의 숫자를 단순 합산하거나 시도 횟수를 고유 장소 수로 읽으면 안 된다. 슬롯 매칭 수도 한 장소가 여러 슬롯에 맞을 수 있어 단순 합과 전체 후보 수가 같을 필요는 없다. 탐색하지 않은 단계의 카운터는 0 또는 null이다.

## 4. SDK 상태와 HTTP 상태 구분

현재 검색은 직접 REST fetch가 아니라 Kakao JS SDK다. 콜백에서 확인 가능한 상태는 OK, ZERO_RESULT, ERROR이며 숫자 HTTP 상태는 제공되지 않는다.

- OK + 결과 존재: 성공
- OK 또는 ZERO_RESULT + 빈 배열: 정상 검색 완료, 결과 0개
- ERROR: SDK 콜백 오류
- sdk_load: services SDK 사용 불가
- sdk_request: SDK 생성/요청 중 예외 또는 분류 불가 예외

진단의 `httpStatus: null`, `httpStatusAvailable: false`는 상태를 관측하지 못했다는 뜻이다. OK를 HTTP 200으로 바꾸지 않는다. 실제 HTTP 상태가 필요하면 같은 실행의 브라우저 Network에서 Kakao 검색 요청 상태를 확인해야 한다. 원본 URL·헤더·응답 본문 대신 요청 순번과 상태 숫자만 기록한다. SDK가 콜백을 호출하지 않아 대기하면 시작 로그와 완료된 요청 로그까지만 남는다. 임의 timeout/재시도는 추가하지 않았다.

최종 outcome:

- api_failure_all: 모든 검색 실패
- api_failure_partial_empty: 일부 검색 실패, 성공 요청에서도 후보 없음
- search_empty: 오류 없이 결과 0개
- coordinates_empty: 고유 검색 결과는 있지만 유효 좌표 후보 0개
- no_combination: 좌표 후보는 있으나 필터/조합 실패
- success: 유효 코스 생성
- missing_input: 조건 또는 일정 입력 없음

## 5. 실제 40/177 재현 절차

1. 변경된 파일이 반영된 frontend 개발 서버를 `npm start`로 실행한다. production build에서는 진단 로그가 나오지 않는다. 다른 백엔드나 DB 작업을 시작할 필요는 없다.
2. 브라우저 Console의 Info를 활성화하고 필터에 `MeetUP course`를 입력한다. 이전 전체 Console 로그는 보내지 않는다.
3. 모임 40·일정 177의 **조건 화면**에서 기존 조건을 유지한 채 추천을 한 번 실행한다. 결과 화면 새로고침만 하면 저장 결과만 복구할 수 있다.
4. 최종 `[MeetUP course diagnostic]` JSON 한 줄을 확인한다. 아직 최종 로그가 없다면 start/요청 완료 로그의 존재 여부만 확인한다.
5. start도 없으면 최신 개발 코드인지, Info 필터인지, 입력 검사에 막혔는지, 실제 생성 버튼을 눌렀는지 확인한다. start만 있으면 검색 대기/SDK 실행 경로를 확인한다.
6. 요청별 HTTP 상태는 필요할 때 Network에서 숫자만 기록한다. 민감한 원본 로그·URL·헤더·스크린샷은 공유하지 않는다.

이 절차는 추천 검색과 계산만 실행하며 일정 177의 삭제·재생성이나 DB 쓰기를 요구하지 않는다.

## 6. 숫자 확인 후 최소 수정 범위

| 관측 결과 | 우선 확인 및 최소 수정 대상 |
| --- | --- |
| sdk_load 실패 | SDK services 초기화/로딩 경로. 키 변경이나 필터 완화부터 하지 않음 |
| SDK ERROR | Network 숫자 상태·SDK 권한/차단 여부 확인 후 검색 래퍼만 검토 |
| search_empty | 요청 유형·중심 fallback·반경 확인 후 검색어 생성 범위 검토 |
| coordinateExcluded 과다 | 래퍼의 좌표 변환·응답 필드 점검. 없는 좌표를 생성하지 않음 |
| slotMatches의 특정 슬롯 matches=0 | 해당 식사/활동의 실제 카테고리와 검색어·매칭 사전을 근거로 대조 |
| categoryExcluded 과다 | 활동/식사 매칭 경계 점검. 모든 후보 허용으로 우회하지 않음 |
| availableMinutes < minimumStayMinutes | 실제 일정 범위와 채울 장소 수 확인. 고정 기본 장소 수 정책 수정이 필요한지 별도 판단 |
| travelLimitExcluded 과다 | 실제 후보 분포·이동 수단·최대 이동 시간 확인. 추정 시간 검증 후 해당 계산만 검토 |
| totalBudgetExcluded 과다 | 알려진 비용 합과 실제 예산 비교. 누락값을 임의 0원으로 채우지 않음 |
| searchLimitReached=true | 제약을 유지한 채 탐색 순서/가지치기 최적화 검토 |

아직 실제 관측 수치가 없으므로 위 후보 중 하나를 원인으로 확정하거나 수정하지 않았다.

## 7. 변경 파일 및 검증

- 신규: frontend/src/utils/courseRecommendationDiagnostics.js
- 수정: frontend/src/utils/courseRecommendationEngine.js — 단계별 계수 및 안전한 로그 연결만 추가. 기존 후보 조건·시간 검사·중복 방지·최대 5개·반환 구조 유지
- 수정: frontend/src/api/kakaoPlacesApi.js — 선택적 진단 콜백 및 고정 오류 단계. 기존 검색 결과 배열 유지
- 신규 테스트: frontend/src/utils/courseRecommendationDiagnostics.test.js, frontend/src/api/kakaoPlacesApi.test.js

모의 검증 예: 3회 검색마다 후보 5개를 반환하는 fixture에서 원본 15 → 고유 5 → 좌표 제외 1 → 유효 4 → 평점 제외 1 → 비용 제외 1 → 카테고리 제외 1 → 후보 1 → 코스 1을 확인했다. 이는 일정 177의 숫자가 아니다.

API 오류/정상 0개 구분, 슬롯별 누락 후보, 시간 한도·이동 한도·총예산 분기, 안전한 로그, production 로그 차단, SDK 오류 단계를 테스트했다. 실제 Kakao API 또는 사용자 브라우저의 추천 실행은 수행하지 않았다.

최종 실행 결과:

- frontend `CI=true npm test -- --watchAll=false --runInBand`: **14개 스위트, 141개 통과 / 실패 0개**. 기존 130개와 신규 진단·래퍼 테스트 11개 포함.
- frontend `npm run build`: 성공, 기존 다른 파일의 ESLint 및 Node deprecation 경고 유지.
- git diff --check: 이번 수정의 검사 대상 파일 통과.
- 실제 40/177의 필터별 숫자: **미수집**. 개발 Console의 새 진단 JSON이 필요하며, 이번 모의 계수를 실제 결과로 대체해 보고하지 않았다.

위 결과는 후속 로그 수신 전의 검증 기록이다. 후속 최소 수정에 대한 최종 검증 결과는 아래에 별도로 기록한다.

## 8. 후속 실제 진단 결과 및 수정

사용자가 브라우저에서 재실행한 JSON의 실제 수치:

| 단계 | 관측값 |
| --- | --- |
| 선택 조건 | 활동 5종 + 아침/점심/저녁 각 any, transit |
| 필수 슬롯 | 8개 |
| 검색 계획/완료 | 1회 / 1회 |
| 검색 유형 | region_or_other, usesFallbackCenter=true, 반경 12,000m |
| SDK 결과 | ZERO_RESULT, 성공 1 / 실패 0 / 빈 응답 1 |
| 실제 HTTP 숫자 상태 | SDK에서 미제공(null), 추측하지 않음 |
| 원본/고유/좌표 유효 장소 | 모두 0개 |
| 평점/비용/카테고리/시간/이동 제외 | 모두 0. 검색 후보가 없어 해당 검증·탐색은 실행되지 않음 |
| 탐색 방문/성공 조합 | 0 / 0 |
| 최종 outcome | search_empty |

**확정된 원인 범위:** 이번 실행은 API 오류가 아니라 정상 검색 응답에 결과가 없었다. 좌표 없는 일정에서 선택한 활동·식사 키워드가 빠지고 지역 문자열만 검색되는 코드 경로가 실제 실행되었다. 그 지역 문자열이 왜 0건이었는지(정확한 검색 문구, 검색 서비스의 지역 해석 등)는 로그에서 제거되어 있어 별도로 단정하지 않는다. 예전의 조합 실패 문구와 달리 이번 실제 실행의 최종 경로는 search_empty다.

최소 수정:

- 기준 좌표가 없을 때도 **지역 + 선택 장소 유형**을 함께 검색한다. 이 분기에서만 기존 영어 유형을 한국어 검색어로 매핑하고 중복 검색어를 제거한다. 지역 단독 검색도 보조로 유지한다.
- 이 조건에서는 지역이 비어 있지 않다면 활동·식사에서 유도된 고유 유형 10개 + 지역 보조 검색 1개로 계획 11회를 예상한다. 검색 결과가 실제로 생긴다는 보장은 아니며 재실행 로그로 확인해야 한다.
- 좌표 없는 요청에 임의의 서울 중심 좌표와 반경을 넣던 처리를 제거했다. Kakao 키워드 SDK에 location/radius/거리 정렬을 생략하여 지역이 포함된 검색 문구를 사용한다. 기준 좌표가 있으면 기존 주변 검색 범위·거리 정렬을 유지한다.
- 새 진단은 `hasLocationBias`로 실제 중심 사용 여부를 표시하며, 기본 중심을 쓰지 않으므로 usesFallbackCenter=false다. 좌표 없는 요청의 radiusMeters는 null이다. 실제 지역 문자열은 계속 로그에 노출하지 않는다.
- 필수 슬롯 8개, 식사·활동 매칭, 시간/이동/예산/평점 검증, 조합 중복 제거와 최대 5개 규칙은 완화하지 않았다. 검색 후보가 생기면 이후에 별도 제약에 걸릴 수 있으므로 그때의 다음 로그를 확인해야 한다.

추가 회귀 테스트 3개: 좌표 없는 지역+유형 검색 및 후보 생성, 5개 활동/3개 식사의 검색어 보존, SDK에 임의 위치/반경/거리 정렬을 전달하지 않음. 추가로 수정된 파일은 기존 엔진·Kakao 래퍼·안전한 유형 목록과 관련 테스트다. 실제 API 재호출·DB 쓰기는 하지 않았다.

후속 수정 후 전체 테스트 **14개 스위트 / 144개 통과, 실패 0개**. 프로덕션 빌드 성공, 기존 ESLint 경고 유지. 실제 사용자 브라우저에서의 수정 후 Kakao 결과는 재검증 대기다.
