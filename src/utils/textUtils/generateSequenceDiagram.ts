import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { generateMultiSequenceDiagramUserPrompt } from "../promptUtils/prompt.js";
import { callMultiSequenceDiagramLLM, repairBusinessModelJson } from "../utils.js";
import type { LeafModel, ModuleTree, ModuleTreeNode, SequenceModel, SequenceView } from "../../types/diagram.js";
import { readLeafRequirement, readModuleTree } from "./generateClassDiagram.js";
import { validateBusinessModelSchema } from "../schemaUtils/businessModelSchemas.js";
import { convertSequenceJsonToPuml, writePumlFile } from "../pumlUtils/convertToPuml.js";

const MAX_SCHEMA_REPAIR_RETRIES = 5;

// v0.4.0: 从 project.json / project_rules.json 读取非功能需求配置
function readNfrConfig(workspaceRoot: string): string {
  const newPath = path.join(workspaceRoot, ".d2c", "project.json");
  const legacyPath = path.join(workspaceRoot, ".model", "config", "project_rules.json");
  const rulesPath = fs.existsSync(newPath) ? newPath : (fs.existsSync(legacyPath) ? legacyPath : null);
  if (!rulesPath) return "";

  try {
    const rules = JSON.parse(fs.readFileSync(rulesPath, "utf-8"));
    const nfr = rules?.nonFunctionalRequirements;
    if (nfr?.rawContent && typeof nfr.rawContent === "string") {
      return nfr.rawContent;
    }
  } catch { /* ignore */ }
  return "";
}

type FunctionalRequirementItem = {
  useCaseId: string;
  useCaseDescription: string;
};

export type ModuleProgressPayload = {
  phase: "sequence_diagram";
  moduleId: string;
  moduleName: string;
  status: "start" | "success" | "error";
  message: string;
  error?: string;
  completed?: number;
  total?: number;
};

const readClassView = (moduleDir: string): LeafModel => {
  const classViewPath = path.join(moduleDir, "design", "business_model_class.json");
  if (!fs.existsSync(classViewPath)) {
    throw new Error(`类图文件不存在: ${classViewPath}`);
  }
  const content = fs.readFileSync(classViewPath, "utf-8");
  return JSON.parse(content) as LeafModel;
};

const buildClassViewConstraint = (classView: LeafModel): unknown => {
  return {
    classifiers: (classView.classifiers || []).map(c => ({
      classifier_id: c.classifier_id,
      name: c.name,
      kind: c.kind,
      stereotype: c.stereotype,
      businessMeaning: c.businessMeaning,
      responsibilities: c.responsibilities || [],
      businessRules: c.businessRules || [],
      operations: (c.operations || []).map(op => ({
        name: op.name,
        businessGoal: op.businessGoal,
        preconditions: op.preconditions || [],
        postconditions: op.postconditions || [],
      })),
    })),
  };
};

const parseFunctionalRequirements = (requirementContent: string): FunctionalRequirementItem[] => {
  const lines = requirementContent.split(/\r?\n/);
  const startIndex = lines.findIndex(l => /^##\s*功能需求\s*$/.test(l.trim()));
  if (startIndex < 0) {
    return [];
  }

  const items: FunctionalRequirementItem[] = [];
  for (let i = startIndex + 1; i < lines.length; i++) {
    const rawLine = lines[i];
    if (rawLine === undefined) {
      continue;
    }
    const line = rawLine.trim();
    if (line === "") {
      continue;
    }
    if (/^##\s+/.test(line)) {
      break;
    }
    if (!/^[*-]\s+/.test(line)) {
      continue;
    }

    const raw = line.replace(/^[*-]\s+/, "").trim();
    if (!raw) {
      continue;
    }
    const [first, ...rest] = raw.split(/\s+/);
    if (!first) {
      continue;
    }
    const useCaseId = first;
    const useCaseDescription = rest.join(" ").trim();
    items.push({ useCaseId, useCaseDescription });
  }

  return items;
};

const ensureSequenceModel = (
  model: Partial<SequenceModel>,
  moduleId: string,
  useCaseId: string,
  classView: LeafModel
): SequenceModel => {
  const interaction_id = model.interaction_id && model.interaction_id.trim() !== ""
    ? model.interaction_id
    : crypto.randomUUID();

  const lifelines = Array.isArray(model.lifelines) ? model.lifelines : [];
  const elements = model.sequence?.elements && Array.isArray(model.sequence.elements) ? model.sequence.elements : [];

  const firstLifelineId = lifelines[0]?.lifeline_id || "";
  const secondLifelineId = lifelines[1]?.lifeline_id || firstLifelineId;
  for (const el of elements as any[]) {
    if (!el || el.type !== "Message" || !el.message) {
      continue;
    }
    if (!el.element_id) {
      el.element_id = crypto.randomUUID();
    }

    normalizeMessage(el.message, firstLifelineId, secondLifelineId);
  }

  for (const lf of lifelines as any[]) {
    if (!lf || !lf.lifeline_id) {
      lf.lifeline_id = crypto.randomUUID();
    }
    lf.name = (lf.name || lf.lifeline_id).toString();
    lf.isActor = Boolean(lf.isActor);
    if (lf.isActor) {
      lf.role = "Actor";
      lf.classifier_id = lf.classifier_id ?? null;
    }
    if (lf.isActor === false && (!lf.classifier_id || lf.classifier_id.trim() === "")) {
      const fallback = classView.classifiers?.[0]?.classifier_id;
      if (fallback) {
        lf.classifier_id = fallback;
      }
    }
    if (!lf.role || !["Actor", "Aggregate", "Service", "ExternalSystem", "Policy"].includes(lf.role)) {
      lf.role = lf.isActor ? "Actor" : "Aggregate";
    }
    lf.businessResponsibility = (lf.businessResponsibility || `${lf.name || lf.lifeline_id} 在当前交互中的业务职责`).toString();
    delete lf.instance_name;
    delete lf.creation;
    delete lf.destruction;
  }

  normalizeSequenceElements(elements as any[], firstLifelineId, secondLifelineId);
  normalizeContext(model.context);

  const normalized = {
    description: (model.description || "").toString(),
    interaction_id,
    name: (model.name || useCaseId).toString(),
    module_id: moduleId,
    use_case_id: useCaseId,
    preconditions: toStringArray((model as any).preconditions, []),
    postconditions: toStringArray((model as any).postconditions, []),
    businessOutcome: ((model as any).businessOutcome || "完成当前功能需求对应的业务结果").toString(),
    context: model.context || { variables: [] },
    lifelines: lifelines as any,
    sequence: { elements: elements as any },
  };

  validateBusinessModelSchema("sequence", normalized);
  return normalized;
};

const ensureSequenceModelWithRetry = async (
  model: Partial<SequenceModel>,
  moduleId: string,
  moduleName: string,
  useCase: FunctionalRequirementItem,
  classView: LeafModel
): Promise<SequenceModel> => {
  let candidate = model;

  for (let attempt = 0; attempt <= MAX_SCHEMA_REPAIR_RETRIES; attempt++) {
    try {
      const normalized = ensureSequenceModel(candidate, moduleId, useCase.useCaseId, classView);
      if (attempt > 0) {
        console.log(`${moduleName}/${useCase.useCaseId} 时序图 schema 修复成功，重试次数: ${attempt}`);
      }
      return normalized;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (attempt >= MAX_SCHEMA_REPAIR_RETRIES) {
        throw error;
      }

      console.warn(`${moduleName}/${useCase.useCaseId} 时序图 schema 校验失败，准备第 ${attempt + 1}/${MAX_SCHEMA_REPAIR_RETRIES} 次修复`);
      candidate = await repairBusinessModelJson<SequenceModel>(
        "sequence",
        JSON.stringify(candidate, null, 2),
        errorMessage,
        [
          `module_id: ${moduleId}`,
          `module_name: ${moduleName}`,
          `use_case_id: ${useCase.useCaseId}`,
          `use_case_description: ${useCase.useCaseDescription}`,
        ].join("\n")
      );
    }
  }

  throw new Error(`${moduleName}/${useCase.useCaseId} 时序图 schema 修复流程异常结束`);
};

const normalizeContext = (context?: any): void => {
  if (!context) {
    return;
  }
  context.variables = Array.isArray(context.variables) ? context.variables : [];
  for (const variable of context.variables) {
    variable.name = (variable.name || "variable").toString();
    variable.type = (variable.type || "string").toString();
  }
};

const normalizeSequenceElements = (elements: any[], firstLifelineId: string, secondLifelineId: string): void => {
  for (const el of elements) {
    if (!el) {
      continue;
    }
    if (el.type === "Message" && el.message) {
      if (!el.element_id) {
        el.element_id = crypto.randomUUID();
      }
      normalizeMessage(el.message, firstLifelineId, secondLifelineId);
    }
    if (el.type === "Fragment" && el.fragment) {
      el.fragment.fragment_type = normalizeFragmentType(el.fragment.fragment_type);
      el.fragment.businessPurpose = (el.fragment.businessPurpose || "表达当前业务流程中的条件、循环或并行控制").toString();
      if (el.fragment.loop) {
        delete el.fragment.loop.min;
        delete el.fragment.loop.max;
      }
      const operands = Array.isArray(el.fragment.operands) ? el.fragment.operands : [];
      el.fragment.operands = operands;
      for (const operand of operands) {
        operand.operand_id = (operand.operand_id || crypto.randomUUID()).toString();
        operand.elements = Array.isArray(operand.elements) ? operand.elements : [];
        normalizeSequenceElements(operand.elements, firstLifelineId, secondLifelineId);
      }
    }
    if (el.type === "InteractionUse") {
      el.element_id = (el.element_id || crypto.randomUUID()).toString();
      el.type = "Message";
      el.message = {
        message_kind: "notify",
        name: el.interaction_use?.name || "引用交互",
        source: { lifeline_id: "" },
        target: { lifeline_id: "" },
        businessGoal: "引用已有业务交互",
        businessResult: "业务交互被复用",
        businessRuleRefs: [],
        outputs: [],
      };
      delete el.interaction_use;
    }
  }
};

const normalizeMessage = (message: any, firstLifelineId: string, secondLifelineId: string): void => {
  message.source = message.source || { lifeline_id: firstLifelineId };
  message.target = message.target || { lifeline_id: secondLifelineId };
  message.source.lifeline_id = (message.source.lifeline_id || firstLifelineId).toString();
  message.target.lifeline_id = (message.target.lifeline_id || secondLifelineId).toString();
  message.message_kind = normalizeMessageKind(message.message_kind);
  message.name = (message.name || "业务交互").toString();
  message.businessGoal = (message.businessGoal || "完成当前步骤的业务目标").toString();
  message.businessResult = (message.businessResult || "当前步骤业务状态已更新").toString();
  message.businessRuleRefs = toStringArray(message.businessRuleRefs, []);
  message.outputs = toStringArray(message.outputs, []);
  delete message.operation;
  delete message.return;
  delete message.activation;
  delete message.exception;
};

const normalizeMessageKind = (kind: unknown): string => {
  const value = String(kind);
  if (["request", "notify", "response"].includes(value)) {
    return value;
  }
  if (["return", "sync"].includes(value)) {
    return value === "return" ? "response" : "request";
  }
  return "notify";
};

const normalizeFragmentType = (type: unknown): string => {
  const value = String(type);
  return ["alt", "opt", "loop", "par"].includes(value) ? value : "opt";
};

const toStringArray = (value: unknown, fallback: string[]): string[] => {
  return Array.isArray(value) ? value.map(String) : fallback;
};

const writeSequenceView = (moduleDir: string, sequenceView: SequenceView): string => {
  const outputPath = path.join(moduleDir, "design", "business_model_sequence.json");
  const designDir = path.dirname(outputPath);
  if (!fs.existsSync(designDir)) {
    fs.mkdirSync(designDir, { recursive: true });
  }
  fs.writeFileSync(outputPath, JSON.stringify(sequenceView, null, 2), "utf-8");
  console.log(`已写入: ${outputPath}`);

  const pumlContent = convertSequenceJsonToPuml(sequenceView);
  writePumlFile(designDir, "business_model_sequence.puml", pumlContent);

  return outputPath;
};

const getLeafModules = (node: ModuleTreeNode): ModuleTreeNode[] => {
  if (node.is_leaf) {
    return [node];
  }
  const leafModules: ModuleTreeNode[] = [];
  for (const child of node.children) {
    leafModules.push(...getLeafModules(child));
  }
  return leafModules;
};

const generateSingleModuleSequenceView = async (
  moduleNode: ModuleTreeNode,
  moduleDir: string,
  nfrContent?: string
): Promise<{ success: boolean; sequenceViewPath?: string; error?: string }> => {
  const { module_id, module_name } = moduleNode;

  console.log(`\n正在处理模块: ${module_name} (${module_id})`);

  try {
    const requirementContent = readLeafRequirement(moduleDir);
    const classView = readClassView(moduleDir);
    const classConstraint = buildClassViewConstraint(classView);
    const functionalReqs = parseFunctionalRequirements(requirementContent);

    const items = functionalReqs.length
      ? functionalReqs
      : [{ useCaseId: `FR-${module_id}-000`, useCaseDescription: module_name }];

    console.log(`   发现 ${items.length} 个功能需求，并行生成时序图...`);

    // 并行生成每个功能需求的时序图（每批最多 10 个）
    const interactions: SequenceModel[] = await processInteractionsInBatches(
      items,
      module_id,
      module_name,
      requirementContent,
      classConstraint,
      classView,
      moduleDir,
      10,
      nfrContent
    );

    const sequenceView: SequenceView = {
      module_id,
      module_name,
      schema_version: "0.1.0",
      interactions,
    };

    const sequenceViewPath = writeSequenceView(moduleDir, sequenceView);
    console.log(`模块 ${module_name} 时序图生成完成`);
    return { success: true, sequenceViewPath };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "未知错误";
    console.error(`模块 ${module_name} 时序图生成失败: ${errorMessage}`);
    return { success: false, error: errorMessage };
  }
};

// 批量生成时序图（一次调用生成多个）
async function processInteractionsInBatches(
  items: FunctionalRequirementItem[],
  moduleId: string,
  moduleName: string,
  requirementContent: string,
  classConstraint: unknown,
  classView: LeafModel,
  moduleDir: string,
  batchSize: number = 10,
  nfrContent?: string
): Promise<SequenceModel[]> {
  const results: SequenceModel[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(items.length / batchSize);

    console.log(`    处理批次 ${batchNum}/${totalBatches} (${batch.length} 个需求，批量生成)`);

    try {
      // 使用批量生成 prompt
      const userPrompt = generateMultiSequenceDiagramUserPrompt(
        moduleId,
        moduleName,
        batch,
        requirementContent,
        JSON.stringify(classConstraint, null, 2),
        nfrContent
      );

      // 一次调用生成多个时序图
      const batchResults = await callMultiSequenceDiagramLLM(userPrompt);

      // 规范化每个结果
      for (let j = 0; j < batchResults.length; j++) {
        const raw = batchResults[j];
        const item = batch[j];
        if (raw && item) {
          try {
            const normalized = await ensureSequenceModelWithRetry(raw as any, moduleId, moduleName, item, classView);
            results.push(normalized);
          } catch (error) {
            console.error(`      ${item.useCaseId} schema 修复后仍失败:`, error);
          }
        }
      }

      console.log(`      批次 ${batchNum} 完成，成功 ${batchResults.length} 个`);
    } catch (error) {
      console.error(`      批次 ${batchNum} 生成失败:`, error);
      // 该批次失败，继续处理下一批
    }
  }

  return results;
}

// 并行度配置
const MAX_PARALLEL_MODULES = 3;

export const generateAllSequenceDiagrams = async (
  moduleTreePath?: string,
  rootDir?: string,
  maxParallel?: number,
  onModuleProgress?: (payload: ModuleProgressPayload) => void
): Promise<{
  results: {
    moduleId: string;
    moduleName: string;
    success: boolean;
    sequenceViewPath?: string;
    error?: string;
  }[];
}> => {
  console.log(`开始为所有叶子模块生成时序图...`);

  const moduleTree: ModuleTree = readModuleTree(moduleTreePath);
  const derivedRootDir = moduleTreePath
    ? path.dirname(path.dirname(moduleTreePath))
    : undefined;
  const actualRootDir = rootDir || derivedRootDir || process.cwd();
  const parallelLimit = maxParallel || MAX_PARALLEL_MODULES;

  const leafModules = getLeafModules(moduleTree.root);
  console.log(` 发现 ${leafModules.length} 个叶子模块`);

  // build absolute paths from root downwards
  // For each module, recursively build its directory path
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
  const leafModulesWithPaths = [];
  if (moduleTree.root.children) {
    for (const child of moduleTree.root.children) {
      leafModulesWithPaths.push(...buildModulePath(child, modulesDir));
    }
  }

  console.log(` 发现 ${leafModulesWithPaths.length} 个叶子模块，并行度: ${parallelLimit}`);

  // 读取非功能需求配置（project_rules.json → nonFunctionalRequirements）
  const nfrContent = readNfrConfig(actualRootDir);

  // 并行处理
  const results = await processModulesInBatches(leafModulesWithPaths, parallelLimit, nfrContent, onModuleProgress);

  const successCount = results.filter(r => r.success).length;
  console.log(`\n 时序图生成完成: ${successCount}/${results.length} 成功`);

  return { results };
};

// 分批并行处理模块
async function processModulesInBatches(
  modules: { node: ModuleTreeNode; fullPath: string }[],
  batchSize: number,
  nfrContent?: string,
  onModuleProgress?: (payload: ModuleProgressPayload) => void
): Promise<{
  moduleId: string;
  moduleName: string;
  success: boolean;
  sequenceViewPath?: string;
  error?: string;
}[]> {
  const results: {
    moduleId: string;
    moduleName: string;
    success: boolean;
    sequenceViewPath?: string;
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
        phase: "sequence_diagram",
        moduleId: node.module_id,
        moduleName: node.module_name,
        status: "start",
        message: `生成时序图: ${node.module_name}`,
        completed,
        total,
      });
      const result = await generateSingleModuleSequenceView(node, fullPath, nfrContent);
      completed += 1;
      const progressPayload: any = {
        phase: "sequence_diagram",
        moduleId: node.module_id,
        moduleName: node.module_name,
        status: result.success ? "success" : "error",
        message: result.success ? `时序图完成: ${node.module_name}` : `时序图失败: ${node.module_name}`,
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
