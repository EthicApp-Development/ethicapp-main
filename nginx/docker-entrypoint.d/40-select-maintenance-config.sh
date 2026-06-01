#!/bin/sh
set -eu

is_enabled() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

if is_enabled "${NGINX_MAINTENANCE_MODE:-false}"; then
  : "${NGINX_MAINTENANCE_RETRY_AFTER:=3600}"
  export NGINX_MAINTENANCE_RETRY_AFTER

  echo "NGINX maintenance mode enabled."
  envsubst '${NGINX_MAINTENANCE_RETRY_AFTER}' \
    < /etc/nginx/maintenance.conf.template \
    > /etc/nginx/conf.d/default.conf
  exit 0
fi

rm -f /etc/nginx/conf.d/maintenance.conf

if [ -f /etc/nginx/dev.conf ]; then
  echo "Using development NGINX config."
  cp /etc/nginx/dev.conf /etc/nginx/nginx.conf
  exit 0
fi

: "${ETHICAPP_NODE_PORT:=8501}"
: "${PORT:=8502}"
: "${ETHICAPP_STUDENT_NODE_PORT:=8503}"
: "${MNG_PORT:=8504}"
export ETHICAPP_NODE_PORT PORT ETHICAPP_STUDENT_NODE_PORT MNG_PORT

echo "Rendering production NGINX config."
envsubst '${ETHICAPP_NODE_PORT} ${PORT} ${ETHICAPP_STUDENT_NODE_PORT} ${MNG_PORT}' \
  < /etc/nginx/default.conf.template \
  > /etc/nginx/conf.d/default.conf
