/** JSON Schema 导出（供前端编辑器/外部工具校验），与 zod schema 保持同源语义。 */
export const dslCaseJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "DslCase", type: "object", required: ["dslVersion","name","steps"],
  properties: {
    dslVersion: { const: "1" }, name: { type: "string", minLength: 1 },
    loginPreset: { type: "string" }, variables: { type: "object", additionalProperties: { type: "string" } },
    steps: { type: "array", minItems: 1, items: { $ref: "#/definitions/step" } },
  },
  definitions: {
    locator: { type: "object", required: ["strategy","value"], properties: {
      strategy: { enum: ["testid","role","label","text","css","xpath"] }, value: { type: "string" }, name: { type: "string" } } },
    step: { type: "object", required: ["id","type"], properties: {
      id: { type: "string" }, type: { type: "string" }, locator: { $ref: "#/definitions/locator" },
      value: { type: "string" }, url: { type: "string" }, timeoutMs: { type: "number", maximum: 120000 } } },
  },
} as const;
