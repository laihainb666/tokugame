#!/bin/sh
# NEXUS FIGHT — C 内核构建脚本 (Linux / macOS / MSYS2 / WSL)
set -e
cd "$(dirname "$0")"

CC_BIN="${CC:-}"
if [ -z "$CC_BIN" ]; then
  for c in cc gcc clang tcc; do
    if command -v "$c" >/dev/null 2>&1; then CC_BIN="$c"; break; fi
  done
fi

if [ -z "$CC_BIN" ]; then
  echo "没找到 C 编译器。装一个 gcc / clang / tcc 后重试。" >&2
  exit 1
fi

echo "[$CC_BIN] 编译 nexus.c ..."
"$CC_BIN" -O2 -std=c99 -Wall -Wextra nexus.c -o nexus

echo "编译完成。运行："
echo "  ./nexus 900 12345"
echo ""
echo "期望："
echo "  hash@60=AD80AAA9"
echo "  FINAL_HASH=280F7260"
echo ""
echo "=== 实际输出 ==="
./nexus 900 12345 --quiet
