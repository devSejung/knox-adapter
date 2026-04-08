# Knox Mock Proxy 테스트 가이드

## 목적

이 문서는 실제 회사 Knox Proxy가 아직 준비되지 않은 상태에서, 로컬에서 Proxy를 흉내 내어 다음 흐름을 확인하는 방법을 설명한다.

- Mock Proxy가 Adapter에 inbound 요청 전송
- Adapter가 PlatformClaw Gateway에 메시지 실행 요청 전송
- Gateway 최종 응답 수신
- Adapter가 Mock Proxy outbound endpoint로 결과 전달

## 구성 요소

- PlatformClaw Gateway
- Knox Adapter
- Mock Proxy

실제 Gateway 대신 mock gateway로 전체 흐름을 테스트할 수도 있다.

- Mock Gateway

## Mock Proxy가 제공하는 엔드포인트

| Method | Endpoint | 설명 |
| --- | --- | --- |
| `GET` | `/healthz` | Mock Proxy 상태 확인 |
| `POST` | `/api/v1/platformclaw/knox/test/send` | 테스트 메시지를 생성해서 Adapter에 전달 |
| `POST` | `/api/v1/platformclaw/knox/outbound/send` | Adapter가 최종 응답을 되돌려주는 수신 endpoint |
| `GET` | `/api/v1/platformclaw/knox/outbound/messages` | 수신된 최종 응답 목록 조회 |
| `DELETE` | `/api/v1/platformclaw/knox/outbound/messages` | 저장된 최종 응답 목록 초기화 |

## 사전 준비

## 빠른 전체 흐름 테스트 권장 경로

실제 Gateway 인증 설정이 아직 정리되지 않았다면, 아래 조합으로 먼저 검증하는 것이 가장 빠르다.

- Mock Gateway
- Knox Adapter
- Mock Proxy

이 경로에서는 다음을 확인할 수 있다.

- Proxy가 Adapter로 inbound 요청 전송
- Adapter가 Gateway로 `chat.send` 전송
- Gateway가 최종 응답 반환
- Adapter가 Proxy outbound endpoint로 최종 응답 전달

### Mock Gateway 실행

```bash
cd /home/eon/work/open_claw/knox-adapter
corepack pnpm mock:gateway
```

기본 주소:

- `ws://127.0.0.1:19011`

### 1. Mock Gateway 실행

가장 빠른 1차 검증 경로다.

```bash
cd /home/eon/work/open_claw/knox-adapter
corepack pnpm mock:gateway
```

기본 주소:

- `ws://127.0.0.1:19011`

### 2. 실제 PlatformClaw Gateway 실행

실서비스에 더 가까운 검증을 하려면 실제 Gateway도 별도로 띄운다.

중요:

- 실제 Gateway에서 shared secret만으로 websocket `chat.send`는 `operator.write` 부족으로 실패할 수 있다.
- Adapter는 이 경우 `/v1/responses`로 자동 폴백한다.
- 따라서 실제 Gateway 테스트를 하려면 `gateway.http.endpoints.responses.enabled = true`가 필요하다.

예시:

```bash
cd /home/eon/work/open_claw/openclaw
OPENCLAW_STATE_DIR=/home/eon/work/open_claw/.openclaw-local-test \
OPENCLAW_CONFIG_PATH=/home/eon/work/open_claw/openclaw/exam_emp_openclaw.json \
OPENCLAW_EMPLOYEE_AUTH_SECRET='CHANGE_ME_LONG_RANDOM_SECRET' \
OPENCLAW_EMPLOYEE_AUTH_LOGIN_URL='http://127.0.0.1:18080/login' \
OPENCLAW_EMPLOYEE_AUTH_ADSSO_URL='http://127.0.0.1:18080/adsso' \
node openclaw.mjs gateway --bind loopback --port 19001 --allow-unconfigured
```

실제 Gateway 검증용 예시 설정:

```json
{
  "gateway": {
    "bind": "loopback",
    "port": 19121,
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

### 3. Knox Adapter 실행

`.env` 예시:

```env
PORT=3010
HOST=127.0.0.1
LOG_LEVEL=info
NODE_ENV=development

DATABASE_PATH=/home/eon/work/open_claw/knox-adapter/data/knox-adapter.sqlite

PROXY_SHARED_SECRET=test-shared-secret
REQUIRE_PROXY_HMAC=true
PROXY_OUTBOUND_URL=http://127.0.0.1:3020/api/v1/platformclaw/knox/outbound/send
PROXY_OUTBOUND_AUTH_TOKEN=

PLATFORMCLAW_GATEWAY_URL=ws://127.0.0.1:19011
PLATFORMCLAW_TRANSPORT=auto
PLATFORMCLAW_GATEWAY_TOKEN=
PLATFORMCLAW_GATEWAY_PASSWORD=
PLATFORMCLAW_DEVICE_IDENTITY_PATH=/home/eon/work/open_claw/knox-adapter/data/gateway-device.json
PLATFORMCLAW_CLIENT_ID=gateway-client
DEFAULT_SESSION_MODE=isolated_dm
MAX_RETRY_ATTEMPTS=1
```

실행:

```bash
cd /home/eon/work/open_claw/knox-adapter
corepack pnpm dev
```

실제 Gateway 검증 시 예시:

```env
PLATFORMCLAW_GATEWAY_URL=ws://127.0.0.1:19121
PLATFORMCLAW_GATEWAY_PASSWORD=CHANGE_ME_ADMIN_PASSWORD
PLATFORMCLAW_USE_DEVICE_IDENTITY=false
PLATFORMCLAW_TRANSPORT=auto
```

### 4. Mock Proxy 실행

환경변수:

```bash
export MOCK_PROXY_SHARED_SECRET='test-shared-secret'
export MOCK_PROXY_ADAPTER_BASE_URL='http://127.0.0.1:3010'
```

실행:

```bash
cd /home/eon/work/open_claw/knox-adapter
corepack pnpm mock:proxy
```

## 테스트 방법

### 1. 기존 outbound 메시지 비우기

```bash
curl -X DELETE http://127.0.0.1:3020/api/v1/platformclaw/knox/outbound/messages
```

### 2. 테스트 메시지 보내기

```bash
curl -s http://127.0.0.1:3020/api/v1/platformclaw/knox/test/send \
  -H 'content-type: application/json' \
  -d '{
    "employeeEmail": "eon@samsung.com",
    "text": "오늘 해야 할 일을 세 줄로 정리해줘."
  }'
```

정상이라면 응답에 다음 정보가 포함된다.

- `inboundPayload`
- `adapterStatus`
- `adapterResult`

`adapterResult`에는 Adapter가 계산한 `agentId`, `sessionKey`, 현재 상태가 포함된다.

### 3. 최종 응답 확인

몇 초 후 아래 API를 조회한다.

```bash
curl -s http://127.0.0.1:3020/api/v1/platformclaw/knox/outbound/messages
```

정상이라면 `items` 배열 안에 Adapter가 되돌려 보낸 최종 응답이 저장된다.

핵심 확인 포인트:

- `body.messageId`
- `body.agentId`
- `body.sessionKey`
- `body.status`
- `body.text`

Mock Gateway를 사용한 경우 `body.status`는 `final`이어야 하고, `body.text`에는 mock gateway 응답 문장이 포함된다.

실제 Gateway를 사용한 경우에도 `body.status=final`과 실제 모델 응답이 저장되어야 한다.

## 예상 결과 예시

```json
{
  "ok": true,
  "count": 1,
  "items": [
    {
      "receivedAt": "2026-04-09T01:00:00.000Z",
      "headers": {
        "authorization": "",
        "content-type": "application/json"
      },
      "body": {
        "messageId": "....",
        "conversationId": "dm:eon",
        "threadId": null,
        "agentId": "eon",
        "sessionKey": "agent:eon:knox:dm:eon",
        "runId": "....",
        "requestId": "....",
        "chatroomId": "dm:eon",
        "chatMsgId": "....",
        "msgType": "text",
        "status": "final",
        "text": "PlatformClaw mock gateway 응답입니다. 입력: 오늘 해야 할 일을 세 줄로 정리해줘.",
        "final": true
      }
    }
  ]
}
```

실제 Gateway 검증에서 확인한 예시:

- `agentId`: `eon`
- `sessionKey`: `agent:eon:knox:dm:eon`
- `status`: `final`
- `text`:
  - `1. 가장 중요한 일 1가지를 먼저 끝내기`
  - `2. 미뤄둔 작은 일 1, 2개 빠르게 정리하기`
  - `3. 저녁 전에 내일 할 일까지 짧게 정리해두기`

## 실패 시 확인할 것

### Adapter가 401을 반환하는 경우

- `MOCK_PROXY_SHARED_SECRET`
- Adapter의 `PROXY_SHARED_SECRET`

두 값이 동일해야 한다.

### outbound가 비어 있는 경우

- Adapter 로그에 Gateway 연결 오류가 없는지 확인
- `PLATFORMCLAW_GATEWAY_URL` 확인
- Gateway 또는 Mock Gateway가 실제로 실행 중인지 확인
- 요청한 `agentId` 또는 `employeeEmail`에 대응되는 agent가 존재하는지 확인
- 실제 Gateway를 쓰는 경우 `gateway.http.endpoints.responses.enabled=true`인지 확인

### `status=error` 또는 `status=timeout`인 경우

- PlatformClaw 모델 응답 timeout 여부 확인
- Gateway 로그 확인
- 요청 프롬프트 길이 또는 모델 상태 확인
- Gateway가 device identity 또는 password를 요구하는지 확인
- 필요하면 `PLATFORMCLAW_GATEWAY_TOKEN`, `PLATFORMCLAW_GATEWAY_PASSWORD`, `PLATFORMCLAW_DEVICE_IDENTITY_PATH`를 점검
- Adapter 로그에 `gateway websocket send failed; falling back to /v1/responses`가 찍히는지 확인

## 운영 관점 참고

- 이 Mock Proxy는 개발/통합 테스트 전용이다.
- 회사 실제 Knox Proxy는 이 Mock API가 아니라, 별도 회사 표준 계약을 구현해야 한다.
- 다만 Adapter 입장에서는 이 Mock Proxy와 실제 Proxy가 동일한 계약을 따르는 것이 목표다.

## Mock 테스트를 통해 확인한 주의사항

### 1. Mock Gateway 경로와 실제 Gateway 경로는 구분해야 한다

Mock Gateway를 사용하면 Adapter의 내부 로직은 끝까지 검증할 수 있다.

- inbound 수신
- sessionKey 계산
- `chat.send`
- 최종 outbound 전달

하지만 이것만으로 실제 PlatformClaw Gateway와의 인증 호환성이 보장되지는 않는다.

실제 확인된 차이:

- 실제 Gateway는 `connect` 시 device identity를 요구할 수 있다.
- 실제 Gateway는 token만으로 충분하지 않을 수 있다.
- 실제 Gateway는 `client.id` 값이 허용 목록에 있어야 한다.
- 실제 Gateway는 device signature 형식이 정확히 맞아야 한다.

즉 다음 두 테스트는 의미가 다르다.

- Mock Gateway 테스트: Adapter 로직 검증
- 실제 Gateway 테스트: Gateway 인증/프로토콜 정합성 검증

### 2. 실제 Gateway에서 websocket `chat.send`가 실패해도 곧바로 서비스 실패는 아니다

실제 로컬 Gateway에서는 아래 순서가 확인됐다.

- websocket `connect` 성공
- websocket `chat.send`는 `missing scope: operator.write`
- Adapter가 `/v1/responses`로 자동 폴백
- 최종 outbound 전달 성공

즉 현재 실서비스 기준 핵심은 아래다.

- Gateway shared secret 준비
- `/v1/responses` 활성화
- Adapter transport를 `auto` 또는 `http-responses`로 유지

### 3. Mock 메시지는 실제 OpenClaw 현재 세션에 보이지 않는다

Mock Gateway로 보낸 메시지는 실제 OpenClaw `19001` 세션에 저장되지 않는다.

이유:

- Mock Gateway는 PlatformClaw Gateway를 흉내 낸 별도 테스트 서버다.
- 따라서 현재 브라우저에서 보고 있는 실제 OpenClaw 세션에는 나타나지 않는다.

확인 위치:

- `GET /api/v1/platformclaw/knox/outbound/messages`

실제 OpenClaw 세션에 메시지 흔적을 보고 싶다면 실제 Gateway 경로로 테스트해야 한다.

- `device identity required`
- `unauthorized: gateway password missing`
- `invalid connect params`
- `device signature invalid`

이 오류들은 Adapter의 전체 흐름이 틀렸다는 의미가 아니라, 실제 Gateway 핸드셰이크 계약을 아직 완전히 맞추지 못했다는 의미다.

따라서 검증 순서는 아래가 맞다.

1. Mock Gateway로 Adapter 전체 흐름 검증
2. 실제 Gateway 인증/핸드셰이크 정합성 별도 보정

### 3. HMAC 값이 다르면 테스트가 바로 깨진다

Mock Proxy와 Adapter 사이의 HMAC shared secret이 다르면 Adapter는 `401`을 반환한다.

반드시 같은 값을 써야 한다.

- `MOCK_PROXY_SHARED_SECRET`
- `PROXY_SHARED_SECRET`

### 4. 상태 저장 파일은 테스트별로 분리하는 것이 안전하다

같은 SQLite 파일을 재사용하면 이전 `messageId`가 남아 duplicate로 처리될 수 있다.

권장:

- mock 테스트용 DB 파일 별도 사용
- 실제 개발용 DB 파일과 분리

예:

- `data/test-mock.sqlite`
- `data/knox-adapter.sqlite`

### 5. 실제 Proxy 구현 언어는 TypeScript일 필요가 없다

이 문서의 Mock Proxy는 TypeScript로 작성했지만, 실제 회사 Knox Proxy는 Python으로 구현해도 충분하다.

중요한 것은 언어가 아니라 계약 일치다.

즉 실제 Proxy가 Python/Flask 또는 FastAPI여도 문제가 없다. 반드시 맞아야 하는 것은 아래뿐이다.

- inbound payload 형식
- HMAC 검증 규칙
- outbound payload 형식
- HTTP 상태 코드 규칙

정리:

- Mock은 TypeScript
- 실제 회사 Proxy는 Python 가능
- Adapter 관점에서는 HTTP 계약만 맞으면 된다
