# SSH 연결과 독립적인 상시 실행

현재 서버의 사용자 systemd 서비스로 프론트엔드(8080)와 백엔드(5000)를 실행합니다.
`loginctl enable-linger syk15151` 및 두 서비스의 enable 설정을 적용하여 로그아웃 뒤에도 유지하고 부팅 시 시작합니다.
서비스가 종료되면 5초 후 다시 실행합니다. 원격 서버 자체는 켜져 있어야 합니다.
프론트엔드는 기존 `npm start` 개발 서버를 사용합니다.

```bash
# 상태
systemctl --user status meetup-backend meetup-frontend
# 코드/환경 설정 변경 후 재시작
systemctl --user restart meetup-backend meetup-frontend
# 로그
journalctl --user -u meetup-backend -u meetup-frontend -f
# 수동 중지 (다음 부팅에는 다시 시작)
systemctl --user stop meetup-frontend meetup-backend
```

서비스 원본은 `deploy/systemd/`에 있습니다. 설치 위치는
`~/.config/systemd/user/`이며, 각 서비스의 `node.conf` drop-in에 설치 당시 Node 디렉터리를 PATH로 지정했습니다.
Node 버전을 삭제하거나 프로젝트를 이동하면 해당 설정도 수정한 뒤 `systemctl --user daemon-reload` 및 재시작이 필요합니다.

설정 후 공개 주소의 HTTP 200과 `/api/rooms/0/locations`의 JSON 응답을 확인했습니다.
실제 서버 재부팅 검증은 수행하지 않았습니다.
