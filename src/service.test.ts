import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { KnoxAdapterService } from "./service.js";
import type {
  AdapterConfig,
} from "./config.js";
import type {
  GatewayChatAccepted,
  GatewayChatTerminal,
  GatewayCompactionEvent,
  KnoxInboundPayload,
  MessageRecord,
} from "./types.js";

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
    ENABLE_STAGE_UPDATES: true,
    MAX_RETRY_ATTEMPTS: 0,
    REQUIRE_EMPLOYEE_ACTIVATION: false,
    PLATFORMCLAW_EMPLOYEE_ACTIVATION_PATH: "/tmp/employee-activation.json",
    ...overrides,
  };
}

function createInbound(): KnoxInboundPayload {
  return {
    eventId: "evt-1",
    messageId: "msg-1",
    occurredAt: new Date().toISOString(),
    sender: {
      knoxUserId: "knox-user-1",
      employeeId: "hyeonho.jung",
      employeeEmail: "hyeonho.jung@example.com",
      displayName: "Jung Hyeonho",
      department: "Samsung",
    },
    conversation: {
      type: "dm",
      conversationId: "conv-1",
      threadId: null,
    },
    text: "hello",
  };
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

class FakeStore {
  records = new Map<string, MessageRecord>();

  health() {
    return true;
  }

  getByMessageId(messageId: string) {
    return this.records.get(messageId) ?? null;
  }

  insertReceived(params: {
    messageId: string;
    eventId: string;
    employeeId: string;
    agentId: string;
    sessionKey: string;
    conversationId: string;
    threadId: string | null;
    conversationType: string;
  }) {
    const now = new Date().toISOString();
    const record: MessageRecord = {
      messageId: params.messageId,
      eventId: params.eventId,
      employeeId: params.employeeId,
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      conversationId: params.conversationId,
      threadId: params.threadId,
      conversationType: params.conversationType,
      requestId: null,
      chatroomId: null,
      chatMsgId: null,
      runId: null,
      status: "received",
      errorCode: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(params.messageId, record);
    return record;
  }

  updateProgress(messageId: string, fields: Partial<MessageRecord>) {
    const record = this.records.get(messageId);
    if (!record) {
      return;
    }
    this.records.set(messageId, {
      ...record,
      ...fields,
      updatedAt: new Date().toISOString(),
    });
  }
}

class FakeGateway {
  private readonly listeners = new Set<(event: GatewayCompactionEvent) => void>();

  constructor(
    private readonly accepted: GatewayChatAccepted,
    private readonly terminal: GatewayChatTerminal,
    private readonly compactionEvents: GatewayCompactionEvent[],
  ) {}

  onCompactionEvent(listener: (event: GatewayCompactionEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async sendChat() {
    return this.accepted;
  }

  async waitForTerminal() {
    for (const event of this.compactionEvents) {
      for (const listener of this.listeners) {
        listener(event);
      }
    }
    return this.terminal;
  }
}

class FakeOutbound {
  progressCalls: Array<{ runId: string; text: string }> = [];
  finalCalls: Array<{ runId: string; text: string; status: string }> = [];

  async sendProgress(params: { runId: string; text: string }) {
    this.progressCalls.push({ runId: params.runId, text: params.text });
    return {
      delivered: true as const,
      payload: {} as never,
    };
  }

  async sendFinal(params: { runId: string; text: string; status: string }) {
    this.finalCalls.push({
      runId: params.runId,
      text: params.text,
      status: params.status,
    });
    return {
      delivered: true as const,
      payload: { chatMsgId: "chat-msg-1", requestId: "req-1" } as never,
    };
  }
}

describe("KnoxAdapterService compaction stage updates", () => {
  it("sends compaction progress and completion messages before the final outbound", async () => {
    const config = createConfig({ ENABLE_STAGE_UPDATES: true });
    const logger = {
      info: mock.fn(),
      warn: mock.fn(),
      error: mock.fn(),
    };
    const store = new FakeStore();
    const outbound = new FakeOutbound();
    const gateway = new FakeGateway(
      { runId: "run-1", transport: "websocket" },
      { runId: "run-1", sessionKey: "agent:hyeonho_jung:knox:dm:hyeonho.jung", status: "final", text: "done" },
      [
        {
          runId: "run-1",
          sessionKey: "agent:hyeonho_jung:knox:dm:hyeonho.jung",
          phase: "start",
          completed: false,
          willRetry: false,
        },
        {
          runId: "run-1",
          sessionKey: "agent:hyeonho_jung:knox:dm:hyeonho.jung",
          phase: "end",
          completed: true,
          willRetry: true,
          tokensBefore: 120_000,
          tokensAfter: 45_000,
        },
      ],
    );
    const service = new KnoxAdapterService(
      config,
      logger as never,
      store as never,
      gateway as never,
      outbound as never,
    );
    const inbound = createInbound();
    store.insertReceived({
      messageId: inbound.messageId,
      eventId: inbound.eventId,
      employeeId: "hyeonho.jung",
      agentId: "hyeonho_jung",
      sessionKey: "agent:hyeonho_jung:knox:dm:hyeonho.jung",
      conversationId: inbound.conversation.conversationId,
      threadId: inbound.conversation.threadId ?? null,
      conversationType: inbound.conversation.type,
    });

    await (service as any).process(inbound);

    assert.equal(outbound.progressCalls.length, 2);
    assert.match(outbound.progressCalls[0]?.text ?? "", /Context 압축 중입니다/);
    assert.match(outbound.progressCalls[1]?.text ?? "", /약 63% 줄였습니다/);
    assert.match(outbound.progressCalls[1]?.text ?? "", /120,000 -> 45,000 tokens/);
    assert.equal(outbound.finalCalls.length, 1);
    assert.deepEqual(outbound.finalCalls[0], {
      runId: "run-1",
      text: "done",
      status: "final",
    });
  });

  it("does not send compaction progress when stage updates are disabled", async () => {
    const config = createConfig({ ENABLE_STAGE_UPDATES: false });
    const logger = {
      info: mock.fn(),
      warn: mock.fn(),
      error: mock.fn(),
    };
    const store = new FakeStore();
    const outbound = new FakeOutbound();
    const gateway = new FakeGateway(
      { runId: "http-run-1", transport: "http-responses" },
      {
        runId: "http-run-1",
        sessionKey: "agent:hyeonho_jung:knox:dm:hyeonho.jung",
        status: "final",
        text: "done",
      },
      [
        {
          runId: "engine-run-1",
          sessionKey: "agent:hyeonho_jung:knox:dm:hyeonho.jung",
          phase: "start",
          completed: false,
          willRetry: false,
        },
      ],
    );
    const service = new KnoxAdapterService(
      config,
      logger as never,
      store as never,
      gateway as never,
      outbound as never,
    );
    const inbound = createInbound();
    store.insertReceived({
      messageId: inbound.messageId,
      eventId: inbound.eventId,
      employeeId: "hyeonho.jung",
      agentId: "hyeonho_jung",
      sessionKey: "agent:hyeonho_jung:knox:dm:hyeonho.jung",
      conversationId: inbound.conversation.conversationId,
      threadId: inbound.conversation.threadId ?? null,
      conversationType: inbound.conversation.type,
    });

    await (service as any).process(inbound);

    assert.equal(outbound.progressCalls.length, 0);
    assert.equal(outbound.finalCalls.length, 1);
  });

  it("serializes same-session inbound messages in FIFO order", async () => {
    const config = createConfig({ ENABLE_STAGE_UPDATES: false });
    const logger = {
      info: mock.fn(),
      warn: mock.fn(),
      error: mock.fn(),
    };
    const store = new FakeStore();
    const outbound = new FakeOutbound();
    const firstRelease = createDeferred();
    const sendOrder: string[] = [];
    const gateway = {
      onCompactionEvent() {
        return () => {};
      },
      async sendChat(params: { inbound: KnoxInboundPayload }) {
        sendOrder.push(params.inbound.messageId);
        return {
          runId: `run-${params.inbound.messageId}`,
          transport: "http-responses" as const,
        };
      },
      async waitForTerminal(runId: string) {
        if (runId === "run-msg-1") {
          await firstRelease.promise;
        }
        return {
          runId,
          sessionKey: "agent:hyeonho_jung:knox:dm:hyeonho.jung",
          status: "final" as const,
          text: runId,
        };
      },
    };
    const service = new KnoxAdapterService(
      config,
      logger as never,
      store as never,
      gateway as never,
      outbound as never,
    );
    const inbound1 = createInbound();
    const inbound2 = {
      ...createInbound(),
      messageId: "msg-2",
      eventId: "evt-2",
      text: "second",
    };

    await service.acceptInbound(inbound1);
    await service.acceptInbound(inbound2);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(sendOrder, ["msg-1"]);
    assert.equal(store.getByMessageId("msg-2")?.status, "queued");
    assert.match(
      outbound.progressCalls[0]?.text ?? "",
      /앞선 요청 1건 처리 후 이어서 진행합니다/,
    );

    firstRelease.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(sendOrder, ["msg-1", "msg-2"]);
    assert.equal(outbound.finalCalls.length, 2);
    assert.deepEqual(
      outbound.finalCalls.map((entry) => entry.runId),
      ["run-msg-1", "run-msg-2"],
    );
  });

  it("reports accumulated queue depth for later same-session requests", async () => {
    const config = createConfig({ ENABLE_STAGE_UPDATES: false });
    const logger = {
      info: mock.fn(),
      warn: mock.fn(),
      error: mock.fn(),
    };
    const store = new FakeStore();
    const outbound = new FakeOutbound();
    const release = createDeferred();
    const gateway = {
      onCompactionEvent() {
        return () => {};
      },
      async sendChat(params: { inbound: KnoxInboundPayload }) {
        return {
          runId: `run-${params.inbound.messageId}`,
          transport: "http-responses" as const,
        };
      },
      async waitForTerminal() {
        await release.promise;
        return {
          runId: "run-msg-1",
          sessionKey: "agent:hyeonho_jung:knox:dm:hyeonho.jung",
          status: "final" as const,
          text: "done",
        };
      },
    };
    const service = new KnoxAdapterService(
      config,
      logger as never,
      store as never,
      gateway as never,
      outbound as never,
    );
    const inbound1 = createInbound();
    const inbound2 = {
      ...createInbound(),
      messageId: "msg-2",
      eventId: "evt-2",
    };
    const inbound3 = {
      ...createInbound(),
      messageId: "msg-3",
      eventId: "evt-3",
    };

    await service.acceptInbound(inbound1);
    await service.acceptInbound(inbound2);
    await service.acceptInbound(inbound3);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.match(outbound.progressCalls[0]?.text ?? "", /앞선 요청 1건 처리 후 이어서 진행합니다/);
    assert.match(outbound.progressCalls[1]?.text ?? "", /앞선 요청 2건 처리 후 이어서 진행합니다/);

    release.resolve();
  });

  it("keeps different sessions parallel while same-session queueing is enabled", async () => {
    const config = createConfig({ ENABLE_STAGE_UPDATES: false });
    const logger = {
      info: mock.fn(),
      warn: mock.fn(),
      error: mock.fn(),
    };
    const store = new FakeStore();
    const outbound = new FakeOutbound();
    const release = createDeferred();
    const started: string[] = [];
    const gateway = {
      onCompactionEvent() {
        return () => {};
      },
      async sendChat(params: { inbound: KnoxInboundPayload }) {
        started.push(params.inbound.messageId);
        return {
          runId: `run-${params.inbound.messageId}`,
          transport: "http-responses" as const,
        };
      },
      async waitForTerminal(runId: string) {
        await release.promise;
        return {
          runId,
          sessionKey: runId === "run-msg-1"
            ? "agent:hyeonho_jung:knox:dm:hyeonho.jung"
            : "agent:minji_kim:knox:dm:minji.kim",
          status: "final" as const,
          text: runId,
        };
      },
    };
    const service = new KnoxAdapterService(
      config,
      logger as never,
      store as never,
      gateway as never,
      outbound as never,
    );
    const inbound1 = createInbound();
    const inbound2 = {
      ...createInbound(),
      messageId: "msg-2",
      eventId: "evt-2",
      sender: {
        ...createInbound().sender,
        knoxUserId: "knox-user-2",
        employeeId: "minji.kim",
        employeeEmail: "minji.kim@example.com",
        displayName: "Minji Kim",
      },
      conversation: {
        type: "dm" as const,
        conversationId: "conv-2",
        threadId: null,
      },
    };

    await service.acceptInbound(inbound1);
    await service.acceptInbound(inbound2);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(started.sort(), ["msg-1", "msg-2"]);

    release.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(outbound.finalCalls.length, 2);
  });
});
