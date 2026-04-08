import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { verifyProxyRequest } from "./auth.js";
import { loadConfig } from "./config.js";
import { Logger } from "./logger.js";
import { ProxyOutboundClient } from "./outbound-client.js";
import { PlatformClawGatewayClient } from "./platformclaw-gateway.js";
import { knoxInboundSchema } from "./schemas.js";
import { KnoxAdapterService } from "./service.js";
import { AdapterStore } from "./store.js";

const config = loadConfig();
const logger = new Logger(config);
const store = new AdapterStore(config.DATABASE_PATH);
const gatewayClient = new PlatformClawGatewayClient(config, logger);
const outboundClient = new ProxyOutboundClient(config, logger);
const service = new KnoxAdapterService(config, logger, store, gatewayClient, outboundClient);

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    sendJson(res, 200, service.health());
    return;
  }

  if (req.method === "GET" && req.url === "/readyz") {
    const ready = service.readiness();
    sendJson(res, ready.ok ? 200 : 503, ready);
    return;
  }

  if (req.method === "POST" && req.url === "/api/v1/platformclaw/knox/inbound") {
    const rawBody = await readRawBody(req);
    const verified = verifyProxyRequest({
      config,
      headers: req.headers,
      rawBody,
    });
    if (!verified.ok) {
      sendJson(res, 401, { ok: false, error: verified.code, message: verified.message });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString("utf8"));
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid_json" });
      return;
    }

    const inbound = knoxInboundSchema.safeParse(parsed);
    if (!inbound.success) {
      sendJson(res, 400, {
        ok: false,
        error: "invalid_payload",
        details: inbound.error.flatten(),
      });
      return;
    }

    const accepted = await service.acceptInbound(inbound.data);
    sendJson(res, accepted.duplicate ? 200 : 202, {
      ok: true,
      duplicate: accepted.duplicate,
      messageId: accepted.record.messageId,
      agentId: accepted.record.agentId,
      sessionKey: accepted.record.sessionKey,
      status: accepted.record.status,
    });
    return;
  }

  sendJson(res, 404, { ok: false, error: "not_found" });
});

server.listen(config.PORT, config.HOST, () => {
  logger.info("adapter listening", {
    host: config.HOST,
    port: config.PORT,
    gatewayUrl: config.PLATFORMCLAW_GATEWAY_URL,
    dbPath: config.DATABASE_PATH,
  });
});

function shutdown(signal: string) {
  logger.info("adapter shutting down", { signal });
  gatewayClient.close();
  store.close();
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
