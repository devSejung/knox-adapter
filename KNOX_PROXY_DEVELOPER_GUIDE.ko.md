# Knox Proxy 개발자 가이드

## 개요

이 문서는 회사에서 `Knox Proxy`를 구현하는 개발자를 위한 문서다.

목적:

- Knox Proxy가 무엇을 해야 하는지 빠르게 이해
- PlatformClaw Adapter와 어떤 계약으로 통신해야 하는지 이해
- 실제 운영에서 빠뜨리기 쉬운 항목을 체크

이 문서는 **Knox Proxy 개발자 관점**에 집중한다.

비범위:

- PlatformClaw 내부 구현 상세
- Adapter 내부 저장소 구현 상세
- OpenClaw UI 구성 상세

---

## 1. Knox Proxy의 책임

Knox Proxy는 아래 책임만 명확히 가지면 된다.

1. Knox 원본 수신 API 연결
2. Knox 원본 발신 API 연결
3. Knox 사용자 식별
4. Knox 메시지를 회사 표준 payload로 정규화
5. Adapter inbound API 호출
6. Adapter outbound 결과를 받아 Knox 발신 API 호출

중요:

- Proxy는 `sessionKey`를 직접 만들지 않는다.
- Proxy는 Knox 원본 포맷을 PlatformClaw 내부 포맷으로 직접 바꾸지 않는다.
- `agentId`, `sessionKey` 최종 결정은 Adapter 책임이다.

즉 Proxy는 아래 두 세계를 잇는 역할이다.

- `Knox 원본 API`
- `회사 표준 API`

---

## 2. 전체 흐름

정상 동작 흐름은 아래와 같다.

1. Knox 사용자가 DM 전송
2. Knox Proxy가 Knox 메시지 수신
3. Knox Proxy가 Adapter inbound API 호출
4. Adapter가 PlatformClaw에 요청
5. PlatformClaw가 답변 생성
6. Adapter가 Proxy outbound API 호출
7. Knox Proxy가 Knox 발신 API 호출

정리:

- 수신 시작점: Knox Proxy
- Knox 발신 최종 책임: Knox Proxy
- PlatformClaw 연결 책임: Adapter

---

## 3. Knox Proxy가 Adapter에 보내야 하는 값

Proxy가 Adapter에 보내는 endpoint:

```http
POST /api/v1/platformclaw/knox/inbound
```

필수 헤더:

| 헤더 | 필수 | 설명 |
| --- | --- | --- |
| `content-type: application/json` | 필수 | JSON body |
| `x-platformclaw-timestamp` | 필수 | HMAC 검증용 timestamp |
| `x-platformclaw-signature` | 필수 | HMAC SHA-256 서명 |

필수 body:

| 필드 | 필수 | 설명 |
| --- | --- | --- |
| `eventId` | 필수 | 이벤트 식별자 |
| `messageId` | 필수 | 메시지 dedupe 식별자 |
| `occurredAt` | 필수 | 원본 발생 시각 |
| `sender.knoxUserId` | 필수 | Knox 사용자 ID |
| `conversation.type` | 필수 | 현재는 `dm`만 허용 |
| `conversation.conversationId` | 필수 | Knox 대화방 ID |
| `text` | 필수 | 사용자 메시지 본문 |

강하게 권장:

| 필드 | 권장 | 설명 |
| --- | --- | --- |
| `sender.employeeId` | 권장 | 사번/직원 ID |
| `sender.employeeEmail` | 권장 | 이메일, 기본 매핑 기준 |
| `sender.displayName` | 권장 | 표시 이름 |
| `sender.department` | 권장 | 부서 |
| `conversation.threadId` | 권장 | thread 구분이 있으면 전달 |
| `preferredSessionMode` | 권장 | `isolated_dm` 또는 `shared_main` |
| `agentId` | 선택 | Proxy가 명시적으로 계산했을 때만 |

권장 payload 예시:

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

---

## 4. Knox Proxy가 Adapter에서 받아야 하는 값

Adapter가 Proxy에 보내는 endpoint:

```http
POST /api/v1/platformclaw/knox/outbound/send
```

Proxy는 이 값을 받아 Knox 발신 API로 변환해야 한다.

핵심 필드:

| 필드 | 의미 |
| --- | --- |
| `messageId` | 원본 Knox 메시지 식별자 |
| `conversationId` | Knox 대화방 ID |
| `threadId` | Knox thread ID |
| `agentId` | PlatformClaw agent 식별자 |
| `sessionKey` | PlatformClaw session 식별자 |
| `runId` | PlatformClaw 실행 단위 ID |
| `requestId` | 추적용 요청 ID |
| `chatroomId` | Knox 발신 대상 대화방 ID |
| `chatMsgId` | Knox 발신 메시지 ID |
| `msgType` | 현재는 `text` |
| `status` | `final`, `error`, `timeout` |
| `text` | Knox로 보낼 최종 텍스트 |
| `final` | 최종 메시지 여부 |

예시:

```json
{
  "messageId": "msg_20260409_000001",
  "conversationId": "conv_12345",
  "threadId": null,
  "agentId": "seungon.jung",
  "sessionKey": "agent:seungon.jung:knox:dm:u_12345",
  "runId": "run_abc123",
  "requestId": "req_abc123",
  "chatroomId": "conv_12345",
  "chatMsgId": "knox-out-12345",
  "msgType": "text",
  "status": "final",
  "text": "회의 내용을 정리했습니다.",
  "final": true
}
```

---

## 5. Knox 발신 API 변환 기준

현재 확인된 Knox 발신 필수값:

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

Proxy는 Adapter outbound payload를 Knox 발신 포맷으로 바꾸면 된다.

매핑 예시:

| Adapter outbound | Knox 발신 |
| --- | --- |
| `requestId` | `requestid` |
| `chatroomId` | `chatroomid` |
| `chatMsgId` | `chatmsgid` |
| `msgType` | `msgtype` |
| `text` | `chatmsg` |

즉 Proxy는 PlatformClaw 내부 값 전체를 이해할 필요 없이, Knox 발신에 필요한 값만 골라서 매핑하면 된다.

---

## 6. 사용자 매핑 기준

권장 기준:

- `employeeEmail`이 있으면 email local-part를 기본 `agentId` 기준으로 사용
- 예:
  - `seungon.jung@samsung.com`
  - `agentId = "seungon.jung"`

Proxy 쪽 최소 원칙:

- 가능하면 `employeeId`와 `employeeEmail` 둘 다 넘긴다
- Adapter가 라우팅 판단을 안정적으로 할 수 있게 한다

중요:

- `knoxUserId`만 넘기고 직원 식별을 비워두면 운영상 불안정해진다
- 회사에서 이미 사번/이메일 조회가 가능하면 Proxy 단계에서 보강해서 넘기는 것이 맞다

---

## 7. 세션 정책

Proxy는 세션 정책을 힌트로 전달할 수 있다.

허용 값:

- `isolated_dm`
- `shared_main`

권장 기본값:

- `isolated_dm`

의미:

- web: `agent:<agentId>:main`
- Knox DM: `agent:<agentId>:knox:dm:<knoxUserId>`

중요:

- Proxy는 `sessionKey` 완성 문자열을 직접 강제하지 않는다
- Proxy는 `preferredSessionMode`만 전달한다
- 최종 `sessionKey` 계산은 Adapter가 한다

---

## 8. 인증 방식

### 8.1 Proxy -> Adapter

권장:

- HMAC shared secret

의미:

- Proxy가 요청 body와 timestamp로 HMAC 서명
- Adapter가 검증

최소 필요:

- `x-platformclaw-timestamp`
- `x-platformclaw-signature`

### `x-platformclaw-signature` 계산 방법

서명 계산 기준은 아래와 같다.

```text
payload = "<x-platformclaw-timestamp>.<rawBody>"
signature = HMAC_SHA256(PROXY_SHARED_SECRET, payload)
header = "sha256=" + hex(signature)
```

중요:

- `rawBody`는 실제 HTTP로 보낼 JSON 문자열 그대로여야 한다.
- JSON을 다시 정렬하거나 pretty-print하면 서명이 달라질 수 있다.
- `x-platformclaw-timestamp`는 밀리초 epoch 문자열을 권장한다.

Node.js 예시:

```js
import crypto from "node:crypto";

const rawBody = JSON.stringify(body);
const timestamp = Date.now().toString();
const payload = `${timestamp}.${rawBody}`;
const signature = crypto
  .createHmac("sha256", process.env.PROXY_SHARED_SECRET)
  .update(payload)
  .digest("hex");

headers["x-platformclaw-timestamp"] = timestamp;
headers["x-platformclaw-signature"] = `sha256=${signature}`;
```
- `PROXY_SHARED_SECRET`

### 8.2 Adapter -> Proxy

권장:

- Bearer token

의미:

- Adapter가 outbound API 호출 시 `Authorization: Bearer ...` 사용
- Proxy가 토큰 검증

---

## 9. 실패 처리 원칙

Proxy 개발자 기준으로 중요한 것은 아래다.

1. Adapter inbound `202`
- 정상 수신 후 비동기 처리 시작

2. Adapter inbound `200`
- 중복 메시지 처리
- 기존 상태 재사용

3. Adapter outbound `status=final`
- Knox에 정상 발신

4. Adapter outbound `status=error` 또는 `timeout`
- Knox에 실패 안내를 보낼지, 운영 로그만 남길지 정책 결정 필요

권장:

- 1차는 Knox 사용자에게 단순 실패 메시지 1회 발신
- 내부 운영 로그에는 `messageId`, `requestId`, `runId`를 함께 남김

---

## 10. Proxy 개발자가 반드시 구현해야 하는 체크리스트

- Knox 수신 API 연결
- Knox 발신 API 연결
- Adapter inbound 호출
- Adapter outbound 수신 처리
- HMAC 생성
- Bearer token 검증
- `messageId` dedupe 기준 유지
- `employeeId` 또는 `employeeEmail` 보강
- `conversationId` 정확 전달
- Knox 발신 필드 매핑

---

## 11. 이것만 맞으면 되는가

Proxy 개발자 관점에서는 아래가 맞으면 된다.

- Adapter API 계약 일치
- HMAC/토큰 인증 일치
- `employeeId` 또는 `employeeEmail` 전달
- `conversationId` / `chatroomId` 매핑 정확
- Knox 발신 필드 매핑 정확

즉 Proxy가 Adapter 계약만 정확히 지키면,

- Adapter가 PlatformClaw 연결
- PlatformClaw가 답변 생성
- Adapter가 Proxy outbound 호출

까지는 Adapter와 PlatformClaw 쪽 책임으로 넘어간다.

---

## 12. 참고 문서

- 계약 표: [KNOX_PROXY_API.ko.md](/home/eon/work/open_claw/knox-adapter/KNOX_PROXY_API.ko.md)
- 흐름 예시: [FLOW_EXAMPLE.ko.md](/home/eon/work/open_claw/knox-adapter/FLOW_EXAMPLE.ko.md)
- Adapter 운영 계획: [ADAPTER_PLAN.ko.md](/home/eon/work/open_claw/knox-adapter/ADAPTER_PLAN.ko.md)
- Docker 배포: [DOCKER_DEPLOY.ko.md](/home/eon/work/open_claw/knox-adapter/DOCKER_DEPLOY.ko.md)
