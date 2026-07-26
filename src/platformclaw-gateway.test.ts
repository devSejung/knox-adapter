import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { AdapterConfig } from "./config.js";
import { PlatformClawGatewayClient } from "./platformclaw-gateway.js";
import type { KnoxInboundPayload } from "./types.js";

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

describe("PlatformClawGatewayClient Knox origin routing", () => {
  it("uses the Knox conversation id as the DM delivery target so chatroomId can be restored", async () => {
    let capturedOriginatingChannel = "";
    let capturedOriginatingTo = "";
    let capturedSenderId = "";
    const fetchMock = mock.method(
      globalThis,
      "fetch",
      async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const headers = new Headers(init?.headers);
        capturedOriginatingChannel = headers.get("x-openclaw-originating-channel") ?? "";
        capturedOriginatingTo = headers.get("x-openclaw-originating-to") ?? "";
        capturedSenderId = headers.get("x-openclaw-sender-id") ?? "";
        return new Response(
          JSON.stringify({
            output: [{ type: "message", content: [{ text: "ok" }] }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );
    try {
      const client = new PlatformClawGatewayClient(
        createConfig({
          ENABLE_STAGE_UPDATES: false,
          PLATFORMCLAW_TRANSPORT: "http-responses",
        }),
        {
          info: mock.fn(),
          warn: mock.fn(),
          error: mock.fn(),
        } as never,
      );
      const inbound: KnoxInboundPayload = {
        eventId: "evt-1",
        messageId: "knox-msg-1",
        occurredAt: "2026-05-16T00:00:00.000Z",
        sender: {
          knoxUserId: "seungon.jung",
          employeeId: "seungon.jung",
          employeeEmail: "seungon.jung@example.com",
          displayName: "Seungon Jung",
        },
        conversation: {
          type: "dm",
          conversationId: "dm-chatroom-123",
          threadId: null,
        },
        text: "hello",
      };

      await client.sendChat({
        routing: {
          employeeId: "seungon.jung",
          agentId: "seungon-jung",
          sessionKey: "agent:seungon-jung:knox:dm:seungon.jung",
        },
        inbound,
      });

      assert.equal(capturedOriginatingChannel, "knox");
      assert.equal(capturedOriginatingTo, "dm:dm-chatroom-123");
      assert.equal(capturedSenderId, "seungon.jung");
    } finally {
      fetchMock.mock.restore();
    }
  });

  it("forces websocket chat.send for strict skillhub commands even when http-responses is configured", async () => {
    const client = new PlatformClawGatewayClient(
      createConfig({
        ENABLE_STAGE_UPDATES: false,
        PLATFORMCLAW_TRANSPORT: "http-responses",
      }),
      {
        info: mock.fn(),
        warn: mock.fn(),
        error: mock.fn(),
      } as never,
    ) as any;

    let requestedMethod = "";
    let requestedPayload: Record<string, unknown> | null = null;
    client.ensureConnected = async () => {};
    client.request = async (method: string, payload: Record<string, unknown>) => {
      requestedMethod = method;
      requestedPayload = payload;
      return { runId: "run-1" };
    };

    const inbound: KnoxInboundPayload = {
      eventId: "evt-2",
      messageId: "knox-msg-2",
      occurredAt: "2026-06-01T00:00:00.000Z",
      sender: {
        knoxUserId: "hyeonho_jung",
        displayName: "Eon",
      },
      conversation: {
        type: "room",
        conversationId: "room_platform",
        threadId: null,
      },
      text: "[그룹방에서 온 메세지입니다]\n사용자정보: eon / Samsung\n/skillhub install jedec-lpddr-dram-reference",
    };

    const accepted = await client.sendChat({
      routing: {
        employeeId: "eon",
        agentId: "knox_group",
        sessionKey: "agent:knox_group:knox:room:room_platform",
      },
      inbound,
    });

    assert.equal(accepted.transport, "websocket");
    assert.equal(requestedMethod, "chat.send");
    const payload = requestedPayload as {
      message?: string;
      commandBody?: string;
      senderId?: string;
    } | null;
    assert.equal(payload?.message, "/skillhub install jedec-lpddr-dram-reference");
    assert.equal(payload?.commandBody, "/skillhub install jedec-lpddr-dram-reference");
    assert.equal(payload?.senderId, "hyeonho.jung");
  });

  it("forces websocket chat.send for strict skillhub list commands extracted from wrapped room text", async () => {
    const client = new PlatformClawGatewayClient(
      createConfig({
        ENABLE_STAGE_UPDATES: false,
        PLATFORMCLAW_TRANSPORT: "http-responses",
      }),
      {
        info: mock.fn(),
        warn: mock.fn(),
        error: mock.fn(),
      } as never,
    ) as any;

    let requestedMethod = "";
    let requestedPayload: Record<string, unknown> | null = null;
    client.ensureConnected = async () => {};
    client.request = async (method: string, payload: Record<string, unknown>) => {
      requestedMethod = method;
      requestedPayload = payload;
      return { runId: "run-2" };
    };

    const inbound: KnoxInboundPayload = {
      eventId: "evt-3",
      messageId: "knox-msg-3",
      occurredAt: "2026-06-01T00:00:00.000Z",
      sender: {
        knoxUserId: "eon",
        employeeId: "eon",
        employeeEmail: "eon@samsung.com",
        displayName: "Eon",
      },
      conversation: {
        type: "room",
        conversationId: "room_platform",
        threadId: null,
      },
      text: "[그룹방에서 온 메세지입니다]\n사용자정보: eon / Samsung\n/skillhub list knowledge",
    };

    const accepted = await client.sendChat({
      routing: {
        employeeId: "eon",
        agentId: "knox_group",
        sessionKey: "agent:knox_group:knox:room:room_platform",
      },
      inbound,
    });

    assert.equal(accepted.transport, "websocket");
    assert.equal(requestedMethod, "chat.send");
    const payload = requestedPayload as { message?: string; commandBody?: string } | null;
    assert.equal(payload?.message, "/skillhub list knowledge");
    assert.equal(payload?.commandBody, "/skillhub list knowledge");
  });

  it("accepts explicit /skillhub list all from wrapped room text", async () => {
    const client = new PlatformClawGatewayClient(
      createConfig({
        ENABLE_STAGE_UPDATES: false,
        PLATFORMCLAW_TRANSPORT: "http-responses",
      }),
      {
        info: mock.fn(),
        warn: mock.fn(),
        error: mock.fn(),
      } as never,
    ) as any;

    let requestedMethod = "";
    let requestedPayload: Record<string, unknown> | null = null;
    client.ensureConnected = async () => {};
    client.request = async (method: string, payload: Record<string, unknown>) => {
      requestedMethod = method;
      requestedPayload = payload;
      return { runId: "run-3" };
    };

    const inbound: KnoxInboundPayload = {
      eventId: "evt-4",
      messageId: "knox-msg-4",
      occurredAt: "2026-06-01T00:00:00.000Z",
      sender: {
        knoxUserId: "eon",
        employeeId: "eon",
        employeeEmail: "eon@samsung.com",
        displayName: "Eon",
      },
      conversation: {
        type: "room",
        conversationId: "room_platform",
        threadId: null,
      },
      text: "[그룹방에서 온 메세지입니다]\n사용자정보: eon / Samsung\n/skillhub list all",
    };

    const accepted = await client.sendChat({
      routing: {
        employeeId: "eon",
        agentId: "knox_group",
        sessionKey: "agent:knox_group:knox:room:room_platform",
      },
      inbound,
    });

    assert.equal(accepted.transport, "websocket");
    assert.equal(requestedMethod, "chat.send");
    const payload = requestedPayload as { message?: string; commandBody?: string } | null;
    assert.equal(payload?.message, "/skillhub list all");
    assert.equal(payload?.commandBody, "/skillhub list all");
  });

  it("accepts /skillhub help ko from wrapped room text", async () => {
    const client = new PlatformClawGatewayClient(
      createConfig({
        ENABLE_STAGE_UPDATES: false,
        PLATFORMCLAW_TRANSPORT: "http-responses",
      }),
      {
        info: mock.fn(),
        warn: mock.fn(),
        error: mock.fn(),
      } as never,
    ) as any;

    let requestedMethod = "";
    let requestedPayload: Record<string, unknown> | null = null;
    client.ensureConnected = async () => {};
    client.request = async (method: string, payload: Record<string, unknown>) => {
      requestedMethod = method;
      requestedPayload = payload;
      return { runId: "run-4" };
    };

    const inbound: KnoxInboundPayload = {
      eventId: "evt-5",
      messageId: "knox-msg-5",
      occurredAt: "2026-06-01T00:00:00.000Z",
      sender: {
        knoxUserId: "eon",
        employeeId: "eon",
        employeeEmail: "eon@samsung.com",
        displayName: "Eon",
      },
      conversation: {
        type: "room",
        conversationId: "room_platform",
        threadId: null,
      },
      text: "[그룹방에서 온 메세지입니다]\n사용자정보: eon / Samsung\n/skillhub help ko",
    };

    const accepted = await client.sendChat({
      routing: {
        employeeId: "eon",
        agentId: "knox_group",
        sessionKey: "agent:knox_group:knox:room:room_platform",
      },
      inbound,
    });

    assert.equal(accepted.transport, "websocket");
    assert.equal(requestedMethod, "chat.send");
    const payload = requestedPayload as { message?: string; commandBody?: string } | null;
    assert.equal(payload?.message, "/skillhub help ko");
    assert.equal(payload?.commandBody, "/skillhub help ko");
  });

  it("accepts /skillhub installed from wrapped room text", async () => {
    const client = new PlatformClawGatewayClient(
      createConfig({
        ENABLE_STAGE_UPDATES: false,
        PLATFORMCLAW_TRANSPORT: "http-responses",
      }),
      {
        info: mock.fn(),
        warn: mock.fn(),
        error: mock.fn(),
      } as never,
    ) as any;

    let requestedMethod = "";
    let requestedPayload: Record<string, unknown> | null = null;
    client.ensureConnected = async () => {};
    client.request = async (method: string, payload: Record<string, unknown>) => {
      requestedMethod = method;
      requestedPayload = payload;
      return { runId: "run-5" };
    };

    const inbound: KnoxInboundPayload = {
      eventId: "evt-6",
      messageId: "knox-msg-6",
      occurredAt: "2026-06-01T00:00:00.000Z",
      sender: {
        knoxUserId: "eon",
        employeeId: "eon",
        employeeEmail: "eon@samsung.com",
        displayName: "Eon",
      },
      conversation: {
        type: "room",
        conversationId: "room_platform",
        threadId: null,
      },
      text: "[그룹방에서 온 메세지입니다]\n사용자정보: eon / Samsung\n/skillhub installed",
    };

    const accepted = await client.sendChat({
      routing: {
        employeeId: "eon",
        agentId: "knox_group",
        sessionKey: "agent:knox_group:knox:room:room_platform",
      },
      inbound,
    });

    assert.equal(accepted.transport, "websocket");
    assert.equal(requestedMethod, "chat.send");
    const payload = requestedPayload as { message?: string; commandBody?: string } | null;
    assert.equal(payload?.message, "/skillhub installed");
    assert.equal(payload?.commandBody, "/skillhub installed");
  });
});
