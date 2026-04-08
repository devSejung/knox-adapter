import { randomUUID } from "node:crypto";
import type { AdapterConfig } from "./config.js";
import { Logger } from "./logger.js";
import { ProxyOutboundClient } from "./outbound-client.js";
import { PlatformClawGatewayClient } from "./platformclaw-gateway.js";
import { resolveRouting } from "./routing.js";
import { AdapterStore } from "./store.js";
import type { KnoxInboundPayload, MessageRecord } from "./types.js";

export class KnoxAdapterService {
  constructor(
    private readonly config: AdapterConfig,
    private readonly logger: Logger,
    private readonly store: AdapterStore,
    private readonly gateway: PlatformClawGatewayClient,
    private readonly outbound: ProxyOutboundClient,
  ) {}

  health() {
    return {
      ok: this.store.health(),
      gatewayUrl: this.config.PLATFORMCLAW_GATEWAY_URL,
      outboundUrl: this.config.PROXY_OUTBOUND_URL ?? null,
      dbPath: this.config.DATABASE_PATH,
    };
  }

  readiness() {
    return {
      ok:
        this.store.health() &&
        Boolean(this.config.PLATFORMCLAW_GATEWAY_URL) &&
        Boolean(this.config.PROXY_OUTBOUND_URL) &&
        (!this.config.REQUIRE_PROXY_HMAC || Boolean(this.config.PROXY_SHARED_SECRET)),
      hasProxyOutboundUrl: Boolean(this.config.PROXY_OUTBOUND_URL),
      hasProxySharedSecret: !this.config.REQUIRE_PROXY_HMAC || Boolean(this.config.PROXY_SHARED_SECRET),
    };
  }

  async acceptInbound(message: KnoxInboundPayload): Promise<{
    duplicate: boolean;
    record: MessageRecord;
  }> {
    const existing = this.store.getByMessageId(message.messageId);
    if (existing) {
      this.logger.info("duplicate inbound message ignored", {
        messageId: message.messageId,
        status: existing.status,
      });
      return { duplicate: true, record: existing };
    }

    const routing = resolveRouting(this.config, message);
    this.store.insertReceived({
      messageId: message.messageId,
      eventId: message.eventId,
      employeeId: routing.employeeId,
      agentId: routing.agentId,
      sessionKey: routing.sessionKey,
      conversationId: message.conversation.conversationId,
      threadId: message.conversation.threadId ?? null,
      conversationType: message.conversation.type,
    });

    this.store.updateProgress(message.messageId, {
      status: "routing_resolved",
      requestId: randomUUID(),
      chatroomId: message.conversation.conversationId,
    });

    void this.process(message).catch((error) => {
      this.logger.error("inbound processing failed", {
        messageId: message.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return { duplicate: false, record: this.store.getByMessageId(message.messageId)! };
  }

  private async process(message: KnoxInboundPayload) {
    const record = this.store.getByMessageId(message.messageId);
    if (!record) {
      throw new Error(`missing stored record for ${message.messageId}`);
    }

    const routing = {
      employeeId: record.employeeId,
      agentId: record.agentId,
      sessionKey: record.sessionKey,
    };

    let lastError: Error | null = null;
    let acceptedRunId: string | null = null;
    let terminalResult:
      | {
          runId: string;
          text: string;
          status: "final" | "error" | "timeout";
          errorCode?: string;
          errorMessage?: string;
        }
      | null = null;

    for (let attempt = 0; attempt <= this.config.MAX_RETRY_ATTEMPTS; attempt += 1) {
      try {
        const accepted = await this.gateway.sendChat({ routing, inbound: message });
        acceptedRunId = accepted.runId;
        this.store.updateProgress(message.messageId, {
          status: "gateway_accepted",
          runId: accepted.runId,
        });
        this.store.updateProgress(message.messageId, { status: "running" });

        const terminal = await this.gateway.waitForTerminal(accepted.runId, routing.sessionKey);
        if (terminal.status === "final") {
          this.store.updateProgress(message.messageId, {
            status: "final_received",
            runId: terminal.runId,
          });
          terminalResult = {
            runId: terminal.runId,
            text: terminal.text,
            status: "final",
          };
          break;
        }

        this.store.updateProgress(message.messageId, {
          status: terminal.status === "timeout" ? "timed_out" : "failed",
          runId: terminal.runId,
          errorCode: terminal.errorCode,
          errorMessage: terminal.errorMessage,
        });
        terminalResult = {
          runId: terminal.runId,
          text: terminal.errorMessage,
          status: terminal.status === "timeout" ? "timeout" : "error",
          errorCode: terminal.errorCode,
          errorMessage: terminal.errorMessage,
        };
        break;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn("gateway processing attempt failed", {
          attempt: attempt + 1,
          messageId: message.messageId,
          error: lastError.message,
        });
      }
    }

    if (!terminalResult) {
      this.store.updateProgress(message.messageId, {
        status: "failed",
        runId: acceptedRunId,
        errorCode: "gateway_request_failed",
        errorMessage: lastError?.message ?? "gateway request failed",
      });
      terminalResult = {
        runId: acceptedRunId ?? "unknown",
        text: lastError?.message ?? "gateway request failed",
        status: "error",
        errorCode: "gateway_request_failed",
        errorMessage: lastError?.message ?? "gateway request failed",
      };
    }

    try {
      await this.deliverTerminal({
        messageId: message.messageId,
        runId: terminalResult.runId,
        text: terminalResult.text,
        status: terminalResult.status,
        errorCode: terminalResult.errorCode,
        errorMessage: terminalResult.errorMessage,
      });
    } catch (outboundError) {
      this.store.updateProgress(message.messageId, {
        status: "failed",
        errorCode: "proxy_outbound_failed",
        errorMessage: outboundError instanceof Error ? outboundError.message : String(outboundError),
      });
      this.logger.error("proxy outbound delivery failed", {
        messageId: message.messageId,
        runId: terminalResult.runId,
        error: outboundError instanceof Error ? outboundError.message : String(outboundError),
      });
    }
  }

  private async deliverTerminal(params: {
    messageId: string;
    runId: string;
    text: string;
    status: "final" | "error" | "timeout";
    errorCode?: string;
    errorMessage?: string;
  }) {
    const current = this.store.getByMessageId(params.messageId);
    if (!current) {
      throw new Error(`missing stored record for outbound ${params.messageId}`);
    }
    const outbound = await this.outbound.sendFinal({
      record: current,
      runId: params.runId,
      text: params.text,
      status: params.status,
      errorCode: params.errorCode,
      errorMessage: params.errorMessage,
    });
    if (outbound.delivered) {
      this.store.updateProgress(params.messageId, {
        status: "outbound_sent",
        chatMsgId: outbound.payload.chatMsgId,
        requestId: outbound.payload.requestId,
      });
      return;
    }
    this.store.updateProgress(params.messageId, {
      status: "outbound_skipped",
      chatMsgId: outbound.payload.chatMsgId,
      requestId: outbound.payload.requestId,
      errorCode: outbound.reason,
      errorMessage: "proxy outbound url missing",
    });
  }
}
