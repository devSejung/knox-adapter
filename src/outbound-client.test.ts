import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdapterConfig } from "./config.js";
import { Logger } from "./logger.js";
import { ProxyOutboundClient } from "./outbound-client.js";

function createConfig(overrides?: Partial<AdapterConfig>): AdapterConfig {
  return {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: 3010,
    LOG_LEVEL: "error",
    DATABASE_PATH: ":memory:",
    PROXY_SHARED_SECRET: "test-secret",
    REQUIRE_PROXY_HMAC: false,
    PROXY_OUTBOUND_URL: undefined,
    PROXY_OUTBOUND_AUTH_TOKEN: undefined,
    PROXY_SEND_TIMEOUT_MS: 10_000,
    CORE_OUTBOUND_AUTH_TOKEN: undefined,
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

describe("ProxyOutboundClient core outbound mapping", () => {
  it("derives Knox proxy routing fields from to for backwards compatibility", async () => {
    const config = createConfig();
    const client = new ProxyOutboundClient(config, new Logger(config));

    const result = await client.sendCoreOutbound({
      to: "room:room-123",
      text: "done",
      agentId: "knox_group",
      sessionKey: "agent:knox_group:knox:room:room-123",
    });

    assert.equal(result.delivered, false);
    assert.equal(result.payload.conversationType, "room");
    assert.equal(result.payload.conversationId, "room-123");
    assert.equal(result.payload.chatroomId, "room-123");
    assert.match(result.payload.chatMsgId, /^knox-out-/);
  });

  it("prefers explicit Knox ids when core has proxy-specific delivery context", async () => {
    const config = createConfig();
    const client = new ProxyOutboundClient(config, new Logger(config));

    const result = await client.sendCoreOutbound({
      to: "dm:seungon.jung",
      conversationType: "dm",
      conversationId: "dm-conversation-1",
      chatroomId: "knox-dm-room-1",
      chatMsgId: "knox-origin-msg-1",
      messageId: "core-msg-1",
      threadId: 7,
      text: "done",
      agentId: "seungon_jung",
      sessionKey: "agent:seungon_jung:knox:dm:seungon.jung",
    });

    assert.equal(result.delivered, false);
    assert.equal(result.payload.messageId, "core-msg-1");
    assert.equal(result.payload.conversationType, "dm");
    assert.equal(result.payload.conversationId, "dm-conversation-1");
    assert.equal(result.payload.chatroomId, "knox-dm-room-1");
    assert.equal(result.payload.chatMsgId, "knox-origin-msg-1");
    assert.equal(result.payload.threadId, "7");
  });
});
