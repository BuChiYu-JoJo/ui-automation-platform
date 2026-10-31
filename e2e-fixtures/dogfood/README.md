# Dogfooding 套件：拿平台监控你自己的 3 条真实旅程

目标（MVP 的 Definition of Done）：用本平台真实监控 3–5 条生产旅程、连续观察一周，
把每一次告警按真/假逐条记录（模板见 `observation-log.md`），用数据决定 V1 先做
flaky 自动隔离还是告警升级链。这里的 3 个模板覆盖最常见的三类旅程，改完就能用。

## 通用准备（每条旅程都要做一次）

1. 建项目与环境（管理台或 API）：环境的 `baseUrl` 填被监控站点的根地址
   （如 `https://console.example.com`）——三个模板里的 `goto url` 都是相对路径，
   运行时基于这个 baseUrl 解析，所以模板里不用改域名。
2. 给页面元素准备 `data-testid`：模板里的 testid 都是占位值（`home-hero` 等），
   换成你站点真实的 `data-testid`。没有 testid 的老页面先推动前端补；
   临时兜底可把 locator 的 `strategy` 改成 `role` / `label` / `text` / `css`
   （优先级 testid > role > label > text > css，css/xpath 与 DOM 结构耦合、最易碎，只当临时方案）。
3. 每个模板末尾都有 `screenshot` 步骤：失败排查时先看截图再看日志，这是刻意留的。

## 模板 1：首页可用性（01-homepage-availability.json）

- 改什么：`home-hero` → 首页关键区块（主标题/主横幅）的 testid；
  `variables.siteName` → 该区块里稳定的文案（主标题最好，别用活动文案，会频繁变）。
- 要建的变量/账号：无（公开页）。
- 为什么这样写：只断 200 会被错误页/白屏骗过，所以必须断言关键元素可见 + 文案。

## 模板 2：登录态受保护页（02-login-preset-protected.json）

- 改什么：`/dashboard` → 登录后落地的受保护页路径；`user-menu` / `welcome-banner` → testid；
  `variables.welcomeText` → 欢迎区稳定文案。
- 要建的变量/账号：
  - 一个**监控专用账号**（低权限、只读优先），不要用个人账号。
  - 先用这个账号真实登录一次，把 Playwright 的 storageState 存为**角色名 `admin` 的预设**：
    `POST /api/environments/:envId/storage-state`，body `{ "role": "admin", "state": <storageState JSON> }`。
    预设在平台侧信封加密落盘，用例只引用角色名、永远不接触密码（口径见 docs/decisions.md Week 3 条）。
  - storageState 默认 7 天过期：过期时 `login_preset` 步骤会明确报错提醒刷新，
    按同一接口重存一次即可。先在日历上给自己记一个每周刷新的提醒。
- 为什么不直接在用例里填密码：监控用例会被多人查看/复用，密码进用例等于扩散；
  登录态注入还能避开验证码/2FA（在登录那一次人工完成即可）。

## 模板 3：搜索/列表流程（03-search-list-flow.json）

- 改什么：`/search` → 搜索页路径；三个 testid 换真实值；
  `variables.searchKeyword` → 一个**长期必然有结果**的关键词（自家产品名、固定栏目名），
  别用热点词（结果会消失，制造假失败）。
- 要建的变量/账号：无（若搜索在登录后，把模板 2 的 `login_preset` 步骤抄到第一步，
  并给用例加同名 `loginPreset` 字段）。
- 注意：断言特意写在结果**容器**上（包含关键词），而不是只看第一条结果——
  空结果页也是 200 + 容器存在，必须靠文案断言把「无结果」和「有结果」分开。

## 推荐的计划设置（三条旅程统一）

建用例后，为每条旅程建一个计划（Plan）+ 一条计划级告警规则：

| 配置 | 值 | 理由 |
|---|---|---|
| cron | `*/5 * * * *`（5 分钟） | 旅程级监控的务实粒度；更密只涨成本不涨可信度 |
| timezone | `Asia/Shanghai` | 与团队作息对齐，维护窗口好算 |
| failThreshold | `3` | 连续失败 3 次（约 15 分钟）才 down 开单，单次抖动不打扰 |
| concurrencyPolicy | `skip` | 上一轮没跑完就跳过本轮，防慢旅程堆积 |
| regions | 先留空（单地域） | 本地单机先跑通；有多地域 Worker 后再开 quorum |
| 告警规则 | scope=plan，通道选飞书或企微（一组先行） | webhook 地址按密钥处理（平台加密落库、回显掩码）；先用平台的 test-send 验通再启用 |
| 维护窗口 | 把你已知的发布时间段建成窗口 | 窗口内照常执行记录、但不告警不开单（Week 3 口径） |

## 一周观察期怎么做

1. 三条计划同时启用，跑满 7 天，不要中途改阈值（要改，记到观察日志的备注里）。
2. 每收到一条 opened / recovered 通知，当天在 `observation-log.md` 记一行：
   真故障还是误报、原因归类（被测真故障 / 选择器失效 / 测试数据问题 / 网络抖动 /
   平台自身 infra / 维护窗口没覆盖到的发布）。
3. 一周后看两个数：**误报率**（误报 opened / 总 opened）和 **漏报**（人工发现的故障平台没报）。
   误报率 > 30% 先治 flaky 与定位稳定性（对应 V1 的 flaky 自动隔离）；
   漏报多先查阈值与旅程覆盖（对应计划粒度/阈值调整）。把结论回填 docs/PROGRESS.md 的 Week 4 章节。
