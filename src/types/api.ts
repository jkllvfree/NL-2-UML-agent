import {
  type ProgrammingLanguage,
  type Stage1Output,
  type UMLModel,
  type ModuleTree,
  type SequenceModel,
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

// 用于迭代修改时，前端把当前画布上的 UML 数据传回来
  currentModel?: UMLModel;
}

// 模块树生成请求
export interface ModuleTreeRequest {
  projectRoot: string;          // 项目根目录绝对路径
  requirementRelativePath: string; // 需求文档相对路径（相对于 projectRoot）
  projectName: string;
  documentVersion?: string;    // 可选，默认 "1.0.0"
}

export interface PipelineSummaryItem {
  stage: string;
  total: number;
  success: number;
  failed: number;
}

// 模块树生成响应
export interface ModuleTreeResponse {
  status: "success" | "needs_clarification" | "error";
  data?: ModuleTree;             // 生成的模块树
  rootDir?: string;              // 根目录路径
  pipelineSummary?: PipelineSummaryItem[];
  clarification?: {
    question: string;
    originalRequirement?: string;
  };
  errorMessage?: string;
}

// 所有叶子模块类图生成请求
export interface GenerateAllClassDiagramsRequest {
  moduleTreePath?: string;  // 可选，默认读取 ./design_model/module_tree.json
}

// 单个类图生成结果
export interface ClassDiagramResult {
  moduleId: string;
  moduleName: string;
  success: boolean;
  classViewPath?: string;
  error?: string;
}

// 所有叶子模块类图生成响应
export interface GenerateAllClassDiagramsResponse {
  status: "success" | "error";
  results?: ClassDiagramResult[];
  errorMessage?: string;
}

export interface GenerateAllSequenceDiagramsRequest {
  moduleTreePath?: string;
}

export interface SequenceDiagramResult {
  moduleId: string;
  moduleName: string;
  success: boolean;
  sequenceViewPath?: string;
  error?: string;
}

export interface GenerateAllSequenceDiagramsResponse {
  status: "success" | "error";
  results?: SequenceDiagramResult[];
  errorMessage?: string;
}

// ============ PIM 相关类型 ============

export interface GeneratePimDiagramsRequest {
  rootDir?: string;  // 项目根目录绝对路径，默认使用 process.cwd()
}

export interface PimDiagramResult {
  moduleId: string;
  moduleName: string;
  success: boolean;
  error?: string;
}

export interface GeneratePimDiagramsResponse {
  status: "success" | "error";
  classResults?: PimDiagramResult[];
  sequenceResults?: PimDiagramResult[];
  errorMessage?: string;
}

// ============ PSM 相关类型 ============

export interface GeneratePsmDiagramsRequest {
  rootDir?: string;
}

export interface PsmDiagramResult {
  moduleId: string;
  moduleName: string;
  success: boolean;
  error?: string;
}

export interface GeneratePsmDiagramsResponse {
  status: "success" | "error";
  classResults?: PsmDiagramResult[];
  sequenceResults?: PsmDiagramResult[];
  errorMessage?: string;
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
