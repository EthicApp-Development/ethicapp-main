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
fi
