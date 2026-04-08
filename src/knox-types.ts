export type KnoxSender = {
  knoxUserId: string;
  employeeId?: string;
  employeeEmail?: string;
  displayName?: string;
  department?: string;
};

export type KnoxConversation = {
  type: "dm" | "group" | "thread";
  conversationId: string;
  threadId?: string;
};

export type KnoxInboundMessage = {
  eventId: string;
  messageId: string;
  occurredAt: string;
  sender: KnoxSender;
  conversation: KnoxConversation;
  text: string;
};

export type PlatformClawRouting = {
  employeeId: string;
  agentId: string;
  sessionKey: string;
};

export type KnoxOutboundMessage = {
  conversationId: string;
  threadId?: string;
  text: string;
};
