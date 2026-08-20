#!/bin/bash

set -euo pipefail

ARCHIVE_PATH=${1:-/root/nurse-schedule-release.tar.gz}
NODE_VERSION=24.19.0
NODE_ARCHIVE=node-v${NODE_VERSION}-linux-x64.tar.xz
NODE_ROOT=/opt/nurse-schedule-runtime
NODE_DIR=${NODE_ROOT}/node-v${NODE_VERSION}-linux-x64
APP_ROOT=/opt/nurse-schedule
DATA_ROOT=/var/lib/nurse-schedule
BACKUP_ROOT=/var/backups/nurse-schedule
ENV_FILE=/etc/nurse-schedule.env
SERVICE_FILE=/etc/systemd/system/nurse-schedule.service

if [[ ! -f "$ARCHIVE_PATH" ]]; then
  echo "发布包不存在：$ARCHIVE_PATH" >&2
  exit 2
fi

if [[ ! -x "${NODE_DIR}/bin/node" ]]; then
  install -d -m 755 "$NODE_ROOT"
  DOWNLOAD_DIR=$(mktemp -d /tmp/nurse-node.XXXXXX)
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ARCHIVE}" -o "${DOWNLOAD_DIR}/${NODE_ARCHIVE}"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" -o "${DOWNLOAD_DIR}/SHASUMS256.txt"
  (
    cd "$DOWNLOAD_DIR"
    grep " ${NODE_ARCHIVE}$" SHASUMS256.txt | sha256sum -c -
  )
  tar -xJf "${DOWNLOAD_DIR}/${NODE_ARCHIVE}" -C "$NODE_ROOT"
fi

if ! id nurse-schedule >/dev/null 2>&1; then
  useradd --system --home-dir "$DATA_ROOT" --shell /usr/sbin/nologin nurse-schedule
fi

install -d -m 755 "$APP_ROOT" "${APP_ROOT}/releases"
install -d -m 750 -o nurse-schedule -g nurse-schedule "$DATA_ROOT" "$BACKUP_ROOT"

RELEASE_DIR=$(mktemp -d "${APP_ROOT}/releases/release.XXXXXX")
tar -xzf "$ARCHIVE_PATH" -C "$RELEASE_DIR"

(
  cd "$RELEASE_DIR"
  PATH="${NODE_DIR}/bin:${PATH}" "${NODE_DIR}/bin/npm" ci --omit=dev --ignore-scripts --no-audit --no-fund
)

chown -R root:root "$RELEASE_DIR"
find "$RELEASE_DIR" -type d -exec chmod 755 {} +
find "$RELEASE_DIR" -type f -exec chmod 644 {} +

if [[ ! -f "$ENV_FILE" ]]; then
  SCHEDULE_ADMIN_PASSWORD=$(openssl rand -hex 16)
  umask 077
  {
    echo "NODE_ENV=production"
    echo "HOST=127.0.0.1"
    echo "PORT=3010"
    echo "DATA_DIR=${DATA_ROOT}"
    echo "BACKUP_DIR=${BACKUP_ROOT}"
    echo "COOKIE_SECURE=true"
    echo "ADMIN_PASSWORD=${SCHEDULE_ADMIN_PASSWORD}"
  } > "$ENV_FILE"
fi

ln -sfn "$RELEASE_DIR" "${APP_ROOT}/current"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Hospital nurse scheduling service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=nurse-schedule
Group=nurse-schedule
WorkingDirectory=${APP_ROOT}/current
EnvironmentFile=${ENV_FILE}
Environment=NODE_OPTIONS=--max-old-space-size=384
ExecStart=${NODE_DIR}/bin/node ${APP_ROOT}/current/server/index.js
Restart=on-failure
RestartSec=3
TimeoutStopSec=20
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=${DATA_ROOT} ${BACKUP_ROOT}
MemoryMax=512M
TasksMax=128

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now nurse-schedule
systemctl restart nurse-schedule

echo "RELEASE_DIR=${RELEASE_DIR}"
echo "NODE_VERSION=$(${NODE_DIR}/bin/node --version)"
systemctl is-active nurse-schedule
for attempt in {1..20}; do
  if curl -fsS -o /dev/null -w 'LOCAL_HTTP_STATUS=%{http_code}\n' http://127.0.0.1:3010/; then
    exit 0
  fi
  sleep 0.5
done

echo "服务启动后健康检查失败" >&2
systemctl status nurse-schedule --no-pager >&2
exit 1
