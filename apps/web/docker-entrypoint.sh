#!/bin/sh
set -eu

# Generate runtime config for the SPA (no rebuild per environment)
: "${PUBLIC_API_BASE_URL:=/api/v1}"
: "${PUBLIC_APP_NAME:=AdCoDe}"
: "${PUBLIC_VAPID_PUBLIC_KEY:=}"

cat > /usr/share/nginx/html/env.js <<EOF
window.__APP_CONFIG__ = {
  API_BASE_URL: "${PUBLIC_API_BASE_URL}",
  APP_NAME: "${PUBLIC_APP_NAME}",
  VAPID_PUBLIC_KEY: "${PUBLIC_VAPID_PUBLIC_KEY}"
};
EOF

exit 0
