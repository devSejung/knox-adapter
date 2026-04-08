# PlatformClaw Knox Adapter

Standalone Knox adapter skeleton for PlatformClaw.

## Purpose

This service is the bridge between:

- company Knox Proxy API
- PlatformClaw gateway

It is intentionally separated from the main OpenClaw repo runtime so that:

- Knox-specific logic can evolve independently
- company auth and mapping rules can stay local to the adapter
- gateway stability is isolated from Knox integration failures

## Initial Scope

MVP scope:

- inbound Knox message receive
- user-to-agent mapping
- sessionKey generation
- PlatformClaw gateway websocket/RPC client
- final-only outbound reply delivery

Not yet included:

- chunked streaming delivery
- attachment relay
- group room policies
- production auth hardening
- retry/dedupe persistence

## Layout

- `src/config.ts`: environment config loader
- `src/server.ts`: adapter HTTP server bootstrap
- `src/platformclaw-gateway.ts`: PlatformClaw gateway client placeholder
- `src/knox-types.ts`: shared Knox/adapter types

## Run

This is a scaffold only. Dependencies are not installed yet.

Planned commands:

```bash
cd /home/eon/work/open_claw/knox-adapter
corepack pnpm install
corepack pnpm dev
```

## Notes

- The Knox Proxy contract is documented in [KNOX_PORXY_SPEC.md](/home/eon/work/open_claw/KNOX_PORXY_SPEC.md).
- The adapter should treat PlatformClaw as an RPC target, not as a filesystem dependency.
