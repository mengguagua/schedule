#!/bin/sh

set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$PROJECT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js，请先安装 Node.js 24 或更高版本。"
  exit 1
fi

NODE_MAJOR=$(node -p "Number(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 24 ]; then
  echo "当前 Node.js 版本为 $(node --version)，本项目需要 Node.js 24 或更高版本。"
  exit 1
fi

if [ ! -f .env ]; then
  umask 077
  {
    echo "ADMIN_PASSWORD=admin123456"
    echo "HOST=127.0.0.1"
    echo "PORT=3000"
    echo "DATA_DIR=./data"
    echo "BACKUP_DIR=./backups"
    echo "COOKIE_SECURE=false"
  } > .env
  echo "已创建本地配置 .env"
fi

INSTALL_STAMP=node_modules/.schedule-install-stamp
if [ ! -d node_modules ] || [ ! -f "$INSTALL_STAMP" ] || [ package-lock.json -nt "$INSTALL_STAMP" ]; then
  echo "正在安装项目依赖……"
  npm ci
  touch "$INSTALL_STAMP"
fi

echo ""
echo "护士排班系统即将启动："
echo "  地址：http://localhost:3000"
echo "  账号：admin"
echo "  首次本地密码：admin123456"
echo ""
echo "按 Ctrl+C 停止服务。"
echo ""

exec npm run dev
