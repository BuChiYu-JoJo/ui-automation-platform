import { test, expect } from "@playwright/test";
// 示例 spec（example.com 标题检查），无真实凭证/站点依赖业务数据。
test("example.com has title", async ({ page }) => {
  await page.goto("https://example.com/");
  await expect(page).toHaveTitle(/Example Domain/);
});
