import { callUMLGenerator, callModifyLLM} from "../utils.js";
import { CLASS_DIAGRAM_SYSTEM_PROMPT } from "../promptUtils/prompt.js";
import { LongTextProcess } from "./longTextProcess.js";
import type {
  UMLApiResponse,
  UMLRequest,
  ChatMessage,
} from "../../types/api.js";
import type { UMLModel } from "../../types/diagram.js";

// 短文本处理（单阶段直接生成）
export const ShortTextProcess = async (
  userInput: UMLRequest,
): Promise<UMLApiResponse> => {
  console.log("[ShortText] 处理生成请求...");
  const finalModel: UMLModel = await callUMLGenerator(userInput.requirement);
  return { status: "success", data: finalModel };
};

// 模型修改
export const ModifyProcess = async (
  userInput: UMLRequest,
): Promise<UMLApiResponse> => {
  console.log("[Modify] 处理 UML 模型修改请求...");

  if (!userInput.currentModel || !userInput.requirement) {
    throw new Error("ModifyProcess 需要 currentModel 和 requirement 参数");
  }

  const modifyMessages: ChatMessage[] = [
    { role: "system", content: CLASS_DIAGRAM_SYSTEM_PROMPT },
    { role: "user", content: `这是当前的 UML 模型：\n${JSON.stringify(userInput.currentModel)}\n\n用户的修改要求是：${userInput.requirement}` }
  ];

  const updatedModel: UMLModel = await callModifyLLM(modifyMessages);
  return { status: "success", data: updatedModel };
};

// 中文本处理（单阶段直接生成，与短文本相同逻辑）
export const MediumTextProcess = ShortTextProcess;

// 长文本处理（分块并行处理）
export { LongTextProcess };