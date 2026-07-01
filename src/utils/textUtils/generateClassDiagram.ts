import * as fs from "fs";
import * as path from "path";
import { generateClassDiagramUserPrompt } from "../promptUtils/prompt.js";
import { callClassDiagramLLM, repairBusinessModelJson } from "../utils.js";
import type { ModuleTree, ModuleTreeNode, LeafModel } from "../../types/diagram.js";
import { validateBusinessModelSchema } from "../schemaUtils/businessModelSchemas.js";
import { convertClassJsonToPuml, writePumlFile } from "../pumlUtils/convertToPuml.js";

const MAX_SCHEMA_REPAIR_RETRIES = 5;

export type ModuleProgressPayload = {
  phase: "class_diagram";
  moduleId: string;
  moduleName: string;
  status: "start" | "success" | "error";
  message: string;
  error?: string;
  completed?: number;
  total?: number;
};

// 读取模块树文件
export const readModuleTree = (moduleTreePath?: string): ModuleTree => {
  const filePath = moduleTreePath || path.join(process.cwd(), "design_model", "module_tree.json");

  if (!fs.existsSync(filePath)) {
    throw new Error(`模块树文件不存在: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  console.log(`已读取模块树: ${filePath}`);
  return JSON.parse(content);
};

// 读取叶子模块的需求文档
export const readLeafRequirement = (moduleDir: string): string => {
  const requirementPath = path.join(moduleDir, "requirement.md");

  if (!fs.existsSync(requirementPath)) {
    throw new Error(`需求文档不存在: ${requirementPath}`);
  }

  return fs.readFileSync(requirementPath, "utf-8");
};

// 写入类图 JSON 到 business_model_class.json
export const writeClassView = (
  moduleDir: string,
  classDiagram: LeafModel
): string => {
  validateBusinessModelSchema("class", classDiagram);

  const classViewPath = path.join(moduleDir, "design", "business_model_class.json");

  // 确保目录存在
  const designDir = path.dirname(classViewPath);
  if (!fs.existsSync(designDir)) {
    fs.mkdirSync(designDir, { recursive: true });
  }

  fs.writeFileSync(classViewPath, JSON.stringify(classDiagram, null, 2), "utf-8");
  console.log(`已写入: ${classViewPath}`);

  const pumlContent = convertClassJsonToPuml(classDiagram);
  writePumlFile(designDir, "business_model_class.puml", pumlContent);

  return classViewPath;
};

const normalizeClassDiagram = (classDiagram: LeafModel, moduleId: string): LeafModel => {
  const normalized = classDiagram as any;
  delete normalized.relations;

  normalized.description = (normalized.description || "").toString();
  normalized.classifiers = Array.isArray(normalized.classifiers) ? normalized.classifiers : [];

  for (const cls of normalized.classifiers) {
    cls.classifier_id = (cls.classifier_id || cryptoSafeId("cls")).toString();
    cls.name = (cls.name || cls.classifier_id).toString();
    cls.kind = normalizeClassifierKind(cls.kind);
    cls.module_id = moduleId;
    cls.stereotype = normalizeStereotype(cls.stereotype, cls.kind);
    cls.businessMeaning = (cls.businessMeaning || cls.description || `${cls.name} 在本模块中的业务对象。`).toString();
    cls.responsibilities = toStringArray(cls.responsibilities, [`承担 ${cls.name} 相关业务职责`]);
    cls.businessRules = toStringArray(cls.businessRules, []);

    delete cls.package;
    delete cls.package_id;
    delete cls.visibility;
    delete cls.isAbstract;
    delete cls.typeParameters;

    cls.attributes = Array.isArray(cls.attributes) ? cls.attributes : [];
    for (const attr of cls.attributes) {
      attr.name = (attr.name || "attribute").toString();
      attr.type = (attr.type || "string").toString();
      delete attr.visibility;
      delete attr.isStatic;
      delete attr.defaultValue;
      delete attr.isDerived;
    }

    cls.operations = Array.isArray(cls.operations) ? cls.operations : [];
    for (const op of cls.operations) {
      op.name = (op.name || "operate").toString();
      op.returnType = op.returnType ?? null;
      op.parameters = Array.isArray(op.parameters) ? op.parameters : [];
      op.businessGoal = (op.businessGoal || `完成 ${op.name} 对应的业务目标`).toString();
      op.preconditions = toStringArray(op.preconditions, []);
      op.postconditions = toStringArray(op.postconditions, []);
      delete op.visibility;
      delete op.isStatic;
      delete op.isAbstract;
      delete op.isConstructor;
      delete op.raisedExceptions;
      delete op.typeParameters;

      for (const param of op.parameters) {
        param.name = (param.name || "param").toString();
        param.type = (param.type || "string").toString();
      }
    }

    cls.dependencies = Array.isArray(cls.dependencies) ? cls.dependencies : [];
    for (const dep of cls.dependencies) {
      dep.target = (dep.target || "").toString();
      dep.kind = normalizeDependencyKind(dep.kind);
      dep.name = dep.name ?? null;
      dep.multiplicityFrom = dep.multiplicityFrom ?? null;
      dep.multiplicityTo = dep.multiplicityTo ?? null;
      dep.businessRelation = dep.businessRelation ?? null;
      delete dep.roleFrom;
      delete dep.roleTo;
      delete dep.navigability;
    }
  }

  return normalized as LeafModel;
};

const toStringArray = (value: unknown, fallback: string[]): string[] => {
  return Array.isArray(value) ? value.map(String) : fallback;
};

const normalizeClassifierKind = (kind: unknown): string => {
  if (["Entity", "ValueObject", "Service", "Enum"].includes(String(kind))) {
    return String(kind);
  }
  if (String(kind) === "Enumeration") {
    return "Enum";
  }
  return "Entity";
};

const normalizeStereotype = (stereotype: unknown, kind: string): string => {
  if (["Entity", "ValueObject", "AggregateRoot", "DomainService", "Repository", "Policy", "Event"].includes(String(stereotype))) {
    return String(stereotype);
  }
  return kind === "Service" ? "DomainService" : kind === "Enum" ? "ValueObject" : kind;
};

const normalizeDependencyKind = (kind: unknown): string => {
  const value = String(kind);
  if (["generalization", "realization", "association", "aggregation", "composition", "dependency"].includes(value)) {
    return value;
  }
  return "association";
};

const cryptoSafeId = (prefix: string): string => {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const generateValidatedClassDiagram = async (
  userPrompt: string,
  moduleId: string,
  moduleName: string
): Promise<LeafModel> => {
  let candidate = normalizeClassDiagram(await callClassDiagramLLM(userPrompt), moduleId);

  for (let attempt = 0; attempt <= MAX_SCHEMA_REPAIR_RETRIES; attempt++) {
    try {
      validateBusinessModelSchema("class", candidate);
      if (attempt > 0) {
        console.log(`模块 ${moduleName} 类图 schema 修复成功，重试次数: ${attempt}`);
      }
      return candidate;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (attempt >= MAX_SCHEMA_REPAIR_RETRIES) {
        throw error;
      }

      console.warn(`模块 ${moduleName} 类图 schema 校验失败，准备第 ${attempt + 1}/${MAX_SCHEMA_REPAIR_RETRIES} 次修复`);
      candidate = normalizeClassDiagram(
        await repairBusinessModelJson<LeafModel>(
          "class",
          JSON.stringify(candidate, null, 2),
          errorMessage,
          `module_id: ${moduleId}\nmodule_name: ${moduleName}`
        ),
        moduleId
      );
    }
  }

  throw new Error(`模块 ${moduleName} 类图 schema 修复流程异常结束`);
};

// 递归获取所有叶子模块
export const getLeafModules = (node: ModuleTreeNode): ModuleTreeNode[] => {
  if (node.is_leaf) {
    return [node];
  }

  const leafModules: ModuleTreeNode[] = [];
  for (const child of node.children || []) {
    leafModules.push(...getLeafModules(child));
  }
  return leafModules;
};

// 解析叶子模块的绝对路径
export const resolveModuleDir = (rootDir: string, node: ModuleTreeNode): string => {
  const modulesDir = path.join(rootDir, "design_model", "modules");
  return path.join(modulesDir, node.full_path || node.directory_name);
};

// 为单个叶子模块生成类图
const generateSingleClassDiagram = async (
  moduleNode: ModuleTreeNode,
  moduleDir: string
): Promise<{ success: boolean; classViewPath?: string; error?: string }> => {
  const { module_id, module_name } = moduleNode;

  console.log(`\n正在处理模块: ${module_name} (${module_id})`);

  try {
    // 1. 读取需求文档
    const requirementContent = readLeafRequirement(moduleDir);
    console.log(`已读取需求文档 (${requirementContent.length} 字符)`);

    // 2. 生成用户提示词
    const userPrompt = generateClassDiagramUserPrompt(
      module_id,
      module_name,
      requirementContent
    );

    // 3. 调用 LLM 生成类图，并在 schema 校验失败时进行有限修复重试
    const classDiagram = await generateValidatedClassDiagram(userPrompt, module_id, module_name);

    // 5. 写入 business_model_class.json
    const classViewPath = writeClassView(moduleDir, classDiagram);

    console.log(`模块 ${module_name} 类图生成完成`);
    return { success: true, classViewPath };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "未知错误";
    console.error(`模块 ${module_name} 类图生成失败: ${errorMessage}`);
    return { success: false, error: errorMessage };
  }
};

// 并行度配置
const MAX_PARALLEL_MODULES = 3;

// 为所有叶子模块生成类图
export const generateAllClassDiagrams = async (
  moduleTreePath?: string,
  rootDir?: string,
  maxParallel?: number,
  onModuleProgress?: (payload: ModuleProgressPayload) => void
): Promise<{
  results: {
    moduleId: string;
    moduleName: string;
    success: boolean;
    classViewPath?: string;
    error?: string;
  }[];
}> => {
  console.log(`开始为所有叶子模块生成类图...`);

  // 1. 读取模块树
  const moduleTree = readModuleTree(moduleTreePath);
  const actualRootDir = rootDir || process.cwd();
  const parallelLimit = maxParallel || MAX_PARALLEL_MODULES;

  // 2. 递归构建叶子模块的路径
  const buildModulePath = (node: ModuleTreeNode, currentPath: string): { node: ModuleTreeNode, fullPath: string }[] => {
    const nodePath = path.join(currentPath, node.directory_name);
    if (node.is_leaf) {
      return [{ node, fullPath: nodePath }];
    }

    let leaves: { node: ModuleTreeNode, fullPath: string }[] = [];
    if (node.children) {
      const childrenPath = path.join(nodePath, "modules");
      for (const child of node.children) {
        leaves.push(...buildModulePath(child, childrenPath));
      }
    }
    return leaves;
  };

  const modulesDir = path.join(actualRootDir, "design_model", "modules");
  const leafModulesWithPaths: { node: ModuleTreeNode; fullPath: string }[] = [];
  if (moduleTree.root.children) {
    for (const child of moduleTree.root.children) {
      leafModulesWithPaths.push(...buildModulePath(child, modulesDir));
    }
  }

  console.log(` 发现 ${leafModulesWithPaths.length} 个叶子模块，并行度: ${parallelLimit}`);

  // 3. 并行为每个叶子模块生成类图
  const results = await processModulesInBatches(leafModulesWithPaths, parallelLimit, onModuleProgress);

  // 4. 统计结果
  const successCount = results.filter(r => r.success).length;
  console.log(`\n 类图生成完成: ${successCount}/${results.length} 成功`);

  return { results };
};

// 分批并行处理模块
async function processModulesInBatches(
  modules: { node: ModuleTreeNode; fullPath: string }[],
  batchSize: number,
  onModuleProgress?: (payload: ModuleProgressPayload) => void
): Promise<{
  moduleId: string;
  moduleName: string;
  success: boolean;
  classViewPath?: string;
  error?: string;
}[]> {
  const results: {
    moduleId: string;
    moduleName: string;
    success: boolean;
    classViewPath?: string;
    error?: string;
  }[] = [];
  const total = modules.length;
  let completed = 0;

  for (let i = 0; i < modules.length; i += batchSize) {
    const batch = modules.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(modules.length / batchSize);
    console.log(`  处理批次 ${batchNum}/${totalBatches} (${batch.length} 个模块)`);

    const batchPromises = batch.map(async ({ node, fullPath }) => {
      onModuleProgress?.({
        phase: "class_diagram",
        moduleId: node.module_id,
        moduleName: node.module_name,
        status: "start",
        message: `生成类图: ${node.module_name}`,
        completed,
        total,
      });
      const result = await generateSingleClassDiagram(node, fullPath);
      completed += 1;
      const progressPayload: any = {
        phase: "class_diagram",
        moduleId: node.module_id,
        moduleName: node.module_name,
        status: result.success ? "success" : "error",
        message: result.success ? `类图完成: ${node.module_name}` : `类图失败: ${node.module_name}`,
        completed,
        total,
      };
      if (!result.success && result.error) {
        progressPayload.error = result.error;
      }
      onModuleProgress?.(progressPayload);
      return {
        moduleId: node.module_id,
        moduleName: node.module_name,
        ...result,
      };
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  return results;
}
