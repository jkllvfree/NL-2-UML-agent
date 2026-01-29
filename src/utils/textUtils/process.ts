import { callStage1LLM, callStage2LLM } from "../utils.js";
import {
  generateStage1Prompt,
  generateStage2Prompt,
} from "../promptUtils/prompt.js";
import type { UMLApiResponse } from "../../types/api.js";
import type { Stage1Output, UMLModel } from "../../types/diagram.js";

// 职责：处理不同长度文本的任务
export const ShortTextProcess = async (
  userInput: string,
): Promise<UMLApiResponse> => {
  // // stage1 的提示词
  const stage1_prompt = generateStage1Prompt(userInput);
  const stage1Result: Stage1Output = await callStage1LLM(stage1_prompt);
  //判断是否需要澄清
  const hasAmbiguities =
    stage1Result.ambiguities && stage1Result.ambiguities.length > 0;

  // 如果有歧义，且不是第二轮（即没有上下文），则打断流程
  if (hasAmbiguities) {
    // 将 Stage1Output 转为 API 响应 ===
    return {
      status: "needs_clarification",
      clarification: {
        // 将数组合并为一个字符串问题，或者只取第一个
        question: stage1Result.ambiguities.join("\n"),
        originalRequirement: userInput,
      },
    };
  }

  // 3. 如果没歧义，或者用户已经回答了，继续 Stage 2
  const stage2_prompt = generateStage2Prompt(stage1Result);
  const finalModel: UMLModel = await callStage2LLM(stage2_prompt);

  // 4. 返回最终成功响应
  return {
    status: "success",
    data: finalModel,
  };
};

export const MediumTextProcess = (): void => {};

export const LongTextProcess = (): void => {};
