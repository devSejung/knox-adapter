import crypto from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

type TestSendRequest = {
  text: string;
  employeeId?: string;
  employeeEmail?: string;
  knoxUserId?: string;
  conversationId?: string;
  threadId?: string | null;
  preferredSessionMode?: "shared_main" | "isolated_dm";
  agentId?: string;
};

type StoredOutbound = {
  receivedAt: string;
  headers: Record<string, string>;
  body: unknown;
};

const HOST = process.env.MOCK_PROXY_HOST?.trim() || "127.0.0.1";
const PORT = Number(process.env.MOCK_PROXY_PORT || 3020);
const ADAPTER_BASE_URL =
  process.env.MOCK_PROXY_ADAPTER_BASE_URL?.trim() || "http://127.0.0.1:3010";
const SHARED_SECRET = process.env.MOCK_PROXY_SHARED_SECRET?.trim() || "";
const OUTBOUND_AUTH_TOKEN = process.env.MOCK_PROXY_OUTBOUND_AUTH_TOKEN?.trim() || "";

const outbounds: StoredOutbound[] = [];

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body, null, 2));
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function buildSignedHeaders(rawBody: string) {
  const timestamp = String(Date.now());
  const signature = crypto
    .createHmac("sha256", SHARED_SECRET)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return {
    "content-type": "application/json",
    "x-platformclaw-timestamp": timestamp,
    "x-platformclaw-signature": `sha256=${signature}`,
  };
}

function normalizeTestRequest(input: Partial<TestSendRequest>): TestSendRequest {
  const now = new Date().toISOString();
  const employeeEmail = input.employeeEmail?.trim() || "eon@samsung.com";
  const employeeId =
    input.employeeId?.trim() || employeeEmail.split("@")[0] || "eon";
  return {
    text: input.text?.trim() || "테스트 메시지입니다. 간단히 답변해 주세요.",
    employeeId,
    employeeEmail,
    knoxUserId: input.knoxUserId?.trim() || employeeId,
    conversationId: input.conversationId?.trim() || `dm:${employeeId}`,
    threadId: input.threadId ?? null,
    preferredSessionMode: input.preferredSessionMode ?? "isolated_dm",
    agentId: input.agentId?.trim(),
  };
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    sendJson(res, 200, {
      ok: true,
      status: "live",
      adapterBaseUrl: ADAPTER_BASE_URL,
      storedOutboundCount: outbounds.length,
    });
    return;
  }

  if (req.method === "GET" && req.url === "/api/v1/platformclaw/knox/outbound/messages") {
    sendJson(res, 200, {
      ok: true,
      count: outbounds.length,
      items: outbounds,
    });
    return;
  }

  if (req.method === "DELETE" && req.url === "/api/v1/platformclaw/knox/outbound/messages") {
    outbounds.length = 0;
    sendJson(res, 200, { ok: true, cleared: true });
    return;
  }

  if (req.method === "POST" && req.url === "/api/v1/platformclaw/knox/outbound/send") {
    if (OUTBOUND_AUTH_TOKEN) {
      const actual = req.headers.authorization;
      const expected = `Bearer ${OUTBOUND_AUTH_TOKEN}`;
      if (actual !== expected) {
        sendJson(res, 401, { ok: false, error: "invalid_outbound_auth" });
        return;
      }
    }

    const rawBody = await readBody(req);
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString("utf8"));
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid_json" });
      return;
    }

    outbounds.push({
      receivedAt: new Date().toISOString(),
      headers: {
        authorization: req.headers.authorization || "",
        "content-type": req.headers["content-type"]?.toString() || "",
      },
      body: parsed,
    });
    sendJson(res, 202, { ok: true, stored: true, count: outbounds.length });
    return;
  }

  if (req.method === "POST" && req.url === "/api/v1/platformclaw/knox/test/send") {
    if (!SHARED_SECRET) {
      sendJson(res, 500, { ok: false, error: "missing_shared_secret" });
      return;
    }

    const rawBody = await readBody(req);
    let parsed: Partial<TestSendRequest> = {};
    if (rawBody.length > 0) {
      try {
        parsed = JSON.parse(rawBody.toString("utf8")) as Partial<TestSendRequest>;
      } catch {
        sendJson(res, 400, { ok: false, error: "invalid_json" });
        return;
      }
    }

    const testRequest = normalizeTestRequest(parsed);
    const inboundPayload = {
      eventId: crypto.randomUUID(),
      messageId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      sender: {
        knoxUserId: testRequest.knoxUserId!,
        employeeId: testRequest.employeeId,
        employeeEmail: testRequest.employeeEmail,
        displayName: testRequest.employeeId,
        department: "PlatformClaw",
      },
      conversation: {
        type: "dm" as const,
        conversationId: testRequest.conversationId!,
        threadId: testRequest.threadId,
      },
      text: testRequest.text,
      preferredSessionMode: testRequest.preferredSessionMode,
      agentId: testRequest.agentId,
    };

    const encodedBody = JSON.stringify(inboundPayload);
    const response = await fetch(`${ADAPTER_BASE_URL}/api/v1/platformclaw/knox/inbound`, {
      method: "POST",
      headers: buildSignedHeaders(encodedBody),
      body: encodedBody,
    });

    const adapterResult = await response
      .json()
      .catch(async () => ({ raw: await response.text() }));

    sendJson(res, response.ok ? 202 : response.status, {
      ok: response.ok,
      inboundPayload,
      adapterStatus: response.status,
      adapterResult,
      hint:
        "응답이 최종적으로 돌아오면 /api/v1/platformclaw/knox/outbound/messages 에 저장됩니다.",
    });
    return;
  }

  sendJson(res, 404, { ok: false, error: "not_found" });
});

server.listen(PORT, HOST, () => {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      message: "mock proxy listening",
      host: HOST,
      port: PORT,
      adapterBaseUrl: ADAPTER_BASE_URL,
    }),
  );
});

process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
