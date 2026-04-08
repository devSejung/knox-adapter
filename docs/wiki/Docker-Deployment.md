# Knox Adapter Docker 배포

## 개요

이 문서는 `platformclaw-knox-adapter` 이미지를 Docker로 빌드하고, tar 파일로 내보내고, 회사 환경에서 `docker load` 및 `docker run`으로 실행하는 방법을 설명한다.

대상:

- 배포 담당자
- 운영 담당자
- 회사 내부 인프라 담당자

---

## 빌드 산출물

`build_docker.sh`를 실행하면 아래 경로에 tar 파일이 생성된다.

```text
release/YYYY-MM-DD/platformclaw-knox-adapter_YYYY-MM-DD.tar
```

예:

```text
release/2026-04-09/platformclaw-knox-adapter_2026-04-09.tar
```

---

## 1. 이미지 빌드

프로젝트 루트:

```bash
cd /home/eon/work/open_claw/knox-adapter
```

실행:

```bash
./build_docker.sh
```

기본 동작:

1. Docker 이미지 빌드
2. 빌드 전 타입 체크 실행
3. Docker 이미지 tar 저장
4. `release/{오늘날짜}/` 경로 생성

기본 이미지 이름:

```text
platformclaw-knox-adapter:{오늘날짜}
```

예:

```text
platformclaw-knox-adapter:2026-04-09
```

### 선택 환경변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `IMAGE_NAME` | `platformclaw-knox-adapter` | Docker image repository 이름 |
| `IMAGE_TAG` | `YYYY-MM-DD` | Docker tag |

예:

```bash
IMAGE_NAME=corp-platformclaw-knox-adapter IMAGE_TAG=prod ./build_docker.sh
```

---

## 2. 회사 환경에서 이미지 로드

tar 파일을 회사 서버로 전달한 뒤 아래 명령으로 로드한다.

```bash
docker load -i platformclaw-knox-adapter_2026-04-09.tar
```

정상 로드 후 확인:

```bash
docker images | grep platformclaw-knox-adapter
```

예상:

```text
platformclaw-knox-adapter   2026-04-09   <image-id>
```

---

## 3. 환경변수 파일 준비

예시:

```bash
cp .env.example .env
```

최소 확인해야 하는 값:

| 변수 | 설명 |
| --- | --- |
| `HOST` | 기본 `127.0.0.1`, 컨테이너 내부 바인딩 주소 |
| `PORT` | 기본 `3010`, Adapter HTTP 포트 |
| `DATABASE_PATH` | 컨테이너 내부 SQLite 경로 |
| `PROXY_SHARED_SECRET` | Proxy -> Adapter HMAC 검증용 secret |
| `PROXY_OUTBOUND_URL` | Adapter -> Proxy outbound endpoint |
| `PROXY_OUTBOUND_AUTH_TOKEN` | outbound 호출용 Bearer token |
| `PLATFORMCLAW_GATEWAY_URL` | Adapter -> Gateway websocket URL |
| `PLATFORMCLAW_HTTP_BASE_URL` | Adapter -> Gateway HTTP base URL, 미설정 시 websocket URL 기준으로 자동 변환 |
| `PLATFORMCLAW_GATEWAY_TOKEN` | Gateway 인증 토큰 |
| `PLATFORMCLAW_GATEWAY_PASSWORD` | Gateway 인증 비밀번호 |
| `PLATFORMCLAW_TRANSPORT` | `auto`, `websocket`, `http-responses` |
| `PLATFORMCLAW_USE_DEVICE_IDENTITY` | device auth 사용 여부 |
| `DEFAULT_SESSION_MODE` | `isolated_dm` 권장 |

권장값 예시:

```env
HOST=0.0.0.0
PORT=3010
DATABASE_PATH=/app/data/knox-adapter.sqlite
PROXY_SHARED_SECRET=change_me
REQUIRE_PROXY_HMAC=true
PROXY_OUTBOUND_URL=http://knox-proxy.internal:3020/api/v1/platformclaw/knox/outbound/send
PROXY_OUTBOUND_AUTH_TOKEN=change_me
PLATFORMCLAW_GATEWAY_URL=ws://platformclaw-gateway.internal:19001
PLATFORMCLAW_TRANSPORT=auto
PLATFORMCLAW_GATEWAY_PASSWORD=change_me
PLATFORMCLAW_USE_DEVICE_IDENTITY=false
DEFAULT_SESSION_MODE=isolated_dm
ENABLE_STAGE_UPDATES=false
MAX_RETRY_ATTEMPTS=1
```

중요:

- `PLATFORMCLAW_GATEWAY_TOKEN`과 `PLATFORMCLAW_GATEWAY_PASSWORD`는 둘 다 넣을 필요 없다.
- 현재 로컬 검증은 `password` 경로로 했다.
- `PLATFORMCLAW_USE_DEVICE_IDENTITY=false`는 문자열 `"false"`도 올바르게 `false`로 처리되도록 수정돼 있다.
- `PLATFORMCLAW_TRANSPORT=auto`면 shared-secret 환경에서 `/v1/responses`를 우선 사용한다.
- 따라서 기본 운영에서는 websocket `chat.send` 실패 로그를 먼저 만들지 않는다.

---

## 4. 컨테이너 실행

예시:

```bash
docker run -d \
  --name platformclaw-knox-adapter \
  --restart unless-stopped \
  -p 3010:3010 \
  --env-file .env \
  -v /srv/platformclaw-knox-adapter/data:/app/data \
  platformclaw-knox-adapter:2026-04-09
```

설명:

| 옵션 | 설명 |
| --- | --- |
| `--restart unless-stopped` | 운영 환경 재시작 정책 |
| `-p 3010:3010` | Adapter HTTP 포트 노출 |
| `--env-file .env` | 설정 주입 |
| `-v /srv/.../data:/app/data` | SQLite 상태 저장 영속화 |

---

## 5. 상태 확인

### Health

```bash
curl -s http://127.0.0.1:3010/healthz
```

### Readiness

```bash
curl -s http://127.0.0.1:3010/readyz
```

주의:

- `healthz`는 프로세스 생존 확인
- `readyz`는 필수 설정 존재 여부와 내부 준비 상태 확인
- Docker `HEALTHCHECK`는 `healthz` 기준으로 동작한다.
- 컨테이너 시작 직후에는 잠시 `starting` 상태일 수 있다.

---

## 6. 운영 시 권장 사항

1. `DATABASE_PATH`는 반드시 volume에 올린다.
2. `PROXY_SHARED_SECRET`, `PLATFORMCLAW_GATEWAY_TOKEN`, `PROXY_OUTBOUND_AUTH_TOKEN`은 평문 공유를 피한다.
3. `DEFAULT_SESSION_MODE`는 초기에는 `isolated_dm`으로 고정한다.
4. `ENABLE_STAGE_UPDATES`는 초기에 `false` 유지가 권장된다.
5. Adapter와 Gateway는 내부망으로 통신하는 것이 권장된다.

---

## 7. 문제 해결

### `readyz`가 503인 경우

확인할 것:

- `PROXY_SHARED_SECRET`
- `PROXY_OUTBOUND_URL`
- `PLATFORMCLAW_GATEWAY_URL`

### outbound가 실패하는 경우

확인할 것:

- `PROXY_OUTBOUND_AUTH_TOKEN`
- Proxy outbound endpoint 응답 코드
- Knox Proxy 로그

### Gateway 연결이 실패하는 경우

확인할 것:

- `PLATFORMCLAW_GATEWAY_URL`
- `PLATFORMCLAW_GATEWAY_TOKEN`
- `PLATFORMCLAW_GATEWAY_PASSWORD`
- Gateway가 실제로 해당 주소에서 websocket을 받고 있는지

### Gateway 연결은 되는데 `chat.send`가 실패하는 경우

확인할 것:

- 오류 메시지에 `missing scope: operator.write`가 있는지
- `PLATFORMCLAW_TRANSPORT`가 `auto` 또는 `http-responses`인지
- Gateway에 `/v1/responses`가 활성화되어 있는지
- `PLATFORMCLAW_HTTP_BASE_URL` 또는 `PLATFORMCLAW_GATEWAY_URL`가 실제 Gateway 주소와 일치하는지

주의:

- 현재 실제 Gateway 검증에서 `connect`는 성공했고, websocket `chat.send`는 `operator.write` 부족으로 실패할 수 있음을 확인했다.
- Adapter는 이 경우 `/v1/responses`로 자동 폴백하도록 수정되었다.
- 따라서 회사 반입 전에는 "연결 성공"뿐 아니라 "/v1/responses 활성화 여부"와 "최종 outbound 전달 성공"까지 반드시 확인해야 한다.

---

## 8. PlatformClaw 설정 확인 항목

Adapter를 붙이기 전에 PlatformClaw 설정 파일에서 아래만 우선 확인하면 된다.

| 항목 | 설명 |
| --- | --- |
| `gateway.bind` | Gateway 바인딩 주소 |
| `gateway.port` | Gateway 포트 |
| `gateway.auth.mode` | `password` 또는 `token` |
| `gateway.auth.password` | password 모드일 때 사용 |
| `gateway.auth.token` | token 모드일 때 사용 |
| `gateway.http.endpoints.responses.enabled` | `/v1/responses` 활성화 여부 |

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

- 저장소의 [exam_emp_openclaw.json](/home/eon/work/open_claw/openclaw/exam_emp_openclaw.json) 예시는 이미 아래 항목을 포함하도록 반영돼 있다.
  - `gateway.auth.mode = "password"`
  - `gateway.auth.password`
  - `gateway.http.endpoints.responses.enabled = true`

즉 Knox Adapter 연동 기준의 기본 예시 설정으로 바로 참고할 수 있다.

---

## 9. 회사 적용 시 최종 해석

결론부터 적으면 아래 조건이 맞으면 회사에서 정상 동작으로 Knox 수발신을 구성할 수 있다.

- 회사 Knox Proxy가 준비되어 있음
- `platformclaw-knox-adapter` 컨테이너가 배포되어 있음
- PlatformClaw Gateway에서 `/v1/responses`가 활성화되어 있음
- Gateway shared secret이 Adapter에 설정되어 있음

동작 흐름:

1. Knox -> Knox Proxy 수신
2. Knox Proxy -> Adapter inbound API 호출
3. Adapter -> PlatformClaw Gateway 요청
4. PlatformClaw -> Adapter 최종 응답 반환
5. Adapter -> Knox Proxy outbound API 호출
6. Knox Proxy -> Knox 발신 API 호출

중요:

- "Proxy만 있으면 된다"는 표현은 정확하지 않다.
- 실제로는 `Proxy + Adapter + Gateway 설정`이 모두 필요하다.
- 다만 회사 구현팀 입장에서는 Knox 세부사항은 Proxy가 흡수하고, PlatformClaw 연결은 Adapter가 흡수하므로 역할 분리가 명확하다.

---

## 10. 정상 동작을 위한 정확한 조건과 설정 방법

아래 네 가지는 최소 전제 조건이다.

1. `Knox Proxy`가 있어야 한다.
2. `Adapter`가 배포되어 있어야 한다.
3. `Gateway shared secret`이 설정되어 있어야 한다.
4. `gateway.http.endpoints.responses.enabled = true` 이어야 한다.

이 네 가지를 실제로 어떻게 맞추는지 아래에 정리한다.

### 10.1 Knox Proxy가 있어야 한다

의미:

- Knox 원본 메시지를 직접 Adapter로 보내는 것이 아니라, 회사 `Knox Proxy`가 먼저 수신해야 한다.
- Proxy는 Knox 원본 API를 회사 표준 payload로 바꿔 Adapter에 전달해야 한다.

Proxy가 해야 하는 최소 구현:

- Knox 수신 API 연결
- Knox 발신 API 연결
- `POST /api/v1/platformclaw/knox/inbound` 호출
- `POST /api/v1/platformclaw/knox/outbound/send` 수신 처리
- `messageId`, `conversationId`, `employeeId` 또는 `employeeEmail` 전달

즉 Proxy는 아래 두 계약만 맞추면 된다.

- [KNOX_PROXY_API.ko.md](/home/eon/work/open_claw/knox-adapter/KNOX_PROXY_API.ko.md)
- [FLOW_EXAMPLE.ko.md](/home/eon/work/open_claw/knox-adapter/FLOW_EXAMPLE.ko.md)

### 10.2 Adapter가 배포되어 있어야 한다

의미:

- Knox Proxy와 PlatformClaw 사이의 브리지가 실제로 떠 있어야 한다.

배포 방법:

1. 이미지 빌드

```bash
cd /home/eon/work/open_claw/knox-adapter
./build_docker.sh
```

2. 회사 서버에서 로드

```bash
docker load -i platformclaw-knox-adapter_2026-04-09.tar
```

3. `.env` 준비 후 실행

```bash
docker run -d \
  --name platformclaw-knox-adapter \
  --restart unless-stopped \
  -p 3010:3010 \
  --env-file .env \
  -v /srv/platformclaw-knox-adapter/data:/app/data \
  platformclaw-knox-adapter:2026-04-09
```

### 10.3 Gateway shared secret이 설정되어 있어야 한다

의미:

- Adapter가 PlatformClaw Gateway에 인증된 요청을 보낼 수 있어야 한다.

둘 중 하나를 사용한다.

- `gateway.auth.mode = "password"`
- `gateway.auth.mode = "token"`

Adapter `.env` 예시:

비밀번호 방식:

```env
PLATFORMCLAW_GATEWAY_URL=ws://platformclaw-gateway.internal:19001
PLATFORMCLAW_GATEWAY_PASSWORD=CHANGE_ME_ADMIN_PASSWORD
PLATFORMCLAW_TRANSPORT=auto
```

토큰 방식:

```env
PLATFORMCLAW_GATEWAY_URL=ws://platformclaw-gateway.internal:19001
PLATFORMCLAW_GATEWAY_TOKEN=CHANGE_ME_GATEWAY_TOKEN
PLATFORMCLAW_TRANSPORT=auto
```

중요:

- 둘 다 동시에 넣을 필요는 없다.
- 현재 검증 기준은 `password` 방식이다.

### 10.4 `gateway.http.endpoints.responses.enabled = true` 이어야 한다

의미:

- shared-secret 환경에서는 Adapter가 `/v1/responses`를 주 경로로 사용한다.
- 이 endpoint가 꺼져 있으면 실제 서비스 경로가 막힌다.

OpenClaw 설정 예시:

```json
{
  "gateway": {
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

저장소 기준 예시 파일:

- [exam_emp_openclaw.json](/home/eon/work/open_claw/openclaw/exam_emp_openclaw.json)

### 10.5 이 조건들만 있으면 정상 동작하는가

정확히는 아래까지 맞아야 한다.

- Knox Proxy 계약이 문서와 일치
- Adapter가 정상 배포됨
- Gateway shared secret 설정됨
- `/v1/responses` 활성화됨
- Proxy가 `employeeId` 또는 `employeeEmail`을 올바르게 넘김

즉 "정상 동작의 최소 조건"은 위 네 가지가 맞고, 실제 운영 성공 조건은 Proxy payload 계약 일치까지 포함한다.

현재 기준 최종 판단:

- 위 조건을 맞추면 구조적으로 정상 동작한다.
- 이 경로는 실제로 `Mock Proxy -> Adapter -> 실제 Gateway -> Proxy outbound`까지 검증됐다.
- 따라서 남은 건 설계 불확실성이 아니라 회사 환경값을 정확히 넣는 작업이다.

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

참고:

- `gateway.controlUi.allowedOrigins`는 Control UI 브라우저 제한용이다.
- 현재 Adapter 연결 문제의 주원인은 아니었다.

---

## 관련 문서

- [Adapter Plan](/home/eon/work/open_claw/knox-adapter/ADAPTER_PLAN.ko.md)
- [Knox Proxy API](/home/eon/work/open_claw/knox-adapter/KNOX_PROXY_API.ko.md)
- [Flow Example](/home/eon/work/open_claw/knox-adapter/FLOW_EXAMPLE.ko.md)
