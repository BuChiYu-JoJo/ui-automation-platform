import type { Page, Locator } from "playwright";
import type { Locator as DslLocator } from "@uip/dsl";
/** 定位解析：DSL 的 locator 策略 -> Playwright Locator。
 *  优先级 testid > role > label > text > css（xpath 最后兜底）。fallback 命中时打 healed 标记，不静默自愈。 */
export function resolveLocator(page: Page, loc: DslLocator): Locator {
  switch (loc.strategy) {
    case "testid": return page.getByTestId(loc.value);
    case "role": return page.getByRole(loc.value as any, loc.name ? { name: loc.name } : undefined);
    case "label": return page.getByLabel(loc.value);
    case "text": return page.getByText(loc.value);
    case "css": return page.locator(loc.value);
    case "xpath": return page.locator(`xpath=${loc.value}`);
  }
}
/** 按 主->fallback 顺序找第一个可见的；返回命中的是否为 fallback。 */
export async function resolveWithFallback(page: Page, loc: DslLocator)
  : Promise<{ locator: Locator; healed: boolean }> {
  const candidates = [loc, ...(loc.fallback ?? [])];
  for (let i = 0; i < candidates.length; i++) {
    const l = resolveLocator(page, candidates[i]);
    if (await l.first().isVisible().catch(() => false)) return { locator: l, healed: i > 0 };
  }
  return { locator: resolveLocator(page, loc), healed: false }; // 交给动作本身报错，错误信息完整
}
