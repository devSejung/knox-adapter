# Knox Proxy - PlatformClaw Adapter API

## 개요

이 문서는 `Knox Proxy`와 `PlatformClaw Adapter` 사이의 통신 API를 정리한 문서다.

대상 독자:

- Knox Proxy 구현 담당자
- PlatformClaw Adapter 구현 담당자
- 운영/보안 검토 담당자

목표:

- 어떤 API가 필요한지 한 번에 보이게 정리
- 어떤 필드가 필수인지 명확히 정의
- 어떤 값이 PlatformClaw 라우팅용이고, 어떤 값이 Knox 발신용인지 구분

범위:

- `Proxy -> Adapter` inbound API
- `Adapter -> PlatformClaw Gateway` ingress 전달 경로
- `OpenClaw Core -> Adapter` Knox delivery API
- `Adapter -> Proxy` outbound API
- 인증 헤더
- 필수 파라미터
- 예시 payload

비범위:

- Knox 원본 vendor API 세부 포맷
- PlatformClaw Gateway websocket/RPC 내부 프레임 전체

---

## 시스템 역할

### Knox Proxy

책임:

- Knox 원본 수신/발신
- Knox 인증/서명 검증
- Knox 사용자 식별
- 회사 표준 payload 생성

### PlatformClaw Adapter

책임:

- Proxy 표준 payload 수신
- `agentId`, `sessionKey` 결정
- PlatformClaw Gateway 연동
- 최종 응답을 Proxy에 다시 전달

---

## 통신 방향

### 1. Proxy -> Adapter

용도:

- 정규화된 Knox 메시지를 Adapter로 전달

방식:

- HTTP `POST`
- JSON body
- HMAC shared secret 인증

### 2. Adapter -> PlatformClaw Gateway

용도:

- Adapter가 수신한 Knox 메시지를 PlatformClaw agent/session으로 전달
- session `deliveryContext`에 Knox 회신 목적지를 저장

방식:

- 우선순위에 따라 `/v1/responses` HTTP 또는 Gateway websocket `chat.send`
- 이 경로는 Proxy가 직접 호출하지 않는다.

### 3. OpenClaw Core -> Adapter

용도:

- cron/job/subagent/background 작업 결과를 Knox로 다시 보내기 위해 Core가 Adapter에 전달
- HTTP 관점에서는 Adapter inbound이다.
- 업무 방향 관점에서는 Knox로 나가는 delivery/outbound 요청이다.

방식:

- HTTP `POST`
- JSON body
- Bearer token 또는 내부 서비스 인증

### 4. Adapter -> Proxy

용도:

- PlatformClaw 실행 결과를 Proxy에 전달
- Proxy가 실제 Knox 발신 API를 호출

방식:

- HTTP `POST`
- JSON body
- Bearer token 또는 내부 서비스 인증

---

## API 목록

| 구분 | Method | Endpoint | 호출 주체 | 목적 | 필수 |
| --- | --- | --- | --- | --- | --- |
| Proxy Inbound | `POST` | `/api/v1/platformclaw/knox/inbound` | Knox Proxy | 정규화된 Knox 메시지를 Adapter에 전달 | 필수 |
| Gateway Ingress | `POST` 또는 WS RPC | `/v1/responses` 또는 `chat.send` | Adapter | Knox inbound 메시지를 PlatformClaw agent/session으로 전달 | 필수 |
| Core Delivery | `POST` | `/api/v1/platformclaw/knox/outbound/core-send` | OpenClaw Core | cron/job/subagent 등 core 채널 결과를 Adapter에 전달 | 권장 |
| Proxy Outbound | `POST` | `/api/v1/platformclaw/knox/outbound/send` | Adapter | PlatformClaw 결과를 Proxy에 전달 | 필수 |
| Health | `GET` | `/healthz` | 운영/모니터링 | Adapter 생존 확인 | 필수 |
| Readiness | `GET` | `/readyz` | 운영/모니터링 | Adapter 준비 상태 확인 | 필수 |

주의:

- `healthz`와 `readyz`는 Adapter가 제공하는 API다.
- `inbound`, `outbound/send`는 Proxy와 Adapter가 서로 호출하는 계약이다.
- `/v1/responses`와 `chat.send`는 Adapter와 PlatformClaw Gateway 사이의 내부 경로다.
- `outbound/core-send`는 HTTP 관점에서는 Adapter가 받는 inbound endpoint다. 이름에 `outbound`가 들어가는 이유는 이 요청의 업무 목적이 Knox/Proxy로 나가는 발신이기 때문이다.

---

## 1. Proxy -> Adapter Inbound API

### Endpoint

```http
POST /api/v1/platformclaw/knox/inbound
```

### 목적

- Knox Proxy가 Knox 원본 메시지를 정규화한 뒤 Adapter에 전달

### 요청 헤더

| 헤더 | 필수 | 설명 |
| --- | --- | --- |
| `content-type: application/json` | 필수 | JSON body 전송 |
| `x-platformclaw-timestamp` | 필수 | HMAC 서명 시간값 |
| `x-platformclaw-signature` | 필수 | HMAC SHA-256 서명 |

### 헤더 설명

| 헤더 | 설명 |
| --- | --- |
| `x-platformclaw-timestamp` | 요청 생성 시각. 재전송 공격 방지와 시계 오차 검증에 사용 |
| `x-platformclaw-signature` | `timestamp.body` 기준 HMAC SHA-256 값 |

### HMAC 서명 계산 규칙

`x-platformclaw-signature`는 임의 문자열이 아니라 아래 규칙으로 계산한 값이다.

1. `x-platformclaw-timestamp` 값을 준비한다.
2. HTTP body 원문(JSON 문자열 그대로)을 준비한다.
3. 아래 문자열을 만든다.

```text
<timestamp>.<rawBody>
```

4. 위 문자열을 `PROXY_SHARED_SECRET`로 HMAC SHA-256 계산한다.
5. hex digest를 구한다.
6. 최종 헤더 값은 아래 형식으로 넣는다.

```text
sha256=<hex-digest>
```

주의:

- body를 파싱 후 다시 serialize하면 공백/키 순서가 달라질 수 있다.
- 서명은 반드시 실제 전송할 raw JSON body 기준으로 계산해야 한다.
- Adapter는 현재 timestamp 허용 오차를 약 5분으로 본다.

### 서명 예시

예:

- `timestamp`: `1712812345678`
- `rawBody`:

```json
{"messageId":"msg-1","text":"hello"}
```

서명 대상 문자열:

```text
1712812345678.{"messageId":"msg-1","text":"hello"}
```

최종 헤더 예시:

```http
x-platformclaw-timestamp: 1712812345678
x-platformclaw-signature: sha256=<hmac-sha256-hex>
```

### Node.js 예시

```js
import crypto from "node:crypto";

const timestamp = Date.now().toString();
const rawBody = JSON.stringify({
  messageId: "msg-1",
  text: "hello",
});

const payload = `${timestamp}.${rawBody}`;
const signature = crypto
  .createHmac("sha256", process.env.PROXY_SHARED_SECRET)
  .update(payload)
  .digest("hex");

const headers = {
  "content-type": "application/json",
  "x-platformclaw-timestamp": timestamp,
  "x-platformclaw-signature": `sha256=${signature}`,
};
```

### Body 파라미터 표

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `eventId` | `string` | 필수 | Knox 이벤트 단위 식별자 |
| `messageId` | `string` | 필수 | Knox 메시지 식별자. dedupe 기준 |
| `occurredAt` | `string` | 필수 | 원본 메시지 발생 시각 |
| `sender.knoxUserId` | `string` | 필수 | Knox 사용자 식별자 |
| `sender.employeeId` | `string` | 선택 | 회사 직원 식별자 |
| `sender.employeeEmail` | `string` | 선택 | 회사 이메일. `agentId` 계산 기본값 |
| `sender.displayName` | `string` | 선택 | 사용자 표시 이름 |
| `sender.department` | `string` | 선택 | 사용자 부서 |
| `conversation.type` | `string` | 필수 | Knox 대화 형태. `dm` 또는 `room` |
| `conversation.conversationId` | `string` | 필수 | Knox 대화방 식별자 |
| `conversation.threadId` | `string \| null` | 선택 | thread 식별자 |
| `text` | `string` | 필수 | 사용자 메시지 본문 |
| `preferredSessionMode` | `string` | 선택 | `shared_main` 또는 `isolated_dm` 힌트 |
| `agentId` | `string` | 선택 | Proxy가 명시적으로 계산한 `agentId` |
| `sessionKey` | `string` | 선택 | Proxy가 명시적으로 계산한 PlatformClaw 세션 키 |

### PlatformClaw origin routing

Adapter는 inbound를 Gateway로 보낼 때 Knox 대화 위치를 PlatformClaw origin route로 같이 전달한다.

- DM: `originatingChannel=knox`, `originatingTo=dm:<conversationId>`
- ROOM: `originatingChannel=knox`, `originatingTo=room:<conversationId>`
- Thread/topic: `originatingThreadId=<conversation.threadId>`

이 값은 OpenClaw session `deliveryContext`에 저장된다. 이후 cron, subagent, background job 결과가 `origin` 또는 `knox` delivery를 사용할 때 같은 Knox 대화방으로 돌아갈 수 있다.
DM의 `conversationId`는 Proxy가 Knox 발신에 사용할 실제 `chatroomId`와 같아야 한다. `sessionKey`는 사용자/agent 세션 분리용이고, `originatingTo`는 발신 목적지 복원용이다.

---

## 2. Adapter -> PlatformClaw Gateway Ingress

### 목적

Adapter가 `/api/v1/platformclaw/knox/inbound`로 받은 Knox 메시지를 PlatformClaw Gateway에 전달한다. 이 경로에서 `agentId`, `sessionKey`, Knox 회신 목적지(`originating*`)가 PlatformClaw에 주입된다.

### HTTP `/v1/responses` 사용 시

```http
POST /v1/responses
Authorization: Bearer <PLATFORMCLAW_GATEWAY_TOKEN>
Content-Type: application/json
x-openclaw-session-key: <sessionKey>
x-openclaw-message-channel: knox
x-openclaw-originating-channel: knox
x-openclaw-originating-to: dm:<chatroomId> | room:<chatroomId>
x-openclaw-originating-thread-id: <threadId>
```

Body 예:

```json
{
  "stream": false,
  "model": "openclaw/seungon-jung",
  "input": "오늘 회의 내용을 정리해줘",
  "user": "seungon.jung@samsung.com"
}
```

### WebSocket `chat.send` 사용 시

```json
{
  "method": "chat.send",
  "params": {
    "sessionKey": "agent:seungon-jung:knox:dm:seungon.jung",
    "message": "오늘 회의 내용을 정리해줘",
    "originatingChannel": "knox",
    "originatingTo": "dm:conv_12345",
    "originatingThreadId": null,
    "idempotencyKey": "msg_20260409_000001:evt_20260409_000001"
  }
}
```

중요:

- `sessionKey`는 PlatformClaw 세션 식별용이다.
- `originatingTo`는 나중에 cron/job/subagent 결과가 Knox로 돌아갈 발신 목적지다.
- DM에서도 `originatingTo`에는 Knox user id가 아니라 Proxy가 실제 발신에 사용할 `chatroomId`를 넣어야 한다.
- 이 경로는 Proxy가 호출하는 API가 아니라 Adapter 내부 구현 경로다.

---

## 3. OpenClaw Core -> Adapter Delivery API

### Endpoint

```http
POST /api/v1/platformclaw/knox/outbound/core-send
```

### 목적

OpenClaw Core의 `knox` channel plugin이 Adapter를 호출한다. Adapter는 이 요청을 기존 `Adapter -> Proxy` outbound payload로 변환해서 Knox Proxy의 `/api/v1/platformclaw/knox/outbound/send`로 전달한다.

HTTP 관점에서는 Adapter가 받는 inbound endpoint다. 다만 이 API는 사용자의 Knox inbound 메시지가 아니라, Core가 Knox로 발신하려는 delivery 요청이므로 `inbound`가 아니라 `core-send`로 분리한다.

### 인증

`CORE_OUTBOUND_AUTH_TOKEN`을 Adapter에 설정한 경우 아래 헤더가 필요하다.

```http
Authorization: Bearer <CORE_OUTBOUND_AUTH_TOKEN>
```

### Body

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `to` | `string` | 필수 | Knox 대상. `dm:<chatroomId>` 또는 `room:<conversationId>` |
| `text` | `string` | 필수 | 전송할 본문 |
| `conversationType` | `string \| null` | 선택 | `dm` 또는 `room`. 없으면 `to` prefix에서 파생 |
| `conversationId` | `string \| null` | 선택 | Proxy에 전달할 conversation id. 없으면 `to`에서 파생 |
| `chatroomId` | `string \| null` | 선택 | Proxy/Knox 발신 대상 room id. 없으면 `conversationId` 사용 |
| `chatMsgId` | `string \| null` | 선택 | Proxy/Knox dedupe 또는 원본 메시지 id. 없으면 Adapter가 생성 |
| `messageId` | `string \| null` | 선택 | Adapter -> Proxy outbound `messageId`. 없으면 Adapter가 생성 |
| `threadId` | `string \| number \| null` | 선택 | thread/topic 식별자 |
| `accountId` | `string \| null` | 선택 | OpenClaw Knox channel account |
| `status` | `string` | 선택 | `progress`, `final`, `error`, `timeout`. 기본 `final` |
| `final` | `boolean` | 선택 | 최종 메시지 여부 |
| `agentId` | `string \| null` | 선택 | 추적용 agent id |
| `sessionKey` | `string \| null` | 선택 | 추적용 session key |
| `runId` | `string \| null` | 선택 | 추적용 run id |
| `requestId` | `string \| null` | 선택 | 멱등/추적용 request id |

### OpenClaw config 예시

```json
{
  "plugins": {
    "entries": {
      "knox": {
        "enabled": true
      }
    }
  },
  "channels": {
    "knox": {
      "enabled": true,
      "adapterOutboundUrl": "http://knox-adapter:3010/api/v1/platformclaw/knox/outbound/core-send",
      "adapterAuthToken": "CHANGE_ME_INTERNAL_TOKEN"
    }
  }
}
```

운영 포인트:

- `plugins`와 `channels`는 설정 JSON 최상위에 둔다. `gateway`나 `agents` 안에 넣지 않는다.
- `adapterOutboundUrl`은 OpenClaw container에서 접근 가능한 Adapter 내부 주소여야 한다.
- `adapterAuthToken`은 Adapter의 `CORE_OUTBOUND_AUTH_TOKEN`과 같아야 한다.
- Proxy로 보내는 최종 발신 인증은 기존 `PROXY_OUTBOUND_AUTH_TOKEN` 경로를 그대로 사용한다.
- 기존 호환을 위해 `to=room:<id>`만 보내도 `conversationId`와 `chatroomId`는 `<id>`로 파생된다.
- DM에서 Knox user id와 실제 DM room id가 다르면 `to=dm:<actualDmRoomId>`를 사용한다. 호환상 `chatroomId=<actualDmRoomId>`를 별도 명시해도 된다.

### 세션 관련 설명

| 필드 | 역할 |
| --- | --- |
| `agentId` | PlatformClaw agent 식별자 |
| `preferredSessionMode` | Adapter가 `sessionKey`를 결정할 때 참고하는 힌트 |
| `sessionKey` | Proxy가 특수 라우팅을 명시할 때 사용하는 세션 override |

중요:

- `agentId`와 `sessionKey`를 둘 다 보내면 Adapter는 둘의 일치성을 검증한 뒤 그대로 사용한다.
- `agentId`만 보내면 Adapter가 기존 정책으로 `sessionKey`를 만든다.
- `sessionKey`만 보내면 Adapter가 거절한다.
- `agentId`와 `sessionKey`를 둘 다 보내지 않으면 Adapter가 기존 fallback으로 둘 다 계산한다.
- 명시적 `sessionKey`는 반드시 `agent:<agentId>:`로 시작해야 한다.
- 기본 정책은 `isolated_dm`이다.

단체방처럼 Proxy가 별도 정책을 적용해야 하는 경우 예:

```json
{
  "agentId": "knox_group",
  "sessionKey": "agent:knox_group:knox:room:room_123",
  "text": "[Knox 단체방: room_123]\n[발화자: seungon.jung]\n\n이 이슈 정리해줘"
}
```

이 경우 Adapter는 단체방 정책을 해석하지 않고 `agentId`/`sessionKey` 일치 여부만 검증한다.

### 요청 예시

```json
{
  "eventId": "evt_20260409_000001",
  "messageId": "msg_20260409_000001",
  "occurredAt": "2026-04-09T14:00:00+09:00",
  "sender": {
    "knoxUserId": "u_12345",
    "employeeId": "seungon.jung",
    "employeeEmail": "seungon.jung@samsung.com",
    "displayName": "Seungon Jung",
    "department": "SOC"
  },
  "conversation": {
    "type": "dm",
    "conversationId": "conv_12345",
    "threadId": null
  },
  "text": "오늘 회의 내용을 정리해줘",
  "preferredSessionMode": "isolated_dm"
}
```

### 명시적 sessionKey 요청 예시

```json
{
  "eventId": "evt_20260409_000002",
  "messageId": "msg_20260409_000002",
  "occurredAt": "2026-04-09T14:05:00+09:00",
  "sender": {
    "knoxUserId": "seungon.jung",
    "displayName": "Seungon Jung"
  },
  "conversation": {
    "type": "room",
    "conversationId": "room_123",
    "threadId": null
  },
  "agentId": "knox_group",
  "sessionKey": "agent:knox_group:knox:room:room_123",
  "text": "[Knox 단체방: room_123]\n[발화자: seungon.jung]\n\n이 이슈 정리해줘"
}
```

### 응답 예시

```json
{
  "ok": true,
  "duplicate": false,
  "messageId": "msg_20260409_000001",
  "agentId": "seungon.jung",
  "sessionKey": "agent:seungon.jung:knox:dm:u_12345",
  "status": "routing_resolved"
}
```

### 응답 코드

| 상태 코드 | 의미 |
| --- | --- |
| `202` | 정상 수신 후 비동기 처리 시작 |
| `200` | 중복 메시지로 판단되어 기존 상태 반환 |
| `400` | body 형식 오류 또는 라우팅 정책 위반 |
| `401` | 서명 검증 실패 |
| `404` | 잘못된 endpoint |
| `503` | 준비 상태 아님 |

---

## 4. Adapter -> Proxy Outbound API

### Endpoint

```http
POST /api/v1/platformclaw/knox/outbound/send
```

### 목적

- Adapter가 PlatformClaw 실행 결과를 Proxy에 전달
- Proxy는 이 payload를 기반으로 Knox 발신 API를 호출

### 요청 헤더

| 헤더 | 필수 | 설명 |
| --- | --- | --- |
| `content-type: application/json` | 필수 | JSON body 전송 |
| `authorization: Bearer <token>` | 권장 | Adapter 서비스 인증 |

### Body 파라미터 표

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `messageId` | `string` | 필수 | 원본 Knox 메시지 ID |
| `conversationId` | `string` | 필수 | Knox 대화방 식별자 |
| `threadId` | `string \| null` | 선택 | thread 식별자 |
| `agentId` | `string` | 필수 | 실행에 사용한 PlatformClaw agent |
| `sessionKey` | `string` | 필수 | 실행에 사용한 PlatformClaw 세션 |
| `runId` | `string` | 필수 | PlatformClaw run 식별자 |
| `requestId` | `string` | 필수 | Adapter와 Proxy 사이 상관관계 키 |
| `chatroomId` | `string` | 필수 | Knox 발신 대상 대화방 식별자 |
| `chatMsgId` | `string` | 필수 | Knox 발신 메시지 식별자 또는 dedupe 키 |
| `msgType` | `string` | 필수 | 1차는 `text`만 허용 |
| `status` | `string` | 필수 | `final`, `error`, `timeout` |
| `text` | `string` | 필수 | 발신 본문 |
| `final` | `boolean` | 필수 | 최종 응답 여부 |
| `errorCode` | `string` | 선택 | 실패 코드 |
| `errorMessage` | `string` | 선택 | 실패 상세 메시지 |

### Knox 발신 관련 설명

Adapter는 Knox 원본 발신 헤더를 직접 모를 필요는 없지만, Proxy가 Knox로 보내기 위한 필드는 반드시 넘겨야 한다.

실제 Knox 발신에 필요한 대표 값:

| Knox 필드 | Adapter에서 어떤 값으로 대응되는지 |
| --- | --- |
| `chatroomid` | `chatroomId` |
| `chatmsgid` | `chatMsgId` |
| `requestid` | `requestId` |
| `msgtype` | `msgType` |
| `chatmsg` | `text` |

중요:

- `sessionKey`만으로는 Knox 발신 대상이 정해지지 않는다.
- `conversationId` 또는 `chatroomId`가 반드시 있어야 한다.

### 요청 예시

```json
{
  "messageId": "msg_20260409_000001",
  "conversationId": "conv_12345",
  "threadId": null,
  "agentId": "seungon.jung",
  "sessionKey": "agent:seungon.jung:knox:dm:u_12345",
  "runId": "run_abc123",
  "requestId": "req_out_20260409_000001",
  "chatroomId": "conv_12345",
  "chatMsgId": "knox_out_000001",
  "msgType": "text",
  "status": "final",
  "text": "회의 내용을 정리했습니다.",
  "final": true
}
```

### 응답 예시

```json
{
  "ok": true,
  "provider": "knox",
  "messageId": "knox_out_000001",
  "conversationId": "conv_12345",
  "threadId": null,
  "acceptedAt": "2026-04-09T14:00:15+09:00"
}
```

### 응답 코드

| 상태 코드 | 의미 |
| --- | --- |
| `200` | 발신 완료 |
| `202` | 비동기 큐 적재 완료 |
| `400` | body 형식 오류 |
| `401` | 인증 실패 |
| `404` | 잘못된 endpoint |
| `409` | 중복 발신 |
| `429` | Knox rate limit 또는 Proxy rate limit |
| `500` | 내부 발신 실패 |

---

## 5. Health API

### `GET /healthz`

목적:

- Adapter 프로세스가 살아 있는지 확인

권장 응답:

```json
{
  "ok": true,
  "gatewayUrl": "ws://platformclaw-gateway:19001",
  "outboundUrl": "http://knox-proxy:3020/api/v1/platformclaw/knox/outbound/send",
  "dbPath": "/data/knox-adapter.sqlite"
}
```

### `GET /readyz`

목적:

- Adapter가 실제 요청을 받을 준비가 됐는지 확인

권장 응답:

```json
{
  "ok": true,
  "hasProxyOutboundUrl": true,
  "hasProxySharedSecret": true
}
```

---

## 인증 방식

### Proxy -> Adapter

권장:

- `HMAC shared secret`

이유:

- mTLS보다 초기 운영 복잡도가 낮음
- 내부망만 신뢰하는 방식보다 감사/추적이 쉬움
- 단일 서비스 간 인증으로는 구현 복잡도 대비 안정성이 좋음

### Adapter -> Proxy

권장:

- `Bearer token`

이유:

- Outbound는 서비스 간 호출이므로 단순하고 명확한 토큰 방식이 적절

---

## 운영 주의사항

1. `messageId`는 dedupe 기준이므로 절대 비워두면 안 된다.
2. `conversationId` 또는 `chatroomId`가 없으면 Knox 발신이 불가능하다.
3. `agentId`와 `sessionKey`는 PlatformClaw 라우팅용이다.
4. `chatroomId`, `chatMsgId`, `requestId`는 Knox 발신/추적용이다.
5. `final-only` 기준에서는 중간 delta를 Proxy에 보내지 않는다.
6. Outbound 실패는 gateway 재실행으로 이어지면 안 된다.

---

## 1차 서비스 기준 고정값

| 항목 | 값 |
| --- | --- |
| 지원 채널 | DM only |
| 응답 방식 | final-only |
| 기본 세션 정책 | `isolated_dm` |
| `agentId` 기본 생성 | email local-part |
| Proxy -> Adapter 인증 | HMAC shared secret |
| Adapter -> Proxy 인증 | Bearer token |
| 실패 정책 | gateway timeout/일시 실패 1회 재시도 후 실패 전달 |

---

## 관련 문서

- [Knox Proxy Spec](/home/eon/work/open_claw/KNOX_PORXY_SPEC.md)
- [Adapter Plan](/home/eon/work/open_claw/knox-adapter/ADAPTER_PLAN.ko.md)
