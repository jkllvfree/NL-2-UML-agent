import { callStage1LLM, callStage2LLM } from "../utils.js";
import {
  // generateStage1Prompt,
  generateStage2Prompt,
} from "../promptUtils/prompt.js";
import type { UMLApiResponse, UMLRequest,ChatMessage } from "../../types/api.js";
import type { Stage1Output, UMLModel } from "../../types/diagram.js";

// 职责：处理不同长度文本的任务
export const ShortTextProcess = async (
  userInput: UMLRequest,
): Promise<UMLApiResponse> => {

  const messages: ChatMessage[] = [];

  // 1. 永远把用户的原始需求放在第一句
  messages.push({ role: "user", content: userInput.requirement });

  // 2. 如果有历史记录，按顺序“重播”之前的对话
  if (userInput.history && userInput.history.length > 0) {
    for (const turn of userInput.history) {
      // 模拟 LLM 之前的提问
      messages.push({ 
        role: "assistant", 
        content: JSON.stringify({ ambiguities: [turn.question] }) 
      });
      // 模拟用户之前的回答
      messages.push({ 
        role: "user", 
        content: turn.answer 
      });
    }
    
    // 在最后加一句 Prompt，提示它根据补充信息进行最终生成
    messages.push({
      role: "user",
      content: "请结合上述所有的补充信息，重新提取实体和关系。如果信息已经充足，请保持 ambiguities 为空数组。"
    });
  }

  const stage1Result: Stage1Output = await callStage1LLM(messages);
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
        originalRequirement: userInput.requirement,
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
