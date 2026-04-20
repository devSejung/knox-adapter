import { randomUUID } from "node:crypto";
import type { AdapterConfig } from "./config.js";
import { isEmployeeActivated } from "./activation.js";
import { Logger } from "./logger.js";
import { ProxyOutboundClient } from "./outbound-client.js";
import { PlatformClawGatewayClient } from "./platformclaw-gateway.js";
import { resolveRouting } from "./routing.js";
import { AdapterStore } from "./store.js";
import type { GatewayCompactionEvent, KnoxInboundPayload, MessageRecord } from "./types.js";

function formatTokenCount(value: number) {
  return value.toLocaleString("en-US");
}

function formatCompactionReduction(params: { tokensBefore?: number; tokensAfter?: number }) {
  const { tokensBefore, tokensAfter } = params;
  if (
    typeof tokensBefore !== "number" ||
    !Number.isFinite(tokensBefore) ||
    tokensBefore <= 0 ||
    typeof tokensAfter !== "number" ||
    !Number.isFinite(tokensAfter) ||
    tokensAfter < 0
  ) {
    return null;
  }
  const clampedAfter = Math.min(tokensAfter, tokensBefore);
  const reducedRatio = Math.max(0, Math.min(1, (tokensBefore - clampedAfter) / tokensBefore));
  return {
    reducedPercent: Math.round(reducedRatio * 100),
    beforeLabel: formatTokenCount(tokensBefore),
    afterLabel: formatTokenCount(clampedAfter),
  };
}

function buildCompactionStartText() {
  return "Context 압축 중입니다. 응답을 이어가기 위해 대화 내용을 정리하고 있습니다.";
}

function buildCompactionCompleteText(event: GatewayCompactionEvent) {
  const reduction = formatCompactionReduction({
    tokensBefore: event.tokensBefore,
    tokensAfter: event.tokensAfter,
  });
  if (!reduction) {
    return "Context 압축이 완료되었습니다. 응답을 이어갑니다.";
  }
  return `Context 압축이 완료되었습니다. 약 ${reduction.reducedPercent}% 줄였습니다 (${reduction.beforeLabel} -> ${reduction.afterLabel} tokens). 응답을 이어갑니다.`;
}

function buildQueuedText(queueDepthAhead: number) {
  if (!Number.isFinite(queueDepthAhead) || queueDepthAhead <= 0) {
    return "앞선 요청 처리 후 이어서 진행합니다.";
  }
  return `앞선 요청 ${queueDepthAhead}건 처리 후 이어서 진행합니다.`;
}

export class KnoxAdapterService {
  private readonly sessionQueues = new Map<
    string,
    {
      running: boolean;
      items: KnoxInboundPayload[];
    }
  >();

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

    this.enqueueBySession(routing.sessionKey, message);

    return { duplicate: false, record: this.store.getByMessageId(message.messageId)! };
  }

  private enqueueBySession(sessionKey: string, message: KnoxInboundPayload) {
    let queue = this.sessionQueues.get(sessionKey);
    if (!queue) {
      queue = { running: false, items: [] };
      this.sessionQueues.set(sessionKey, queue);
    }
    const queueDepthAhead = queue.items.length + (queue.running ? 1 : 0);
    const isQueuedBehindAnother = queueDepthAhead > 0;
    queue.items.push(message);
    if (isQueuedBehindAnother) {
      this.store.updateProgress(message.messageId, {
        status: "queued",
      });
      void this.notifyQueued(message.messageId, queueDepthAhead).catch((error) => {
        this.logger.warn("queued stage update delivery failed", {
          messageId: message.messageId,
          sessionKey,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
    void this.pumpSessionQueue(sessionKey).catch((error) => {
      this.logger.error("session queue pump failed", {
        sessionKey,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private async pumpSessionQueue(sessionKey: string) {
    const queue = this.sessionQueues.get(sessionKey);
    if (!queue || queue.running) {
      return;
    }
    queue.running = true;
    try {
      while (queue.items.length > 0) {
        const next = queue.items.shift();
        if (!next) {
          continue;
        }
        try {
          await this.process(next);
        } catch (error) {
          this.logger.error("inbound processing failed", {
            messageId: next.messageId,
            sessionKey,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      queue.running = false;
      if (queue.items.length === 0) {
        this.sessionQueues.delete(sessionKey);
      }
    }
  }

  private async notifyQueued(messageId: string, queueDepthAhead: number) {
    const record = this.store.getByMessageId(messageId);
    if (!record) {
      return;
    }
    await this.outbound.sendProgress({
      record,
      runId: `queue-${messageId}`,
      text: buildQueuedText(queueDepthAhead),
    });
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

    const activation = await isEmployeeActivated({
      config: this.config,
      employeeId: routing.employeeId,
      agentId: routing.agentId,
    });
    if (!activation.ok) {
      this.logger.warn("employee activation gate rejected inbound message", {
        messageId: message.messageId,
        employeeId: routing.employeeId,
        agentId: routing.agentId,
        reason: activation.reason,
      });
      this.store.updateProgress(message.messageId, {
        status: "failed",
        errorCode: "employee_not_activated",
        errorMessage: activation.reason,
      });
      await this.deliverTerminal({
        messageId: message.messageId,
        runId: "activation-gate",
        text: "PlatformClaw web login is required before Knox access can be used.",
        status: "error",
        errorCode: "employee_not_activated",
        errorMessage: activation.reason,
      });
      return;
    }

    let lastError: Error | null = null;
    let acceptedRunId: string | null = null;
    let acceptedTransport: "websocket" | "http-responses" | null = null;
    let terminalResult:
      | {
          runId: string;
          text: string;
          status: "final" | "error" | "timeout";
          errorCode?: string;
          errorMessage?: string;
        }
      | null = null;
    const compactionState = {
      activeNotified: false,
      completedNotified: false,
    };
    const unsubscribeCompaction = this.config.ENABLE_STAGE_UPDATES
      ? this.gateway.onCompactionEvent((event) => {
          if (event.sessionKey !== routing.sessionKey) {
            return;
          }
          if (
            acceptedTransport === "websocket" &&
            acceptedRunId &&
            event.runId &&
            event.runId !== acceptedRunId
          ) {
            return;
          }
          void this.handleCompactionProgress({
            messageId: message.messageId,
            runId: acceptedRunId ?? event.runId ?? "compaction-stage",
            event,
            state: compactionState,
          }).catch((error) => {
            this.logger.warn("compaction stage update delivery failed", {
              messageId: message.messageId,
              sessionKey: routing.sessionKey,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        })
      : null;

    try {
      for (let attempt = 0; attempt <= this.config.MAX_RETRY_ATTEMPTS; attempt += 1) {
        try {
          const accepted = await this.gateway.sendChat({ routing, inbound: message });
          acceptedRunId = accepted.runId;
          acceptedTransport = accepted.transport;
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
    } finally {
      unsubscribeCompaction?.();
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

  private async handleCompactionProgress(params: {
    messageId: string;
    runId: string;
    event: GatewayCompactionEvent;
    state: {
      activeNotified: boolean;
      completedNotified: boolean;
    };
  }) {
    if (!this.config.ENABLE_STAGE_UPDATES) {
      return;
    }
    const record = this.store.getByMessageId(params.messageId);
    if (!record) {
      return;
    }
    if (params.event.phase === "start") {
      if (params.state.activeNotified) {
        return;
      }
      params.state.activeNotified = true;
      await this.outbound.sendProgress({
        record,
        runId: params.runId,
        text: buildCompactionStartText(),
      });
      return;
    }
    if (!params.event.completed || params.state.completedNotified) {
      return;
    }
    params.state.completedNotified = true;
    await this.outbound.sendProgress({
      record,
      runId: params.runId,
      text: buildCompactionCompleteText(params.event),
    });
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
