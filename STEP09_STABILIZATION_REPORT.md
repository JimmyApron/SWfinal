# STEP 09 Supabase 진단 및 추천 중복 수정

## 1. HTTP 401 진단 결과

실제 실행: `node scripts/step09-diagnose.cjs`. 네트워크 승인을 받아 **GET /rest/v1/ 메타데이터 요청 2개만** 실행했다. SQL 실행, 테이블 행 조회, DB 쓰기는 하지 않았다.

| 확인 항목 | 실제 결과 |
| --- | --- |
| URL 구성 | HTTPS, 표준 프로젝트 호스트 형식, 루트 경로 |
| 프론트/백엔드 URL | 동일 |
| 키 형식/claim | legacy JWT anon, 현재 실행 시각에 미만료 |
| JWT 프로젝트 식별자 | URL 호스트와 일치. JWT 서명을 검증했다는 의미는 아님 |
| REST 경로 | 프로젝트 기본 URL + /rest/v1/ |
| apikey 단독 | HTTP 401, 응답 메시지에서 Invalid API key 분류 확인 |
| apikey + Authorization: Bearer anon JWT | 동일 HTTP 401 및 Invalid API key 분류 |
| 별도 오류 code | 응답에 식별 가능한 code 없음. 임의 코드를 만들지 않음 |
| supabase-js 비로그인 헤더 | 외부 요청 없는 가짜 fetch에서 apikey=설정 키, Authorization=Bearer 설정 키 확인 |
| 로컬 설정 덮어쓰기 | .env.local/.env.development/.env.development.local 없음. 현재 실행 프로세스의 연결 환경 변수 override 없음 |

**확인 가능한 원인 수준:** 현재 .env의 키가 해당 엔드포인트에서 API 키로 거절된다. apikey 또는 Authorization 누락만으로 발생한 문제는 아니며 URL 형식·프로젝트 식별자 불일치·만료 역시 이번 점검의 근거가 아니다. 키 폐기/교체·서명 설정 변경·프로젝트/게이트웨이 구성 중 무엇이 원인인지는 대시보드 확인 없이 확정할 수 없다. 401을 해결했다고 보고하지 않는다.

기존 React는 환경 변수로 Supabase 클라이언트를 생성하고 로그인 세션이 있으면 사용자 access token을 Authorization에 사용한다. 이전 진단 스크립트는 .env를 직접 읽고 apikey만 보냈다. 새 진단은 legacy anon JWT의 두 헤더 방식을 비교했다. publishable 키는 JWT가 아니므로 apikey-only로 진단하며 임의로 Bearer JWT처럼 취급하지 않는다. 실제 로그인 사용자 토큰으로 접속한 것은 아니다. 배포 환경의 주입 변수나 브라우저 세션은 별도 확인이 필요하다.

기존 step08-readonly.cjs도 JWT인 경우 anon bearer를 추가하고 실패 응답의 오류 code/분류만 안전하게 출력하도록 개선했다. 진단기는 임의 응답 본문, 키, JWT, 프로젝트 호스트/식별자, 비밀번호를 출력하지 않는다. 저장된 URL·키는 교체하지 않았다.

사용자 확인 순서:

1. Supabase 대시보드에서 대상 프로젝트가 맞는지 확인한다.
2. 프로젝트의 API URL 및 현재 유효한 브라우저용 anon/publishable 키를 로컬 .env와 직접 대조한다. 키를 채팅·보고서·커밋에 붙여 넣지 않는다.
3. 키 폐기/교체 이력 및 프로젝트 상태를 확인한다. 값 변경이 필요하면 사용자가 승인한 뒤 진행한다. 백엔드 키와 프론트 키를 무조건 동일하게 만들지 않는다.
4. 변경 승인 및 설정 후 프로세스를 재시작하고 메타데이터 진단을 재실행한다. 사용자 로그인 JWT를 익명 API 키 자리에 사용하거나 Service Role을 프론트엔드에 넣지 않는다.

## 2. 읽기 전용 DB 확인 절차

`scripts/step08-schema-audit.sql`을 보강했다. 소유자가 Supabase SQL Editor에서 내용을 검토하고 직접 실행한다. 이번 작업에서는 실행하지 않았다. 모든 문장은 메타데이터 SELECT다.

결과 확인 순서:

1. 첫 결과에서 코스 관련 신규 테이블 6개 `courses`, `course_stops`, `vote_course_links`, `course_member_confirmations`, `schedule_creation_records`, `schedule_finalizations`가 모두 존재하는지 확인한다.
2. 컬럼 목록에서 실제 이름·data_type·udt_name·nullable을 확인한다. 특히 bigint 일정/코스 ID, 회원·게스트 uuid, voter response의 TEXT userid, absentees의 uuid[]를 확인한다.
3. 제약 목록에서 PK(p), FK(f), UNIQUE(u)의 실제 이름과 정의를 확인한다. votes.scheduleid → confirmed_schedules, voteoptions.voteid → votes, voteresponses의 투표/선택지 관계, vote_course_links의 vote_id/vote_option_id/course_id, 코스/장소/확정 기록의 연결을 대조한다.
4. `getVoteDetail`에서 사용하는 **vote_options_voteid_fkey**가 실제로 존재하고 voteoptions.voteid를 연결하는지 확인한다. 관계 이름이 다르면 SQL 결과를 근거로 PostgREST 조회 코드를 수정해야 하며 이름을 추측해 바꾸지 않는다.
5. 인덱스 목록에서 schedule_creation_records.schedule_id, schedule_finalizations.schedule_id의 UNIQUE와 course_member_confirmations의 `UNIQUE(schedule_id, participant_key) WHERE is_active = true`를 확인한다. 부분 UNIQUE는 pg_constraint에 나타나지 않을 수 있으므로 인덱스 결과도 함께 본다.

현재 실제 스키마 결과는 확보하지 못했다. 관계·타입·FK 이름이 검증 완료된 것은 아니다. RLS/GRANT 변경이나 과거 데이터 추정 입력도 하지 않았다.

## 3. 중복의 정확한 원인과 연관 오류

- 매 코스 반복마다 usedIds를 빈 집합으로 만들고 동일한 scoredPlaces 앞에서부터 find했다. index는 이름 변경에만 쓰여 같은 장소들이 다시 선택됐다.
- 코스 간 장소 조합을 비교하는 집합이 없었다. 같은 장소들의 순서만 달라져도 중복 여부를 판단하지 못했다.
- 장소 중복 키가 ID와 주소를 함께 사용해 같은 ID의 주소 표기 차이가 별도 후보로 남을 수 있었다.
- activities/mealPreferences는 검색어 생성에만 쓰이고 실제 해당 활동·식사 장소를 선택하는 검사에는 연결되지 않았다.
- 키워드를 categorySearch의 category 인자로 넘겼다. 해당 API 래퍼가 알 수 없는 키워드를 음식점 코드로 바꾸어 활동/식사 검색 의도가 손실됐다.
- map으로 방문 시간을 만들면서 아직 계산 결과가 없는 원본 이전 장소의 visitEndTime을 읽어, 두 번째 이후 장소가 같은 기본 시작 시각 근처로 돌아갈 수 있었다. maxTravelMinutes·종료 시간도 실질적으로 검사하지 않았다.

## 4. 수정 파일

신규:

- scripts/step09-diagnose.cjs
- scripts/step09-diagnose.test.cjs
- frontend/src/utils/courseRecommendationEngine.test.js
- frontend/src/pages/course/CourseRecommendationResultPage.test.jsx
- 이 보고서

수정:

- scripts/step08-readonly.cjs: 안전한 오류 분류·JWT 헤더
- scripts/step08-schema-audit.sql: 신규 6개 테이블 존재 및 관련 인덱스·제약 범위 확장
- frontend/src/utils/courseRecommendationEngine.js: 후보 선택·조합 중복 제거·식사/활동·시간/수치 검증
- frontend/src/api/courseRecommendationApi.js: 저장/복구 시 동일 조합 제거
- frontend/src/pages/course/CourseRecommendationResultPage.jsx: state의 기존 중복 제거, 실제 개수·경고·누락 비용 표시
- frontend/src/api/courseFlow.integration.test.js: 실제 수정된 키워드 검색 경계에 맞춘 모의 검색 연결

## 5. 다양성 및 조건 유지 방식

검색·점수 체계와 반환 데이터 구조는 유지하고 후보 선택 부분을 교체했다. 실제 검색 결과만 사용하며 가짜 장소는 생성하지 않는다.

- 장소는 provider + ID로 중복 제거한다. ID가 없는 검색 결과만 실제 이름/주소를 fallback 식별값으로 쓴다.
- 코스는 provider + 장소 ID들의 **정렬된 집합 서명**을 비교한다. 같은 장소들의 방문 순서만 바꿔도 별도 코스로 추천하지 않는다.
- 식사별 음식 종류와 선택 활동을 필수 슬롯으로 검사한다. 맞는 후보가 없으면 다른 종류로 임의 대체하지 않는다. 추가 장소도 선택 조건에 맞는 실제 후보에서 고른다.
- 점수, 기존 코스에서의 장소 사용 횟수, 동선 우선 시 이전 장소와의 예상 이동 시간을 사용해 후보를 정렬한다. 기존 코스와 덜 겹치는 후보를 우선 시도한다.
- 중복되지 않는 조합을 최대 5개까지만 생성한다. 실제 후보·시간 조건으로 적게 만들어지면 있는 개수만 반환한다. 탐색은 5,000회로 제한해 브라우저에서 조합 폭발을 피하며 모든 가능한 조합을 완전 탐색한다는 보장은 없다.
- 이전 종료 시각을 누적하여 다음 방문 시간을 계산한다. 각 이동 구간의 maxTravelMinutes, 일정 시작/종료, 장소 내 중복 방문을 검사한다. 잘못되거나 당일 종료가 시작보다 이른 시간 범위는 반환하지 않는다. 자정 넘김 일정은 지원하지 않는다.
- 좌표 누락·빈 값·범위 밖 좌표는 후보에서 제외한다. 알려진 최소 평점 미달·개별/코스 총예산 초과는 제외한다.
- 기존 누락 평점·비용 처리처럼 미제공 값은 추정하지 않는다. 누락 정보가 있는 후보를 사용할 수 있으나, 최소 평점/예산 조건이 있으면 **충족 여부를 확인할 수 없다는 warning**을 반환하고 결과 화면에도 표시한다. 모든 후보가 조건을 충족한다고 단정하지 않는다. 비용이 하나라도 없으면 전체 예상 비용은 null이며 `비용 정보 없음`으로 표시한다. 알려진 비용의 합이 예산을 넘으면 누락값 유무와 관계없이 제외한다.
- 기존 state/localStorage에 남은 이름만 다른 중복도 표시·복구 시 제거한다. 화면의 실제 코스 개수 및 선택 후 투표 전달 ID가 유지된다. 이 처리는 과거 캐시의 다른 조건·시간 오류까지 재검증하거나 과거 DB 코스를 변경하는 마이그레이션은 아니다. 이전 결과는 조건 화면에서 다시 추천받아 검증해야 한다.

이동 시간·거리는 기존 좌표 기반 **추정 방식**이다. 실제 경로 API 또는 실제 영업시간을 검증한 것은 아니며 실제 도로 이동·영업 가능성을 보장하지 않는다.

## 6. 중복 방지 및 조건 테스트

새 엔진 테스트 21개와 결과 화면 테스트 1개를 추가했다.

- 충분한 후보에서 5개 다른 조합, 순서만 다른 동일 조합 차단
- 동일 ID/다른 주소 표기 중복 제거, 후보 1·2·3개에서 부풀리기 없이 1개 조합 반환, 빈 후보
- 아침/점심/저녁별 음식 선호, 활동 다중 선택과 무관한 장소 제외, 불가능한 식사 조건
- 누적 방문 시간/소요 합계, 이동 시간 한도, 종료 시간, 부족·잘못된 일정 범위
- 알려진 평점/총예산 제약, 누락 좌표/평점/비용과 조건 미확인 안내
- 코스 선택 → 저장/투표 데이터 전달, 기존 state/캐시 중복 제거
- 외부 검색 실패 시 가짜 코스 없이 빈 결과

모의 Kakao 검색으로 실행한 테스트다. 실제 장소 API 호출 성공 검증은 아니다.

진단 출력 단위 테스트 3개도 실행했다. 임의 오류 본문·JWT 문자열이 출력 결과에 포함되지 않는지와 오류 code가 없을 때 만들어 내지 않는지 확인한다.

## 7. 전체 회귀 테스트

frontend 디렉터리:

```powershell
$env:CI='true'
npm test -- --watchAll=false --runInBand
```

**12개 스위트 / 130개 테스트 통과, 실패 0개.** 기존 App 및 STEP 05~08 투표·개인 확정·전원 동의·최종 확정·로드맵·공유 회귀와 API 통합 테스트를 포함한다.

저장소 루트:

```powershell
node --test scripts/step09-diagnose.test.cjs
```

**3개 통과, 실패 0개.** 프론트엔드 130개와 별도 집계한다.

## 8. 빌드

frontend의 `npm run build` 최종 성공. 기존 다른 파일의 unused 변수·Hook dependency 및 Node deprecation 경고는 남아 있다. 이번 단계에서 일반/일정/장소 투표, 개인·최종 확정, 로드맵, 채팅, 인증 코드를 변경하지 않았다.

## 9. 실DB·외부 API 검증 여부

- Supabase 메타데이터 GET 실제 실행: 두 요청 모두 401 / invalid_api_key 분류로 실패.
- 실제 DB 스키마 SQL: 미실행. 사용자가 실행할 SELECT 파일만 제공.
- 실제 행 조회·INSERT·UPDATE·DELETE: 미실행.
- 실제 Kakao/Google 장소·경로 API: 미실행. 검색 결과는 테스트 fixture 사용.
- 키 교체·DB 스키마·RLS·GRANT·회원/게스트 인증 변경: 없음.

## 10. 남은 실환경 확인

대시보드에서 유효 키와 프로젝트 상태를 확인하고 401을 먼저 해결해야 한다. 이후 SQL Editor의 읽기 전용 검증 결과로 FK·타입·인덱스를 대조한다. 테스트 전용 프로젝트/모임과 쓰기 범위를 명시적으로 승인받은 뒤 기존 STEP 08 절차대로 전체 사용자 흐름을 실행한다.

실제 Kakao 검색의 한국어 카테고리·장소 분류와 음식 선호 매칭, 후보 다양성, 평점·비용 제공 여부, API 실패/할당량, 360/390/768px 화면, 브라우저 새로고침, SDK 키·도메인과 실제 경로 차이는 여전히 실환경 확인 대상이다. 누락 평점·비용으로 조건을 검증할 수 없다는 정책도 실제 사용자 화면에서 확인해야 한다.

기존 서버 권한 강제·게스트 신원 인증·DB 원자성·스냅샷·정확히 한 번 공유 문제는 해결된 것으로 취급하지 않는다.
