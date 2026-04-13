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

### 2. Adapter -> Proxy

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
| Inbound | `POST` | `/api/v1/platformclaw/knox/inbound` | Knox Proxy | 정규화된 Knox 메시지를 Adapter에 전달 | 필수 |
| Outbound | `POST` | `/api/v1/platformclaw/knox/outbound/send` | Adapter | PlatformClaw 결과를 Proxy에 전달 | 필수 |
| Health | `GET` | `/healthz` | 운영/모니터링 | Adapter 생존 확인 | 필수 |
| Readiness | `GET` | `/readyz` | 운영/모니터링 | Adapter 준비 상태 확인 | 필수 |

주의:

- `healthz`와 `readyz`는 Adapter가 제공하는 API다.
- `inbound`, `outbound/send`는 Proxy와 Adapter가 서로 호출하는 계약이다.

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
| `conversation.type` | `string` | 필수 | 현재는 `dm`만 허용 |
| `conversation.conversationId` | `string` | 필수 | Knox 대화방 식별자 |
| `conversation.threadId` | `string \| null` | 선택 | thread 식별자 |
| `text` | `string` | 필수 | 사용자 메시지 본문 |
| `preferredSessionMode` | `string` | 선택 | `shared_main` 또는 `isolated_dm` 힌트 |
| `agentId` | `string` | 선택 | Proxy가 명시적으로 계산한 `agentId` |

### 세션 관련 설명

| 필드 | 역할 |
| --- | --- |
| `agentId` | PlatformClaw agent 식별자 |
| `preferredSessionMode` | Adapter가 `sessionKey`를 결정할 때 참고하는 힌트 |

중요:

- Proxy는 임의의 `sessionKey`를 직접 강제하지 않는다.
- Adapter가 최종 `sessionKey`를 만든다.
- 기본 정책은 `isolated_dm`이다.

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
| `400` | body 형식 오류 |
| `401` | 서명 검증 실패 |
| `404` | 잘못된 endpoint |
| `503` | 준비 상태 아님 |

---

## 2. Adapter -> Proxy Outbound API

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

## 3. Health API

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
