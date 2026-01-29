import { generateText } from "ai"; // 用的 Vercel AI SDK
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { openai } from "@ai-sdk/openai";
import { RepairJson,
  validateAndNormalizeResult_1,
  validateAndNormalizeResult_2,
  transformToUMLModel 
} from "./repairUtils/repair.js";

//存放工具函数
import type { Stage1Output, Stage2Output, UMLModel } from "../types/diagram.js";

// 创建 DeepSeek 客户端
const deepseek = createOpenAICompatible({
  name: "deepseek",
  baseURL: "https://api.deepseek.com/v1",  // DeepSeek API 地址
  apiKey: process.env.DEEPSEEK_API_KEY || "",  // 从环境变量读取
});


//stage1 的处理过程，调用api
export const callStage1LLM = async (prompt: string): Promise<Stage1Output> => {
  try {
    // 调用 LLM API
    console.log("🤖 [Stage 1] 使用 DeepSeek 处理...");
    
    const { text } = await generateText({
      model: deepseek("deepseek-chat"),  // 使用 deepseek-chat 模型
      prompt: prompt,
      temperature: 0.1,
    });

    console.log("📝 [Stage 1] Raw Response:", text.substring(0, 50) + "...");

    // 清洗逻辑，转化为对象返回 
    let result;
    result = RepairJson<Stage1Output>(text);
    result = validateAndNormalizeResult_1(result);
    return result;
  } catch (error) {
    console.error("❌ [Stage 1] Failed:", error);
    // 返回一个空对象兜底，或者直接 throw error 让外层处理重试
    throw error;
  }
};

//stage2 的处理过程
export const callStage2LLM = async (prompt: string): Promise<UMLModel> => {
  //调用api
  try {
    // 调用 LLM API
    console.log("🤖 [Stage 2] 使用 DeepSeek 处理...");
    
    const { text } = await generateText({
      model: deepseek("deepseek-chat"),  // 使用 deepseek-chat 模型
      prompt: prompt,
      temperature: 0.1,
    });

    console.log("📝 [Stage 2] Raw Response:", text.substring(0, 50) + "...");

    // 清洗逻辑，转化为对象返回 
    let output = RepairJson<Stage2Output>(text);
    output = validateAndNormalizeResult_2(output);
    //将Stage2Output组装成UMLModel返回
  
    let result = transformToUMLModel(output);
    return result;
  } catch (error) {
    console.error("❌ [Stage 1] Failed:", error);
    // 返回一个空对象兜底，或者直接 throw error 让外层处理重试
    throw error;
  }
};
