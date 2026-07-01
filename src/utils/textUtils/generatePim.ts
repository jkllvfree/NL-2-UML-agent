/**
 * PIM 生成服务 — 将业务模型转换为平台无关设计模型。
 */
import * as fs from "fs";
import * as path from "path";
import { readModuleTree } from "./generateClassDiagram.js";
import { callPimClassLLM, callPimSequenceLLM } from "../utils.js";
import { RepairJson } from "../repairUtils/repair.js";
import { validatePimSchema } from "../schemaUtils/businessModelSchemas.js";
import { readSchemaText } from "../schemaUtils/businessModelSchemas.js";
import {
  PIM_CLASS_SYSTEM_PROMPT,
  buildPimClassUserPrompt,
  PIM_SEQUENCE_SYSTEM_PROMPT,
  buildPimSequenceUserPrompt,
} from "../promptUtils/pimPrompts.js";
import {
  convertPimClassJsonToPuml,
  convertPimSequenceJsonToPuml,
  writePumlFile,
} from "../pumlUtils/convertToPuml.js";
import type { ModuleTreeNode } from "../../types/diagram.js";

const MAX_RETRIES = 5;
const MAX_PARALLEL_MODULES = 3;

// 从 project_rules.json 读取非功能需求配置
function readNfrConfig(workspaceRoot: string): string {
  // v0.4.0: 优先读 .d2c/project.json，fallback 到 .model/config/project_rules.json
  const newPath = path.join(workspaceRoot, ".d2c", "project.json");
  const legacyPath = path.join(workspaceRoot, ".model", "config", "project_rules.json");
  const rulesPath = fs.existsSync(newPath) ? newPath : (fs.existsSync(legacyPath) ? legacyPath : null);
  if (!rulesPath) return "";

  try {
    const rules = JSON.parse(fs.readFileSync(rulesPath, "utf-8"));
    const nfr = rules?.nonFunctionalRequirements;
    if (nfr?.rawContent && typeof nfr.rawContent === "string") {
      console.log(` 已读取 NFR 配置 (${nfr.rawContent.length} 字符)`);
      return nfr.rawContent;
    }
  } catch { /* ignore */ }
  return "";
}

// ============ PIM 类图生成 ============

async function generateSinglePimClass(
  moduleNode: ModuleTreeNode,
  moduleDir: string,
  nfrContent?: string
): Promise<{ moduleId: string; moduleName: string; success: boolean; classViewPath?: string; error?: string }> {
  const { module_id, module_name } = moduleNode;
  console.log(`\n[PIM Class] 处理模块: ${module_name} (${module_id})`);

  try {
    const designDir = path.join(moduleDir, "design");
    const bmClassFile = path.join(designDir, "business_model_class.json");
    if (!fs.existsSync(bmClassFile)) {
      return { moduleId: module_id, moduleName: module_name, success: false, error: "缺少 business_model_class.json" };
    }

    const businessModelJson = fs.readFileSync(bmClassFile, "utf-8");
    const schemaText = readSchemaText("pim_class");
    const userPrompt = buildPimClassUserPrompt(businessModelJson, nfrContent);

    let pimClass: unknown = null;
    let lastError = "";
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const retryHint = attempt > 0 && lastError
          ? `\n\n# 上次校验失败错误\n${lastError}\n\n请修复上述 JSON Schema 错误后重新输出。`
          : "";
        const text = await callPimClassLLM(PIM_CLASS_SYSTEM_PROMPT + `\n${schemaText}`, userPrompt + retryHint);
        pimClass = RepairJson(text);
        validatePimSchema("pim_class", pimClass);
        lastError = "";
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message.substring(0, 1500) : String(err);
        if (attempt < MAX_RETRIES) {
          console.warn(`[PIM Class] ${module_name} 第 ${attempt + 1} 次校验失败，准备第 ${attempt + 2} 次重试...`);
        } else {
          throw err;
        }
      }
    }

    // 写入 pim_class.json
    fs.writeFileSync(path.join(designDir, "pim_class.json"), JSON.stringify(pimClass, null, 2));

    // 生成 PlantUML
    try {
      const pumlContent = convertPimClassJsonToPuml(pimClass as Record<string, unknown>);
      writePumlFile(designDir, "pim_class.puml", pumlContent);
    } catch (pumlErr) {
      console.warn(`[PIM Class] ${module_name} PlantUML 生成失败`);
    }

    console.log(`[PIM Class] ${module_name} 完成`);
    return { moduleId: module_id, moduleName: module_name, success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[PIM Class] ${module_name} 失败: ${msg}`);
    return { moduleId: module_id, moduleName: module_name, success: false, error: msg };
  }
}

// ============ PIM 时序图生成 ============

async function generateSinglePimSequence(
  moduleNode: ModuleTreeNode,
  moduleDir: string,
  nfrContent?: string
): Promise<{ moduleId: string; moduleName: string; success: boolean; sequencePath?: string; error?: string }> {
  const { module_id, module_name } = moduleNode;
  console.log(`\n[PIM Seq] 处理模块: ${module_name} (${module_id})`);

  try {
    const designDir = path.join(moduleDir, "design");
    const seqFile = path.join(designDir, "business_model_sequence.json");
    const pimClassFile = path.join(designDir, "pim_class.json");

    if (!fs.existsSync(seqFile)) {
      return { moduleId: module_id, moduleName: module_name, success: false, error: "缺少 business_model_sequence.json" };
    }
    if (!fs.existsSync(pimClassFile)) {
      return { moduleId: module_id, moduleName: module_name, success: false, error: "缺少 pim_class.json" };
    }

    const seqData = JSON.parse(fs.readFileSync(seqFile, "utf-8"));
    const pimClassJson = fs.readFileSync(pimClassFile, "utf-8");

    // nl2uml 的序列输出是 SequenceView (interactions 数组)，逐个处理
    const interactions = Array.isArray(seqData.interactions) ? seqData.interactions : (Array.isArray(seqData) ? seqData : [seqData]);
    const schemaText = readSchemaText("pim_sequence");
    const pimSequences: unknown[] = [];

    for (let i = 0; i < interactions.length; i++) {
      const seq = interactions[i];
      const seqPrompt = buildPimSequenceUserPrompt(JSON.stringify(seq, null, 2), pimClassJson, nfrContent);

      let pimSeq: unknown = null;
      let lastSeqError = "";
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const retryHint = attempt > 0 && lastSeqError
            ? `\n\n# 上次校验失败错误\n${lastSeqError}\n\n请修复后重新输出。`
            : "";
          const text = await callPimSequenceLLM(PIM_SEQUENCE_SYSTEM_PROMPT + `\n${schemaText}`, seqPrompt + retryHint);
          pimSeq = RepairJson(text);
          validatePimSchema("pim_sequence", pimSeq);
          lastSeqError = "";
          break;
        } catch (seqErr) {
          lastSeqError = seqErr instanceof Error ? seqErr.message.substring(0, 1500) : String(seqErr);
          if (attempt < MAX_RETRIES) {
            console.warn(`[PIM Seq] ${module_name} seq ${i + 1} 第 ${attempt + 1} 次校验失败，准备第 ${attempt + 2} 次重试...`);
          } else {
            console.warn(`[PIM Seq] ${module_name} seq ${i + 1} 重试 ${MAX_RETRIES} 次后仍失败: ${lastSeqError}`);
          }
        }
      }

      if (pimSeq) {
        pimSequences.push(pimSeq);
      }
    }

    if (pimSequences.length > 0) {
      const output = pimSequences.length === 1 ? pimSequences[0] : pimSequences;
      fs.writeFileSync(path.join(designDir, "pim_sequence.json"), JSON.stringify(output, null, 2));

      // PlantUML
      try {
        const pimSeqObj = (Array.isArray(output) ? output[0] : output) as Record<string, unknown>;
        const pumlContent = convertPimSequenceJsonToPuml(pimSeqObj);
        writePumlFile(designDir, "pim_sequence.puml", pumlContent);
      } catch (pumlErr) {
        console.warn(`[PIM Seq] ${module_name} PlantUML 生成失败`);
      }

      console.log(`[PIM Seq] ${module_name} 完成 (${pimSequences.length} 个交互)`);
      return { moduleId: module_id, moduleName: module_name, success: true };
    }

    return { moduleId: module_id, moduleName: module_name, success: false, error: "无有效生成结果" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[PIM Seq] ${module_name} 失败: ${msg}`);
    return { moduleId: module_id, moduleName: module_name, success: false, error: msg };
  }
}

// ============ 路径构建（递归，与 generateClassDiagram 一致） ============

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

// ============ 批量生成（类图 + 时序图） ============

export async function generateAllPimClassDiagrams(
  moduleTreePath?: string,
  rootDir?: string
): Promise<{ results: { moduleId: string; moduleName: string; success: boolean; error?: string }[] }> {
  console.log("开始为所有叶子模块生成 PIM 类图...");

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

  // 读取非功能需求配置（project_rules.json → nonFunctionalRequirements）
  const nfrContent = readNfrConfig(actualRootDir);

  const results: { moduleId: string; moduleName: string; success: boolean; error?: string }[] = [];
  for (let i = 0; i < leafModulesWithPaths.length; i += MAX_PARALLEL_MODULES) {
    const batch = leafModulesWithPaths.slice(i, i + MAX_PARALLEL_MODULES);
    const batchResults = await Promise.all(
      batch.map(({ node, fullPath }) => generateSinglePimClass(node, fullPath, nfrContent))
    );
    results.push(...batchResults);
  }

  const successCount = results.filter((r) => r.success).length;
  console.log(` PIM 类图完成: ${successCount}/${results.length}`);
  return { results };
}

export async function generateAllPimSequenceDiagrams(
  moduleTreePath?: string,
  rootDir?: string
): Promise<{ results: { moduleId: string; moduleName: string; success: boolean; error?: string }[] }> {
  console.log("开始为所有叶子模块生成 PIM 时序图...");

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

  // 读取非功能需求配置（project_rules.json → nonFunctionalRequirements）
  const nfrContent = readNfrConfig(actualRootDir);

  const results: { moduleId: string; moduleName: string; success: boolean; error?: string }[] = [];
  for (let i = 0; i < leafModulesWithPaths.length; i += MAX_PARALLEL_MODULES) {
    const batch = leafModulesWithPaths.slice(i, i + MAX_PARALLEL_MODULES);
    const batchResults = await Promise.all(
      batch.map(({ node, fullPath }) => generateSinglePimSequence(node, fullPath, nfrContent))
    );
    results.push(...batchResults);
  }

  const successCount = results.filter((r) => r.success).length;
  console.log(` PIM 时序图完成: ${successCount}/${results.length}`);
  return { results };
}
