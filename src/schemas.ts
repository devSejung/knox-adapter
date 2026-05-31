import { z } from "zod";

export const knoxInboundSchema = z.object({
  eventId: z.string().trim().min(1),
  messageId: z.string().trim().min(1),
  occurredAt: z.string().trim().min(1),
  sender: z.object({
    knoxUserId: z.string().trim().min(1),
    employeeId: z.string().trim().min(1).optional(),
    employeeEmail: z.string().trim().email().optional(),
    displayName: z.string().trim().min(1).optional(),
    department: z.string().trim().min(1).optional(),
  }),
  conversation: z.object({
    type: z.enum(["dm", "room"]),
    conversationId: z.string().trim().min(1),
    threadId: z.string().trim().min(1).nullable().optional(),
  }),
  text: z.string().trim().min(1),
  preferredSessionMode: z.enum(["shared_main", "isolated_dm"]).optional(),
  agentId: z.string().trim().min(1).optional(),
  sessionKey: z.string().trim().min(1).optional(),
});

export type KnoxInboundSchema = z.infer<typeof knoxInboundSchema>;

export const coreOutboundSchema = z.object({
  accountId: z.string().trim().min(1).nullable().optional(),
  to: z.string().trim().min(1),
  conversationType: z.enum(["dm", "room"]).nullable().optional(),
  conversationId: z.string().trim().min(1).nullable().optional(),
  chatroomId: z.string().trim().min(1).nullable().optional(),
  chatMsgId: z.string().trim().min(1).nullable().optional(),
  messageId: z.string().trim().min(1).nullable().optional(),
  threadId: z.union([z.string().trim().min(1), z.number().finite()]).nullable().optional(),
  text: z.string().min(1),
  status: z.enum(["progress", "final", "error", "timeout"]).optional(),
  final: z.boolean().optional(),
  agentId: z.string().trim().min(1).nullable().optional(),
  sessionKey: z.string().trim().min(1).nullable().optional(),
  runId: z.string().trim().min(1).nullable().optional(),
  requestId: z.string().trim().min(1).nullable().optional(),
  senderId: z.string().trim().min(1).nullable().optional(),
  senderDisplayName: z.string().trim().min(1).nullable().optional(),
  errorCode: z.string().trim().min(1).optional(),
  errorMessage: z.string().trim().min(1).optional(),
});

export type CoreOutboundSchema = z.infer<typeof coreOutboundSchema>;
