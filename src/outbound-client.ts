import { randomUUID } from "node:crypto";
import type { AdapterConfig } from "./config.js";
import { Logger } from "./logger.js";
import type { CoreOutboundPayload, MessageRecord, ProxyOutboundPayload } from "./types.js";

export type ProxyOutboundResult =
  | { delivered: true; payload: ProxyOutboundPayload }
  | { delivered: false; reason: "missing_outbound_url"; payload: ProxyOutboundPayload };

export class ProxyOutboundClient {
  constructor(
    private readonly config: AdapterConfig,
    private readonly logger: Logger,
  ) {}

  async sendProgress(params: {
    record: MessageRecord;
    runId: string;
    text: string;
  }): Promise<ProxyOutboundResult> {
    return await this.send({
      record: params.record,
      runId: params.runId,
      text: params.text,
      status: "progress",
      final: false,
    });
  }

  async sendFinal(params: {
    record: MessageRecord;
    runId: string;
    text: string;
    status: "final" | "error" | "timeout";
    errorCode?: string;
    errorMessage?: string;
  }): Promise<ProxyOutboundResult> {
    return await this.send({
      record: params.record,
      runId: params.runId,
      text: params.text,
      status: params.status,
      final: true,
      errorCode: params.errorCode,
      errorMessage: params.errorMessage,
    });
  }

  async sendCoreOutbound(params: CoreOutboundPayload): Promise<ProxyOutboundResult> {
    const target = parseCoreOutboundTarget(params.to);
    const messageId = params.messageId?.trim() || `core-out-${randomUUID()}`;
    const conversationType = params.conversationType ?? target.type;
    const conversationId = params.conversationId?.trim() || target.conversationId;
    const chatroomId = params.chatroomId?.trim() || conversationId;
    const chatMsgId = params.chatMsgId?.trim() || `knox-out-${randomUUID()}`;
    const status = params.status ?? "final";
    const final = params.final ?? status !== "progress";
    return await this.sendPayload({
      messageId,
      conversationType,
      conversationId,
      threadId: normalizeThreadId(params.threadId),
      senderId: params.senderId?.trim() || "platformclaw",
      senderDisplayName: params.senderDisplayName?.trim() || "PlatformClaw",
      agentId: params.agentId?.trim() || "unknown",
      sessionKey: params.sessionKey?.trim() || "",
      runId: params.runId?.trim() || messageId,
      requestId: params.requestId?.trim() || randomUUID(),
      chatroomId,
      chatMsgId,
      msgType: "text",
      status,
      text: params.text,
      final,
      errorCode: params.errorCode,
      errorMessage: params.errorMessage,
    });
  }

  private async send(params: {
    record: MessageRecord;
    runId: string;
    text: string;
    status: "progress" | "final" | "error" | "timeout";
    final: boolean;
    errorCode?: string;
    errorMessage?: string;
  }): Promise<ProxyOutboundResult> {
    const payload: ProxyOutboundPayload = {
      messageId: params.record.messageId,
      conversationId: params.record.conversationId,
      threadId: params.record.threadId,
      senderId: params.record.senderId,
      senderDisplayName: params.record.senderDisplayName,
      agentId: params.record.agentId,
      sessionKey: params.record.sessionKey,
      runId: params.runId,
      requestId: params.record.requestId ?? randomUUID(),
      chatroomId: params.record.chatroomId ?? params.record.conversationId,
      chatMsgId: params.record.chatMsgId ?? `knox-out-${randomUUID()}`,
      msgType: "text",
      status: params.status,
      text: params.text,
      final: params.final,
      errorCode: params.errorCode,
      errorMessage: params.errorMessage,
    };

    return await this.sendPayload(payload);
  }

  private async sendPayload(payload: ProxyOutboundPayload): Promise<ProxyOutboundResult> {
    if (!this.config.PROXY_OUTBOUND_URL) {
      this.logger.warn("proxy outbound url missing; skipping outbound delivery", {
        messageId: payload.messageId,
        runId: payload.runId,
      });
      return {
        delivered: false,
        reason: "missing_outbound_url",
        payload,
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.PROXY_SEND_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (this.config.PROXY_OUTBOUND_AUTH_TOKEN) {
        headers.authorization = `Bearer ${this.config.PROXY_OUTBOUND_AUTH_TOKEN}`;
      }
      const response = await fetch(this.config.PROXY_OUTBOUND_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`proxy outbound failed with status ${response.status}`);
      }
      return {
        delivered: true,
        payload,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizeThreadId(value: CoreOutboundPayload["threadId"]): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

function parseCoreOutboundTarget(raw: string): { conversationId: string; type: "dm" | "room" } {
  const trimmed = raw.trim();
  const dm = trimmed.match(/^(?:dm|direct|user):(.+)$/i);
  if (dm?.[1]?.trim()) {
    return { type: "dm", conversationId: dm[1].trim() };
  }
  const room = trimmed.match(/^(?:room|group|channel):(.+)$/i);
  if (room?.[1]?.trim()) {
    return { type: "room", conversationId: room[1].trim() };
  }
  return { type: "room", conversationId: trimmed };
}
