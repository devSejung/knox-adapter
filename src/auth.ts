import crypto from "node:crypto";
import type { AdapterConfig } from "./config.js";

const TIMESTAMP_HEADER = "x-platformclaw-timestamp";
const SIGNATURE_HEADER = "x-platformclaw-signature";

export function readProxyAuthHeaders(headers: Headers | Record<string, string | string[] | undefined>) {
  const get = (name: string): string | null => {
    if (headers instanceof Headers) {
      return headers.get(name);
    }
    const raw = headers[name];
    if (Array.isArray(raw)) {
      return raw[0] ?? null;
    }
    return raw ?? null;
  };

  return {
    timestamp: get(TIMESTAMP_HEADER),
    signature: get(SIGNATURE_HEADER),
  };
}

export function verifyProxyRequest(params: {
  config: AdapterConfig;
  headers: Headers | Record<string, string | string[] | undefined>;
  rawBody: Buffer;
}) {
  if (!params.config.REQUIRE_PROXY_HMAC) {
    return { ok: true as const };
  }
  if (!params.config.PROXY_SHARED_SECRET) {
    return { ok: false as const, code: "missing_shared_secret", message: "proxy shared secret missing" };
  }

  const { timestamp, signature } = readProxyAuthHeaders(params.headers);
  if (!timestamp || !signature) {
    return { ok: false as const, code: "missing_signature", message: "missing proxy auth headers" };
  }

  const parsedTs = Number(timestamp);
  if (!Number.isFinite(parsedTs)) {
    return { ok: false as const, code: "invalid_timestamp", message: "invalid timestamp header" };
  }

  const ageMs = Math.abs(Date.now() - parsedTs);
  if (ageMs > 5 * 60_000) {
    return { ok: false as const, code: "stale_timestamp", message: "stale request timestamp" };
  }

  const payload = `${timestamp}.${params.rawBody.toString("utf8")}`;
  const expected = crypto
    .createHmac("sha256", params.config.PROXY_SHARED_SECRET)
    .update(payload)
    .digest("hex");

  const actual = signature.replace(/^sha256=/i, "");
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(actual, "hex");
  if (expectedBuf.length !== actualBuf.length) {
    return { ok: false as const, code: "invalid_signature", message: "invalid request signature" };
  }
  if (!crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    return { ok: false as const, code: "invalid_signature", message: "invalid request signature" };
  }
  return { ok: true as const };
}
