import type { AdapterConfig } from "./config.js";
import type { KnoxInboundPayload, PlatformClawRouting, SessionMode } from "./types.js";

const VALID_AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const INVALID_AGENT_ID_CHARS_RE = /[^a-z0-9_-]+/gi;
const LEADING_DASH_RE = /^-+/;
const TRAILING_DASH_RE = /-+$/;

function normalizeNonEmpty(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeAgentId(value?: string | null): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return "main";
  }
  const lowered = trimmed.toLowerCase();
  if (VALID_AGENT_ID_RE.test(trimmed)) {
    return lowered;
  }
  return (
    lowered
      .replace(INVALID_AGENT_ID_CHARS_RE, "-")
      .replace(LEADING_DASH_RE, "")
      .replace(TRAILING_DASH_RE, "")
      .slice(0, 64) || "main"
  );
}

function deriveEmployeeId(message: KnoxInboundPayload): string {
  return (
    normalizeNonEmpty(message.sender.employeeId) ??
    normalizeNonEmpty(message.sender.employeeEmail)?.split("@")[0] ??
    message.sender.knoxUserId.trim()
  );
}

function deriveAgentId(message: KnoxInboundPayload): string {
  return normalizeAgentId(
    normalizeNonEmpty(message.agentId) ??
      normalizeNonEmpty(message.sender.employeeEmail)?.split("@")[0] ??
      deriveEmployeeId(message),
  );
}

function resolveSessionMode(config: AdapterConfig, message: KnoxInboundPayload): SessionMode {
  return message.preferredSessionMode ?? config.DEFAULT_SESSION_MODE;
}

export function resolveRouting(
  config: AdapterConfig,
  message: KnoxInboundPayload,
): PlatformClawRouting {
  const employeeId = deriveEmployeeId(message);
  const agentId = deriveAgentId(message);
  const sessionMode = resolveSessionMode(config, message);
  const sessionKey =
    sessionMode === "shared_main"
      ? `agent:${agentId}:main`
      : `agent:${agentId}:knox:dm:${message.sender.knoxUserId.trim()}`;

  return { employeeId, agentId, sessionKey };
}
