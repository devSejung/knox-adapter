export type SessionMode = "shared_main" | "isolated_dm";

export type AdapterStatus =
  | "received"
  | "duplicate"
  | "routing_resolved"
  | "queued"
  | "gateway_accepted"
  | "running"
  | "final_received"
  | "outbound_sent"
  | "outbound_skipped"
  | "timed_out"
  | "failed";

export type KnoxInboundPayload = {
  eventId: string;
  messageId: string;
  occurredAt: string;
  sender: {
    knoxUserId: string;
    employeeId?: string;
    employeeEmail?: string;
    displayName?: string;
    department?: string;
  };
  conversation: {
    type: "dm";
    conversationId: string;
    threadId?: string | null;
  };
  text: string;
  preferredSessionMode?: SessionMode;
  agentId?: string;
};

export type PlatformClawRouting = {
  employeeId: string;
  agentId: string;
  sessionKey: string;
};

export type MessageRecord = {
  messageId: string;
  eventId: string;
  employeeId: string;
  agentId: string;
  sessionKey: string;
  conversationId: string;
  threadId: string | null;
  conversationType: string;
  requestId: string | null;
  chatroomId: string | null;
  chatMsgId: string | null;
  runId: string | null;
  status: AdapterStatus;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GatewayChatAccepted = {
  runId: string;
  transport: "websocket" | "http-responses";
};

export type GatewayChatFinal = {
  runId: string;
  sessionKey: string;
  text: string;
  status: "final";
};

export type GatewayChatFailure = {
  runId: string;
  sessionKey: string;
  status: "error" | "aborted" | "timeout";
  errorCode: string;
  errorMessage: string;
};

export type GatewayChatTerminal = GatewayChatFinal | GatewayChatFailure;

export type GatewayCompactionEvent = {
  runId: string | null;
  sessionKey: string;
  phase: "start" | "end";
  completed: boolean;
  willRetry: boolean;
  tokensBefore?: number;
  tokensAfter?: number;
  trigger?: string;
};

export type ProxyOutboundPayload = {
  messageId: string;
  conversationId: string;
  threadId: string | null;
  agentId: string;
  sessionKey: string;
  runId: string;
  requestId: string;
  chatroomId: string;
  chatMsgId: string;
  msgType: "text";
  status: "progress" | "final" | "error" | "timeout";
  text: string;
  final: boolean;
  errorCode?: string;
  errorMessage?: string;
};
