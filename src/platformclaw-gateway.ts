import type { KnoxInboundMessage, PlatformClawRouting } from "./knox-types.js";

export type GatewayClientOptions = {
  gatewayUrl: string;
  token?: string;
};

export class PlatformClawGatewayClient {
  readonly gatewayUrl: string;
  readonly token?: string;

  constructor(options: GatewayClientOptions) {
    this.gatewayUrl = options.gatewayUrl;
    this.token = options.token;
  }

  async sendChat(params: {
    routing: PlatformClawRouting;
    inbound: KnoxInboundMessage;
  }): Promise<{ accepted: true; runId: string }> {
    const runId = `knox-${Date.now()}`;
    console.log(
      "[knox-adapter] gateway chat.send placeholder",
      JSON.stringify({
        gatewayUrl: this.gatewayUrl,
        agentId: params.routing.agentId,
        sessionKey: params.routing.sessionKey,
        messageId: params.inbound.messageId,
        runId,
      }),
    );
    return { accepted: true, runId };
  }
}
