import {
  type ProgrammingLanguage,
  type Stage1Output,
  type UMLModel,
} from "./diagram.js";

// 1. API 请求体 (输入规范)
export interface UMLRequest {
  requirement: string; // 必填，自然语言需求
  language?: ProgrammingLanguage; // 可选
  context?: Record<string, any>; // 可选，上下文信息
  clarificationContext?: {
    //可选，处理需求澄清（新增加）
    question: string;
    answer: string;
  };
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
