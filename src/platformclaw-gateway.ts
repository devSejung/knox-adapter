import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import type { AdapterConfig } from "./config.js";
import {
  loadOrCreateDeviceIdentity,
  publicKeyRawBase64UrlFromPem,
  signDevicePayload,
} from "./device-identity.js";
import { buildDeviceAuthPayloadV3 } from "./gateway-device-auth.js";
import { Logger } from "./logger.js";
import type {
  GatewayChatAccepted,
  GatewayCompactionEvent,
  GatewayChatTerminal,
  KnoxInboundPayload,
  PlatformClawRouting,
} from "./types.js";

type PendingRequest = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout | null;
};

type ChatWaiter = {
  runId: string;
  sessionKey: string;
  resolve: (value: GatewayChatTerminal) => void;
  timeout: NodeJS.Timeout;
};

const PROTOCOL_VERSION = 3;

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function normalizeWsOrigin(gatewayUrl: string): string | undefined {
  try {
    const parsed = new URL(gatewayUrl);
    if (parsed.protocol === "ws:" || parsed.protocol === "wss:") {
      const httpProtocol = parsed.protocol === "wss:" ? "https:" : "http:";
      return `${httpProtocol}//${parsed.host}`;
    }
  } catch {}
  return undefined;
}

function extractText(message: unknown): string {
  if (!message) {
    return "";
  }
  if (typeof message === "string") {
    return message;
  }
  if (typeof message !== "object") {
    return "";
  }
  const record = message as Record<string, unknown>;
  if (typeof record.text === "string") {
    return record.text;
  }
  const content = Array.isArray(record.content) ? record.content : [];
  return content
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }
      const block = item as Record<string, unknown>;
      return typeof block.text === "string" ? block.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

export class PlatformClawGatewayClient {
  private ws: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private connected = false;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly chatWaiters = new Map<string, ChatWaiter>();
  private readonly immediateTerminal = new Map<string, GatewayChatTerminal>();
  private readonly compactionListeners = new Set<(event: GatewayCompactionEvent) => void>();

  constructor(
    private readonly config: AdapterConfig,
    private readonly logger: Logger,
  ) {}

  async sendChat(params: {
    routing: PlatformClawRouting;
    inbound: KnoxInboundPayload;
  }): Promise<GatewayChatAccepted> {
    const idempotencyKey = `${params.inbound.messageId}:${params.inbound.eventId}`;
    const transport = this.config.PLATFORMCLAW_TRANSPORT;

    if (transport === "http-responses") {
      return await this.sendChatViaHttpResponses(params);
    }

    if (transport === "auto" && this.shouldPreferHttpResponses()) {
      this.logger.info("using /v1/responses as primary transport", {
        sessionKey: params.routing.sessionKey,
      });
      return await this.sendChatViaHttpResponses(params);
    }

    try {
      await this.ensureConnected();
      const payload = (await this.request("chat.send", {
        sessionKey: params.routing.sessionKey,
        message: params.inbound.text,
        idempotencyKey,
        timeoutMs: this.config.PLATFORMCLAW_RUN_TIMEOUT_MS,
      })) as { runId?: unknown };

      const runId = typeof payload?.runId === "string" ? payload.runId : idempotencyKey;
      return { runId, transport: "websocket" };
    } catch (error) {
      const err = asError(error);
      if (transport === "auto" && this.shouldFallbackToHttpResponses(err)) {
        this.logger.warn("gateway websocket send failed; falling back to /v1/responses", {
          error: err.message,
          sessionKey: params.routing.sessionKey,
        });
        return await this.sendChatViaHttpResponses(params);
      }
      throw err;
    }
  }

  waitForTerminal(runId: string, sessionKey: string): Promise<GatewayChatTerminal> {
    const immediate = this.immediateTerminal.get(runId);
    if (immediate) {
      this.immediateTerminal.delete(runId);
      return Promise.resolve(immediate);
    }
    return new Promise<GatewayChatTerminal>((resolve) => {
      const timeout = setTimeout(() => {
        this.chatWaiters.delete(runId);
        resolve({
          runId,
          sessionKey,
          status: "timeout",
          errorCode: "gateway_timeout",
          errorMessage: "gateway run completion timeout",
        });
      }, this.config.PLATFORMCLAW_RUN_TIMEOUT_MS);
      this.chatWaiters.set(runId, { runId, sessionKey, resolve, timeout });
    });
  }

  onCompactionEvent(listener: (event: GatewayCompactionEvent) => void): () => void {
    this.compactionListeners.add(listener);
    return () => {
      this.compactionListeners.delete(listener);
    };
  }

  async close() {
    this.connected = false;
    this.connectPromise = null;
    this.flushPendingErrors(new Error("gateway client closed"));
    for (const waiter of this.chatWaiters.values()) {
      clearTimeout(waiter.timeout);
      waiter.resolve({
        runId: waiter.runId,
        sessionKey: waiter.sessionKey,
        status: "error",
        errorCode: "gateway_closed",
        errorMessage: "gateway client closed",
      });
    }
    this.chatWaiters.clear();

    if (!this.ws) {
      return;
    }
    const socket = this.ws;
    this.ws = null;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), 500);
      socket.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        socket.close();
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  private async ensureConnected() {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      return;
    }
    if (!this.connectPromise) {
      this.connectPromise = this.connect().finally(() => {
        if (!this.connected) {
          this.connectPromise = null;
        }
      });
    }
    await this.connectPromise;
  }

  private async sendChatViaHttpResponses(params: {
    routing: PlatformClawRouting;
    inbound: KnoxInboundPayload;
  }): Promise<GatewayChatAccepted> {
    const gatewaySecret =
      this.config.PLATFORMCLAW_GATEWAY_TOKEN || this.config.PLATFORMCLAW_GATEWAY_PASSWORD;
    if (!gatewaySecret) {
      throw new Error(
        "http-responses transport requires PLATFORMCLAW_GATEWAY_TOKEN or PLATFORMCLAW_GATEWAY_PASSWORD",
      );
    }

    const runId = randomUUID();
    if (this.config.ENABLE_STAGE_UPDATES) {
      await this.ensureStageChannelConnected();
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.PLATFORMCLAW_RUN_TIMEOUT_MS);
    try {
      const res = await fetch(this.resolveHttpResponsesUrl(), {
        method: "POST",
        headers: {
          authorization: `Bearer ${gatewaySecret}`,
          "content-type": "application/json",
          "x-openclaw-session-key": params.routing.sessionKey,
        },
        body: JSON.stringify({
          stream: false,
          model: `openclaw/${params.routing.agentId}`,
          input: params.inbound.text,
          user:
            params.inbound.sender.employeeEmail ||
            params.inbound.sender.employeeId ||
            params.inbound.sender.knoxUserId,
        }),
        signal: controller.signal,
      });

      const raw = await res.text();
      let parsed: unknown = null;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch {}

      if (!res.ok) {
        throw new Error(this.formatHttpError(res.status, parsed, raw));
      }

      const text = this.extractHttpResponseText(parsed);
      this.immediateTerminal.set(runId, {
        runId,
        sessionKey: params.routing.sessionKey,
        status: "final",
        text,
      });
      return { runId, transport: "http-responses" };
    } catch (error) {
      const err = asError(error);
      if (err.name === "AbortError") {
        this.immediateTerminal.set(runId, {
          runId,
          sessionKey: params.routing.sessionKey,
          status: "timeout",
          errorCode: "gateway_timeout",
          errorMessage: "gateway /v1/responses timeout",
        });
        return { runId, transport: "http-responses" };
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  private resolveHttpResponsesUrl() {
    if (this.config.PLATFORMCLAW_HTTP_BASE_URL) {
      return new URL("/v1/responses", this.config.PLATFORMCLAW_HTTP_BASE_URL).toString();
    }
    const gatewayUrl = new URL(this.config.PLATFORMCLAW_GATEWAY_URL);
    gatewayUrl.protocol = gatewayUrl.protocol === "wss:" ? "https:" : "http:";
    gatewayUrl.pathname = "/v1/responses";
    gatewayUrl.search = "";
    gatewayUrl.hash = "";
    return gatewayUrl.toString();
  }

  private shouldFallbackToHttpResponses(error: Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("missing scope: operator.write") ||
      message.includes("gateway request failed for chat.send")
    );
  }

  private shouldPreferHttpResponses() {
    return Boolean(
      (this.config.PLATFORMCLAW_GATEWAY_PASSWORD || this.config.PLATFORMCLAW_GATEWAY_TOKEN) &&
        !this.config.PLATFORMCLAW_GATEWAY_DEVICE_TOKEN &&
        this.config.PLATFORMCLAW_USE_DEVICE_IDENTITY !== true,
    );
  }

  private async ensureStageChannelConnected() {
    try {
      await this.ensureConnected();
    } catch (error) {
      this.logger.warn("stage updates unavailable: gateway event channel connection failed", {
        error: asError(error).message,
      });
    }
  }

  private formatHttpError(status: number, parsed: unknown, raw: string) {
    const fromJson =
      parsed &&
      typeof parsed === "object" &&
      "error" in (parsed as Record<string, unknown>) &&
      typeof (parsed as { error?: { message?: unknown } }).error?.message === "string"
        ? (parsed as { error: { message: string } }).error.message
        : null;
    return fromJson || raw || `gateway /v1/responses failed with status ${status}`;
  }

  private extractHttpResponseText(parsed: unknown) {
    if (!parsed || typeof parsed !== "object") {
      return "No response from PlatformClaw.";
    }
    const output = Array.isArray((parsed as { output?: unknown }).output)
      ? ((parsed as { output: unknown[] }).output as Array<Record<string, unknown>>)
      : [];
    const texts = output
      .filter((item) => item?.type === "message")
      .flatMap((item) => {
        const content = Array.isArray(item.content) ? item.content : [];
        return content.map((block) =>
          block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string"
            ? ((block as { text: string }).text as string)
            : "",
        );
      })
      .filter(Boolean);
    return texts.join("\n\n") || "No response from PlatformClaw.";
  }

  private async connect() {
    if (this.ws) {
      try {
        this.ws.terminate();
      } catch {}
      this.ws = null;
    }

    const gatewayOrigin = normalizeWsOrigin(this.config.PLATFORMCLAW_GATEWAY_URL);
    const headers = gatewayOrigin ? { origin: gatewayOrigin } : undefined;
    const ws = new WebSocket(this.config.PLATFORMCLAW_GATEWAY_URL, headers ? { headers } : undefined);
    this.ws = ws;

    ws.on("message", (data) => {
      this.handleMessage(String(data));
    });
    ws.on("close", (code, reason) => {
      const reasonText = typeof reason === "string" ? reason : String(reason ?? "");
      this.connected = false;
      this.connectPromise = null;
      this.ws = null;
      this.flushPendingErrors(new Error(`gateway closed (${code}): ${reasonText}`));
      this.logger.warn("gateway websocket closed", { code, reason: reasonText });
    });
    ws.on("error", (error) => {
      this.logger.warn("gateway websocket error", {
        error: asError(error).message,
      });
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("gateway websocket open timeout")), this.config.PLATFORMCLAW_CONNECT_TIMEOUT_MS);
      ws.once("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once("error", (error) => {
        clearTimeout(timer);
        reject(asError(error));
      });
    });

    const nonce = await this.waitForConnectChallenge();
    const connectPayload = await this.buildConnectParams(PROTOCOL_VERSION, nonce);
    const response = await this.request("connect", connectPayload, this.config.PLATFORMCLAW_REQUEST_TIMEOUT_MS);
    const payload = response as { type?: unknown };
    if (payload?.type !== "hello-ok") {
      throw new Error("gateway connect returned unexpected payload");
    }
    this.connected = true;
    this.logger.info("gateway connected", {
      url: this.config.PLATFORMCLAW_GATEWAY_URL,
      clientId: this.config.PLATFORMCLAW_CLIENT_ID,
      mode: this.config.PLATFORMCLAW_CLIENT_MODE,
    });
  }

  private async buildConnectParams(protocolVersion: number, nonce: string) {
    const role = this.config.PLATFORMCLAW_ROLE;
    const scopes = [this.config.PLATFORMCLAW_SCOPE];
    const auth =
      this.config.PLATFORMCLAW_GATEWAY_TOKEN ||
      this.config.PLATFORMCLAW_GATEWAY_DEVICE_TOKEN ||
      this.config.PLATFORMCLAW_GATEWAY_PASSWORD
        ? {
            token: this.config.PLATFORMCLAW_GATEWAY_TOKEN || undefined,
            deviceToken: this.config.PLATFORMCLAW_GATEWAY_DEVICE_TOKEN || undefined,
            password: this.config.PLATFORMCLAW_GATEWAY_PASSWORD || undefined,
          }
        : undefined;

    const device =
      this.config.PLATFORMCLAW_USE_DEVICE_IDENTITY
        ? await this.buildDevicePayload({
            nonce,
            role,
            scopes,
          })
        : undefined;

    return {
      minProtocol: protocolVersion,
      maxProtocol: protocolVersion,
      client: {
        id: this.config.PLATFORMCLAW_CLIENT_ID,
        displayName: "PlatformClaw Knox Adapter",
        version: this.config.PLATFORMCLAW_CLIENT_VERSION,
        platform: this.config.PLATFORMCLAW_CLIENT_PLATFORM,
        deviceFamily: this.config.PLATFORMCLAW_CLIENT_DEVICE_FAMILY,
        mode: this.config.PLATFORMCLAW_CLIENT_MODE,
      },
      auth,
      role,
      scopes,
      device,
      caps: [],
    };
  }

  private async buildDevicePayload(params: {
    nonce: string;
    role: string;
    scopes: string[];
  }) {
    const identity = loadOrCreateDeviceIdentity(this.config.PLATFORMCLAW_DEVICE_IDENTITY_PATH);
    const signedAtMs = Date.now();
    const tokenForSignature =
      this.config.PLATFORMCLAW_GATEWAY_TOKEN ||
      this.config.PLATFORMCLAW_GATEWAY_DEVICE_TOKEN ||
      null;
    const payload = buildDeviceAuthPayloadV3({
      deviceId: identity.deviceId,
      clientId: this.config.PLATFORMCLAW_CLIENT_ID,
      clientMode: this.config.PLATFORMCLAW_CLIENT_MODE,
      role: params.role,
      scopes: params.scopes,
      signedAtMs,
      token: tokenForSignature,
      nonce: params.nonce,
      platform: this.config.PLATFORMCLAW_CLIENT_PLATFORM,
      deviceFamily: this.config.PLATFORMCLAW_CLIENT_DEVICE_FAMILY,
    });
    return {
      id: identity.deviceId,
      publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
      signature: signDevicePayload(identity.privateKeyPem, payload),
      signedAt: signedAtMs,
      nonce: params.nonce,
    };
  }

  private async waitForConnectChallenge() {
    const frame = (await new Promise<unknown>((resolve, reject) => {
      const id = `connect-challenge:${randomUUID()}`;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("gateway connect challenge timeout"));
      }, this.config.PLATFORMCLAW_CONNECT_TIMEOUT_MS);
      this.pending.set(id, {
        method: "connect.challenge",
        resolve,
        reject,
        timeout,
      });
    })) as { payload?: { nonce?: unknown } };

    const nonce = frame?.payload?.nonce;
    if (typeof nonce !== "string" || !nonce.trim()) {
      throw new Error("gateway connect challenge missing nonce");
    }
    return nonce.trim();
  }

  private async request(method: string, params: unknown, timeoutMs?: number) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("gateway not connected");
    }
    const id = randomUUID();
    const promise = new Promise<unknown>((resolve, reject) => {
      const timeout =
        timeoutMs === null
          ? null
          : setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`gateway request timeout for ${method}`));
            }, timeoutMs ?? this.config.PLATFORMCLAW_REQUEST_TIMEOUT_MS);
      this.pending.set(id, { method, resolve, reject, timeout });
    });
    ws.send(
      JSON.stringify({
        type: "req",
        id,
        method,
        params,
      }),
    );
    return await promise;
  }

  private handleMessage(raw: string) {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    if (frame.type === "event" && frame.event === "connect.challenge") {
      for (const [id, pending] of this.pending.entries()) {
        if (pending.method !== "connect.challenge") {
          continue;
        }
        this.pending.delete(id);
        if (pending.timeout) {
          clearTimeout(pending.timeout);
        }
        pending.resolve(frame);
        return;
      }
      return;
    }

    if (frame.type === "event" && frame.event === "chat") {
      this.handleChatEvent(frame.payload);
      return;
    }

    if (frame.type === "event" && frame.event === "agent") {
      this.handleAgentEvent(frame.payload);
      return;
    }

    if (frame.type !== "res") {
      return;
    }
    const id = typeof frame.id === "string" ? frame.id : null;
    if (!id) {
      return;
    }
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }
    this.pending.delete(id);
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }
    if (frame.ok === true) {
      pending.resolve(frame.payload);
      return;
    }
    const errorShape = frame.error as { message?: unknown; code?: unknown } | undefined;
    pending.reject(
      new Error(
        typeof errorShape?.message === "string"
          ? errorShape.message
          : `gateway request failed for ${pending.method}`,
      ),
    );
  }

  private handleChatEvent(payload: unknown) {
    if (!payload || typeof payload !== "object") {
      return;
    }
    const eventPayload = payload as Record<string, unknown>;
    const runId = typeof eventPayload.runId === "string" ? eventPayload.runId : null;
    if (!runId) {
      return;
    }
    const waiter = this.chatWaiters.get(runId);
    if (!waiter) {
      return;
    }
    const state = typeof eventPayload.state === "string" ? eventPayload.state : null;
    if (state === "final") {
      clearTimeout(waiter.timeout);
      this.chatWaiters.delete(runId);
      waiter.resolve({
        runId,
        sessionKey: waiter.sessionKey,
        status: "final",
        text: extractText(eventPayload.message),
      });
      return;
    }
    if (state === "error" || state === "aborted") {
      clearTimeout(waiter.timeout);
      this.chatWaiters.delete(runId);
      waiter.resolve({
        runId,
        sessionKey: waiter.sessionKey,
        status: state,
        errorCode: state === "error" ? "gateway_error" : "gateway_aborted",
        errorMessage:
          typeof eventPayload.errorMessage === "string"
            ? eventPayload.errorMessage
            : state === "error"
              ? "gateway chat failed"
              : "gateway chat aborted",
      });
    }
  }

  private handleAgentEvent(payload: unknown) {
    if (!payload || typeof payload !== "object") {
      return;
    }
    const eventPayload = payload as Record<string, unknown>;
    if (eventPayload.stream !== "compaction") {
      return;
    }
    const sessionKey =
      typeof eventPayload.sessionKey === "string" && eventPayload.sessionKey.trim()
        ? eventPayload.sessionKey.trim()
        : null;
    if (!sessionKey) {
      return;
    }
    const data = eventPayload.data;
    if (!data || typeof data !== "object") {
      return;
    }
    const dataRecord = data as Record<string, unknown>;
    const phase = dataRecord.phase === "start" || dataRecord.phase === "end" ? dataRecord.phase : null;
    if (!phase) {
      return;
    }
    const runId =
      typeof eventPayload.runId === "string" && eventPayload.runId.trim()
        ? eventPayload.runId.trim()
        : null;
    const tokensBefore =
      typeof dataRecord.tokensBefore === "number" && Number.isFinite(dataRecord.tokensBefore)
        ? dataRecord.tokensBefore
        : undefined;
    const tokensAfter =
      typeof dataRecord.tokensAfter === "number" && Number.isFinite(dataRecord.tokensAfter)
        ? dataRecord.tokensAfter
        : undefined;
    const event: GatewayCompactionEvent = {
      runId,
      sessionKey,
      phase,
      completed: dataRecord.completed === true,
      willRetry: dataRecord.willRetry === true,
      ...(tokensBefore !== undefined ? { tokensBefore } : {}),
      ...(tokensAfter !== undefined ? { tokensAfter } : {}),
      ...(typeof dataRecord.trigger === "string" && dataRecord.trigger.trim()
        ? { trigger: dataRecord.trigger.trim() }
        : {}),
    };
    for (const listener of this.compactionListeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.warn("gateway compaction listener failed", {
          error: asError(error).message,
          sessionKey: event.sessionKey,
          runId: event.runId,
        });
      }
    }
  }

  private flushPendingErrors(error: Error) {
    for (const pending of this.pending.values()) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      pending.reject(error);
    }
    this.pending.clear();
  }
}
