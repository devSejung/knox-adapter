import { z } from "zod";

const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3010),
  HOST: z.string().trim().min(1).default("127.0.0.1"),
  LOG_LEVEL: z.string().trim().min(1).default("info"),
  KNOX_PROXY_SHARED_SECRET: z.string().trim().optional(),
  PLATFORMCLAW_GATEWAY_URL: z.string().trim().min(1).default("ws://127.0.0.1:19001"),
  PLATFORMCLAW_GATEWAY_TOKEN: z.string().trim().optional(),
  DEFAULT_SESSION_MODE: z.enum(["shared_main", "knox_dm"]).default("knox_dm"),
});

export type AdapterConfig = z.infer<typeof configSchema>;

export function loadConfig(env = process.env): AdapterConfig {
  return configSchema.parse(env);
}
