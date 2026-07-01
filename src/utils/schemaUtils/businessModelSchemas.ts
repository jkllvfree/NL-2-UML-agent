import * as fs from "fs";
import * as path from "path";

type JsonSchema = Record<string, any>;

export type BusinessModelSchemaName = "class" | "sequence";
export type PimSchemaName = "pim_class" | "pim_sequence";
export type PsmSchemaName = "psm_class" | "psm_sequence";

const schemaFileByName: Record<BusinessModelSchemaName | PimSchemaName | PsmSchemaName, string> = {
  class: "business_model_class.schema.json",
  sequence: "business_model_sequence.schema.json",
  pim_class: "pim_class.schema.json",
  pim_sequence: "pim_sequence.schema.json",
  psm_class: "psm_class.schema.json",
  psm_sequence: "psm_sequence.schema.json",
};

const schemaCache = new Map<string, JsonSchema>();

export const getSchemaPath = (name: BusinessModelSchemaName | PimSchemaName | PsmSchemaName): string => {
  return path.join(process.cwd(), "schemas", schemaFileByName[name]);
};

export const readSchema = (name: BusinessModelSchemaName | PimSchemaName | PsmSchemaName): JsonSchema => {
  const cached = schemaCache.get(name);
  if (cached) {
    return cached;
  }

  const schemaPath = getSchemaPath(name);
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`schema 文件不存在: ${schemaPath}`);
  }

  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8")) as JsonSchema;
  schemaCache.set(name, schema);
  return schema;
};

export const readSchemaText = (name: BusinessModelSchemaName | PimSchemaName | PsmSchemaName): string => {
  return JSON.stringify(readSchema(name), null, 2);
};

// 向后兼容别名
export const getBusinessModelSchemaPath = getSchemaPath;
export const readBusinessModelSchema = readSchema;
export const readBusinessModelSchemaText = readSchemaText;

export const validateBusinessModelSchema = (
  name: BusinessModelSchemaName,
  value: unknown
): void => {
  validateSchema(name, value);
};

export const validatePimSchema = (
  name: PimSchemaName,
  value: unknown
): void => {
  validateSchema(name, value);
};

export const validatePsmSchema = (
  name: PsmSchemaName,
  value: unknown
): void => {
  validateSchema(name, value);
};

const validateSchema = (
  name: BusinessModelSchemaName | PimSchemaName | PsmSchemaName,
  value: unknown
): void => {
  const schema = readSchema(name);
  const errors: string[] = [];
  validateValue(value, schema, "$", schema, errors);

  if (errors.length > 0) {
    const detail = errors.slice(0, 20).join("\n");
    const suffix = errors.length > 20 ? `\n... 还有 ${errors.length - 20} 个错误` : "";
    throw new Error(`Schema ${name} 校验失败:\n${detail}${suffix}`);
  }
};

const validateValue = (
  value: unknown,
  schema: JsonSchema,
  dataPath: string,
  rootSchema: JsonSchema,
  errors: string[]
): void => {
  if (schema.$ref) {
    validateValue(value, resolveRef(rootSchema, schema.$ref), dataPath, rootSchema, errors);
    return;
  }

  if (schema.allOf) {
    for (const item of schema.allOf) {
      validateConditional(value, item, dataPath, rootSchema, errors);
    }
  }

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${dataPath}: 应为常量 ${JSON.stringify(schema.const)}`);
    return;
  }

  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    errors.push(`${dataPath}: 类型不匹配，期望 ${JSON.stringify(schema.type)}，实际 ${describeType(value)}`);
    return;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${dataPath}: 枚举值不合法，实际 ${JSON.stringify(value)}，允许 ${schema.enum.join(" | ")}`);
    return;
  }

  if (schema.type === "object" || (schema.properties && isPlainObject(value))) {
    validateObject(value, schema, dataPath, rootSchema, errors);
  }

  if (schema.type === "array" || Array.isArray(value)) {
    validateArray(value, schema, dataPath, rootSchema, errors);
  }
};

const validateConditional = (
  value: unknown,
  schema: JsonSchema,
  dataPath: string,
  rootSchema: JsonSchema,
  errors: string[]
): void => {
  if (!schema.if || !schema.then) {
    validateValue(value, schema, dataPath, rootSchema, errors);
    return;
  }

  const conditionErrors: string[] = [];
  validateValue(value, schema.if, dataPath, rootSchema, conditionErrors);
  if (conditionErrors.length === 0) {
    validateValue(value, schema.then, dataPath, rootSchema, errors);
  }
};

const validateObject = (
  value: unknown,
  schema: JsonSchema,
  dataPath: string,
  rootSchema: JsonSchema,
  errors: string[]
): void => {
  if (!isPlainObject(value)) {
    return;
  }

  for (const key of schema.required || []) {
    if (!(key in value)) {
      errors.push(`${dataPath}: 缺少必填字段 ${key}`);
    }
  }

  const properties = schema.properties || {};
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!(key in properties)) {
        errors.push(`${dataPath}.${key}: schema 不允许该字段`);
      }
    }
  }

  for (const [key, childSchema] of Object.entries(properties)) {
    if (key in value) {
      validateValue(value[key], childSchema as JsonSchema, `${dataPath}.${key}`, rootSchema, errors);
    }
  }
};

const validateArray = (
  value: unknown,
  schema: JsonSchema,
  dataPath: string,
  rootSchema: JsonSchema,
  errors: string[]
): void => {
  if (!Array.isArray(value) || !schema.items) {
    return;
  }

  value.forEach((item, index) => {
    validateValue(item, schema.items, `${dataPath}[${index}]`, rootSchema, errors);
  });
};

const matchesType = (value: unknown, type: string | string[]): boolean => {
  if (Array.isArray(type)) {
    return type.some(t => matchesType(value, t));
  }

  switch (type) {
    case "array":
      return Array.isArray(value);
    case "object":
      return isPlainObject(value);
    case "null":
      return value === null;
    case "integer":
      return Number.isInteger(value);
    default:
      return typeof value === type;
  }
};

const describeType = (value: unknown): string => {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
};

const isPlainObject = (value: unknown): value is Record<string, any> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const resolveRef = (rootSchema: JsonSchema, ref: string): JsonSchema => {
  if (!ref.startsWith("#/")) {
    throw new Error(`不支持的 schema $ref: ${ref}`);
  }

  return ref
    .slice(2)
    .split("/")
    .reduce((current: any, segment) => current?.[segment], rootSchema);
};
