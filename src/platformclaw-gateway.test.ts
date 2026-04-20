import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { PlatformClawGatewayClient } from "./platformclaw-gateway.js";
import type { AdapterConfig } from "./config.js";

function createConfig(overrides?: Partial<AdapterConfig>): AdapterConfig {
  return {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: 3010,
    LOG_LEVEL: "error",
    DATABASE_PATH: ":memory:",
    PROXY_SHARED_SECRET: "test-secret",
    REQUIRE_PROXY_HMAC: false,
    PROXY_OUTBOUND_URL: "http://proxy.test/outbound",
    PROXY_OUTBOUND_AUTH_TOKEN: undefined,
    PROXY_SEND_TIMEOUT_MS: 10_000,
    PLATFORMCLAW_GATEWAY_URL: "ws://gateway.test",
    PLATFORMCLAW_HTTP_BASE_URL: "http://gateway.test",
    PLATFORMCLAW_TRANSPORT: "auto",
    PLATFORMCLAW_GATEWAY_TOKEN: "token",
    PLATFORMCLAW_GATEWAY_DEVICE_TOKEN: undefined,
    PLATFORMCLAW_GATEWAY_PASSWORD: undefined,
    PLATFORMCLAW_CONNECT_TIMEOUT_MS: 5_000,
    PLATFORMCLAW_REQUEST_TIMEOUT_MS: 10_000,
    PLATFORMCLAW_RUN_TIMEOUT_MS: 180_000,
    PLATFORMCLAW_ROLE: "operator",
    PLATFORMCLAW_SCOPE: "operator.admin",
    PLATFORMCLAW_DEVICE_IDENTITY_PATH: "/tmp/device.json",
    PLATFORMCLAW_CLIENT_ID: "gateway-client",
    PLATFORMCLAW_CLIENT_VERSION: "0.1.0",
    PLATFORMCLAW_CLIENT_PLATFORM: "node",
    PLATFORMCLAW_CLIENT_MODE: "backend",
    PLATFORMCLAW_CLIENT_DEVICE_FAMILY: "server",
    PLATFORMCLAW_LOCALE: "ko-KR",
    PLATFORMCLAW_USER_AGENT: "platformclaw-knox-adapter",
    PLATFORMCLAW_USE_DEVICE_IDENTITY: false,
    DEFAULT_SESSION_MODE: "isolated_dm",
    ENABLE_STAGE_UPDATES: true,
    MAX_RETRY_ATTEMPTS: 0,
    REQUIRE_EMPLOYEE_ACTIVATION: false,
    PLATFORMCLAW_EMPLOYEE_ACTIVATION_PATH: "/tmp/employee-activation.json",
    ...overrides,
  };
}

describe("PlatformClawGatewayClient compaction events", () => {
  it("emits parsed compaction events to subscribers", () => {
    const client = new PlatformClawGatewayClient(createConfig(), {
      info: mock.fn(),
      warn: mock.fn(),
      error: mock.fn(),
    } as never);
    const events: unknown[] = [];
    const listener = (event: unknown) => {
      events.push(event);
    };
    client.onCompactionEvent(listener);

    (client as any).handleMessage(
      JSON.stringify({
        type: "event",
        event: "agent",
        payload: {
          runId: "run-1",
          stream: "compaction",
          sessionKey: "agent:hyeonho_jung:knox:dm:hyeonho.jung",
          data: {
            phase: "end",
            completed: true,
            willRetry: true,
            tokensBefore: 120_000,
            tokensAfter: 45_000,
            trigger: "manual",
          },
        },
      }),
    );

    assert.equal(events.length, 1);
    assert.deepEqual(events[0], {
      runId: "run-1",
      sessionKey: "agent:hyeonho_jung:knox:dm:hyeonho.jung",
      phase: "end",
      completed: true,
      willRetry: true,
      tokensBefore: 120_000,
      tokensAfter: 45_000,
      trigger: "manual",
    });
  });
});
