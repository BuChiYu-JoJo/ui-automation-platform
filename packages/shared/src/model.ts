/** 双轨统一执行模型：DSL 轨解释器 与 代码轨 reporter 解析器 都产出这套结构，报表/告警只认它。 */
export type ExecutionStatus = "queued"|"running"|"passed"|"failed"|"flaky"|"infra_failed"|"timeout"|"cancelled";
export type StepStatus = "passed"|"failed"|"skipped"|"flaky";
export type TrackType = "dsl" | "code";
export interface UnifiedStepResult {
  stepNo: number; name: string; stepType: string; status: StepStatus;
  durationMs: number; errorMessage?: string; locatorHealed?: boolean;
  screenshotArtifactKey?: string;
}
export interface UnifiedExecution {
  executionId: string; track: TrackType; caseName: string;
  status: ExecutionStatus; durationMs: number;
  steps: UnifiedStepResult[];
  artifacts: { kind: "screenshot"|"video"|"trace"|"har"|"log"; s3Key: string }[];
}
