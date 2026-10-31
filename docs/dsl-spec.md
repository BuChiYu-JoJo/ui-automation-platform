# DSL 规范 v1（@uip/dsl）

步骤即数据：`{ id, type, locator?, value?, url?, expected?, variable?, caseRef?, timeoutMs?, optional?, screenshotOnFail? }`，
用例：`{ dslVersion: "1", name, loginPreset?, variables?, steps[] }`。校验：zod schema（packages/dsl/src/schema.ts）+ JSON Schema 导出。

## 动作清单（MVP）

goto / click / fill / press / select / check / uncheck / hover /
wait_for_selector / wait_for_url / wait_timeout（上限 30s，校验层拦截滥用）/
assert_visible / assert_text / assert_value / assert_url / assert_api_status /
screenshot / api_request / set_variable / run_case（骨架未实现，明确报错，V1 落地）/ eval_js（默认关闭，需项目级授权 ALLOW_EVAL_JS）/
login_preset（Week 3 新增：把命名登录预设的 storageState 注入当前 context，见下节）

## 定位策略

优先级 testid > role > label > text > css > xpath。locator 可带 fallback 列表：主定位不可见时按序试次选，
命中次选在 step_result 打 locator_healed 标记计入健康分 —— 只做多候选 + 离线建议，不做运行时静默自愈（防假通过）。

## 变量与登录态

- 模板：`{{var}}`、`{{$timestamp}}`、`{{$random}}`（数据唯一化防并行撞车）。
- 变量分层：平台 < 项目 < 环境 < 计划 < 单次执行；密钥信封加密、仅 Worker 内存解密、日志脱敏。
- 登录：loginPreset 按 项目×环境×角色 引用加密 storageState，普通用例不接触密码；storageState 按凭证同级保护。
- `login_preset` 步骤（Week 3）：步骤 `value` = 预设名（角色），缺省时取用例级 `loginPreset`。Worker 执行时把该预设的 storageState 注入当前 context（cookies 经 addCookies、localStorage 按 origin 注入）。预设缺失或超过 TTL（默认 7 天）时步骤**明确失败并提示刷新预设**，不静默裸跑；预设的保存/新鲜度判定在 API 侧 `StorageStateService.ensureStorageState`（fresh/expired/missing），state 文件信封加密落盘。另一种注入路径：执行快照带 storageStatePath 时，浏览器池在建 context 时直接带登录态（适合整条旅程都需要登录态的情形），`login_preset` 步骤适合旅程中途才需要切换/补登录态的情形。
