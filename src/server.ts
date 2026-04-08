import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import type { KnoxInboundMessage, PlatformClawRouting } from "./knox-types.js";
import { PlatformClawGatewayClient } from "./platformclaw-gateway.js";

const config = loadConfig();
const gatewayClient = new PlatformClawGatewayClient({
  gatewayUrl: config.PLATFORMCLAW_GATEWAY_URL,
  token: config.PLATFORMCLAW_GATEWAY_TOKEN,
});

function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function buildSessionKey(agentId: string, message: KnoxInboundMessage): string {
  if (config.DEFAULT_SESSION_MODE === "shared_main") {
    return `agent:${agentId}:main`;
  }
  return `agent:${agentId}:knox:dm:${message.sender.knoxUserId}`;
}

function mapInboundToRouting(message: KnoxInboundMessage): PlatformClawRouting {
  const employeeId = message.sender.employeeId?.trim() || message.sender.knoxUserId.trim();
  const agentId = employeeId;
  const sessionKey = buildSessionKey(agentId, message);
  return { employeeId, agentId, sessionKey };
}

function isKnoxInboundMessage(value: unknown): value is KnoxInboundMessage {
  if (!value || typeof value !== "object") {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.eventId === "string" &&
    typeof rec.messageId === "string" &&
    typeof rec.occurredAt === "string" &&
    typeof rec.text === "string" &&
    !!rec.sender &&
    typeof rec.sender === "object" &&
    typeof (rec.sender as Record<string, unknown>).knoxUserId === "string" &&
    !!rec.conversation &&
    typeof rec.conversation === "object" &&
    typeof (rec.conversation as Record<string, unknown>).conversationId === "string" &&
    typeof (rec.conversation as Record<string, unknown>).type === "string"
  );
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    sendJson(res, 200, {
      ok: true,
      service: "platformclaw-knox-adapter",
      gatewayUrl: config.PLATFORMCLAW_GATEWAY_URL,
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/v1/platformclaw/knox/inbound") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid_json" });
      return;
    }
    if (!isKnoxInboundMessage(parsed)) {
      sendJson(res, 400, { ok: false, error: "invalid_payload" });
      return;
    }

    const routing = mapInboundToRouting(parsed);
    const accepted = await gatewayClient.sendChat({ routing, inbound: parsed });
    sendJson(res, 202, {
      ok: true,
      accepted: true,
      runId: accepted.runId,
      routing,
    });
    return;
  }

  sendJson(res, 404, { ok: false, error: "not_found" });
});

server.listen(config.PORT, config.HOST, () => {
  console.log(
    `[knox-adapter] listening on http://${config.HOST}:${config.PORT} gateway=${config.PLATFORMCLAW_GATEWAY_URL}`,
  );
});
