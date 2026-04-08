import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.MOCK_GATEWAY_PORT || 19011);
const HOST = process.env.MOCK_GATEWAY_HOST?.trim() || "127.0.0.1";
const FINAL_DELAY_MS = Number(process.env.MOCK_GATEWAY_FINAL_DELAY_MS || 800);
const FIXED_REPLY =
  process.env.MOCK_GATEWAY_REPLY?.trim() ||
  "PlatformClaw mock gateway 응답입니다.";

const wss = new WebSocketServer({ host: HOST, port: PORT });

wss.on("connection", (socket) => {
  const nonce = randomUUID();
  socket.send(
    JSON.stringify({
      type: "event",
      event: "connect.challenge",
      payload: { nonce },
    }),
  );

  socket.on("message", (raw) => {
    let frame: any;
    try {
      frame = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (frame?.type !== "req" || typeof frame?.id !== "string" || typeof frame?.method !== "string") {
      return;
    }

    if (frame.method === "connect") {
      socket.send(
        JSON.stringify({
          type: "res",
          id: frame.id,
          ok: true,
          payload: {
            type: "hello-ok",
            auth: {
              role: frame?.params?.role ?? "operator",
              scopes: Array.isArray(frame?.params?.scopes) ? frame.params.scopes : [],
            },
          },
        }),
      );
      return;
    }

    if (frame.method === "chat.send") {
      const runId = randomUUID();
      const sessionKey =
        typeof frame?.params?.sessionKey === "string" ? frame.params.sessionKey : "agent:test:main";
      const incomingText =
        typeof frame?.params?.message === "string" ? frame.params.message : "";

      socket.send(
        JSON.stringify({
          type: "res",
          id: frame.id,
          ok: true,
          payload: { runId },
        }),
      );

      setTimeout(() => {
        socket.send(
          JSON.stringify({
            type: "event",
            event: "chat",
            payload: {
              runId,
              sessionKey,
              state: "final",
              message: {
                role: "assistant",
                content: [
                  {
                    type: "text",
                    text: `${FIXED_REPLY} 입력: ${incomingText}`,
                  },
                ],
              },
            },
          }),
        );
      }, FINAL_DELAY_MS);
      return;
    }

    socket.send(
      JSON.stringify({
        type: "res",
        id: frame.id,
        ok: false,
        error: {
          code: "NOT_IMPLEMENTED",
          message: `${frame.method} not implemented in mock gateway`,
        },
      }),
    );
  });
});

console.log(
  JSON.stringify({
    ts: new Date().toISOString(),
    level: "info",
    message: "mock gateway listening",
    host: HOST,
    port: PORT,
  }),
);

process.on("SIGINT", () => wss.close(() => process.exit(0)));
process.on("SIGTERM", () => wss.close(() => process.exit(0)));
