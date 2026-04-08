import { randomUUID } from "node:crypto";
import type { AdapterConfig } from "./config.js";
import { Logger } from "./logger.js";
import type { MessageRecord, ProxyOutboundPayload } from "./types.js";

export type ProxyOutboundResult =
  | { delivered: true; payload: ProxyOutboundPayload }
  | { delivered: false; reason: "missing_outbound_url"; payload: ProxyOutboundPayload };

export class ProxyOutboundClient {
  constructor(
    private readonly config: AdapterConfig,
    private readonly logger: Logger,
  ) {}

  async sendFinal(params: {
    record: MessageRecord;
    runId: string;
    text: string;
    status: "final" | "error" | "timeout";
    errorCode?: string;
    errorMessage?: string;
  }): Promise<ProxyOutboundResult> {
    const payload: ProxyOutboundPayload = {
      messageId: params.record.messageId,
      conversationId: params.record.conversationId,
      threadId: params.record.threadId,
      agentId: params.record.agentId,
      sessionKey: params.record.sessionKey,
      runId: params.runId,
      requestId: params.record.requestId ?? randomUUID(),
      chatroomId: params.record.chatroomId ?? params.record.conversationId,
      chatMsgId: params.record.chatMsgId ?? `knox-out-${randomUUID()}`,
      msgType: "text",
      status: params.status,
      text: params.text,
      final: true,
      errorCode: params.errorCode,
      errorMessage: params.errorMessage,
    };

    if (!this.config.PROXY_OUTBOUND_URL) {
      this.logger.warn("proxy outbound url missing; skipping outbound delivery", {
        messageId: params.record.messageId,
        runId: params.runId,
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
