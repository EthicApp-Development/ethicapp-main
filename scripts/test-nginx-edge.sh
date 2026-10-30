#!/usr/bin/env bash
# Checks how the NGINX edge answers missing sessions and outages (#664), for
# both the production template and dev.conf. It builds the nginx image, runs it
# on a private Docker network next to stub upstreams, and compares status,
# Content-Type and a body or header fragment for each case.
#
# Stubs: auth-backend answers the session check from the auth.sid cookie
# (valid: 200, broken: 502, anything else: 401); ethicapp-student returns its
# own 503 for /student/api/; ethicapp has no container, so it is down.
#
# Requires Docker and curl. Usage: npm run test:nginx-edge
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PREFIX="ethicapp-edge-test-$$"
NETWORK="$PREFIX-net"
IMAGE="$PREFIX-nginx"
WORK="$(mktemp -d)"
FAILURES=0

cleanup() {
  docker rm -f "$PREFIX-stub" "$PREFIX-edge" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  docker image rm "$IMAGE" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

cat > "$WORK/stub.conf" <<'STUB'
server {
    listen 8502;
    location = /auth/session/check {
        if ($http_cookie ~ "auth\.sid=valid") {
            add_header X-User-Id 44;
            add_header X-User-Role A;
            return 200;
        }
        if ($http_cookie ~ "auth\.sid=broken") {
            return 502;
        }
        return 401;
    }
}

server {
    listen 8503;
    location /student/api/ {
        default_type application/json;
        return 503 '{"status":"application-error"}';
    }
}
STUB

docker build --quiet --tag "$IMAGE" "$ROOT/nginx" >/dev/null
docker network create "$NETWORK" >/dev/null
docker run --detach --name "$PREFIX-stub" --network "$NETWORK" \
  --network-alias auth-backend --network-alias ethicapp-student \
  --volume "$WORK/stub.conf:/etc/nginx/conf.d/default.conf:ro" \
  nginx:1.28-alpine >/dev/null

# check <description> <status> <content-type prefix> <fragment> <curl args...>
check() {
  local description="$1" status="$2" content_type="$3" fragment="$4"
  shift 4
  local actual_status actual_type
  actual_status="$(curl --silent --output "$WORK/body" --dump-header "$WORK/headers" \
    --write-out '%{http_code}' "$@")"
  actual_type="$(grep -i '^content-type:' "$WORK/headers" | head -n 1 | cut -d' ' -f2 | tr -d '\r;')"

  if [ "$actual_status" = "$status" ] \
    && [ "${actual_type#"$content_type"}" != "$actual_type" ] \
    && grep -qF -- "$fragment" "$WORK/headers" "$WORK/body"; then
    echo "  PASS  $description"
  else
    echo "  FAIL  $description: expected $status $content_type '$fragment'," \
      "got $actual_status $actual_type"
    FAILURES=$((FAILURES + 1))
  fi
}

run_cases() {
  local base="$1"
  local api=(--header 'Sec-Fetch-Mode: cors' --header 'Sec-Fetch-Dest: empty')
  local nav=(--header 'Sec-Fetch-Mode: navigate' --header 'Sec-Fetch-Dest: document')
  local valid=(--cookie 'auth.sid=valid')
  local broken=(--cookie 'auth.sid=broken')
  local page='EthicApp is temporarily unavailable.'

  check "expired session, API call" 401 application/json '{"status":"expired"}' \
    "${api[@]}" "$base/home"
  check "expired session, navigation" 302 text/html 'Location: /auth/login' \
    "${nav[@]}" "$base/home"
  check "expired session, POST navigation" 302 text/html 'Location: /auth/login' \
    "${nav[@]}" --request POST "$base/sessions/join/abc123"
  check "expired session, API call to an image URI keeps JSON" 401 application/json \
    '{"status":"expired"}' "${api[@]}" "$base/uploads/x.png"
  check "expired session, no Sec-Fetch and Accept text/html" 302 text/html \
    'Location: /auth/login' --header 'Accept: text/html' "$base/home"
  check "expired session, no Sec-Fetch and Accept JSON" 401 application/json \
    '{"status":"expired"}' --header 'Accept: application/json, text/plain, */*' "$base/home"

  check "backend outage, API GET" 502 application/json '{"status":"unavailable"}' \
    "${api[@]}" "${valid[@]}" "$base/home"
  check "backend outage, API POST" 502 application/json '{"status":"unavailable"}' \
    "${api[@]}" "${valid[@]}" --request POST "$base/sessions/join/abc123"
  check "backend outage, navigation" 502 text/html "$page" \
    "${nav[@]}" "${valid[@]}" "$base/home"
  check "backend outage, POST navigation" 502 text/html "$page" \
    "${nav[@]}" "${valid[@]}" --request POST "$base/sessions/join/abc123"

  check "auth check outage, API call" 500 application/json '{"status":"unavailable"}' \
    "${api[@]}" "${broken[@]}" "$base/student/api/session"
  check "auth check outage, navigation" 500 text/html "$page" \
    "${nav[@]}" "${broken[@]}" "$base/student/"
  check "auth check outage, POST navigation" 500 text/html "$page" \
    "${nav[@]}" "${broken[@]}" --request POST "$base/sessions/join/abc123"

  check "application error passes through" 503 application/json \
    '{"status":"application-error"}' "${api[@]}" "${valid[@]}" "$base/student/api/session"
  check "well-formed inbound request id is kept" 401 application/json \
    'X-Request-Id: edge-test-0001' "${api[@]}" --header 'X-Request-Id: edge-test-0001' "$base/home"
  check "outage page shows the request id" 502 text/html 'edge-test-0002' \
    "${nav[@]}" "${valid[@]}" --header 'X-Request-Id: edge-test-0002' "$base/home"

  # Internal-only ethicapp routes (#816): 404 at the edge even with a session,
  # never proxied (ethicapp is down here, so a proxied request would be 502).
  check "internal AI services catalog is not served" 404 text/html 'X-Request-Id:' \
    "${api[@]}" "${valid[@]}" "$base/api/admin/ai-services/catalog?locale=es_CL"
  check "internal AI connection test is not served" 404 text/html 'X-Request-Id:' \
    "${api[@]}" "${valid[@]}" --request POST --header 'Content-Type: application/json' \
    --data '{"baseUrl":"http://ai.example.org"}' "$base/api/admin/ai-services/connection-test"
  check "internal AI services catalog, other letter case" 404 text/html 'X-Request-Id:' \
    "${api[@]}" "${valid[@]}" "$base/API/admin/ai-services/catalog?locale=es_CL"
  check "internal AI connection test, other letter case" 404 text/html 'X-Request-Id:' \
    "${api[@]}" "${valid[@]}" --request POST --header 'Content-Type: application/json' \
    --data '{"baseUrl":"http://ai.example.org"}' "$base/api/Admin/ai-services/connection-test"
  check "impersonation start is not served" 404 text/html 'X-Request-Id:' \
    "${api[@]}" "${valid[@]}" --request POST "$base/api/admin/impersonation/professor/12"
  check "impersonation start, other letter case" 404 text/html 'X-Request-Id:' \
    "${api[@]}" "${valid[@]}" --request POST "$base/Api/Admin/Impersonation/professor/12"
  check "internal user erasure status is not served" 404 text/html 'X-Request-Id:' \
    "${api[@]}" "${valid[@]}" "$base/api/admin/user-erasure/users/12"
  check "internal user erasure retry is not served" 404 text/html 'X-Request-Id:' \
    "${api[@]}" "${valid[@]}" --request POST "$base/api/admin/user-erasure/users/12/retry"
  check "internal user erasure retry, other letter case" 404 text/html 'X-Request-Id:' \
    "${api[@]}" "${valid[@]}" --request POST "$base/api/Admin/User-Erasure/users/12/retry"
  check "teacher open activities count is not served" 404 text/html 'X-Request-Id:' \
    "${api[@]}" "${valid[@]}" "$base/api/admin/users/12/open-activities"
  check "finishing a teacher's activities is not served" 404 text/html 'X-Request-Id:' \
    "${api[@]}" "${valid[@]}" --request POST "$base/api/admin/users/12/finish-activities"
  check "finishing a teacher's activities, other letter case" 404 text/html 'X-Request-Id:' \
    "${api[@]}" "${valid[@]}" --request POST "$base/API/Admin/Users/12/finish-activities"
  # Impersonation stop stays proxied: ethicapp is down here, hence 502.
  check "impersonation stop is still proxied" 502 application/json '{"status":"unavailable"}' \
    "${api[@]}" "${valid[@]}" --request POST "$base/api/admin/impersonation/stop"
}

start_edge() {
  docker rm -f "$PREFIX-edge" >/dev/null 2>&1 || true
  docker run --detach --name "$PREFIX-edge" --network "$NETWORK" --publish 127.0.0.1::80 \
    --env ETHICAPP_NODE_PORT=8501 --env PORT=8502 \
    --env ETHICAPP_STUDENT_NODE_PORT=8503 --env MNG_PORT=8504 \
    "$@" "$IMAGE" >/dev/null
  local port
  port="$(docker port "$PREFIX-edge" 80/tcp | head -n 1 | sed 's/.*://')"
  for _ in $(seq 1 50); do
    if curl --silent --output /dev/null "http://127.0.0.1:$port/favicon.ico"; then
      echo "http://127.0.0.1:$port"
      return
    fi
    sleep 0.2
  done
  docker logs "$PREFIX-edge" >&2
  echo "NGINX did not start" >&2
  exit 1
}

echo "Production template (nginx/conf.d/default.conf.template):"
run_cases "$(start_edge)"

echo "Development config (nginx/conf.d/dev.conf):"
run_cases "$(start_edge --volume "$ROOT/nginx/conf.d/dev.conf:/etc/nginx/dev.conf:ro")"

if [ "$FAILURES" -gt 0 ]; then
  echo "$FAILURES check(s) failed."
  exit 1
fi
echo "All checks passed."
