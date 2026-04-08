import type { AdapterConfig } from "./config.js";
import type { KnoxInboundPayload, PlatformClawRouting, SessionMode } from "./types.js";

function normalizeNonEmpty(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function deriveEmployeeId(message: KnoxInboundPayload): string {
  return (
    normalizeNonEmpty(message.sender.employeeId) ??
    normalizeNonEmpty(message.sender.employeeEmail)?.split("@")[0] ??
    message.sender.knoxUserId.trim()
  );
}

function deriveAgentId(message: KnoxInboundPayload): string {
  return (
    normalizeNonEmpty(message.agentId) ??
    normalizeNonEmpty(message.sender.employeeEmail)?.split("@")[0] ??
    deriveEmployeeId(message)
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
