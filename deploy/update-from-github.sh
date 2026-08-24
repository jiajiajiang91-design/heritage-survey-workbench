#!/usr/bin/env bash
set -euo pipefail

# 在没有 .git 目录的展示服务器上更新发布内容。
# 用法：bash deploy/update-from-github.sh codex/professional-workbench-rebuild

BRANCH="${1:-main}"
APP_DIR="/opt/gujian/app"
ARCHIVE_URL="https://codeload.github.com/jiajiajiang91-design/heritage-survey-workbench/tar.gz/refs/heads/${BRANCH}"
RELEASE_DIR="$(mktemp -d /tmp/gujian-release.XXXXXX)"
ARCHIVE_PATH="$RELEASE_DIR/source.tar.gz"
SOURCE_DIR="$RELEASE_DIR/source"

cleanup() {
  rm -rf -- "$RELEASE_DIR"
}
trap cleanup EXIT

if [[ "$APP_DIR" != "/opt/gujian/app" || ! -d "$APP_DIR" ]]; then
  echo "部署目录不符合预期：$APP_DIR" >&2
  exit 1
fi

mkdir -p "$SOURCE_DIR"
curl --http1.1 --fail --location --silent --show-error \
  --connect-timeout 15 --max-time 600 \
  --retry 5 --retry-delay 3 --retry-all-errors \
  --speed-time 30 --speed-limit 1024 \
  --output "$ARCHIVE_PATH" "$ARCHIVE_URL"
tar -tzf "$ARCHIVE_PATH" >/dev/null
tar -xzf "$ARCHIVE_PATH" --strip-components=1 -C "$SOURCE_DIR"

rsync -a --delete \
  --exclude .git \
  --exclude node_modules \
  --exclude .venv \
  --exclude apps/server/.data \
  "$SOURCE_DIR/" "$APP_DIR/"

chown -R gujian:gujian "$APP_DIR"
sudo -u gujian env HOME=/home/gujian PATH=/usr/local/bin:/usr/bin:/bin \
  bash -c "cd '$APP_DIR' && pnpm install --frozen-lockfile && pnpm run build"

cp "$APP_DIR/deploy/nginx-heritage.conf" /etc/nginx/conf.d/heritage.conf
nginx -t
systemctl restart gujian-server
systemctl reload nginx

echo "部署完成：$BRANCH"
