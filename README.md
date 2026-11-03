#README


** .env_exam -> .env 로 파일 이름 수정 후 API 키 입력해서 실행하기 **
# 실행 방법

## frontend

cd frontend
npm install
npm start

## backend

cd backend
npm install
node server.js

방 캘린더 Google Drive 백업 설정: [docs/room-drive-backup.md](docs/room-drive-backup.md)

## 실제 도보 경로

`backend/.env`에 `TMAP_APP_KEY`를 설정하고 백엔드를 재시작하세요.
키에는 TMAP 보행자 경로 API 사용 권한이 필요합니다.
동일한 출발·도착 좌표의 성공 응답은 서버 메모리에 15분 동안 최대 500구간 저장합니다.
대중교통 추천 지도에서도 가까운 구간은 TMAP 도보 경로와 비교합니다. 실제 보행 거리 500m 이하는 도보 우선,
500m 초과~1km 이하는 API 소요 시간이 짧은 수단을 표시합니다.
직선거리 1km를 넘는 구간은 TMAP 비교 호출을 생략하고, 가까운 구간의 TMAP 응답은 같은 15분 캐시를 공유합니다.
동시에 들어온 동일 구간 요청도 하나로 합쳐 TMAP 호출을 줄입니다.
실패 응답은 저장하지 않으며, 서버 재시작·캐시 만료·용량 초과 후에는 다시 조회합니다.
코스 추천 결과 화면의 도보 경로 및 대중교통의 가까운 구간 비교에 TMAP 보행자 API를 사용하며,
최종 확정 코스 화면에서는 도보 API를 호출하지 않고 장소 마커만 표시합니다.
경로 조회에 실패하면 직선으로 대체하지 않고 오류를 안내합니다.
지도 아래 이동 시간은 실제 조회 결과이며, 기존 코스 요약·방문 시각은 저장된 추정값입니다.
