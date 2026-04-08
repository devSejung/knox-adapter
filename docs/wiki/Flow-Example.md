# Knox Adapter 동작 예시

## 개요

이 문서는 `Knox Proxy -> PlatformClaw Adapter -> PlatformClaw Gateway -> Knox Proxy` 흐름이 실제로 어떻게 동작하는지 예시로 설명한다.

목적:

- Adapter가 어떤 신호를 수신하는지 이해
- Adapter가 어떤 값을 만들어내는지 이해
- Gateway에 어떻게 메시지를 넣는지 이해
- 최종적으로 Proxy에 무엇을 다시 보내는지 이해

대상:

- Proxy 구현 담당자
- Adapter 구현 담당자
- 운영/검토 담당자

---

## 전체 흐름

순서:

1. Knox 사용자가 DM 전송
2. Knox Proxy가 원본 메시지를 수신
3. Knox Proxy가 정규화된 payload를 Adapter로 전달
4. Adapter가 `agentId`, `sessionKey`를 계산
5. Adapter가 PlatformClaw Gateway에 websocket `chat.send` 시도
6. 필요 시 Adapter가 `/v1/responses`로 폴백
7. Gateway가 최종 응답 반환
7. Adapter가 Proxy로 outbound payload 전송
8. Proxy가 실제 Knox 발신 API 호출

---

## 예시 시나리오

가정:

- Knox 사용자 ID: `u_12345`
- 회사 이메일: `seungon.jung@samsung.com`
- 기본 agentId 정책: email local-part
- 세션 정책: `isolated_dm`

결과:

- `agentId = "seungon.jung"`
- `sessionKey = "agent:seungon.jung:knox:dm:u_12345"`

---

## 1. Proxy가 Adapter에 보내는 신호

Proxy는 Knox 원본 메시지를 정규화해서 Adapter에 전달한다.

### 요청

```http
POST /api/v1/platformclaw/knox/inbound
content-type: application/json
x-platformclaw-timestamp: 1775710800000
x-platformclaw-signature: sha256=<hmac>
```

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

### Adapter가 여기서 하는 일

1. HMAC 서명 검증
2. JSON 파싱
3. 스키마 검증
4. 중복 `messageId` 검사
5. 상태 저장
6. `agentId`, `sessionKey` 계산

현재 코드 기준 관련 파일:

- [server.ts](/home/eon/work/open_claw/knox-adapter/src/server.ts)
- [auth.ts](/home/eon/work/open_claw/knox-adapter/src/auth.ts)
- [schemas.ts](/home/eon/work/open_claw/knox-adapter/src/schemas.ts)
- [service.ts](/home/eon/work/open_claw/knox-adapter/src/service.ts)
- [routing.ts](/home/eon/work/open_claw/knox-adapter/src/routing.ts)

---

## 2. Adapter가 계산하는 값

위 예시 기준 계산 결과:

```json
{
  "employeeId": "seungon.jung",
  "agentId": "seungon.jung",
  "sessionKey": "agent:seungon.jung:knox:dm:u_12345"
}
```

설명:

- `employeeId`
  - Proxy가 넘긴 직원 식별자
- `agentId`
  - 기본 정책상 email local-part
- `sessionKey`
  - 기본 정책상 Knox DM 분리 세션

---

## 3. Adapter가 Gateway에 보내는 요청

Adapter는 기본적으로 PlatformClaw Gateway websocket/RPC 클라이언트로 `chat.send`를 시도한다.

### 개념적 요청 프레임

```json
{
  "type": "req",
  "id": "rpc_001",
  "method": "chat.send",
  "params": {
    "sessionKey": "agent:seungon.jung:knox:dm:u_12345",
    "message": "오늘 회의 내용을 정리해줘",
    "idempotencyKey": "msg_20260409_000001:evt_20260409_000001",
    "timeoutMs": 180000
  }
}
```

설명:

- `sessionKey`
  - 어느 세션에 메시지를 넣을지 결정
- `message`
  - 실제 사용자 텍스트
- `idempotencyKey`
  - 같은 메시지를 두 번 처리하지 않기 위한 키
- `timeoutMs`
  - 실행 완료를 기다리는 최대 시간

현재 코드 기준 관련 파일:

- [platformclaw-gateway.ts](/home/eon/work/open_claw/knox-adapter/src/platformclaw-gateway.ts)

### 3.1 websocket `chat.send`가 막힐 때

실제 Gateway에서는 shared secret만으로 websocket `chat.send`가 `missing scope: operator.write`로 막힐 수 있다.

이 경우 Adapter는 `/v1/responses`로 자동 폴백한다.

개념적 HTTP 요청:

```http
POST /v1/responses
authorization: Bearer <gateway-secret>
content-type: application/json
x-openclaw-session-key: agent:seungon.jung:knox:dm:u_12345
```

```json
{
  "stream": false,
  "model": "openclaw/seungon.jung",
  "input": "오늘 회의 내용을 정리해줘",
  "user": "seungon.jung@samsung.com"
}
```

즉 현재 실제 서비스 기준 실행 경로는 아래 둘 중 하나다.

- websocket `chat.send`
- `/v1/responses` final-only 폴백

---

## 4. Gateway가 Adapter에 돌려주는 값

### 4.1 최초 응답

`chat.send` 요청이 받아들여지면 `runId`를 가진 응답이 온다.

예시:

```json
{
  "runId": "run_abc123"
}
```

Adapter는 이 시점에 상태를 `gateway_accepted`, 이후 `running`으로 기록한다.

### 4.2 최종 이벤트 또는 최종 HTTP 응답

websocket 경로를 쓴 경우 실행이 끝나면 `chat` 이벤트의 `final`, `error`, `aborted` 중 하나를 받는다.

#### final 예시

```json
{
  "runId": "run_abc123",
  "sessionKey": "agent:seungon.jung:knox:dm:u_12345",
  "state": "final",
  "message": {
    "content": [
      {
        "type": "text",
        "text": "회의 내용을 정리했습니다."
      }
    ]
  }
}
```

#### error 예시

```json
{
  "runId": "run_abc123",
  "sessionKey": "agent:seungon.jung:knox:dm:u_12345",
  "state": "error",
  "errorMessage": "gateway run completion timeout"
}
```

Adapter는 이 결과를 내부 상태에 저장하고, 최종적으로 Proxy에 outbound payload를 보낸다.

`/v1/responses` 폴백 경로를 쓴 경우에는 HTTP 응답 body에서 최종 assistant 텍스트를 추출해 동일한 outbound payload로 변환한다.

---

## 5. Adapter가 Proxy에 다시 보내는 값

Gateway에서 `final`을 받았다고 가정한다.

Adapter는 Proxy에 아래와 같은 payload를 보낸다.

### 요청

```http
POST /api/v1/platformclaw/knox/outbound/send
content-type: application/json
authorization: Bearer <token>
```

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

설명:

- `messageId`
  - 원본 Knox 메시지 식별자
- `conversationId`
  - 원본 대화방 식별자
- `agentId`, `sessionKey`
  - PlatformClaw 내부 라우팅 정보
- `runId`
  - PlatformClaw 실행 식별자
- `requestId`
  - Adapter/Proxy 구간 상관관계 키
- `chatroomId`
  - Proxy가 Knox 발신에 사용할 대화방 식별자
- `chatMsgId`
  - Knox 발신 dedupe/추적용 ID
- `msgType`
  - 1차는 `text`
- `text`
  - 실제 Knox로 보낼 본문

현재 코드 기준 관련 파일:

- [outbound-client.ts](/home/eon/work/open_claw/knox-adapter/src/outbound-client.ts)

---

## 6. Proxy가 Knox로 보내는 최종 발신

Proxy는 Adapter가 준 payload를 Knox 발신 형식으로 변환한다.

대표적으로 필요한 값:

- `accept`
- `content-type`
- `authorization`
- `system-id`
- `x-devide-id`
- `x-device_type`
- `requestid`
- `chatroomid`
- `chatmsgid`
- `msgtype`
- `chatmsg`

핵심 대응 관계:

| Proxy 내부 값 | Knox 발신 값 |
| --- | --- |
| `requestId` | `requestid` |
| `chatroomId` | `chatroomid` |
| `chatMsgId` | `chatmsgid` |
| `msgType` | `msgtype` |
| `text` | `chatmsg` |

---

## 7. 실패 시 예시

### 경우 1. Gateway timeout

상황:

- Adapter가 `chat.send`는 성공시켰지만
- 정해진 시간 안에 `final`을 못 받음

처리:

1. Adapter는 상태를 `timed_out`으로 기록
2. Proxy에 `status=timeout` payload 전송
3. Proxy는 Knox에 실패 메시지를 보낼지, 운영 알림만 남길지 정책적으로 결정

### 경우 2. Proxy outbound 실패

상황:

- Gateway는 정상적으로 `final`을 반환
- 하지만 Proxy outbound API 호출이 실패

처리:

1. Adapter는 상태를 `failed`로 기록
2. `errorCode=proxy_outbound_failed` 저장
3. 이 실패는 gateway 재실행으로 이어지면 안 됨

중요:

- outbound 실패는 "메시지 전달 실패"이지 "모델 실행 실패"가 아니다
- 따라서 같은 Knox 메시지에 대해 다시 `chat.send`를 호출하면 중복 실행이 될 수 있다

---

## 8. 운영자가 봐야 할 추적 키

한 건의 요청을 추적할 때 최소한 아래 키가 필요하다.

| 키 | 의미 |
| --- | --- |
| `eventId` | Knox 이벤트 식별자 |
| `messageId` | Knox 메시지 식별자 |
| `agentId` | PlatformClaw agent 식별자 |
| `sessionKey` | PlatformClaw 세션 식별자 |
| `runId` | PlatformClaw 실행 식별자 |
| `requestId` | Adapter -> Proxy 발신 상관관계 키 |
| `chatroomId` | Knox 대화방 식별자 |
| `chatMsgId` | Knox 발신 메시지 식별자 |

---

## 9. 요약

핵심만 다시 정리하면:

1. Proxy는 정규화된 메시지를 Adapter에 보낸다.
2. Adapter는 `agentId`, `sessionKey`를 계산한다.
3. Adapter는 Gateway에 `chat.send`를 보낸다.
4. Gateway가 `final` 또는 `error`를 반환한다.
5. Adapter는 그 결과를 Proxy에 전달한다.
6. Proxy가 실제 Knox 발신 API를 호출한다.

즉 Adapter는:

- Proxy에서 신호를 받는 서비스
- PlatformClaw에 메시지를 주입하는 서비스
- 실행 결과를 Proxy로 다시 넘겨주는 서비스

---

## 관련 문서

- [Knox Proxy - Adapter API](/home/eon/work/open_claw/knox-adapter/KNOX_PROXY_API.ko.md)
- [Adapter Plan](/home/eon/work/open_claw/knox-adapter/ADAPTER_PLAN.ko.md)
- [Knox Proxy Spec](/home/eon/work/open_claw/KNOX_PORXY_SPEC.md)
