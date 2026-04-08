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
    type: z.literal("dm"),
    conversationId: z.string().trim().min(1),
    threadId: z.string().trim().min(1).nullable().optional(),
  }),
  text: z.string().trim().min(1),
  preferredSessionMode: z.enum(["shared_main", "isolated_dm"]).optional(),
  agentId: z.string().trim().min(1).optional(),
});

export type KnoxInboundSchema = z.infer<typeof knoxInboundSchema>;
