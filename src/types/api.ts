import {
  type ProgrammingLanguage,
  type Stage1Output,
  type UMLModel,
} from "./diagram.js";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

// 定义单次澄清的结构
export interface ClarificationTurn {
  question: string; // LLM 问的问题
  answer: string;   // 用户的回答
}

// 1. API 请求体 (输入规范)
export interface UMLRequest {
  requirement: string; // 必填，自然语言需求
  language?: ProgrammingLanguage; // 可选

  // 历史记录数组：前端把之前所有的问答都传过来
  history?: ClarificationTurn[];
}

//
export interface UMLApiResponse {
  status: "success" | "needs_clarification" | "error";

  // 如果 status === "success"，说明执行完stage1和2了
  data?: UMLModel;

  // 如果 status === "needs_clarification"，说明待澄清
  clarification?: {
    question: string; // AI 问用户的问题
    originalRequirement: string; // 把原始需求带回来，防止前端丢失
    // contextId?: string; // (可选) 用于标记这轮对话的ID
  };

  // 如果 status === "error"
  errorMessage?: string;
}
