import { defineConfig } from "@playwright/test";
// 代码轨约定：spec 目录由 API 层从 Git 同步到此结构，Worker 以 --reporter=json 运行并解析输出。
export default defineConfig({ testDir: "./specs", reporter: "json",
  use: { headless: true, screenshot: "only-on-failure", trace: "retain-on-failure" } });
