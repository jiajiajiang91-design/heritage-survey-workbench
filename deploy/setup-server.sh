#!/usr/bin/env bash
# 服务器初装脚本（OpenCloudOS / RHEL 系，腾讯云上海轻量 4C4G 实测目标）。
# 以 root 运行一次；重复运行安全。下载源全部用国内镜像，不依赖境外网络。
set -euo pipefail

NODE_VERSION=v24.13.1
APP_DIR=/opt/gujian/app
REPO_URL="${GUJIAN_REPO_URL:-https://gitee.com/mirrors_placeholder/heritage-survey-workbench.git}"

echo "== 1/7 系统依赖（nginx、git、python3.11、编译工具）"
dnf install -y nginx git python3.11 python3.11-devel gcc-c++ make tar xz

echo "== 2/7 Node ${NODE_VERSION}（npmmirror 二进制）"
if [ ! -x /usr/local/node/bin/node ]; then
  curl -fL "https://registry.npmmirror.com/-/binary/node/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz" -o /tmp/node.tar.xz
  mkdir -p /usr/local/node
  tar -xJf /tmp/node.tar.xz -C /usr/local/node --strip-components=1
  ln -sf /usr/local/node/bin/node /usr/local/bin/node
  ln -sf /usr/local/node/bin/npm /usr/local/bin/npm
  ln -sf /usr/local/node/bin/corepack /usr/local/bin/corepack
fi
node --version

echo "== 3/7 pnpm（corepack，npmmirror 注册表）"
corepack enable pnpm || true
npm config set registry https://registry.npmmirror.com

echo "== 4/7 运行账号与目录"
id gujian >/dev/null 2>&1 || useradd --system --create-home gujian
mkdir -p "${APP_DIR}" /etc/gujian /etc/nginx/certs
chown -R gujian:gujian /opt/gujian

echo "== 5/7 代码（仓库拉取；本地 rsync 部署时跳过）"
if [ ! -d "${APP_DIR}/.git" ] && [ "${GUJIAN_SKIP_CLONE:-0}" != "1" ]; then
  sudo -u gujian git clone "${REPO_URL}" "${APP_DIR}"
fi

echo "== 6/7 构建（前端 + 服务端）与 Python CAD 环境"
cd "${APP_DIR}"
sudo -u gujian bash -lc "cd ${APP_DIR} && pnpm config set registry https://registry.npmmirror.com && pnpm install --frozen-lockfile && pnpm run build"
if [ ! -x "${APP_DIR}/workers/cad/.venv/bin/python" ]; then
  sudo -u gujian python3.11 -m venv "${APP_DIR}/workers/cad/.venv"
fi
sudo -u gujian bash -lc "${APP_DIR}/workers/cad/.venv/bin/pip install -i https://pypi.tuna.tsinghua.edu.cn/simple --upgrade pip"
sudo -u gujian bash -lc "${APP_DIR}/workers/cad/.venv/bin/pip install -i https://pypi.tuna.tsinghua.edu.cn/simple --require-hashes -r ${APP_DIR}/workers/cad/requirements.lock"

echo "== 7/7 服务接线"
cp "${APP_DIR}/deploy/gujian-server.service" /etc/systemd/system/gujian-server.service
cp "${APP_DIR}/deploy/nginx-heritage.conf" /etc/nginx/conf.d/heritage.conf
[ -f /etc/gujian/server.env ] || { cp "${APP_DIR}/deploy/server.env.example" /etc/gujian/server.env; chmod 600 /etc/gujian/server.env; echo "!! 记得编辑 /etc/gujian/server.env 填入 KIMI_API_KEY"; }
systemctl daemon-reload
systemctl enable --now gujian-server
nginx -t && systemctl enable --now nginx && systemctl reload nginx

echo "完成。验收：curl -s http://127.0.0.1:8787/api/status ；证书放好后访问 https://heritage.jiajiajiang.com"
