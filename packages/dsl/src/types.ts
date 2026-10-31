/** DSL 类型定义 —— 见 docs/dsl-spec.md。步骤即数据，可序列化/版本化/多地域下发。 */
export type LocatorStrategy = "testid" | "role" | "label" | "text" | "css" | "xpath";
/** 定位优先级（强制引导顺序）: testid > role > label > text > css > xpath */
export const LOCATOR_PRIORITY: LocatorStrategy[] = ["testid","role","label","text","css","xpath"];
export interface Locator { strategy: LocatorStrategy; value: string; name?: string; fallback?: Locator[]; }
export type ActionType =
  | "goto" | "click" | "fill" | "press" | "select" | "check" | "uncheck" | "hover"
  | "wait_for_selector" | "wait_for_url" | "wait_timeout"
  | "assert_visible" | "assert_text" | "assert_value" | "assert_url" | "assert_api_status"
  | "screenshot" | "api_request" | "set_variable" | "run_case" | "eval_js"
  | "login_preset";
export const DSL_ACTIONS: ActionType[] = [
  "goto","click","fill","press","select","check","uncheck","hover",
  "wait_for_selector","wait_for_url","wait_timeout",
  "assert_visible","assert_text","assert_value","assert_url","assert_api_status",
  "screenshot","api_request","set_variable","run_case","eval_js","login_preset"];
export interface DslStep {
  id: string;
  type: ActionType;
  locator?: Locator;
  /** 值模板支持 {{var}}、{{$timestamp}}、{{$random}}；login_preset 时 value = 预设名（缺省用用例级 loginPreset） */
  value?: string;
  url?: string;
  method?: string;
  expected?: string | number;
  variable?: string;
  caseRef?: string;        // run_case 子流程
  timeoutMs?: number;
  optional?: boolean;
  screenshotOnFail?: boolean;
  comment?: string;
}
export interface DslCase {
  dslVersion: "1";
  name: string;
  /** 登录预设名，对应 项目×环境×角色 的 storageState，普通用例不接触密码 */
  loginPreset?: string;
  variables?: Record<string, string>;
  steps: DslStep[];
}
