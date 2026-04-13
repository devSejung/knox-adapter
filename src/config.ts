import path from "node:path";
import { z } from "zod";

const envBoolean = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return value !== 0;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "") {
        return undefined;
      }
      if (["1", "true", "yes", "y", "on"].includes(normalized)) {
        return true;
      }
      if (["0", "false", "no", "n", "off"].includes(normalized)) {
        return false;
      }
    }
    return value;
  }, z.boolean().default(defaultValue));

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().trim().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(3010),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  DATABASE_PATH: z
    .string()
    .trim()
    .min(1)
    .default(path.resolve(process.cwd(), "data", "knox-adapter.sqlite")),

  PROXY_SHARED_SECRET: z.string().trim().min(1).optional(),
  REQUIRE_PROXY_HMAC: envBoolean(true),
  PROXY_OUTBOUND_URL: z.string().trim().url().optional(),
  PROXY_OUTBOUND_AUTH_TOKEN: z.string().trim().min(1).optional(),
  PROXY_SEND_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  PLATFORMCLAW_GATEWAY_URL: z
    .string()
    .trim()
    .default("ws://127.0.0.1:19001")
    .refine((value) => value.startsWith("ws://") || value.startsWith("wss://"), {
      message: "PLATFORMCLAW_GATEWAY_URL must be a ws:// or wss:// URL",
    }),
  PLATFORMCLAW_HTTP_BASE_URL: z.string().trim().url().optional(),
  PLATFORMCLAW_TRANSPORT: z.enum(["auto", "websocket", "http-responses"]).default("auto"),
  PLATFORMCLAW_GATEWAY_TOKEN: z.string().trim().min(1).optional(),
  PLATFORMCLAW_GATEWAY_DEVICE_TOKEN: z.string().trim().min(1).optional(),
  PLATFORMCLAW_GATEWAY_PASSWORD: z.string().trim().min(1).optional(),
  PLATFORMCLAW_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  PLATFORMCLAW_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  PLATFORMCLAW_RUN_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  PLATFORMCLAW_ROLE: z.literal("operator").default("operator"),
  PLATFORMCLAW_SCOPE: z.string().trim().min(1).default("operator.admin"),
  PLATFORMCLAW_DEVICE_IDENTITY_PATH: z
    .string()
    .trim()
    .min(1)
    .default(path.resolve(process.cwd(), "data", "gateway-device.json")),
  PLATFORMCLAW_CLIENT_ID: z.string().trim().min(1).default("gateway-client"),
  PLATFORMCLAW_CLIENT_VERSION: z.string().trim().min(1).default("0.1.0"),
  PLATFORMCLAW_CLIENT_PLATFORM: z.string().trim().min(1).default("node"),
  PLATFORMCLAW_CLIENT_MODE: z.string().trim().min(1).default("backend"),
  PLATFORMCLAW_CLIENT_DEVICE_FAMILY: z.string().trim().min(1).default("server"),
  PLATFORMCLAW_LOCALE: z.string().trim().min(1).default("ko-KR"),
  PLATFORMCLAW_USER_AGENT: z.string().trim().min(1).default("platformclaw-knox-adapter"),
  PLATFORMCLAW_USE_DEVICE_IDENTITY: envBoolean(false),

  DEFAULT_SESSION_MODE: z.enum(["shared_main", "isolated_dm"]).default("isolated_dm"),
  ENABLE_STAGE_UPDATES: envBoolean(false),
  MAX_RETRY_ATTEMPTS: z.coerce.number().int().min(0).max(5).default(1),
  REQUIRE_EMPLOYEE_ACTIVATION: envBoolean(false),
  PLATFORMCLAW_EMPLOYEE_ACTIVATION_PATH: z
    .string()
    .trim()
    .min(1)
    .default(path.resolve(process.cwd(), "data", "employee-activation.json")),
});

export type AdapterConfig = z.infer<typeof configSchema>;

export function loadConfig(env = process.env): AdapterConfig {
  return configSchema.parse(env);
}
