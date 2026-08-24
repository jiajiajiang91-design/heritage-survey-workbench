#!/usr/bin/env bash
set -euo pipefail

# 在没有 .git 目录的展示服务器上更新发布内容。
# 用法：bash deploy/update-from-github.sh codex/professional-workbench-rebuild

BRANCH="${1:-main}"
APP_DIR="/opt/gujian/app"
ARCHIVE_URL="https://github.com/jiajiajiang91-design/heritage-survey-workbench/archive/refs/heads/${BRANCH}.tar.gz"
RELEASE_DIR="$(mktemp -d /tmp/gujian-release.XXXXXX)"

cleanup() {
  rm -rf -- "$RELEASE_DIR"
}
trap cleanup EXIT

if [[ "$APP_DIR" != "/opt/gujian/app" || ! -d "$APP_DIR" ]]; then
  echo "部署目录不符合预期：$APP_DIR" >&2
  exit 1
fi

curl --fail --location --silent --show-error "$ARCHIVE_URL" \
  | tar -xz --strip-components=1 -C "$RELEASE_DIR"

rsync -a --delete \
  --exclude .git \
  --exclude node_modules \
  --exclude .venv \
  --exclude apps/server/.data \
  "$RELEASE_DIR/" "$APP_DIR/"

chown -R gujian:gujian "$APP_DIR"
sudo -u gujian env HOME=/home/gujian PATH=/usr/local/bin:/usr/bin:/bin \
  bash -c "cd '$APP_DIR' && pnpm install --frozen-lockfile && pnpm run build"

cp "$APP_DIR/deploy/nginx-heritage.conf" /etc/nginx/conf.d/heritage.conf
nginx -t
systemctl restart gujian-server
systemctl reload nginx

echo "部署完成：$BRANCH"
