pkill -f "node --import tsx src/server.ts"

: "${OPENCLAW_STATE_DIR:=/home/eon/work/open_claw/.openclaw-local-test}"
: "${OPENCLAW_CONFIG_PATH:=/home/eon/work/open_claw/exam_emp_openclaw.json}"

OPENCLAW_STATE_DIR="$OPENCLAW_STATE_DIR" \
OPENCLAW_CONFIG_PATH="$OPENCLAW_CONFIG_PATH" \
PROXY_SHARED_SECRET='CHANGE_ME_LONG_RANDOM_SECRET' \
PROXY_OUTBOUND_URL='http://127.0.0.1:3020/api/v1/platformclaw/knox/outbound/send' \
PROXY_OUTBOUND_AUTH_TOKEN='change_me_proxy_outbound_token' \
CORE_OUTBOUND_AUTH_TOKEN='change_me_core_to_adapter_token' \
PLATFORMCLAW_HTTP_BASE_URL='http://127.0.0.1:19001' \
PLATFORMCLAW_GATEWAY_URL='ws://127.0.0.1:19001' \
PLATFORMCLAW_GATEWAY_PASSWORD='CHANGE_ME_ADMIN_PASSWORD' \
PLATFORMCLAW_SCOPE='operator.admin' \
pnpm start
