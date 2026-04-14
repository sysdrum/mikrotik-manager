#!/bin/sh
set -e

CERT=/certs/server.crt
KEY=/certs/server.key
RELOAD_SIGNAL=/certs/.reload

# Ensure certs directory exists (it will be a mounted volume, but just in case)
mkdir -p /certs

# Generate self-signed certificate if none exists
if [ ! -f "$CERT" ] || [ ! -f "$KEY" ]; then
    echo "[entrypoint] No certificate found — generating self-signed certificate..."
    openssl req -x509 -nodes -days 3650 \
        -newkey rsa:2048 \
        -keyout "$KEY" \
        -out "$CERT" \
        -subj "/CN=Mikrotik Manager/O=Self-Signed/OU=Local/C=US" \
        -addext "subjectAltName=IP:127.0.0.1,DNS:localhost" \
        2>/dev/null
    echo "[entrypoint] Self-signed certificate generated (valid 10 years)."
fi

# Background watcher: reload nginx when backend writes a .reload signal file
(while true; do
    if [ -f "$RELOAD_SIGNAL" ]; then
        rm -f "$RELOAD_SIGNAL"
        echo "[entrypoint] Certificate change detected — reloading nginx..."
        nginx -s reload 2>/dev/null || true
    fi
    sleep 5
done) &

echo "[entrypoint] Starting nginx..."
exec nginx -g "daemon off;"
