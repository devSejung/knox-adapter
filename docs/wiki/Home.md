# PlatformClaw Knox Adapter Wiki

이 위키는 `knox-adapter`의 설계, API 계약, 운영/배포, 테스트 흐름을 한 번에 보기 위한 문서 모음이다.

## 문서 목록

- [개요 / README](../../README.md)
- [설계 문서](./Architecture-and-Design.md)
- [Proxy-Adapter API 계약](./Proxy-Adapter-API.md)
- [Knox Proxy 개발자 가이드](./Knox-Proxy-Developer-Guide.md)
- [동작 흐름 예시](./Flow-Example.md)
- [Mock Proxy 테스트 가이드](./Mock-Proxy-Test-Guide.md)
- [Docker 배포 가이드](./Docker-Deployment.md)

## 권장 읽기 순서

1. README
2. 설계 문서
3. Proxy-Adapter API 계약
4. Knox Proxy 개발자 가이드
5. 동작 흐름 예시
6. 테스트 / 배포 가이드

## 현재 구현 핵심

- Knox inbound 메시지 수신
- Proxy -> Adapter HMAC 검증
- 사용자 -> `agentId` 매핑
- `sessionKey` 생성 정책 적용
- SQLite 기반 dedupe 및 상태 저장
- PlatformClaw Gateway websocket/RPC client
- websocket `chat.send` 실패 시 `/v1/responses` 자동 폴백
- Proxy outbound 최종 응답 전달
