#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Touchpad Tracker 构建脚本
# ============================================================
# 功能：
#   1. 自动设置国内镜像加速下载
#   2. 处理企业网络 SSL 证书问题
#   3. 支持代理服务器配置
#   4. 缓存复用，避免重复下载 Electron 二进制
#
# 用法：
#   ./scripts/build.sh                           # 默认构建（国内镜像，不走代理）
#   ./scripts/build.sh --mac                     # 仅 macOS
#   ./scripts/build.sh --proxy 127.0.0.1:7897   # 使用代理
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# ---- 设置镜像 ----
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"

# ---- 使用 npm 镜像 registry ----
export npm_config_registry="https://registry.npmmirror.com/"

# ---- 默认启用（解决企业网络/防火墙 SSL 证书校验失败） ----
export NODE_TLS_REJECT_UNAUTHORIZED=0

# ---- 解析命令行参数 ----
MAKE_ARGS=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --proxy)
            export https_proxy="$2"
            export http_proxy="$2"
            echo "🌐 使用代理: $2"
            shift 2
            ;;
        --mac)
            MAKE_ARGS="--platform darwin"
            shift
            ;;
        --win)
            MAKE_ARGS="--platform win32"
            shift
            ;;
        --linux)
            MAKE_ARGS="--platform linux"
            shift
            ;;
        --no-ssl-check)
            export NODE_TLS_REJECT_UNAUTHORIZED=0
            shift
            ;;
        *)
            echo "未知参数: $1"
            echo "用法: $0 [--proxy URL] [--mac|--win|--linux] [--no-ssl-check]"
            exit 1
            ;;
    esac
done

echo "============================================"
echo "  Touchpad Tracker 构建"
echo "============================================"
echo "Electron 镜像:  $ELECTRON_MIRROR"
echo "npm registry:   $npm_config_registry"
echo "代理:           ${https_proxy:-无}"
echo "SSL 校验:       $([ "$NODE_TLS_REJECT_UNAUTHORIZED" = "0" ] && echo '已跳过' || echo '已启用')"
echo "平台:           ${MAKE_ARGS:---platform all}"
echo "============================================"
echo ""

# 确保依赖已安装
if [[ ! -d "node_modules" ]]; then
    echo "📦 安装依赖..."
    npm install
fi

# 执行构建
echo "🔨 开始打包..."
npm run make -- $MAKE_ARGS 2>&1 | tee build.log

echo ""
echo "✅ 构建完成！"
echo "产物目录: $(pwd)/out/make/"
ls -lh out/make/ 2>/dev/null || echo "（无产物或路径不同，请检查 out/ 目录）"
