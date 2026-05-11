# PlatformClaw Knox Adapter 설계 문서

## 1. 목적

이 문서는 `knox-adapter`를 실제 서비스 가능한 수준으로 구현하기 위한 기준 문서다.

이 어댑터의 역할은 다음 두 시스템 사이를 연결하는 것이다.

- 회사 `Knox Proxy`
- `PlatformClaw Gateway`

이 문서는 MVP가 아니라, 실제 서비스 운영을 염두에 둔 기준을 정리한다.

중요:

- 절대 오류 0은 보장할 수 없다.
- 대신 단일 오류가 전체 장애로 번지지 않게 설계해야 한다.
- 핵심 목표는 `무중단`, `유실 방지`, `중복 방지`, `복구 가능성`, `관측 가능성`이다.

---

## 2. 최종 구조

권장 구조는 다음과 같다.

- `Knox`
- `Knox Proxy`
- `PlatformClaw Adapter`
- `PlatformClaw Gateway`

역할 분리는 반드시 유지한다.

- `Knox Proxy`
  - Knox 원본 API 수신/발신
  - 회사 사용자 식별
  - Knox 인증 및 보안
  - 회사 표준 payload 생성
- `PlatformClaw Adapter`
  - Proxy 표준 payload 수신
  - `agentId`, `sessionKey` 결정
  - PlatformClaw gateway websocket/RPC 연결
  - websocket `chat.send` 호출
  - 필요 시 `/v1/responses` 폴백 호출
  - 최종 응답을 Proxy outbound API로 전달
- `PlatformClaw Gateway`
  - agent/session/workspace 실행
  - 모델 호출
  - 채팅/히스토리/세션 관리

### 2.1 구현 언어 원칙

Proxy와 Adapter는 같은 언어일 필요가 없다.

권장 기준:

- 회사 Knox Proxy
  - 회사 내부 표준에 맞는 언어 사용
  - Python/Flask 또는 FastAPI 가능
- PlatformClaw Adapter
  - PlatformClaw 프로토콜 구현이 편한 언어 사용
  - 현재 예시는 TypeScript

중요한 것은 구현 언어가 아니라 계약 일치다.

즉 아래가 같으면 된다.

- HTTP endpoint
- 요청/응답 body 형식
- HMAC 서명 규칙
- retry/timeout 규칙

따라서 회사 Knox Proxy가 Python이어도 구조적으로 문제 없다.

### 2.2 검증 원칙

Mock Gateway와 실제 Gateway 검증은 분리해야 한다.

이유:

- Mock Gateway는 Adapter 오케스트레이션을 검증한다.
- 실제 Gateway는 인증/핸드셰이크 호환성까지 검증한다.

실제로 확인된 점:

- Mock Gateway 경로에서는 `Proxy -> Adapter -> Gateway -> Proxy` 최종 응답까지 검증 가능
- 실제 Gateway 경로에서는 `device identity`, `password`, `client.id`, `device signature` 같은 추가 계약이 걸릴 수 있음

따라서 실서비스 검증 순서는 아래로 고정한다.

1. Mock Gateway로 Adapter 로직 검증
2. 실제 Gateway로 인증/프로토콜 정합성 검증
3. 실제 Knox Proxy와 계약 검증

핵심 원칙:

- Proxy는 Knox를 안다
- Adapter는 PlatformClaw를 안다
- Gateway는 Knox를 직접 몰라도 된다

### 2.3 현재 구현 검증 상태

현재 기준으로 확인된 상태는 아래와 같다.

- Mock Proxy -> Adapter -> Mock Gateway -> Adapter -> Mock Proxy
  - 최종 응답까지 검증 완료
- 실제 PlatformClaw Gateway `connect`
  - password 기반 websocket 연결 성공 확인
- 실제 PlatformClaw Gateway `chat.send`
  - websocket 경로는 `operator.write` 부족 시 실패 가능
- 실제 PlatformClaw Gateway + Mock Proxy + Adapter
  - `/v1/responses` 활성화된 실제 Gateway에서 최종 outbound까지 검증 완료

즉 현재 반입 기준 핵심 조건은 아래와 같다.

- Gateway shared secret 준비
- `gateway.http.endpoints.responses.enabled = true`
- Proxy outbound 계약 일치

---

## 2.4 지금까지 수정한 핵심 사항

실제 구현 과정에서 아래 항목을 수정했다.

- `PLATFORMCLAW_USE_DEVICE_IDENTITY=false` 문자열 파싱 버그 수정
  - 문자열 `"false"`가 잘못 `true`로 해석되던 문제 제거
- Adapter용 Gateway client를 정리
  - OpenClaw 내부 `GatewayClient` 래핑 경로 대신 Adapter 제어가 가능한 raw websocket client로 전환
- outbound 상태 기록 수정
  - `PROXY_OUTBOUND_URL`이 없을 때 성공처럼 기록하지 않고 `outbound_skipped`로 기록
- `readyz` 강화
  - 저장소 상태, Proxy outbound URL, HMAC 필수값 존재 여부를 기준으로 확인

이 항목들은 구현 메모가 아니라, 실제 배포 전 검증에서 이미 한 번 문제로 드러난 내용이다.

---

## 3. 왜 Adapter를 분리하는가

실서비스 기준에서 Knox 연동을 OpenClaw 본체 내부에 바로 넣는 것은 리스크가 크다.

분리 이유:

- Knox 장애가 gateway 본체로 직접 전파되지 않게 하기 위함
- 회사 전용 API와 사내 보안 정책을 분리하기 위함
- 회사 내부 구현과 PlatformClaw 업그레이드를 분리하기 위함
- 장애 분석 시 책임 범위를 분명히 하기 위함

권장하지 않는 구조:

- Knox 연동 로직을 현재 단계에서 OpenClaw extension으로 바로 내장

현재 단계에서 가장 안전한 구조:

- `Proxy + Adapter + Gateway` 분리

추가 원칙:

- Knox 관련 장애는 Gateway 장애와 분리되어야 한다.
- Gateway 장애가 나도 Knox 원본 메시지 자체는 추적 가능해야 한다.
- Proxy와 Adapter는 재시도 가능해야 하지만, 중복 발신은 방지되어야 한다.

---

## 4. 세션 정책

직원 웹과 Knox DM은 같은 agent를 사용하되, session은 분리한다.

권장 정책:

- employee web:
  - `agent:<agentId>:main`
- Knox DM:
  - `agent:<agentId>:knox:dm:<knoxUserId>`

예:

- 직원 `eon`
- Knox 사용자 ID `u12345`
- agentId `eon`
- web session:
  - `agent:eon:main`
- Knox session:
  - `agent:eon:knox:dm:u12345`

이렇게 분리하는 이유:

- 웹과 메신저 대화 문맥이 섞이지 않음
- 문제 발생 시 추적이 쉬움
- 운영자가 세션 목적을 바로 구분 가능
- 메신저 발신/수신 로그와 세션을 대응시키기 쉬움

### 4.1 최종 정책

세션 정책은 Proxy가 inbound payload에 실어 보내는 값을 Adapter가 해석하는 구조로 둔다.

즉:

- Proxy는 필요 시 `preferredSessionMode` 또는 `sessionKeyHint`를 전달할 수 있다
- Adapter는 이를 해석하되, 허용된 정책 범위 안에서만 반영한다

권장 기본 정책:

- 기본값: 분리 세션
  - `agent:<agentId>:knox:dm:<knoxUserId>`
- 명시적 정책이 있을 때만 shared main 허용
  - `agent:<agentId>:main`

운영 원칙:

- Proxy가 세션 정책을 힌트로 전달하는 것은 허용
- 최종 허용 여부 판단은 Adapter가 한다
- Adapter는 아래 두 정책만 허용한다
  - `isolated_dm`
  - `shared_main`
- 임의의 `sessionKey` 문자열을 Proxy가 직접 강제하는 구조는 금지한다

정리:

- 사용자가 세션 정책을 아직 확정하지 못한 경우에도 운영 기본값은 `isolated_dm`으로 둔다
- 이후 회사 정책상 웹과 Knox DM을 합쳐야 할 경우에만 Proxy가 `shared_main` 힌트를 보낸다
- 따라서 지금 구현은 "Proxy가 정책을 제안하고, Adapter가 허용된 정책만 적용"하는 구조로 고정한다

이유:

- 운영 기본값은 분리 세션이 안전하다
- 다만 회사 정책상 웹과 Knox를 같은 세션으로 합치고 싶을 수도 있으므로, Proxy 힌트 기반 override는 열어둔다
- Adapter가 무제한으로 세션을 신뢰하면 안 되므로, 허용 가능한 두 정책만 지원한다

추가 원칙:

- Proxy는 `sessionKey` 완성 문자열을 직접 강제하지 않는다.
- Proxy는 최대한 `preferredSessionMode`만 전달한다.
- 실제 `sessionKey` 계산은 Adapter 책임으로 유지한다.

---

## 5. 응답 정책

1차 구현은 `final-only`를 기준으로 한다.

의미:

- Knox 사용자 메시지 수신
- PlatformClaw 내부에서 처리
- 최종 결과가 완성되면 한 번만 Knox로 발신

초기 구현에서 제외:

- 토큰 단위 스트리밍
- message edit 기반 실시간 업데이트
- 복잡한 chunked streaming

실서비스 초기 단계에서 `final-only`를 택하는 이유:

- 가장 안정적임
- rate limit 이슈가 적음
- Knox 발신 API 제약에 덜 민감함
- 중복 전송/순서 꼬임 리스크가 적음

2차 확장 후보:

- 단계별 진행 상태 메시지
- chunked multi-message

실서비스 기준 보완:

- 최초 배포는 `final-only`
- 단, 사용자 체감 지연을 줄이기 위해 선택적으로 `processing ack` 한 번은 허용 가능
- `processing ack`는 최종 답변이 아니므로, 운영 정책상 선택 기능으로 둔다
- 최종 결과는 반드시 한 번만 전달되어야 한다

금지:

- 토큰 단위 스트리밍을 초기 배포에 바로 넣는 것
- 중간 메시지와 최종 메시지가 중복 발신되는 구조

실무 주의:

- 응답 정책이 `final-only`라도 Proxy outbound 실패는 반드시 상태로 남아야 한다.
- 모델 실행 성공과 Knox 발신 성공은 같은 단계가 아니다.
- 따라서 상태 저장에는 최소 아래가 필요하다.
  - `gateway_accepted`
  - `running`
  - `final_received`
  - `outbound_sent`
  - `outbound_skipped`
  - `failed`

### 5.1 최종 정책

1차 실서비스 기준 응답 정책은 아래로 고정한다.

- DM only
- 개인 메시지만 지원
- 최종 응답은 반드시 한 번만 보냄
- 선택적으로 단계별 진행 메시지를 제한적으로 허용

단계별 진행 메시지에 대한 판단:

- 구현 가능
- 하지만 토큰 스트리밍보다 낫다고 해서 아무 때나 보내면 안 됨
- 초기에 무조건 켜지지 않도록 feature flag 또는 정책값으로 제어한다

권장 초기 정책:

- 기본: `final-only`
- 확장 옵션: `stage-based updates`

`stage-based updates`를 켜더라도 아래만 허용한다.

- 시작
- 중간 1회 또는 2회
- 완료

---

## 6. Knox Proxy 개발자가 알아야 할 것

Proxy 구현 담당자는 아래를 알아야 한다.

### 6.1 Proxy 책임

- Knox 원본 메시지를 정규화해서 Adapter에 전달
- Knox 발신 API 호출
- Knox 사용자 식별
- HMAC 또는 내부 서비스 인증 적용
- Adapter에 `agentId`를 줄 수는 있지만 `sessionKey`를 강제하지는 않음

### 6.2 Proxy가 Adapter에 주면 안 되는 것

- 임의의 `sessionKey`
- Adapter 내부 상태를 우회하는 재시도 강제 로직
- Knox 원본 API 포맷을 그대로 전달하는 것

### 6.3 Proxy가 반드시 보존해야 하는 값

- `eventId`
- `messageId`
- `sender.knoxUserId`
- `sender.employeeId` 또는 `sender.employeeEmail`
- `conversation.conversationId`
- `conversation.threadId`
- `text`

### 6.4 Knox 발신 시 필요한 값

현재 확인된 Knox 발신 필수값:

- 헤더
  - `accept`
  - `content-type`
  - `authorization`
  - `system-id`
  - `x-devide-id`
  - `x-device_type`
- 본문/필드
  - `requestid`
  - `chatroomid`
  - `chatmsgid`
  - `msgtype`
  - `chatmsg`

즉 Adapter는 Knox API를 직접 알 필요는 없지만, Proxy는 이 계약을 정확히 구현해야 한다.

---

## 7. PlatformClaw 사용자가 알아야 할 것

### 7.1 Gateway 설정

Adapter 사용 시 확인 대상:

- `gateway.bind`
- `gateway.port`
- `gateway.auth.mode`
- `gateway.auth.password` 또는 `gateway.auth.token`

예시:

```json
{
  "gateway": {
    "bind": "loopback",
    "port": 19001,
    "auth": {
      "mode": "password",
      "password": "CHANGE_ME_ADMIN_PASSWORD"
    }
  }
}
```

### 7.2 Control UI origin 설정

아래 설정은 브라우저 Control UI origin 제한용이다.

```json
"gateway": {
  "controlUi": {
    "allowedOrigins": [
      "https://soc.company.example",
      "https://admin-soc.company.example"
    ]
  }
}
```

현재까지 확인한 범위에서는:

- 이 값은 Adapter websocket 문제의 핵심 원인이 아니었다.
- Adapter는 browser client가 아니라 backend client로 붙는다.

### 7.3 실제 남아 있는 핵심 제약

- `connect`만 성공한다고 Adapter가 실제 메시지를 넣을 수 있는 것은 아니다.
- websocket `chat.send`에는 `operator.write`가 필요하다.
- 따라서 실서비스에서는 Adapter용 권한 경로를 별도로 마련해야 한다.

현재 현실적인 방향:

- Adapter 전용 paired device + `device token`
- 또는 Gateway 정책상 Adapter 전용 write 권한을 가진 인증 경로

즉 운영 초기에 텔레그램/메신저처럼 너무 많은 중간 메시지를 보내는 구조는 피한다.

구현 난이도 판단:

- 단계별 메시지 자체는 구현이 어렵지 않다
- 다만 어떤 내부 이벤트를 외부 메시지로 노출할지 정책화하지 않으면 메시지 품질이 급격히 나빠진다
- 따라서 1차 배포 기본값은 `final-only`
- `stage-based updates`는 feature flag로만 열고, 운영 검증 후 활성화한다

---

## 6. Adapter 책임

Adapter가 반드시 해야 할 일:

1. Proxy 표준 API 요청 수신
2. payload 검증
3. 중복 메시지 방지
4. `employeeId -> agentId` 매핑 적용
5. `sessionKey` 생성
6. PlatformClaw gateway websocket/RPC 연결
7. `chat.send` 호출
8. `chat` 이벤트 수신
9. 최종 결과를 Proxy outbound API로 전달
10. timeout / retry / logging / health 처리
11. dead-letter 또는 실패 기록 저장
12. graceful shutdown 처리
13. 메시지 유실 없는 재기동 처리

Adapter가 하지 말아야 할 일:

- Knox 원본 webhook 규격 처리
- Knox 원본 서명 검증 세부 구현
- 회사 사번 시스템 직접 조회를 Proxy 없이 남발
- Knox 원본 발신 API 로직을 Adapter에 직접 밀어넣기

추가 금지:

- 메모리만 믿고 in-flight 상태를 운영하는 것
- 장애 시 어떤 요청이 유실됐는지 알 수 없는 구조
- 로그만 있고 상태 저장이 없는 구조

---

## 7. Proxy 책임

Proxy가 해야 할 일:

1. Knox 수신 API 처리
2. Knox 발신 API 처리
3. Knox 인증/보안
4. `knoxUserId -> employeeId` 식별
5. 회사 표준 payload 생성

Proxy가 하지 말아야 할 일:

- PlatformClaw `agentId` 결정
- PlatformClaw `sessionKey` 정책 결정
- PlatformClaw gateway websocket/RPC 직접 처리

한 줄 정리:

- Proxy 책임: `Knox -> 회사 표준`
- Adapter 책임: `회사 표준 -> PlatformClaw`

### 7.1 사용자 매핑 기준

현재 기준 기본 매핑 정책:

- email local-part를 `agentId`로 사용

예:

- `seungon.jung@samsung.com`
- `agentId = "seungon.jung"`

권장 구현:

- Proxy는 최소한 `employeeEmail`을 표준 payload에 포함
- Adapter는 `employeeEmail`이 있으면 local-part를 기본 `agentId` 후보로 사용
- 단, 명시적 `agentId`가 payload에 있으면 그 값을 우선

즉 우선순위:

1. payload의 명시적 `agentId`
2. `employeeEmail` local-part
3. fallback으로 `employeeId`

---

## 8. PlatformClaw Gateway 연동 방식

Adapter는 PlatformClaw gateway에 서비스 클라이언트처럼 붙는다.

권장 연결:

- 내부망 또는 컨테이너 네트워크
- websocket/RPC 방식

필수 gateway 호출:

- `connect`
- `chat.send`

초기 선택적 호출:

- `chat.abort`
- `chat.history`

핵심은 `chat.send`다.

예시 개념:

```json
{
  "type": "req",
  "id": "req-001",
  "method": "chat.send",
  "params": {
    "sessionKey": "agent:eon:knox:dm:u12345",
    "message": "오늘 회의 내용 요약해줘"
  }
}
```

`chat.send` 이후 처리할 이벤트:

- `chat` event
  - `state: "delta"`
  - `state: "final"`
  - `state: "aborted"`
  - `state: "error"`

초기 구현에서 Adapter는 이 중 아래만 확실히 처리하면 된다.

- `final`
- `error`

### 8.1 네트워크 연결 방식

실제 연결은 고정 경로가 아니라 설정 기반 네트워크 연결로 처리한다.

구간은 두 개다.

1. `Proxy -> Adapter`
2. `Adapter -> Gateway`

#### Proxy -> Adapter

권장 방식:

- HTTP POST
- 내부망 또는 사설망 주소
- HMAC 또는 shared secret 인증

현재 기본안:

- 1차 서비스는 `HMAC shared secret`
- 이유:
  - mTLS보다 초기 운영 복잡도가 낮음
  - 단순 내부망 신뢰보다 오동작과 오호출 추적이 쉬움
  - 구현 난이도 대비 안정성이 가장 균형적임

예시:

```env
PLATFORMCLAW_ADAPTER_BASE_URL=http://platformclaw-knox-adapter:3010
PLATFORMCLAW_ADAPTER_SHARED_SECRET=...
```

Proxy는 Knox 원본 메시지를 회사 표준 payload로 변환한 뒤 Adapter에 전달한다.

예시:

```http
POST /api/v1/platformclaw/knox/inbound
```

#### Adapter -> Gateway

권장 방식:

- websocket/RPC
- 내부망 주소
- gateway 서비스 인증 토큰 사용

현재 기본안:

- 내부망 + gateway token 둘 다 사용
- 이유:
  - 내부망만 신뢰하는 구조는 오배포/오연결 시 방어가 약함
  - token만 쓰는 구조는 네트워크 경계가 느슨할 때 운영 사고가 날 수 있음
  - 둘 다 쓰는 것이 현재 기준 가장 보수적이고 안전함

예시:

```env
PLATFORMCLAW_GATEWAY_URL=ws://platformclaw-gateway:19001
PLATFORMCLAW_GATEWAY_TOKEN=...
```

Adapter는 gateway에 서비스 클라이언트처럼 연결한 뒤 `chat.send`를 호출한다.

### 8.2 주소 변경 대응 원칙

주소는 절대 코드에 고정하지 않는다.

필수 원칙:

- Proxy -> Adapter 주소는 env/config
- Adapter -> Gateway 주소는 env/config
- health/readiness에서 현재 연결 대상과 연결 성공 여부를 확인 가능해야 함

즉 주소가 바뀌어도 코드를 수정하지 않고 설정만 바꿔야 한다.

### 8.3 end-to-end 예시

1. Knox 사용자 `u12345`가 DM 전송
2. Proxy가 회사 표준 payload 생성
3. Adapter가 `employeeId`, `agentId`, `sessionKey` 결정
4. Adapter가 gateway에 `chat.send`
5. Gateway가 `chat` event(`final` 또는 `error`) 반환
6. Adapter가 Proxy outbound API 호출
7. Proxy가 Knox 발신 API 호출

---

## 9. Adapter 내부 모듈 권장 구조

권장 디렉토리 개념:

- `src/config.ts`
  - env/config 로드
- `src/inbound-api.ts`
  - Proxy 요청 수신
- `src/routing.ts`
  - `employeeId -> agentId`
  - `sessionKey` 생성
- `src/platformclaw-gateway.ts`
  - gateway websocket/RPC client
- `src/run-tracker.ts`
  - `messageId`, `requestId`, `runId` 대응
- `src/outbound-client.ts`
  - Proxy outbound API 호출
- `src/dedupe-store.ts`
  - 중복 메시지 방지
- `src/health.ts`
  - health/readiness
- `src/server.ts`
  - 서버 bootstrap

실서비스 권장 추가 모듈:

- `src/store/`
  - dedupe key 저장
  - inbound message 상태 저장
  - outbound delivery 상태 저장
- `src/retry/`
  - 재시도 스케줄링
  - backoff 정책
- `src/metrics/`
  - Prometheus 또는 OpenTelemetry 메트릭
- `src/audit/`
  - 감사 로그용 구조화 이벤트

권장 저장소:

- 1순위: Redis
- 2순위: Postgres
- 권장하지 않음: 프로세스 메모리 단독 사용

---

## 10. 운영 요구사항

### 10.1 인증

필수:

- Proxy -> Adapter 인증
- Adapter -> Gateway 인증
- 비밀키/토큰 env 분리
- request body 서명 또는 내부망 제한

### 10.1.1 현재 권장안

사용자 입력 기준으로, 가장 오류 가능성이 낮은 방향을 기본안으로 한다.

권장:

- Proxy -> Adapter
  - HMAC shared secret
- Adapter -> Gateway
  - gateway token + 내부망 연결

이유:

- mTLS는 더 강력하지만 초기 배포 복잡도가 높다
- 내부망만 신뢰하는 방식은 설정 실수에 취약하다
- HMAC + gateway token 조합이 현재 단계에서 가장 현실적이고 오류 가능성이 낮다

정리:

- Proxy -> Adapter: `shared secret/HMAC`
- Adapter -> Gateway: `gateway token` + 내부 네트워크

### 10.2 관측성

필수:

- structured log
- correlation id
- `messageId`
- `runId`
- `agentId`
- `sessionKey`
- 처리 시간
- 에러 코드
- retry 횟수
- outbound 상태
- gateway 연결 상태

권장 로그 이벤트 종류:

- inbound_received
- inbound_rejected
- inbound_deduplicated
- routing_resolved
- gateway_connected
- gateway_connect_failed
- chat_send_accepted
- chat_send_failed
- run_final_received
- run_error_received
- outbound_sent
- outbound_failed
- shutdown_started
- shutdown_completed

### 10.3 안정성

필수:

- 중복 메시지 방지
- reconnect backoff
- timeout 층 구분
- outbound retry 정책
- in-flight run 상태 관리
- graceful shutdown
- 재기동 후 상태 복구
- DLQ 또는 실패 큐
- backpressure 제어

권장 원칙:

- `messageId`는 전 구간에서 idempotency key로 유지
- inbound 수신 직후 durable store에 상태를 남긴 뒤 처리 시작
- outbound 성공 전까지 상태를 `completed`로 확정하지 않음
- gateway 연결 실패는 즉시 유실 처리하지 않고 재시도 가능 상태로 둠
- shutdown 시 새 inbound는 거부하고, in-flight 작업은 제한 시간 내 drain

### 10.3.1 실패 처리 정책

현재 결정된 기본 정책:

- gateway timeout 또는 전송 실패 시 1회 재시도
- 재시도 후에도 실패하면 Proxy에 실패 상태 전달

권장 상태 코드:

- `final`
- `error`
- `timeout`

Proxy는 이 상태를 Knox 사용자에게 노출할지, 운영 시스템에만 적재할지 정책적으로 결정한다.

### 10.4 Health

필수 endpoint:

- `/healthz`
- `/readyz`

health에는 최소한 이 정보가 있어야 한다.

- adapter 프로세스 alive
- gateway 접근 가능 여부
- 최근 outbound 실패 상태
- durable store 접근 가능 여부

readiness 판단 기준:

- config 정상 로드
- durable store 접근 가능
- gateway handshake 가능
- 필수 비밀키 누락 없음

health와 readiness는 분리한다.

- `/healthz`
  - 프로세스 생존 여부
- `/readyz`
  - 실제 요청 처리 준비 여부

---

## 11. Timeout 정책

timeout은 한 층이 아니다. 분리해서 본다.

필수 구분:

1. Proxy -> Adapter 요청 timeout
2. Adapter -> Gateway connect timeout
3. Adapter -> Gateway request timeout
4. run completion timeout
5. Proxy outbound send timeout

권장 원칙:

- 네트워크 timeout과 run timeout을 분리
- retry 가능한 timeout과 retry하면 안 되는 timeout을 구분
- 같은 `messageId`에 대해 중복 final 발신이 없도록 보호

권장 기본값 예시:

1. Proxy -> Adapter HTTP request timeout
   - 5s ~ 10s
2. Adapter -> Gateway websocket connect timeout
   - 5s
3. Adapter -> Gateway `chat.send` request timeout
   - 10s
4. run completion timeout
   - 120s ~ 300s
5. Adapter -> Proxy outbound send timeout
   - 5s ~ 10s

run completion timeout 초과 시:

- 즉시 유실 처리하지 않는다
- 상태를 `timed_out`으로 기록
- outbound 실패 알림 또는 운영 알림 정책을 적용한다

---

## 12. 데이터 계약

### 12.1 Proxy -> Adapter inbound 표준 payload

최소 필드:

- `eventId`
- `messageId`
- `occurredAt`
- `sender.knoxUserId`
- `sender.employeeId`
- `sender.employeeEmail`
- `sender.displayName`
- `sender.department`
- `conversation.type`
- `conversation.conversationId`
- `conversation.threadId`
- `text`
- `preferredSessionMode`
- `agentId`

### 12.2 Adapter 내부 라우팅 결과

최소 필드:

- `employeeId`
- `agentId`
- `sessionKey`

### 12.3 Adapter -> Proxy outbound payload

최소 필드:

- `messageId`
- `conversationId`
- `threadId`
- `text`
- `runId`
- `final`

권장 추가 필드:

- `status`
  - `final`
  - `error`
  - `timeout`
- `errorCode`
- `errorMessage`
- `agentId`
- `sessionKey`
- `deliveredAt`

Proxy가 Knox 발신 API를 실제로 호출할 때 필요한 Knox 측 필수 값도 고려해야 한다.

필수 헤더:

- `accept`
- `content-type`
- `authorization`
- `system-id`
- `x-devide-id`
- `x-device_type`

필수 메시지/식별 필드:

- `requestid`
- `chatroomid`
- `chatmsgid`
- `msgtype`
- `chatmsg`

운영 원칙:

- Adapter는 최소한 `conversationId`, `threadId`, `text`, `runId`를 Proxy로 전달해야 한다
- Proxy는 `conversationId`를 Knox의 `chatroomid`로 직접 사용하거나 내부 규칙으로 변환해야 한다
- `requestid`는 요청 상관관계 키로 사용한다
- `chatmsgid`는 Knox 발신 dedupe 및 감사 추적 키로 사용한다
- `msgtype`은 1차에서 `text`만 허용한다
- `chatmsg`는 Adapter가 생성한 최종 발신 본문이다

### 12.4 chatroom key 처리 원칙

메신저 발신 시에는 PlatformClaw의 `sessionKey`만으로는 충분하지 않다.

Proxy가 실제 Knox 발신을 수행하려면 메신저 측 대화방 식별자가 필요하다.

따라서 inbound 시점에 아래 필드를 반드시 보존해야 한다.

- `conversation.conversationId`
- `conversation.threadId`
- 필요 시 `conversation.type`

이 값들은 Adapter 내부 상태 저장과 outbound payload에 그대로 유지한다.

즉 역할은 이렇게 나뉜다.

- `sessionKey`
  - PlatformClaw 내부 세션 라우팅용 키
- `conversationId`, `threadId`
  - Knox/Proxy 발신 대상 식별용 키

둘은 서로 대체 관계가 아니다.

추가로 Knox 발신 단계에서는 아래 식별자가 실제로 필요하다.

- `chatroomid`
- `chatmsgid`
- `requestid`
- `msgtype`
- `chatmsg`

즉 Adapter는 PlatformClaw 식별자와 Knox 발신 식별자를 혼동하면 안 된다.

### 12.5 권장 outbound 식별자 규칙

Adapter -> Proxy outbound payload에는 최소한 아래가 포함되어야 한다.

- `messageId`
- `conversationId`
- `threadId`
- `agentId`
- `sessionKey`
- `runId`
- `text`
- `status`
- `requestId`
- `chatroomId`
- `chatMsgId`
- `msgType`

예시:

```json
{
  "messageId": "msg-1",
  "conversationId": "conv-1",
  "threadId": "th-1",
  "agentId": "eon",
  "sessionKey": "agent:eon:knox:dm:u12345",
  "runId": "run_abc123",
  "requestId": "req_abc123",
  "chatroomId": "conv-1",
  "chatMsgId": "knox_out_001",
  "msgType": "text",
  "status": "final",
  "text": "회의 요약 결과입니다."
}
```

추가 예시:

```json
{
  "eventId": "evt-1",
  "messageId": "msg-1",
  "occurredAt": "2026-04-09T10:00:00Z",
  "sender": {
    "knoxUserId": "u12345",
    "employeeId": "seungon.jung",
    "employeeEmail": "seungon.jung@samsung.com"
  },
  "conversation": {
    "type": "dm",
    "conversationId": "conv-1"
  },
  "preferredSessionMode": "knox_dm",
  "text": "오늘 회의 요약해줘"
}
```

### 12.6 상태 저장 시 보존해야 할 메신저 식별자

내부 상태 저장 모델에는 아래 필드를 추가로 유지한다.

- `conversationId`
- `threadId`
- `conversationType`
- `requestId`
- `chatroomId`
- `chatMsgId`

이유:

- outbound 재시도 시 대상 대화방을 잃지 않기 위함
- 실패 건 재처리 시 사람이 목적지를 재구성하지 않아도 되게 하기 위함
- 운영자가 run과 메신저 대화방을 대응시킬 수 있게 하기 위함

### 12.7 내부 상태 저장 모델

최소 저장 상태:

- `messageId`
- `eventId`
- `employeeId`
- `agentId`
- `sessionKey`
- `conversationId`
- `threadId`
- `conversationType`
- `runId`
- `status`
  - `received`
  - `routing_resolved`
  - `gateway_accepted`
  - `running`
  - `final_received`
  - `outbound_sent`
  - `failed`
  - `timed_out`
- `attemptCount`
- `createdAt`
- `updatedAt`

---

## 13. 구현 순서

권장 순서:

1. config/env 정리
2. inbound payload validation
3. routing module 구현
4. gateway websocket client 구현
5. `chat.send` 호출
6. `final/error` 이벤트 처리
7. outbound client 구현
8. dedupe store 추가
9. health/logging 정리
10. integration test 추가
11. graceful shutdown / drain 추가
12. retry / DLQ 추가
13. metrics / dashboards 추가
14. load test / fault injection 수행

이 순서를 어기지 않는 것이 좋다.

특히 처음부터 스트리밍이나 첨부파일까지 같이 넣지 않는다.

추가 원칙:

- 먼저 유실/중복 없는 경로를 만든다
- 그 다음 사용자 경험을 확장한다

---

## 14. 1차 배포 범위

1차 배포는 아래만 포함한다.

- DM only
- text only
- final-only
- 고정된 사용자 매핑
- session 분리 정책
- health/readiness
- structured logs
- durable dedupe
- status persistence
- retry 정책
- 운영 알림

현재 확정값:

- DM only = 개인 메시지만 지원
- adapter는 별도 컨테이너
- gateway timeout 시 1회 재시도
- `agentId` 기본 생성 기준은 email local-part

1차에서 제외:

- group room
- thread 고급 정책
- attachment relay
- chunked delivery
- 편집형 스트리밍

1차에서도 반드시 포함해야 하는 운영 기능:

- 재기동 후 상태 확인 가능성
- 동일 `messageId` 중복 방지
- gateway 연결 실패 감지
- Proxy outbound 실패 감지
- 장애 시 수동 재처리 가능성

---

## 15. 향후 확장

2차 이후 후보:

- 단계별 진행 메시지
- chunked multi-message
- attachment relay
- 그룹방 정책
- thread별 세션 정책
- gateway event 소비 고도화

추가 후보:

- stage-based progress message
- 운영자용 replay endpoint
- admin audit export
- multi-tenant 분리

---

## 16. 최종 판단

실서비스 기준 현재 권장안은 다음과 같다.

- `Knox Proxy`와 `PlatformClaw Adapter`는 분리
- `Adapter`는 별도 서비스/별도 컨테이너
- `Adapter`는 gateway websocket/RPC 클라이언트를 직접 가진다
- session은 `agent:<agentId>:knox:dm:<knoxUserId>` 정책을 사용한다
- 응답은 1차에서 `final-only`

이 문서는 이후 구현 시 기준 문서로 유지한다.

---

## 17. 실제 서비스 기준 체크리스트

배포 전에 아래가 모두 충족되어야 한다.

### 17.1 기능

- DM inbound 수신 성공
- `employeeId -> agentId` 매핑 성공
- `sessionKey` 정책 일관성 유지
- gateway `chat.send` 성공
- final outbound 발신 성공

### 17.2 안정성

- 같은 `messageId` 재전송 시 중복 처리 안 함
- gateway 순간 장애 시 즉시 유실되지 않음
- adapter 재기동 후 상태 조회 가능
- shutdown 중 새 요청 차단 가능

### 17.3 운영

- health/readiness 분리
- 로그에 `messageId`, `runId`, `agentId`, `sessionKey` 남음
- 실패 케이스가 상태 저장에 남음
- 운영자가 실패 건을 재처리 가능

### 17.4 보안

- Proxy -> Adapter 인증 있음
- Adapter -> Gateway 인증 있음
- 민감정보 마스킹 적용
- 감사 로그 남김

### 17.5 금지사항

아래 상태로는 운영 배포하지 않는다.

- 메모리만 사용하는 dedupe
- 실패 시 유실 여부를 모르는 구조
- `runId` 추적 불가능
- health만 있고 readiness 없음
- 중복 final 발신 방지 장치 없음

---

## 18. 현재 확정된 의사결정

현재까지 사용자와 확정한 내용은 아래와 같다.

1. 세션 정책

- Proxy가 정책 힌트를 줄 수 있음
- Adapter 기본값은 분리 세션
- shared main은 명시적 요청일 때만 허용
- 허용 모드는 `isolated_dm`, `shared_main` 두 가지뿐
- Proxy가 임의 문자열 `sessionKey`를 강제하는 방식은 금지

2. 사용자 매핑

- email local-part 기준 `agentId`
- 예: `seungon.jung@samsung.com` -> `seungon.jung`

3. 1차 범위

- 개인 메시지(DM)만 지원

4. 응답 정책

- 기본은 `final-only`
- 이후 필요 시 `stage-based updates` 확장
- 다만 초기에는 feature flag로만 허용

5. 인증 방식

- Proxy -> Adapter: HMAC shared secret
- Adapter -> Gateway: gateway token + 내부망

6. 실패 정책

- gateway timeout 시 1회 재시도
- 재시도 후에도 실패하면 Proxy에 실패 전달

7. 저장소

- 필요
- 최소 durable dedupe + 상태 저장은 필수

8. 배포 형태

- Adapter는 별도 컨테이너

9. 실패 정책

- gateway timeout/일시 실패 시 1회 재시도
- 재시도 후에도 실패하면 Proxy에 실패 전달

10. 남은 최소 보류사항

- `stage-based updates`를 1차 배포에서 켤지 여부
- 기본값은 `off`
