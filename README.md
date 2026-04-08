# PlatformClaw Knox Adapter 개요

PlatformClaw와 회사 Knox Proxy 사이를 연결하는 독립 어댑터 서비스다.

## 목적

이 서비스는 아래 두 시스템 사이의 브리지 역할을 한다.

- 회사 Knox Proxy API
- PlatformClaw Gateway

어댑터를 Gateway 본체와 분리한 이유는 다음과 같다.

- Knox 전용 연동 로직을 독립적으로 변경할 수 있어야 한다.
- 회사 내부 인증, 사용자 매핑, 운영 정책을 어댑터 쪽에서 별도로 통제할 수 있어야 한다.
- Knox 연동 문제로 PlatformClaw Gateway 전체가 흔들리지 않게 해야 한다.

## 현재 구현 범위

현재 포함된 기능:

- Knox inbound 메시지 수신
- Proxy -> Adapter HMAC 요청 검증
- 사용자 -> agent 매핑
- `sessionKey` 생성 정책 적용
- SQLite 기반 중복 방지 및 상태 저장
- PlatformClaw Gateway WebSocket/RPC 클라이언트
- 실제 Gateway에서 websocket `chat.send`가 막힐 때 `/v1/responses`로 자동 폴백
- 최종 응답(`final-only`) 기반 Proxy outbound 전달

아직 남아 있는 기능:

- 첨부파일 relay
- 단계별 진행 메시지(stage updates)
- 그룹방 정책
- 실제 Proxy/Gateway 통합 테스트 보강

실제로 확인된 수정 사항:

- `PLATFORMCLAW_USE_DEVICE_IDENTITY=false`가 문자열 `"false"`일 때도 올바르게 `false`로 파싱되도록 수정
- Gateway websocket 연결 경로를 어댑터 전용 raw websocket client로 정리
- 실제 Gateway `19001`에 대해 password 기반 `connect` 성공 확인
- `PROXY_OUTBOUND_URL`이 비어 있으면 성공처럼 기록하지 않고 `outbound_skipped`로 기록하도록 수정

실제로 확인된 동작:

- 현재 Gateway websocket에서 `chat.send`는 `operator.write` 권한이 있어야 한다.
- password/shared secret만으로 websocket에 붙으면 `connect`는 가능하지만 `chat.send`는 `missing scope: operator.write`로 막힐 수 있다.
- Adapter는 이 경우 `/v1/responses`로 폴백한다.
- 현재 `PLATFORMCLAW_TRANSPORT=auto`에서는 shared-secret 환경이면 처음부터 `/v1/responses`를 우선 사용한다.
- `/v1/responses`는 shared-secret bearer auth에서 정상적으로 최종 응답을 반환하는 것을 실제 Gateway로 검증했다.

저장소 관련 참고:

- 현재는 Node 내장 `node:sqlite`를 사용한다.
- 초기 구현 단계에서 네이티브 addon 빌드 문제를 피하려고 선택했다.
- 현재 Node 24에서는 experimental 경고가 출력된다.
- 운영 고정 전에는 이 선택을 검증하거나 회사 표준 저장소로 교체해야 한다.

## 디렉토리 구성

- `src/config.ts`: 환경변수 로더
- `src/server.ts`: HTTP 서버 부트스트랩
- `src/service.ts`: inbound -> gateway -> outbound 오케스트레이션
- `src/store.ts`: SQLite 기반 durable 상태 저장
- `src/auth.ts`: Proxy HMAC 검증
- `src/routing.ts`: employee/agent/session 정책
- `src/platformclaw-gateway.ts`: PlatformClaw Gateway WebSocket/RPC 클라이언트
- `src/outbound-client.ts`: Proxy outbound 전달 클라이언트
- `src/types.ts`: 공용 타입
- `src/schemas.ts`: inbound payload 스키마

## 실행 방법

```bash
cd /home/eon/work/open_claw/knox-adapter
corepack pnpm install
cp .env.example .env
corepack pnpm check
corepack pnpm dev
```

제공하는 HTTP 엔드포인트:

- `GET /healthz`
- `GET /readyz`
- `POST /api/v1/platformclaw/knox/inbound`

## PlatformClaw 쪽에서 필요한 것

Adapter를 실제로 사용하려면 PlatformClaw 쪽에서도 몇 가지 전제가 필요하다.

### 1. Gateway 인증 정보

둘 중 하나는 반드시 준비되어야 한다.

- `PLATFORMCLAW_GATEWAY_PASSWORD`
- `PLATFORMCLAW_GATEWAY_TOKEN`

현재 로컬 검증에서는 아래 구성이었다.

- Gateway URL: `ws://127.0.0.1:19001`
- Gateway auth mode: `password`
- Gateway password: `CHANGE_ME_ADMIN_PASSWORD`

### 2. 실제 메시지 실행 경로

중요:

- `connect` 성공과 `chat.send` 성공은 다르다.
- 현재 Gateway는 websocket `chat.send`에 `operator.write`가 필요하다.
- shared secret만으로 연결하면 scope가 좁게 적용되어 `chat.send`가 실패할 수 있다.

현재 Adapter 동작:

- 먼저 websocket `chat.send`를 시도한다.
- `missing scope: operator.write`가 발생하면 `/v1/responses`로 자동 폴백한다.
- 따라서 현재 회사 반입 기준으로 반드시 필요한 것은 아래 두 가지다.
  - Gateway shared secret(`password` 또는 `token`)
  - `POST /v1/responses` 활성화

### 3. OpenClaw 설정 파일

Adapter 자체를 위해 `openclaw.json`을 크게 뜯어고칠 필요는 없다.
다만 아래는 확인해야 한다.

- `gateway.bind`
- `gateway.port`
- `gateway.auth.mode`
- `gateway.auth.password` 또는 `gateway.auth.token`
- `gateway.http.endpoints.responses.enabled`

예시:

```json
{
  "gateway": {
    "bind": "loopback",
    "port": 19001,
    "auth": {
      "mode": "password",
      "password": "CHANGE_ME_ADMIN_PASSWORD"
    },
    "http": {
      "endpoints": {
        "responses": {
          "enabled": true
        }
      }
    }
  }
}
```

참고:

- 저장소의 [exam_emp_openclaw.json](/home/eon/work/open_claw/openclaw/exam_emp_openclaw.json)은 Knox Adapter 연동 기준 예시로 바로 참고할 수 있다.
- 현재 이 예시 파일에는 아래 항목이 이미 포함돼 있다.
  - `gateway.auth.mode = "password"`
  - `gateway.auth.password`
  - `gateway.http.endpoints.responses.enabled = true`

참고:

- `gateway.controlUi.allowedOrigins`는 Control UI 브라우저 origin 제한용이다.
- 현재 Adapter 연결 문제의 핵심 원인은 이 설정이 아니었다.

## 운영 메모

- `readyz`는 저장소 상태, Gateway URL 설정, Proxy outbound URL 설정, HMAC 필수값 존재 여부를 기준으로 판단한다.
- 현재 `readyz`는 실제 Gateway 연결 성공 여부까지 실시간 확인하지는 않는다.
- `PROXY_OUTBOUND_URL`이 없으면 outbound 전달은 수행되지 않으며, 상태는 `outbound_skipped`로 기록된다.
- 어댑터는 PlatformClaw를 파일시스템 의존성이 아니라 WebSocket/RPC 대상 시스템으로 취급한다.

추가 운영 메모:

- 현재 Adapter는 실제 Gateway에 대해 아래를 검증했다.
  - websocket `connect` 성공
  - websocket `chat.send`가 `operator.write` 부족으로 실패하는 상황 감지
  - `/v1/responses` 자동 폴백 후 최종 응답 수신
  - Proxy outbound 전달 성공
- 따라서 현재 반입 기준 핵심 확인 사항은 아래다.
  - Gateway shared secret 준비
  - `/v1/responses` 활성화
  - Proxy outbound API 응답 코드/재시도 정책

## 최종 운영 결론

현재 구조 기준 최종 결론은 아래와 같다.

- 회사에 `Knox Proxy`가 있고
- `PlatformClaw Adapter`가 배포되어 있으며
- PlatformClaw Gateway에서 `/v1/responses`가 활성화되어 있으면
- Knox 수신/발신은 정상 구조로 동작한다.

즉 실제 흐름은 아래와 같다.

1. Knox 사용자가 메시지 전송
2. Knox Proxy가 메시지 수신
3. Knox Proxy가 Adapter inbound API 호출
4. Adapter가 `agentId`, `sessionKey` 계산
5. Adapter가 PlatformClaw Gateway에 요청
6. PlatformClaw가 답변 생성
7. Adapter가 Proxy outbound API 호출
8. Knox Proxy가 Knox 발신 API 호출

중요:

- "Proxy만 있으면 된다"는 표현은 정확하지 않다.
- 정확한 표현은 "Proxy가 있고, Adapter가 있고, Gateway 설정이 맞으면 된다"이다.
- Adapter는 Knox와 PlatformClaw 사이의 브리지이므로 필수 구성요소다.

실서비스 기준 최소 전제:

- Knox Proxy 구현 완료
- Adapter 배포 완료
- Gateway shared secret 준비
- `gateway.http.endpoints.responses.enabled = true`

추가 조건:

- Proxy가 `employeeId` 또는 `employeeEmail`을 올바르게 전달해야 한다.
- Proxy 요청/응답 계약은 [KNOX_PROXY_API.ko.md](/home/eon/work/open_claw/knox-adapter/KNOX_PROXY_API.ko.md)와 일치해야 한다.

이 조건이 맞으면 회사에서는 Knox Proxy가 Adapter에 HTTP 요청만 보내면 되고, 이후 PlatformClaw 응답 생성과 Proxy outbound 호출은 Adapter가 처리한다.

## 문서

- Knox Proxy 상위 계약: [KNOX_PORXY_SPEC.md](/home/eon/work/open_claw/KNOX_PORXY_SPEC.md)
- Knox Proxy 개발자 가이드: [KNOX_PROXY_DEVELOPER_GUIDE.ko.md](/home/eon/work/open_claw/knox-adapter/KNOX_PROXY_DEVELOPER_GUIDE.ko.md)
- Proxy/Adapter API 계약: [KNOX_PROXY_API.ko.md](/home/eon/work/open_claw/knox-adapter/KNOX_PROXY_API.ko.md)
- 전체 흐름 예시: [FLOW_EXAMPLE.ko.md](/home/eon/work/open_claw/knox-adapter/FLOW_EXAMPLE.ko.md)
- Mock Proxy 테스트 가이드: [MOCK_PROXY_TEST.ko.md](/home/eon/work/open_claw/knox-adapter/MOCK_PROXY_TEST.ko.md)
- Docker 배포 문서: [DOCKER_DEPLOY.ko.md](/home/eon/work/open_claw/knox-adapter/DOCKER_DEPLOY.ko.md)
- 상세 설계/운영 계획: [ADAPTER_PLAN.ko.md](/home/eon/work/open_claw/knox-adapter/ADAPTER_PLAN.ko.md)
