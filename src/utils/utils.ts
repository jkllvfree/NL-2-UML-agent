import { generateText } from "ai"; // 用的 Vercel AI SDK
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateClassDiagramUserPrompt, MODULE_TREE_SYSTEM_PROMPT, CLASS_DIAGRAM_SYSTEM_PROMPT, SEQUENCE_DIAGRAM_SYSTEM_PROMPT } from "./promptUtils/prompt.js";
import { readBusinessModelSchemaText, type BusinessModelSchemaName, type PimSchemaName, type PsmSchemaName } from "./schemaUtils/businessModelSchemas.js";
import { RepairJson,
  validateAndNormalizeResult_2,
  transformToUMLModel
} from "./repairUtils/repair.js";

//存放工具函数
import type { Stage2Output, UMLModel, ModuleTree, LeafModel, SequenceModel } from "../types/diagram.js";
import type { ChatMessage } from "../types/api.js";

const llmClient = createOpenAICompatible({
  name: process.env.NL2UML_LLM_PROVIDER || "nl2uml",
  baseURL: process.env.NL2UML_LLM_BASE_URL || "",
  apiKey: process.env.NL2UML_LLM_API_KEY || "",
});

const llmModel = process.env.NL2UML_LLM_MODEL || "";

const llmTemperature = (() => {
  const raw = process.env.NL2UML_LLM_TEMPERATURE;
  if (!raw) return 0.1;
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0.1;
})();

//6.3晚修改，暂时不用的变量
// const activeModelName = process.env.MODEL_NAME || "deepseek-chat";

export const repairBusinessModelJson = async <T>(
  schemaName: BusinessModelSchemaName,
  invalidJson: string,
  validationError: string,
  context: string
): Promise<T> => {
  try {
    console.log(`🔁 [Schema Repair] 修复 ${schemaName} 业务模型 JSON...`);

    const prompt = `
# 修复任务
下面的 JSON 未通过 business model schema 校验。请根据 schema 校验错误修复 JSON。

# 输出要求
1. 只返回修复后的纯 JSON 字符串
2. 不要包含 markdown 标记
3. 不要解释
4. 不要输出 schema 中 additionalProperties=false 禁止的字段
5. 保留原始业务语义，只修正结构、字段、类型、枚举值和缺失必填项

# 上下文
${context}

# Schema 校验错误
${validationError}

# 目标 JSON Schema
${readBusinessModelSchemaText(schemaName)}

# 待修复 JSON
${invalidJson}
`;

    const { text } = await generateText({
      // model: deepseek(activeModelName),
      model: llmClient(llmModel),
      system: "你是严格的 JSON Schema 修复器。你只输出满足目标 schema 的 JSON。",
      prompt,
      temperature: 0,
    });

    console.log("[Schema Repair] Raw Response:", text.substring(0, 100) + "...");
    return RepairJson<T>(text);
  } catch (error) {
    console.error("[Schema Repair] Failed:", error);
    throw error;
  }
};

// ============ PIM LLM 调用 ============

export const callPimClassLLM = async (systemPrompt: string, userPrompt: string): Promise<string> => {
  console.log("🤖 [PIM Class] 使用 LLM 处理...");
  const { text } = await generateText({
    //  model: deepseek(activeModelName),
    model: llmClient(llmModel),
    system: systemPrompt,
    prompt: userPrompt,
    temperature: 0.1,
  });
  return text;
};

export const callPimSequenceLLM = async (systemPrompt: string, userPrompt: string): Promise<string> => {
  console.log("🤖 [PIM Sequence] 使用 LLM 处理...");
  const { text } = await generateText({
    // model: deepseek(activeModelName),
    model: llmClient(llmModel),
    system: systemPrompt,
    prompt: userPrompt,
    temperature: 0.1,
  });
  return text;
};

export const repairPimJson = async <T>(
  schemaName: PimSchemaName,
  invalidJson: string,
  validationError: string,
  context: string
): Promise<T> => {
  console.log(`🔁 [PIM Repair] 修复 ${schemaName} JSON...`);
  const prompt = `
# 修复任务
下面的 JSON 未通过 schema 校验。请修复 JSON。

# 输出要求
1. 只返回修复后的纯 JSON 字符串
2. 不要包含 markdown 标记

# 上下文
${context}

# Schema 校验错误
${validationError}

# 目标 JSON Schema
${readBusinessModelSchemaText(schemaName)}

# 待修复 JSON
${invalidJson}
`;
  const { text } = await generateText({
    // model: deepseek(activeModelName),
    model: llmClient(llmModel),
    system: "你是严格的 JSON Schema 修复器。你只输出满足目标 schema 的 JSON。",
    prompt,
    temperature: 0,
  });
  return RepairJson<T>(text);
};

// ============ PSM LLM 调用 ============

export const callPsmClassLLM = async (systemPrompt: string, userPrompt: string): Promise<string> => {
  console.log("🤖 [PSM Class] 使用 LLM 处理...");
  const { text } = await generateText({
    // model: deepseek(activeModelName),
    model: llmClient(llmModel),
    system: systemPrompt,
    prompt: userPrompt,
    temperature: 0.1,
  });
  return text;
};

export const callPsmSequenceLLM = async (systemPrompt: string, userPrompt: string): Promise<string> => {
  console.log("🤖 [PSM Sequence] 使用 LLM 处理...");
  const { text } = await generateText({
    // model: deepseek(activeModelName),
    model: llmClient(llmModel),
    system: systemPrompt,
    prompt: userPrompt,
    temperature: 0.1,
  });
  return text;
};

export const repairPsmJson = async <T>(
  schemaName: PsmSchemaName,
  invalidJson: string,
  validationError: string,
  context: string
): Promise<T> => {
  console.log(`🔁 [PSM Repair] 修复 ${schemaName} JSON...`);
  const prompt = `
# 修复任务
下面的 JSON 未通过 schema 校验。请修复 JSON。

# 输出要求
1. 只返回修复后的纯 JSON 字符串
2. 不要包含 markdown 标记

# 上下文
${context}

# Schema 校验错误
${validationError}

# 目标 JSON Schema
${readBusinessModelSchemaText(schemaName)}

# 待修复 JSON
${invalidJson}
`;
  const { text } = await generateText({
    // model: deepseek(activeModelName),
    model: llmClient(llmModel),
    system: "你是严格的 JSON Schema 修复器。你只输出满足目标 schema 的 JSON。",
    prompt,
    temperature: 0,
  });
  return RepairJson<T>(text);
};

// 单阶段 UML 生成：直接根据用户需求生成
export const callUMLGenerator = async (requirement: string): Promise<UMLModel> => {
  try {
    console.log("🤖 [UML Generator] 使用 LLM 处理...");

    const userPrompt = generateClassDiagramUserPrompt("M01", "Root", requirement);

    const { text } = await generateText({
      model: llmClient(llmModel),
      system: CLASS_DIAGRAM_SYSTEM_PROMPT,
      prompt: userPrompt,
      temperature: llmTemperature,
    });

    console.log("[UML Generator] Raw Response:", text.substring(0, 50) + "...");

    let output = RepairJson<Stage2Output>(text);
    output = validateAndNormalizeResult_2(output);
    const result = transformToUMLModel(output);
    return result;
  } catch (error) {
    console.error("[UML Generator] Failed:", error);
    throw error;
  }
};

// 修改模型的处理过程
export const callModifyLLM = async (messages: ChatMessage[]): Promise<UMLModel> => {
  try {
    console.log("🤖 [Modify] 处理模型修改请求...");

    const prompt = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");

    const { text } = await generateText({
      model: llmClient(llmModel),
      prompt: prompt,
      temperature: llmTemperature,
    });

    console.log("[Modify] Raw Response:", text.substring(0, 50) + "...");

    let output = RepairJson<Stage2Output>(text);
    output = validateAndNormalizeResult_2(output);
    const result = transformToUMLModel(output);

    return result;
  } catch (error) {
    console.error("[Modify] Failed:", error);
    throw error;
  }
};

// 模块树生成：调用 LLM
export const callModuleTreeLLM = async (prompt: string): Promise<ModuleTree> => {
  try {
    console.log("🤖 [Module Tree] 使用 LLM 处理...");

    const { text } = await generateText({
      model: llmClient(llmModel),
      system: MODULE_TREE_SYSTEM_PROMPT,
      prompt: prompt,
      temperature: llmTemperature,
    });

    console.log("[Module Tree] Raw Response:", text.substring(0, 100) + "...");

    // 清洗逻辑，转化为对象返回
    const result = RepairJson<ModuleTree>(text);
    return result;
  } catch (error) {
    console.error("[Module Tree] Failed:", error);
    throw error;
  }
};

// 类图生成：调用 LLM（叶子模块类图）
export const callClassDiagramLLM = async (prompt: string): Promise<LeafModel> => {
  try {
    console.log("🤖 [Class Diagram] 使用 LLM 处理...");

    const { text } = await generateText({
      model: llmClient(llmModel),
      system: CLASS_DIAGRAM_SYSTEM_PROMPT,
      prompt: prompt,
      temperature: llmTemperature,
    });

    console.log("[Class Diagram] Raw Response:", text.substring(0, 100) + "...");

    // 清洗逻辑，转化为对象返回
    const result = RepairJson<LeafModel>(text);
    return result;
  } catch (error) {
    console.error("[Class Diagram] Failed:", error);
    throw error;
  }
};

// 时序图生成：调用 LLM
export const callSequenceDiagramLLM = async (prompt: string): Promise<SequenceModel> => {
  try {
    console.log("🤖 [Sequence Diagram] 使用 LLM 处理...");

    const { text } = await generateText({
      model: llmClient(llmModel),
      system: SEQUENCE_DIAGRAM_SYSTEM_PROMPT,
      prompt: prompt,
      temperature: llmTemperature,
    });

    console.log("[Sequence Diagram] Raw Response:", text.substring(0, 100) + "...");

    const result = RepairJson<SequenceModel>(text);
    return result;
  } catch (error) {
    console.error("[Sequence Diagram] Failed:", error);
    throw error;
  }
};

// 批量时序图生成：调用 LLM 一次生成多个
export const callMultiSequenceDiagramLLM = async (prompt: string): Promise<SequenceModel[]> => {
  try {
    console.log("🤖 [Multi Sequence Diagram] 使用 LLM 处理...");

    const { text } = await generateText({
      model: llmClient(llmModel),
      system: SEQUENCE_DIAGRAM_SYSTEM_PROMPT,
      prompt: prompt,
      temperature: llmTemperature,
    });

    console.log("[Multi Sequence Diagram] Raw Response:", text.substring(0, 100) + "...");

    // 解析返回的 JSON 数组
    const result = RepairJson<SequenceModel[]>(text);
    return result;
  } catch (error) {
    console.error("[Multi Sequence Diagram] Failed:", error);
    throw error;
  }
};
