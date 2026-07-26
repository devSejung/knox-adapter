import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdapterConfig } from "./config.js";
import { resolveInboundSenderId, resolveRouting, RoutingError } from "./routing.js";
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
    PLATFORMCLAW_HTTP_BASE_URL: undefined,
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
    ENABLE_STAGE_UPDATES: false,
    MAX_RETRY_ATTEMPTS: 0,
    REQUIRE_EMPLOYEE_ACTIVATION: false,
    PLATFORMCLAW_EMPLOYEE_ACTIVATION_PATH: "/tmp/employee-activation.json",
    ...overrides,
  };
}

function createInbound(overrides?: Partial<KnoxInboundPayload>): KnoxInboundPayload {
  return {
    eventId: "evt-1",
    messageId: "msg-1",
    occurredAt: "2026-05-12T00:00:00.000Z",
    sender: {
      knoxUserId: "seungon.jung",
    },
    conversation: {
      type: "dm",
      conversationId: "conv-1",
      threadId: null,
    },
    text: "hello",
    ...overrides,
  };
}

describe("resolveRouting explicit sessionKey policy", () => {
  it("uses explicit agentId and sessionKey when they match", () => {
    const routing = resolveRouting(
      createConfig(),
      createInbound({
        agentId: "knox_group",
        sessionKey: "agent:knox_group:knox:room:room_123",
      }),
    );

    assert.deepEqual(routing, {
      employeeId: "seungon.jung",
      agentId: "knox_group",
      sessionKey: "agent:knox_group:knox:room:room_123",
    });
  });

  it("uses explicit agentId with the existing default session policy when sessionKey is absent", () => {
    const routing = resolveRouting(createConfig(), createInbound({ agentId: "knox_group" }));

    assert.deepEqual(routing, {
      employeeId: "seungon.jung",
      agentId: "knox_group",
      sessionKey: "agent:knox_group:knox:dm:seungon.jung",
    });
  });

  it("falls back to the legacy knoxUserId-derived agent and DM session when neither is provided", () => {
    const routing = resolveRouting(createConfig(), createInbound());

    assert.deepEqual(routing, {
      employeeId: "seungon.jung",
      agentId: "seungon-jung",
      sessionKey: "agent:seungon-jung:knox:dm:seungon.jung",
    });
  });

  it("rejects a sessionKey without an explicit agentId", () => {
    assert.throws(
      () =>
        resolveRouting(
          createConfig(),
          createInbound({ sessionKey: "agent:knox_group:knox:room:room_123" }),
        ),
      (error) =>
        error instanceof RoutingError &&
        error.code === "missing_agent_id" &&
        error.message === "sessionKey requires agentId.",
    );
  });

  it("rejects a sessionKey that belongs to a different agent", () => {
    assert.throws(
      () =>
        resolveRouting(
          createConfig(),
          createInbound({
            agentId: "seungon_jung",
            sessionKey: "agent:knox_group:knox:room:room_123",
          }),
        ),
      (error) =>
        error instanceof RoutingError &&
        error.code === "agent_session_mismatch" &&
        error.message === "sessionKey must start with agent:seungon_jung:.",
    );
  });

  it("rejects an explicit sessionKey with no scope after the agent prefix", () => {
    assert.throws(
      () =>
        resolveRouting(
          createConfig(),
          createInbound({
            agentId: "knox_group",
            sessionKey: "agent:knox_group:",
          }),
        ),
      (error) =>
        error instanceof RoutingError &&
        error.code === "invalid_session_key" &&
        error.message === "sessionKey must include a session scope.",
    );
  });

  it("normalizes sender identity only, without changing agent routing", () => {
    const fromEmployeeId = resolveRouting(
      createConfig(),
      createInbound({ sender: { knoxUserId: "hyeonho_jung", employeeId: "hyeonho_jung" } }),
    );
    const fromEmail = resolveRouting(
      createConfig(),
      createInbound({ sender: { knoxUserId: "hyeonho_jung", employeeEmail: "hyeonho_jung@example.com" } }),
    );
    const fromKnoxId = resolveRouting(
      createConfig(),
      createInbound({ sender: { knoxUserId: "hyeonho_jung" } }),
    );

    for (const [message, routing] of [
      [createInbound({ sender: { knoxUserId: "hyeonho_jung", employeeId: "hyeonho_jung" } }), fromEmployeeId],
      [createInbound({ sender: { knoxUserId: "hyeonho_jung", employeeEmail: "hyeonho_jung@example.com" } }), fromEmail],
      [createInbound({ sender: { knoxUserId: "hyeonho_jung" } }), fromKnoxId],
    ] as const) {
      assert.equal(resolveInboundSenderId(message), "hyeonho.jung");
      assert.equal(routing.employeeId, "hyeonho.jung");
      assert.equal(routing.agentId, "hyeonho_jung");
      assert.equal(routing.sessionKey, "agent:hyeonho_jung:knox:dm:hyeonho_jung");
    }
  });
});
