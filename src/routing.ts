import type { AdapterConfig } from "./config.js";
import type { KnoxInboundPayload, PlatformClawRouting, SessionMode } from "./types.js";

const VALID_AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const INVALID_AGENT_ID_CHARS_RE = /[^a-z0-9_-]+/gi;
const LEADING_DASH_RE = /^-+/;
const TRAILING_DASH_RE = /-+$/;

export class RoutingError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RoutingError";
    this.code = code;
  }
}

function normalizeNonEmpty(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeKnoxSenderId(value: string): string {
  return value.trim().replace(/_([^_]*)$/, ".$1");
}

function normalizeAgentId(value?: string | null): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return "main";
  }
  const lowered = trimmed.toLowerCase().replaceAll(".", "_");
  if (VALID_AGENT_ID_RE.test(lowered)) {
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

export function resolveInboundSenderId(message: KnoxInboundPayload): string {
  const employeeId = normalizeNonEmpty(message.sender.employeeId);
  if (employeeId) {
    return employeeId;
  }
  const employeeEmail = normalizeNonEmpty(message.sender.employeeEmail);
  if (employeeEmail) {
    return employeeEmail.split("@")[0];
  }
  return normalizeKnoxSenderId(message.sender.knoxUserId);
}

function deriveEmployeeId(message: KnoxInboundPayload): string {
  return resolveInboundSenderId(message);
}

function deriveAgentId(message: KnoxInboundPayload): string {
  return normalizeAgentId(
    normalizeNonEmpty(message.agentId) ??
      normalizeNonEmpty(message.sender.employeeEmail)?.split("@")[0] ??
      message.sender.knoxUserId.trim(),
  );
}

function resolveSessionMode(config: AdapterConfig, message: KnoxInboundPayload): SessionMode {
  return message.preferredSessionMode ?? config.DEFAULT_SESSION_MODE;
}

function resolveExplicitSessionKey(message: KnoxInboundPayload, agentId: string): string | null {
  const explicitSessionKey = normalizeNonEmpty(message.sessionKey);
  if (!explicitSessionKey) {
    return null;
  }

  if (!normalizeNonEmpty(message.agentId)) {
    throw new RoutingError("missing_agent_id", "sessionKey requires agentId.");
  }

  const requiredPrefix = `agent:${agentId}:`;
  if (!explicitSessionKey.startsWith(requiredPrefix)) {
    throw new RoutingError(
      "agent_session_mismatch",
      `sessionKey must start with ${requiredPrefix}.`,
    );
  }

  if (explicitSessionKey.length <= requiredPrefix.length) {
    throw new RoutingError("invalid_session_key", "sessionKey must include a session scope.");
  }

  return explicitSessionKey;
}

export function resolveRouting(
  config: AdapterConfig,
  message: KnoxInboundPayload,
): PlatformClawRouting {
  const employeeId = deriveEmployeeId(message);
  const agentId = deriveAgentId(message);
  const explicitSessionKey = resolveExplicitSessionKey(message, agentId);
  if (explicitSessionKey) {
    return { employeeId, agentId, sessionKey: explicitSessionKey };
  }

  const sessionMode = resolveSessionMode(config, message);
  const sessionKey =
    sessionMode === "shared_main"
      ? `agent:${agentId}:main`
      : `agent:${agentId}:knox:dm:${message.sender.knoxUserId.trim()}`;

  return { employeeId, agentId, sessionKey };
}
