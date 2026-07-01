/**
 * PSM 生成服务 — 将 PIM 转换为平台相关设计模型 (Java/Spring Boot)。
 */
import * as fs from "fs";
import * as path from "path";
import { readModuleTree } from "./generateClassDiagram.js";
import { callPsmClassLLM, callPsmSequenceLLM } from "../utils.js";
import { RepairJson } from "../repairUtils/repair.js";
import { validatePsmSchema } from "../schemaUtils/businessModelSchemas.js";
import { readSchemaText } from "../schemaUtils/businessModelSchemas.js";
import {
  PSM_CLASS_SYSTEM_PROMPT,
  buildPsmClassUserPrompt,
  PSM_SEQUENCE_SYSTEM_PROMPT,
  buildPsmSequenceUserPrompt,
} from "../promptUtils/psmPrompts.js";
import {
  convertPsmClassJsonToPuml,
  convertPsmSequenceJsonToPuml,
  writePumlFile,
} from "../pumlUtils/convertToPuml.js";
import type { ModuleTreeNode } from "../../types/diagram.js";

const MAX_RETRIES = 5;
const MAX_PARALLEL_MODULES = 3;

const DEFAULT_BASE_PACKAGE = "com.example.app";

interface ProjectConfig {
  basePackage: string;
  language?: string;
  languageVersion?: string;
  framework?: string;
  frameworkVersion?: string;
}

function readProjectRules(workspaceRoot: string): ProjectConfig {
  // v0.4.0: 优先读 .d2c/project.json，fallback 到 .model/config/project_rules.json
  const newPath = path.join(workspaceRoot, ".d2c", "project.json");
  const legacyPath = path.join(workspaceRoot, ".model", "config", "project_rules.json");
  const actualPath = fs.existsSync(newPath) ? newPath : (fs.existsSync(legacyPath) ? legacyPath : null);
  if (!actualPath) return { basePackage: DEFAULT_BASE_PACKAGE };

  try {
    const rules = JSON.parse(fs.readFileSync(actualPath, "utf-8"));
    const isNewFormat = !!rules.language;
    return {
      basePackage: rules?.namespace?.basePackage || DEFAULT_BASE_PACKAGE,
      language: isNewFormat ? (rules.language?.name || "Java") : (rules.projectLanguage || "Java"),
      languageVersion: isNewFormat ? (rules.language?.version || "21") : (rules.languageVersion || "21"),
      framework: isNewFormat ? (rules.framework?.name || "Spring Boot") : (rules.framework || "Spring Boot"),
      frameworkVersion: isNewFormat ? (rules.framework?.version || "3.3.5") : (rules.frameworkVersion || "3.3.5"),
    };
  } catch { return { basePackage: DEFAULT_BASE_PACKAGE }; }
}

const STEREOTYPE_BY_LAYER: Record<string, string> = {
  domain: "Entity", service: "Service", repository: "Repository",
  controller: "Controller", dto: "DTO", port: "Interface",
  adapter: "Service", gateway: "Service", event: "Component",
  handler: "Component",
};

function postProcessPsmClass(
  psmClass: Record<string, unknown>,
  basePackage: string,
  moduleId: string,
  moduleName: string,
  directoryName: string,
  pimJson: string
): Record<string, unknown> {
  const pc = { ...psmClass };
  const projectPrefix = basePackage;
  const moduleAbbrev = directoryName;
  const modId = `mod.${moduleAbbrev}`;

  // 模块元数据修正
  if (Array.isArray(pc.modules)) {
    for (const m of pc.modules as Record<string, unknown>[]) {
      if (m.parent_module_id === undefined || m.parent_module_id === null) m.parent_module_id = "";
      if (!("is_leaf" in m)) (m as any).is_leaf = true;
      if (!m.module_id) (m as any).module_id = modId;
    }
  } else {
    pc.modules = [{ module_id: modId, module_name: moduleName, parent_module_id: "", is_leaf: true, package_ids: [] }];
  }

  // 包命名修复
  if (!Array.isArray(pc.packages)) pc.packages = [];
  const existingPackages = pc.packages as Record<string, unknown>[];
  for (const pkg of existingPackages) {
    const layer = (pkg as any).name as string || "";
    if (!(pkg as any).full_name || (pkg as any).full_name.includes("com.example.")) {
      (pkg as any).full_name = `${projectPrefix}.${moduleAbbrev}.${layer || "domain"}`;
    }
    (pkg as any).package_path = (pkg as any).full_name.replace(/\./g, "/");
    if (!(pkg as any).parent_package_id) (pkg as any).parent_package_id = "";
    if (!(pkg as any).module_id) (pkg as any).module_id = modId;
  }

  // 更新 modules 的 package_ids
  if (Array.isArray(pc.modules) && (pc.modules as any[]).length > 0) {
    const firstModule = (pc.modules as Record<string, unknown>[])[0];
    (firstModule as any).package_ids = existingPackages.map((p) => (p as any).package_id);
  }

  // classifiers 补充必填字段 + stereotype
  if (Array.isArray(pc.classifiers)) {
    for (const c of pc.classifiers as Record<string, unknown>[]) {
      if (c.visibility === undefined || c.visibility === null) c.visibility = "public";
      if (!c.module_id) c.module_id = modId;
      const matchedPkg = existingPackages.find((p) => (p as any).package_id === c.package_id);
      const layer = matchedPkg ? (matchedPkg as any).name as string : "domain";
      if (!c.stereotype || c.stereotype === "" || c.stereotype === "未标注") {
        c.stereotype = STEREOTYPE_BY_LAYER[layer] || (layer.charAt(0).toUpperCase() + layer.slice(1));
      }
    }
  } else {
    pc.classifiers = [];
  }

  // 从 PIM dependencies 构造 PSM relations
  if (Array.isArray(pc.classifiers)) {
    const rels = (pc.relations || []) as Record<string, unknown>[];
    const hasValidRels = rels.some((r) => (r.from || r.source) && (r.to || r.target));

    if (!hasValidRels) {
      let pimData: Record<string, unknown> | null = null;
      try { pimData = JSON.parse(pimJson); } catch { /* ignore */ }

      if (pimData && Array.isArray(pimData.classifiers)) {
        const pimNameToId = new Map<string, string>();
        const pimDeps: { from: string; target: string; kind: string }[] = [];
        for (const pimC of pimData.classifiers as Record<string, unknown>[]) {
          pimNameToId.set(pimC.name as string, pimC.classifier_id as string);
          for (const dep of (pimC.dependencies || []) as Record<string, unknown>[]) {
            pimDeps.push({
              from: pimC.classifier_id as string,
              target: dep.target as string,
              kind: (dep.kind || "dependency") as string,
            });
          }
        }

        const pimIdToPsmId = new Map<string, string>();
        for (const psmC of pc.classifiers as Record<string, unknown>[]) {
          const pimCid = pimNameToId.get(psmC.name as string);
          if (pimCid) pimIdToPsmId.set(pimCid, psmC.classifier_id as string);
        }

        const newRels: Record<string, unknown>[] = [];
        let relIdx = 0;
        for (const dep of pimDeps) {
          const psmFrom = pimIdToPsmId.get(dep.from);
          const psmTo = pimIdToPsmId.get(dep.target);
          if (psmFrom && psmTo) {
            newRels.push({
              relation_id: `rel.${moduleAbbrev}_${relIdx++}`,
              kind: dep.kind,
              from: psmFrom,
              to: psmTo,
              level: "classifier",
              from_module_id: modId,
              to_module_id: modId,
              derived_from: [],
            });
          }
        }
        if (newRels.length > 0) {
          pc.relations = newRels;
          console.log(`  [PSM] 从 PIM deps 构造 ${newRels.length} 条 relations`);
        }
      }
    }
  }

  return pc;
}

// ============ PSM 类图生成 ============

async function generateSinglePsmClass(
  moduleNode: ModuleTreeNode,
  moduleDir: string,
  basePackage: string
): Promise<{ moduleId: string; moduleName: string; success: boolean; error?: string }> {
  const { module_id, module_name, directory_name } = moduleNode;
  console.log(`\n[PSM Class] 处理模块: ${module_name} (${module_id})`);

  try {
    const designDir = path.join(moduleDir, "design");
    const pimFile = path.join(designDir, "pim_class.json");
    if (!fs.existsSync(pimFile)) {
      return { moduleId: module_id, moduleName: module_name, success: false, error: "缺少 pim_class.json" };
    }

    const pimJson = fs.readFileSync(pimFile, "utf-8");
    const schemaText = readSchemaText("psm_class");
    const userPrompt = buildPsmClassUserPrompt(
      pimJson, basePackage, module_id, module_name, directory_name
    );

    let psmClass: unknown = null;
    let lastError = "";
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const retryHint = attempt > 0 && lastError
          ? `\n\n# 上次校验失败错误\n${lastError}\n\n请修复后重新输出。`
          : "";
        const text = await callPsmClassLLM(PSM_CLASS_SYSTEM_PROMPT + `\n${schemaText}`, userPrompt + retryHint);
        psmClass = RepairJson(text);
        if (!psmClass || typeof psmClass !== "object" || Array.isArray(psmClass)) {
          throw new Error("LLM 输出无法解析为有效 PSM 对象");
        }
        lastError = "";
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message.substring(0, 1500) : String(err);
        if (attempt < MAX_RETRIES) {
          console.warn(`[PSM Class] ${module_name} 第 ${attempt + 1} 次失败，准备第 ${attempt + 2} 次重试...`);
        } else {
          throw err;
        }
      }
    }

    // 后处理
    psmClass = postProcessPsmClass(
      psmClass as Record<string, unknown>,
      basePackage, module_id, module_name, directory_name, pimJson
    );

    fs.writeFileSync(path.join(designDir, "psm_class.json"), JSON.stringify(psmClass, null, 2));

    // Schema 校验（非阻塞）
    try { validatePsmSchema("psm_class", psmClass); } catch (schemaErr) {
      console.warn(`[PSM Class] ${module_name} schema 校验失败（文件已落盘）`);
    }

    // PlantUML
    try {
      const pumlContent = convertPsmClassJsonToPuml(psmClass as Record<string, unknown>);
      writePumlFile(designDir, "psm_class.puml", pumlContent);
    } catch (pumlErr) {
      console.warn(`[PSM Class] ${module_name} PlantUML 生成失败`);
    }

    console.log(`[PSM Class] ${module_name} 完成`);
    return { moduleId: module_id, moduleName: module_name, success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[PSM Class] ${module_name} 失败: ${msg}`);
    return { moduleId: module_id, moduleName: module_name, success: false, error: msg };
  }
}

// ============ PSM 时序图生成 ============

async function generateSinglePsmSequence(
  moduleNode: ModuleTreeNode,
  moduleDir: string
): Promise<{ moduleId: string; moduleName: string; success: boolean; error?: string }> {
  const { module_id, module_name } = moduleNode;
  console.log(`\n[PSM Seq] 处理模块: ${module_name} (${module_id})`);

  try {
    const designDir = path.join(moduleDir, "design");
    const pimSeqFile = path.join(designDir, "pim_sequence.json");
    const psmClassFile = path.join(designDir, "psm_class.json");

    if (!fs.existsSync(pimSeqFile)) {
      return { moduleId: module_id, moduleName: module_name, success: false, error: "缺少 pim_sequence.json" };
    }
    if (!fs.existsSync(psmClassFile)) {
      return { moduleId: module_id, moduleName: module_name, success: false, error: "缺少 psm_class.json" };
    }

    const pimSeqData = JSON.parse(fs.readFileSync(pimSeqFile, "utf-8"));
    const psmClassJson = fs.readFileSync(psmClassFile, "utf-8");

    const pimSequences = Array.isArray(pimSeqData) ? pimSeqData : [pimSeqData];
    const schemaText = readSchemaText("psm_sequence");
    const psmSequences: unknown[] = [];

    for (let i = 0; i < pimSequences.length; i++) {
      const seqPrompt = buildPsmSequenceUserPrompt(JSON.stringify(pimSequences[i], null, 2), psmClassJson);

      let psmSeq: unknown = null;
      let lastSeqErr = "";
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const retryHint = attempt > 0 && lastSeqErr
            ? `\n\n# 上次校验失败错误\n${lastSeqErr}\n\n请修复后重新输出。`
            : "";
          const text = await callPsmSequenceLLM(PSM_SEQUENCE_SYSTEM_PROMPT + `\n${schemaText}`, seqPrompt + retryHint);
          psmSeq = RepairJson(text);
          validatePsmSchema("psm_sequence", psmSeq);
          lastSeqErr = "";
          break;
        } catch (seqErr) {
          lastSeqErr = seqErr instanceof Error ? seqErr.message.substring(0, 1500) : String(seqErr);
          if (attempt < MAX_RETRIES) {
            console.warn(`[PSM Seq] ${module_name} seq ${i + 1} 第 ${attempt + 1} 次校验失败，准备第 ${attempt + 2} 次重试...`);
          } else {
            console.warn(`[PSM Seq] ${module_name} seq ${i + 1} 重试 ${MAX_RETRIES} 次后仍失败: ${lastSeqErr}`);
          }
        }
      }

      if (psmSeq) {
        psmSequences.push(psmSeq);
      }
    }

    if (psmSequences.length > 0) {
      const output = psmSequences.length === 1 ? psmSequences[0] : psmSequences;
      fs.writeFileSync(path.join(designDir, "psm_sequence.json"), JSON.stringify(output, null, 2));

      try {
        const psmSeqObj = (Array.isArray(output) ? output[0] : output) as Record<string, unknown>;
        const pumlContent = convertPsmSequenceJsonToPuml(psmSeqObj);
        writePumlFile(designDir, "psm_sequence.puml", pumlContent);
      } catch (pumlErr) {
        console.warn(`[PSM Seq] ${module_name} PlantUML 生成失败`);
      }

      console.log(`[PSM Seq] ${module_name} 完成 (${psmSequences.length} 个)`);
      return { moduleId: module_id, moduleName: module_name, success: true };
    }

    return { moduleId: module_id, moduleName: module_name, success: false, error: "无有效生成结果" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[PSM Seq] ${module_name} 失败: ${msg}`);
    return { moduleId: module_id, moduleName: module_name, success: false, error: msg };
  }
}

// ============ 路径构建 ============

function buildModulePath(node: ModuleTreeNode, currentPath: string): { node: ModuleTreeNode; fullPath: string }[] {
  const nodePath = path.join(currentPath, node.directory_name);
  if (node.is_leaf) {
    return [{ node, fullPath: nodePath }];
  }
  let leaves: { node: ModuleTreeNode; fullPath: string }[] = [];
  if (node.children) {
    const childrenPath = path.join(nodePath, "modules");
    for (const child of node.children) {
      leaves.push(...buildModulePath(child, childrenPath));
    }
  }
  return leaves;
}

// ============ 批量生成 ============

export async function generateAllPsmClassDiagrams(
  moduleTreePath?: string,
  rootDir?: string
): Promise<{ results: { moduleId: string; moduleName: string; success: boolean; error?: string }[] }> {
  console.log("开始为所有叶子模块生成 PSM 类图...");

  const moduleTree = readModuleTree(moduleTreePath);
  const actualRootDir = rootDir || path.dirname(path.dirname(moduleTreePath || "")) || process.cwd();
  const { basePackage } = readProjectRules(actualRootDir);
  console.log(` Base package: ${basePackage}`);

  const modulesDir = path.join(actualRootDir, "design_model", "modules");

  const leafModulesWithPaths: { node: ModuleTreeNode; fullPath: string }[] = [];
  if (moduleTree.root.children) {
    for (const child of moduleTree.root.children) {
      leafModulesWithPaths.push(...buildModulePath(child, modulesDir));
    }
  }

  console.log(` 发现 ${leafModulesWithPaths.length} 个叶子模块`);

  const results: { moduleId: string; moduleName: string; success: boolean; error?: string }[] = [];
  for (let i = 0; i < leafModulesWithPaths.length; i += MAX_PARALLEL_MODULES) {
    const batch = leafModulesWithPaths.slice(i, i + MAX_PARALLEL_MODULES);
    const batchResults = await Promise.all(
      batch.map(({ node, fullPath }) => generateSinglePsmClass(node, fullPath, basePackage))
    );
    results.push(...batchResults);
  }

  const successCount = results.filter((r) => r.success).length;
  console.log(` PSM 类图完成: ${successCount}/${results.length}`);
  return { results };
}

export async function generateAllPsmSequenceDiagrams(
  moduleTreePath?: string,
  rootDir?: string
): Promise<{ results: { moduleId: string; moduleName: string; success: boolean; error?: string }[] }> {
  console.log("开始为所有叶子模块生成 PSM 时序图...");

  const moduleTree = readModuleTree(moduleTreePath);
  const actualRootDir = rootDir || path.dirname(path.dirname(moduleTreePath || "")) || process.cwd();
  const modulesDir = path.join(actualRootDir, "design_model", "modules");

  const leafModulesWithPaths: { node: ModuleTreeNode; fullPath: string }[] = [];
  if (moduleTree.root.children) {
    for (const child of moduleTree.root.children) {
      leafModulesWithPaths.push(...buildModulePath(child, modulesDir));
    }
  }

  console.log(` 发现 ${leafModulesWithPaths.length} 个叶子模块`);

  const results: { moduleId: string; moduleName: string; success: boolean; error?: string }[] = [];
  for (let i = 0; i < leafModulesWithPaths.length; i += MAX_PARALLEL_MODULES) {
    const batch = leafModulesWithPaths.slice(i, i + MAX_PARALLEL_MODULES);
    const batchResults = await Promise.all(
      batch.map(({ node, fullPath }) => generateSinglePsmSequence(node, fullPath))
    );
    results.push(...batchResults);
  }

  const successCount = results.filter((r) => r.success).length;
  console.log(` PSM 时序图完成: ${successCount}/${results.length}`);
  return { results };
}
