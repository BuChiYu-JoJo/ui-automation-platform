#!/usr/bin/env bash
# smoke-local.sh —— jojo 本机一键验收（在有正常网络/浏览器的机器上跑）
# 逐步执行、每步打印 PASS/FAIL、失败不中断，最后汇总。退出码 = 失败步数（0 = 全过；SKIP 不算失败）。
# 对应 docs/ACCEPTANCE.md 的人工清单；每步 FAIL 时打印的提示与 docs/PROGRESS.md 的已知阻塞一一对应。
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0; SKIP=0
FAILED_STEPS=""

run_step() {
  local name="$1" hint="$2"; shift 2
  echo ""
  echo "==> $name"
  echo "    \$ $*"
  if "$@"; then
    echo "[PASS] $name"
    PASS=$((PASS + 1))
  else
    echo "[FAIL] $name"
    echo "    提示: $hint"
    FAIL=$((FAIL + 1))
    FAILED_STEPS="$FAILED_STEPS $name"
  fi
}

echo "UIP 本机验收开始：$(pwd)"

run_step "1. pnpm install（完整，含 postinstall 脚本）" \
  "Prisma 引擎/浏览器等二进制都在这步下载。若 ECONNRESET/超时：换网络或开代理后重跑本脚本；公司网可能拦截 binaries.prisma.sh / cdn.playwright.dev。不要加 --ignore-scripts（那会跳过引擎下载，validate 必然失败）。" \
  pnpm install

run_step "2. prisma validate" \
  "若在下载引擎时 ECONNRESET/aborted：即 PROGRESS 阻塞 #1，网络恢复后重跑。若是 schema 语法错误：按报错行号改 apps/api/prisma/schema.prisma（Week 2/3 的新表 monitor_state/worker_node/group_verdict 都在里面）。" \
  pnpm --filter @uip/api exec prisma validate

run_step "3. prisma generate" \
  "generate 失败多为引擎未就绪（先修上一步）或 schema 未通过 validate。通過後记得切 UIP_REPOSITORY=prisma 再重跑 HTTP 冒烟（见 ACCEPTANCE.md）。" \
  pnpm --filter @uip/api exec prisma generate

run_step "4. 全仓构建（pnpm -r run build）" \
  "构建失败先看是哪个包：api/web 的类型错误按 tsc 报错定位；packages/* 失败会影响依赖它的包，先修最底层的 dsl/shared。" \
  pnpm -r run build

run_step "5. 全仓测试（pnpm -r run test）" \
  "测试失败不要跳过：把失败测试名和断言抄进 PROGRESS 对应周章节。已知基线（Week 4 后）：api 35 + worker 9 + dsl 3 + shared 2 = 49 条全过。" \
  pnpm -r run test

run_step "6. 安装 Playwright Chromium（worker）" \
  "即 PROGRESS 阻塞 #2 的解法。下载超时：检查到 cdn.playwright.dev 的网络；Linux 缺系统库时改跑 pnpm --filter @uip/worker exec playwright install --with-deps chromium（需要 sudo）。已有系统 Chrome 时可跳过本步、改设 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH。" \
  pnpm --filter @uip/worker exec playwright install chromium

run_step "7. 端到端演示（pnpm demo:e2e，期望退出码 0 + status=passed）" \
  "退出码 2 = 浏览器不可用（先修上一步）；退出码 1 = 真失败，看脚本打印的 step 结果与 artifacts/ 下的截图定位。服务层打印若先挂，多为 MASTER_KEY_B64 未设置或格式不对（32 字节 base64）。" \
  pnpm demo:e2e

# 8. docker compose 语法校验：没装 Docker 不是失败，记 SKIP
echo ""
echo "==> 8. docker compose config（仅校验，不启动）"
if command -v docker >/dev/null 2>&1; then
  if docker compose -f deploy/docker-compose.yml config -q; then
    echo "[PASS] 8. docker compose config"
    PASS=$((PASS + 1))
  else
    echo "[FAIL] 8. docker compose config"
    echo "    提示: 先 cp .env.example .env 并把占位密码/MASTER_KEY_B64 换掉；compose 里 POSTGRES_PASSWORD / MINIO_ROOT_PASSWORD 为空会直接报错。"
    FAIL=$((FAIL + 1))
    FAILED_STEPS="$FAILED_STEPS docker-compose-config"
  fi
else
  echo "[SKIP] 未检测到 docker 命令（PROGRESS 阻塞 #3 在本机不适用——装了 Docker 再跑即可验全栈）"
  SKIP=$((SKIP + 1))
fi

echo ""
echo "================ 验收汇总 ================"
echo "PASS: $PASS  FAIL: $FAIL  SKIP: $SKIP"
if [ "$FAIL" -gt 0 ]; then
  echo "失败步骤:$FAILED_STEPS"
  echo "把本汇总与失败步骤的输出回填 docs/PROGRESS.md 的 Week 4 章节。"
fi
exit "$FAIL"
