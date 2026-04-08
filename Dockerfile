FROM node:24-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml ./

RUN corepack enable && corepack pnpm install --frozen-lockfile --prod=false

COPY src ./src
COPY tsconfig.json ./
COPY README.md ./
COPY ADAPTER_PLAN.ko.md ./
COPY KNOX_PROXY_API.ko.md ./
COPY FLOW_EXAMPLE.ko.md ./
COPY MOCK_PROXY_TEST.ko.md ./
COPY DOCKER_DEPLOY.ko.md ./
COPY .env.example ./

RUN corepack pnpm check && mkdir -p /app/data

EXPOSE 3010

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3010/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--import", "tsx", "src/server.ts"]
