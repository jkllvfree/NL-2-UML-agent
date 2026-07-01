import * as fs from "fs";
import * as path from "path";
import { generateModuleTreeUserPrompt } from "../promptUtils/prompt.js";
import { callModuleTreeLLM } from "../utils.js";
import { generateAllClassDiagrams } from "./generateClassDiagram.js";
import { generateAllSequenceDiagrams } from "./generateSequenceDiagram.js";
import { generateAllPimClassDiagrams, generateAllPimSequenceDiagrams } from "./generatePim.js";
import { generateAllPsmClassDiagrams, generateAllPsmSequenceDiagrams } from "./generatePsm.js";
import type { ModuleTree, ModuleTreeNode } from "../../types/diagram.js";
import type { ModuleTreeRequest } from "../../types/api.js";

type ProgressCallback = (stage: string, message?: string, detail?: unknown) => void;

type GenerateModuleTreeOptions = {
  requestId: string;
  onProgress?: ProgressCallback;
};

// 格式化耗时为人类可读格式
const formatDuration = (ms: number): string => {
  if (ms < 1000) {
    return `${ms}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  } else {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(1);
    return `${minutes}m ${seconds}s`;
  }
};

// 读取需求文档内容
export const readRequirementFile = (projectRoot: string, requirementRelativePath: string): string => {
  const absolutePath = path.join(projectRoot, requirementRelativePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`需求文档不存在: ${absolutePath}`);
  }

  const content = fs.readFileSync(absolutePath, "utf-8");
  console.log(`已读取需求文档: ${absolutePath}`);
  console.log(`文档长度: ${content.length} 字符`);
  return content;
};

// 计算模块树统计信息
const calculateStats = (node: ModuleTreeNode): { total: number; leaf: number; maxDepth: number } => {
  let total = 1;
  let leaf = node.is_leaf ? 1 : 0;
  let maxDepth = 0;

  const children = node.children || [];
  for (const child of children) {
    const childStats = calculateStats(child);
    total += childStats.total;
    leaf += childStats.leaf;
    maxDepth = Math.max(maxDepth, childStats.maxDepth + 1);
  }

  return { total, leaf, maxDepth };
};

// 递归收集所有叶子模块
const collectLeafModules = (node: ModuleTreeNode, leaves: ModuleTreeNode[]): void => {
  if (node.is_leaf) {
    leaves.push(node);
  }
  const children = node.children || [];
  for (const child of children) {
    collectLeafModules(child, leaves);
  }
};



// 解析需求文档，提取功能需求描述
// 返回格式: { "M01": { "FR-M01-001": "租户管理：系统管理员可创建/启用/停用租户..." } }
const parseFunctionalRequirements = (content: string): Record<string, Record<string, string>> => {
  const result: Record<string, Record<string, string>> = {};

  // 匹配所有模块章节
  const moduleMatches = content.matchAll(/##\s*4\.(\d+)\s*模块\s+(M\d+)\s*-/g);

  for (const moduleMatch of moduleMatches) {
    const moduleId = moduleMatch[2];
    if (!moduleId) continue;

    // 找到当前模块的结束位置（下一个 ## 4.x 模块 或文档结束）
    const startPos = moduleMatch.index || 0;
    const nextModuleMatch = content.slice(startPos + 10).match(/##\s*4\.\d+\s*模块\s+M\d+/);
    const endPos = nextModuleMatch
      ? startPos + 10 + (nextModuleMatch.index || 0)
      : content.length;

    const moduleSection = content.substring(startPos, endPos);

    // 匹配功能需求表格行
    const funcMap: Record<string, string> = {};
    const funcMatches = moduleSection.matchAll(/\|(FR-M\d+-\d+)\|([^|]+)\|([^|]+)\|/g);

    for (const funcMatch of funcMatches) {
      const funcId = funcMatch[1];
      const funcName = funcMatch[2]?.trim() || "";
      const funcDesc = funcMatch[3]?.trim() || "";
      if (funcId) {
        funcMap[funcId] = `${funcName}：${funcDesc}`;
      }
    }

    if (Object.keys(funcMap).length > 0) {
      result[moduleId] = funcMap;
      console.log(`解析模块 ${moduleId}: ${Object.keys(funcMap).length} 个功能需求`);
    }
  }

  return result;
};

// 解析需求文档，提取非功能需求章节（第 6 章：全局业务规则与非功能约束）
// 返回该章节的原始文本内容
const parseNonFunctionalRequirements = (content: string): string => {
  // 匹配 "## 6." 开头的非功能需求章节
  const nfrHeaderRegex = /^#{1,2}\s*6\.\s*全局业务规则与非功能约束/m;
  const headerMatch = content.match(nfrHeaderRegex);

  if (!headerMatch || headerMatch.index === undefined) {
    console.log("需求文档中未找到第 6 章「全局业务规则与非功能约束」");
    return "";
  }

  // 从章节标题后开始截取
  const startPos = headerMatch.index;
  const afterHeader = content.slice(startPos);

  // 找到下一行的开始位置（跳过标题行本身）
  const firstNewline = afterHeader.indexOf("\n");
  if (firstNewline === -1) {
    return "";
  }

  let sectionContent = afterHeader.slice(firstNewline + 1);

  // 截取到下一个大章节（# 或 ##）或文档结尾
  const nextMajorSection = sectionContent.match(/^#{1,2}\s+\d+\.\s+/m);
  if (nextMajorSection && nextMajorSection.index !== undefined) {
    sectionContent = sectionContent.slice(0, nextMajorSection.index);
  }

  const trimmed = sectionContent.trim();
  if (trimmed) {
    console.log(`已解析非功能需求章节 (${trimmed.length} 字符)`);
  }
  return trimmed;
};

// 将非功能需求写入或合并到 project_rules.json
const saveNonFunctionalRequirements = (
  projectRoot: string,
  nfrContent: string
): void => {
  if (!nfrContent) return;

  const configDir = path.join(projectRoot, ".model", "config");
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const rulesPath = path.join(configDir, "project_rules.json");
  let rules: Record<string, unknown> = {};

  if (fs.existsSync(rulesPath)) {
    try {
      rules = JSON.parse(fs.readFileSync(rulesPath, "utf-8"));
    } catch {
      console.warn("project_rules.json 解析失败，将覆盖写入");
    }
  }

  rules.nonFunctionalRequirements = {
    description: "从需求文档第 6 章「全局业务规则与非功能约束」提取，影响 PIM 架构决策与 PSM 技术选型",
    rawContent: nfrContent,
  };

  fs.writeFileSync(rulesPath, JSON.stringify(rules, null, 2), "utf-8");
  // v0.4.0: 同步写入 .d2c/project.json
  const d2cProjPath = path.join(projectRoot, ".d2c", "project.json");
  if (fs.existsSync(d2cProjPath)) {
    try {
      const d2cRules = JSON.parse(fs.readFileSync(d2cProjPath, "utf-8"));
      d2cRules.nonFunctionalRequirements = rules.nonFunctionalRequirements;
      fs.writeFileSync(d2cProjPath, JSON.stringify(d2cRules, null, 2), "utf-8");
    } catch { /* ignore */ }
  }
  console.log(`非功能需求已写入: ${rulesPath}`);
};

// 递归创建模块目录结构
const createModuleDirectory = (
  node: ModuleTreeNode,
  parentDir: string,
  functionalReqMap: Record<string, Record<string, string>>
): void => {
  const moduleDir = path.join(parentDir, node.directory_name || node.module_name?.toLowerCase().replace(/\s+/g, "_") || "unknown");

  if (!fs.existsSync(moduleDir)) {
    fs.mkdirSync(moduleDir, { recursive: true });
  }

  // 创建 design 目录
  const designDir = path.join(moduleDir, "design");
  if (!fs.existsSync(designDir)) {
    fs.mkdirSync(designDir, { recursive: true });
  }

  // 如果是叶子模块，创建 requirement.md
  if (node.is_leaf) {
    const requirementPath = path.join(moduleDir, "requirement.md");

    // 获取功能需求描述
    const requirementScope = node.requirement_scope || {};
    const moduleFuncIds = requirementScope.功能需求 as string[] || [];
    const moduleId = node.module_id || "";

    let 功能需求Text = "";
    if (functionalReqMap[moduleId]) {
      功能需求Text = moduleFuncIds
        .map(id => {
          const desc = functionalReqMap[moduleId]?.[id];
          return desc ? `- ${id} ${desc}` : `- ${id}`;
        })
        .join("\n");
    } else {
      功能需求Text = moduleFuncIds.map(id => `- ${id}`).join("\n");
    }

    const requirementContent = `# ${node.module_name} 需求文档

## 模块目标
${node.requirement_scope?.目标 || ""}

## 职责范围
${node.requirement_scope?.职责范围 || ""}

## 功能需求
${功能需求Text}
`;
    fs.writeFileSync(requirementPath, requirementContent, "utf-8");
    console.log(`已创建: ${path.relative(parentDir, moduleDir)}/requirement.md`);
  }

  // 递归处理子模块
  const children = node.children || [];
  if (children.length > 0) {
    // 创建 modules 子目录
    const modulesSubDir = path.join(moduleDir, "modules");
    if (!fs.existsSync(modulesSubDir)) {
      fs.mkdirSync(modulesSubDir, { recursive: true });
    }

    for (const child of children) {
      createModuleDirectory(child, modulesSubDir, functionalReqMap);
    }
  }
};

// 根据模块树创建目录结构
const createDirectoryTree = (
  moduleTree: ModuleTree,
  rootDir: string,
  functionalReqMap: Record<string, Record<string, string>>
): void => {
  // 创建 design_model 目录
  const designModelDir = path.join(rootDir, "design_model");

  if (!fs.existsSync(designModelDir)) {
    fs.mkdirSync(designModelDir, { recursive: true });
    console.log(`已创建目录: design_model/`);
  }

  // 写入 module_tree.json 到 design_model
  const moduleTreePath = path.join(designModelDir, "module_tree.json");
  fs.writeFileSync(moduleTreePath, JSON.stringify(moduleTree, null, 2), "utf-8");
  console.log(`已写入: design_model/module_tree.json`);

  // 创建 design 目录（项目级聚合设计结果）
  const designDir = path.join(designModelDir, "design");
  if (!fs.existsSync(designDir)) {
    fs.mkdirSync(designDir, { recursive: true });
    console.log(`已创建目录: design_model/design/`);
  }

  // 创建 modules 目录（一级模块集合）
  const modulesDir = path.join(designModelDir, "modules");
  if (!fs.existsSync(modulesDir)) {
    fs.mkdirSync(modulesDir, { recursive: true });
    console.log(`已创建目录: design_model/modules/`);
  }

  // 为每个一级模块递归创建目录结构
  const children = moduleTree.root.children || [];
  for (const child of children) {
    createModuleDirectory(child, modulesDir, functionalReqMap);
  }
};

// 生成模块树
export interface PipelineSummary {
  stage: string;
  total: number;
  success: number;
  failed: number;
}

export const generateModuleTree = async (
  req: ModuleTreeRequest,
  options?: GenerateModuleTreeOptions
): Promise<{ moduleTree: ModuleTree; rootDir: string; pipelineSummary: PipelineSummary[] }> => {
  const { projectRoot, requirementRelativePath, projectName, documentVersion } = req;
  const onProgress = options?.onProgress;

  console.log(`开始生成模块树...`);
  console.log(`项目根目录: ${projectRoot}`);
  console.log(`需求文档路径: ${requirementRelativePath}`);
  console.log(`📛 项目名称: ${projectName}`);

  // 记录开始时间
  const startTime = Date.now();

  // 1. 读取需求文档
  onProgress?.("read_requirement", "正在读取需求文档", { requirementRelativePath });
  const requirementContent = readRequirementFile(projectRoot, requirementRelativePath);

  // 2. 生成用户提示词
  onProgress?.("build_prompt", "正在构建模块树提示词");
  const userPrompt = generateModuleTreeUserPrompt(
    requirementContent,
    projectName,
    documentVersion || "1.0.0",
    requirementRelativePath  // 记录相对路径
  );

  // 4. 调用 LLM 生成模块树
  onProgress?.("llm_generating", "正在调用 LLM 生成模块树");
  const moduleTree = await callModuleTreeLLM(userPrompt);

  // 5. 计算 full_path（完整路径）
  // ROOT 节点对应 design_model/ 本身，full_path 为空
  // 一级模块对应 design_model/modules/xxx
  // 叶子模块对应 design_model/modules/xxx/modules/xxx
  const calculateFullPath = (node: ModuleTreeNode, parentPath: string = ""): void => {
    const dirName = node.directory_name || node.module_name?.toLowerCase().replace(/\s+/g, "_") || "unknown";
    // ROOT 节点（module_id === "ROOT"）的 full_path 保持为空
    if (node.module_id === "ROOT") {
      node.full_path = "";
    } else {
      node.full_path = parentPath ? `${parentPath}/${dirName}` : dirName;
    }
    for (const child of node.children || []) {
      calculateFullPath(child, node.full_path);
    }
  };
  calculateFullPath(moduleTree.root);

  // 6. 确保 schema_version 正确
  if (!moduleTree.schema_version) {
    moduleTree.schema_version = "0.2.1";
  }
  if (!moduleTree.project_name) {
    moduleTree.project_name = projectName;
  }
  if (!moduleTree.generated_from) {
    moduleTree.generated_from = {
      requirement_file: requirementRelativePath,  // 记录相对路径
      document_version: documentVersion || "1.0.0",
    };
  }

  // 7. 计算统计信息
  const stats = calculateStats(moduleTree.root);
  moduleTree.stats = {
    total_nodes: stats.total,
    leaf_nodes: stats.leaf,
    max_depth: stats.maxDepth,
  };

  console.log(`📊 模块树统计: 共 ${stats.total} 个模块, ${stats.leaf} 个叶子模块, 最大深度 ${stats.maxDepth}`);
  onProgress?.("stats", "模块树统计完成", { total: stats.total, leaf: stats.leaf, maxDepth: stats.maxDepth });

  // 8. 输出目录为项目根目录
  const rootDir = projectRoot;

  // 9. 解析功能需求
  onProgress?.("parse_requirements", "正在解析功能需求");
  const functionalReqMap = parseFunctionalRequirements(requirementContent);
  console.log(` 已解析 ${Object.keys(functionalReqMap).length} 个模块的功能需求`);

  // 9b. 解析非功能需求（第 6 章）并写入 project_rules.json
  const nfrContent = parseNonFunctionalRequirements(requirementContent);
  if (nfrContent) {
    saveNonFunctionalRequirements(rootDir, nfrContent);
  }

  // 10. 创建目录树结构
  onProgress?.("write_outputs", "正在写入 design_model 目录");
  createDirectoryTree(moduleTree, rootDir, functionalReqMap);
  const directoryTreeTime = Date.now();
  console.log(` 目录树生成耗时: ${formatDuration(directoryTreeTime - startTime)}`);

  // 11. 为所有叶子模块生成类图
  console.log(`\n🚀 开始为所有叶子模块生成类图...`);
  onProgress?.("generate_class_diagrams", "开始生成叶子模块类图");
  const classDiagramStartTime = Date.now();
  const classDiagramResult = await generateAllClassDiagrams(
    path.join(rootDir, "design_model", "module_tree.json"),
    rootDir,
    undefined,
    (payload) => {
      onProgress?.("module_progress", payload.message, payload);
    }
  );

  const classSuccessCount = classDiagramResult.results.filter(r => r.success).length;
  const classDiagramTime = Date.now();
  console.log(`📈 类图生成完成: ${classSuccessCount}/${classDiagramResult.results.length} 成功 (耗时: ${formatDuration(classDiagramTime - classDiagramStartTime)})`);
  onProgress?.("class_diagrams_done", "类图生成完成", { success: classSuccessCount, total: classDiagramResult.results.length });

  // 12. 为所有叶子模块生成时序图（依赖类图结果）
  console.log(`\n🚀 开始为所有叶子模块生成时序图...`);
  onProgress?.("generate_sequence_diagrams", "开始生成叶子模块时序图");
  const sequenceDiagramStartTime = Date.now();
  const sequenceResult = await generateAllSequenceDiagrams(
    path.join(rootDir, "design_model", "module_tree.json"),
    rootDir,
    undefined,
    (payload) => {
      onProgress?.("module_progress", payload.message, payload);
    }
  );

  const sequenceSuccessCount = sequenceResult.results.filter(r => r.success).length;
  const sequenceDiagramTime = Date.now();
  console.log(` 时序图生成完成: ${sequenceSuccessCount}/${sequenceResult.results.length} 成功 (耗时: ${formatDuration(sequenceDiagramTime - sequenceDiagramStartTime)})`);

  // 13. 为所有叶子模块生成 PIM 类图和时序图
  console.log(`\n开始为所有叶子模块生成 PIM 模型...`);
  const pimStartTime = Date.now();
  const moduleTreePath = path.join(rootDir, "design_model", "module_tree.json");
  const pimClassResult = await generateAllPimClassDiagrams(moduleTreePath, rootDir);
  const pimSeqResult = await generateAllPimSequenceDiagrams(moduleTreePath, rootDir);
  const pimClassSuccess = pimClassResult.results.filter(r => r.success).length;
  const pimSeqSuccess = pimSeqResult.results.filter(r => r.success).length;
  const pimTime = Date.now();
  console.log(` PIM 模型生成完成: 类图 ${pimClassSuccess}/${pimClassResult.results.length}, 时序图 ${pimSeqSuccess}/${pimSeqResult.results.length} (耗时: ${formatDuration(pimTime - pimStartTime)})`);

  // 14. 为所有叶子模块生成 PSM 类图和时序图
  console.log(`\n开始为所有叶子模块生成 PSM 模型...`);
  const psmStartTime = Date.now();
  const psmClassResult = await generateAllPsmClassDiagrams(moduleTreePath, rootDir);
  const psmSeqResult = await generateAllPsmSequenceDiagrams(moduleTreePath, rootDir);
  const psmClassSuccess = psmClassResult.results.filter(r => r.success).length;
  const psmSeqSuccess = psmSeqResult.results.filter(r => r.success).length;
  const psmTime = Date.now();
  console.log(` PSM 模型生成完成: 类图 ${psmClassSuccess}/${psmClassResult.results.length}, 时序图 ${psmSeqSuccess}/${psmSeqResult.results.length} (耗时: ${formatDuration(psmTime - psmStartTime)})`);

  // 总耗时
  const totalTime = Date.now() - startTime;
  console.log(`\n 总耗时: ${formatDuration(totalTime)}`);
  console.log(`模块树、业务模型、PIM、PSM 全部生成完成！`);
  console.log(` 输出目录: ${rootDir}`);

  const pipelineSummary: PipelineSummary[] = [
    { stage: "业务类图", total: classDiagramResult.results.length, success: classSuccessCount, failed: classDiagramResult.results.length - classSuccessCount },
    { stage: "业务时序图", total: sequenceResult.results.length, success: sequenceSuccessCount, failed: sequenceResult.results.length - sequenceSuccessCount },
    { stage: "PIM类图", total: pimClassResult.results.length, success: pimClassSuccess, failed: pimClassResult.results.length - pimClassSuccess },
    { stage: "PIM时序图", total: pimSeqResult.results.length, success: pimSeqSuccess, failed: pimSeqResult.results.length - pimSeqSuccess },
    { stage: "PSM类图", total: psmClassResult.results.length, success: psmClassSuccess, failed: psmClassResult.results.length - psmClassSuccess },
    { stage: "PSM时序图", total: psmSeqResult.results.length, success: psmSeqSuccess, failed: psmSeqResult.results.length - psmSeqSuccess },
  ];

  return { moduleTree, rootDir, pipelineSummary };
};
