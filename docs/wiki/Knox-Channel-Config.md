# PlatformClaw Knox Channel 설정

이 문서는 PlatformClaw Core가 cron/job/subagent 결과를 Knox Messenger로 다시 보낼 수 있게 하는 설정을 정리한다.

Knox 일반 대화 inbound는 기존처럼 Proxy -> Adapter -> PlatformClaw Gateway 흐름을 탄다.
이 문서의 설정은 그 반대 방향, 즉 PlatformClaw Core -> Adapter -> Proxy -> Knox outbound를 위한 것이다.

## 설정 위치

`plugins`와 `channels`는 OpenClaw/PlatformClaw 설정 JSON의 최상위에 둔다.

`gateway`, `agents`, `models`, `skills` 안에 넣으면 안 된다.

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
      "adapterOutboundUrl": "http://127.0.0.1:3010/api/v1/platformclaw/knox/outbound/core-send",
      "adapterAuthToken": "CHANGE_ME_CORE_TO_ADAPTER_TOKEN",
      "allowFrom": ["*"]
    }
  }
}
```

## 전체 JSON 안에서의 위치 예시

```json
{
  "models": {
    "mode": "merge",
    "providers": {}
  },
  "skills": {
    "load": {
      "extraDirs": ["/opt/platformclaw/skills"]
    }
  },
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
      "adapterOutboundUrl": "http://127.0.0.1:3010/api/v1/platformclaw/knox/outbound/core-send",
      "adapterAuthToken": "CHANGE_ME_CORE_TO_ADAPTER_TOKEN",
      "allowFrom": ["*"]
    }
  },
  "tools": {
    "profile": "coding"
  },
  "session": {},
  "gateway": {},
  "agents": {},
  "cron": {
    "enabled": true
  }
}
```

## 필드 설명

| 경로 | 필수 | 설명 |
| --- | --- | --- |
| `plugins.entries.knox.enabled` | 필수 | Knox channel plugin을 로드한다. |
| `channels.knox.enabled` | 필수 | Knox channel account를 활성화한다. |
| `channels.knox.adapterOutboundUrl` | 필수 | Core가 Adapter로 core delivery를 보내는 URL이다. |
| `channels.knox.adapterAuthToken` | 권장 | Core -> Adapter 인증 토큰이다. Adapter의 `CORE_OUTBOUND_AUTH_TOKEN`과 같아야 한다. |
| `channels.knox.allowFrom` | 선택 | 허용 sender 범위다. 내부 운영에서는 필요에 맞게 제한할 수 있다. |

## Adapter 환경변수 매칭

Adapter에는 아래 환경변수가 필요하다.

```bash
CORE_OUTBOUND_AUTH_TOKEN='CHANGE_ME_CORE_TO_ADAPTER_TOKEN'
PROXY_OUTBOUND_URL='http://127.0.0.1:3020/api/v1/platformclaw/knox/outbound/send'
PROXY_OUTBOUND_AUTH_TOKEN='CHANGE_ME_PROXY_OUTBOUND_TOKEN'
PROXY_SHARED_SECRET='CHANGE_ME_LONG_RANDOM_SECRET'
PLATFORMCLAW_HTTP_BASE_URL='http://127.0.0.1:19001'
PLATFORMCLAW_GATEWAY_TOKEN='CHANGE_ME_ADMIN_PASSWORD'
```

반드시 맞아야 하는 값:

```text
channels.knox.adapterAuthToken
= Adapter CORE_OUTBOUND_AUTH_TOKEN
```

## Docker 배포 시 주소 주의

`127.0.0.1`은 같은 컨테이너 내부만 가리킨다.

Core와 Adapter가 다른 컨테이너면 `adapterOutboundUrl`은 Docker service 이름을 사용한다.

```json
{
  "channels": {
    "knox": {
      "enabled": true,
      "adapterOutboundUrl": "http://platformclaw-knox-adapter:3010/api/v1/platformclaw/knox/outbound/core-send",
      "adapterAuthToken": "CHANGE_ME_CORE_TO_ADAPTER_TOKEN",
      "allowFrom": ["*"]
    }
  }
}
```

Adapter가 Core에 접근할 때도 같은 원칙을 따른다.

```bash
PLATFORMCLAW_HTTP_BASE_URL='http://platformclaw-core:19001'
```

## Cron 결과 전달 방식

Knox에서 만든 일반 reminder/cron은 agent가 `delivery`를 직접 지정하지 않는 것이 기본이다.

PlatformClaw runtime이 현재 Knox DM/room target을 snapshot해서 cron 결과를 원래 Knox 대화로 보낸다.

권장 cron 생성 방향:

```text
sessionTarget: isolated
payload.kind: agentTurn
delivery: 생략
```

명시적으로 다른 곳으로 보내야 할 때만 `delivery.channel`과 `delivery.to`를 지정한다.

```json
{
  "delivery": {
    "mode": "announce",
    "channel": "knox",
    "to": "room:ROOM_ID"
  }
}
```

## 자주 나는 오류

### `Outbound not configured for channel: knox`

Core 설정에 `plugins.entries.knox.enabled=true` 또는 `channels.knox` 설정이 빠진 것이다.

확인할 것:

- `plugins.entries.knox.enabled`
- `channels.knox.enabled`
- `channels.knox.adapterOutboundUrl`
- `channels.knox.adapterAuthToken`

### `Unauthorized`

Core -> Adapter 토큰이 맞지 않는다.

확인할 것:

```text
channels.knox.adapterAuthToken
= CORE_OUTBOUND_AUTH_TOKEN
```

### `fetch failed`

Core가 Adapter URL에 접근하지 못한다.

확인할 것:

- Adapter가 떠 있는지
- 포트가 맞는지
- Docker에서 `127.0.0.1`을 잘못 쓰지 않았는지
- service name으로 접근해야 하는 구조인지

