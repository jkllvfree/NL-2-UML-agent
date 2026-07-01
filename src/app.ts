// 职责：接收NL，调用模型，输出json
import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors"; // 允许 VSCode 插件跨域调用
import * as fs from "fs";
import * as path from "path";

import {
  type UMLRequest,
  type UMLApiResponse,
  type ModuleTreeRequest,
  type ModuleTreeResponse,
  type GenerateAllClassDiagramsRequest,
  type GenerateAllClassDiagramsResponse,
  type GenerateAllSequenceDiagramsRequest,
  type GenerateAllSequenceDiagramsResponse,
  type GeneratePimDiagramsRequest,
  type GeneratePimDiagramsResponse,
  type GeneratePsmDiagramsRequest,
  type GeneratePsmDiagramsResponse,
} from "./types/api.js";
import { classifyText } from "./utils/textUtils/classfication.js";
import { ShortTextProcess, MediumTextProcess, ModifyProcess, LongTextProcess } from "./utils/textUtils/process.js";
import { generateModuleTree } from "./utils/textUtils/generateModuleTree.js";
import { generateAllClassDiagrams } from "./utils/textUtils/generateClassDiagram.js";
import { generateAllSequenceDiagrams } from "./utils/textUtils/generateSequenceDiagram.js";
import { generateAllPimClassDiagrams, generateAllPimSequenceDiagrams } from "./utils/textUtils/generatePim.js";
import { generateAllPsmClassDiagrams, generateAllPsmSequenceDiagrams } from "./utils/textUtils/generatePsm.js";
import { emitProgress, newRequestId } from "./utils/progress.js";


// 环境变量验证
function validateEnvironmentVariables() {
  const requiredVars = ['AGENT_TOKEN', 'AGENT_PORT', 'NL2UML_LLM_BASE_URL', 'NL2UML_LLM_MODEL', 'NL2UML_LLM_API_KEY'];
  const missingVars: string[] = [];
  const emptyVars: string[] = [];

  requiredVars.forEach(varName => {
    const value = process.env[varName];
    if (value === undefined) {
      missingVars.push(varName);
    } else if (value.trim() === '') {
      emptyVars.push(varName);
    }
  });

  // const modelApiKey = process.env.MODEL_API_KEY || process.env.DEEPSEEK_API_KEY;
  // if (!modelApiKey || modelApiKey.trim() === '') {
  //   missingVars.push('MODEL_API_KEY');
  // }

  if (missingVars.length > 0 || emptyVars.length > 0) {
    console.error('环境变量验证失败:');
    if (missingVars.length > 0) {
      console.error(`  缺失的变量: ${missingVars.join(', ')}`);
    }
    if (emptyVars.length > 0) {
      console.error(`  空值的变量: ${emptyVars.join(', ')}`);
    }
    throw new Error('环境变量配置不完整，请检查配置文件');
  }

  console.log('环境变量验证通过');
}

// // 输入频率限制配置
// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15分钟
//   max: 100, // 每个IP最多100个请求
//   message: {
//     status: "error",
//     errorMessage: "请求过于频繁，请稍后再试"
//   },
//   standardHeaders: true, // 返回标准的RateLimit-*头
//   legacyHeaders: false, // 不返回X-RateLimit-*头
// });

const app = express();
const AGENT_PORT = process.env.AGENT_PORT; // 最好也从环境变量读端口，避免冲突
const AGENT_TOKEN = process.env.AGENT_TOKEN; // 核心：从环境变量获取动态 Token

const PORT = Number(AGENT_PORT) || 3005;

// 启动时验证环境变量
try {
  validateEnvironmentVariables();
} catch (error: unknown) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error('服务启动失败:', errorMessage);
  process.exit(1);
}

// 1、严格的 CORS 配置
const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // 放行以下三种情况：
    // 1. !origin: 允许非浏览器环境（如 Postman、脚本）发起请求，把拦截任务交给后续的 Token 校验兜底
    // 2. localhost: 本地前端开发环境
    // 3. vscode-webview://: VS Code 插件内部 Webview 的标准协议前缀
    if (!origin || origin.startsWith("http://localhost") || origin.startsWith("vscode-webview://")) {
      callback(null, true);
    } else {
      callback(new Error("CORS: 不允许的跨域来源"));
    }
  },
  methods: ["POST"], // 目前只有 POST
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false,
  maxAge: 86400
};

app.use(cors(corsOptions));
app.use(express.json());

// 2、身份鉴权中间件
const authMiddleware = (req: Request, res: Response, next: NextFunction) => {

  // 从请求头的 Authorization 字段获取 Token，格式通常是 "Bearer <token>"
  const authHeader = req.headers.authorization;
  const providedToken = authHeader?.split(" ")[1]; // 提取 Bearer 后面的部分

  if (!providedToken || providedToken !== AGENT_TOKEN) {
    // 直接返回 401 状态码，切断后续逻辑
    return res.status(401).json({
      status: "error",
      errorMessage: "Unauthorized: 非法调用",
    });
  }

  // 暗号正确，放行到下一个路由
  next();
};

// 健康检查端点
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

/**
 * POST /uml
 * 功能：接收自然语言需求，返回 UML 类图数据(json格式)
 */
app.post("/uml", authMiddleware, async (req: Request, res: Response) => {
  const body = req.body as UMLRequest;

  // 验证 requirement 必填
  if (!body.requirement || body.requirement.trim() === "") {
    return res.status(400).json({
      status: "error",
      errorMessage: "requirement 为必填字段，不能为空",
    });
  }

  // 限制最大长度，防止恶意请求
  if (body.requirement.length > 10000) {
    return res.status(400).json({
      status: "error",
      errorMessage: "requirement 长度不能超过 10000 字符",
    });
  }

  console.log(`收到请求: ${new Date().toISOString()}`);
  console.log(`需求内容: ${body.requirement?.substring(0, 50)}...`);

  try {
    let result;

    // 优先检查是否为修改模式（当有 currentModel 时）
    if (body.currentModel) {
      console.log("检测到 currentModel，进入修改模式");
      result = await ModifyProcess(body);
    } else {
      // 否则根据文本长度进入不同的生成模式
      let finalRequirement = body.requirement;
      let classification = classifyText(finalRequirement);

      if (classification === "SHORT_TEXT") {
        // 处理短文本，需求内容可能过少，先进行多轮澄清
        result = await ShortTextProcess(body);
      } else if (classification === "MEDIUM_TEXT") {
        // 处理中文本，不用澄清，直接输出json，等待用户补充信息后再调用LLM生成
        result = await MediumTextProcess(body);
      } else {
        // 处理长文本，需要特殊的处理逻辑，以免漏信息，同时要考虑LLM的能力和成本限制
        result = await LongTextProcess(body);
      }
    }

    res.json(result);

  } catch (error) {
    console.error("处理请求时出错:", error);
    res.status(500).json({
      status: "error",
      errorMessage: "服务器内部错误",
    } as UMLApiResponse);
  }
});

/**
 * POST /generate-module-tree
 * 功能：根据需求文档生成模块树 JSON
 */
app.post("/generate-module-tree", authMiddleware, async (req: Request, res: Response) => {
  const body = req.body as ModuleTreeRequest;
  const headerRequestId = typeof req.headers["x-nl2uml-request-id"] === "string"
    ? req.headers["x-nl2uml-request-id"]
    : undefined;
  const requestId = headerRequestId && headerRequestId.trim() !== "" ? headerRequestId.trim() : newRequestId();

  emitProgress({ task: "generate-module-tree", requestId, stage: "start", message: "开始生成模块树" });

  // 验证 projectRoot 必填
  if (!body.projectRoot || body.projectRoot.trim() === "") {
    emitProgress({ task: "generate-module-tree", requestId, stage: "error", error: "projectRoot 为必填字段，不能为空" });
    return res.status(400).json({
      status: "error",
      errorMessage: "projectRoot 为必填字段，不能为空",
    } as ModuleTreeResponse);
  }

  if (!body.requirementRelativePath || body.requirementRelativePath.trim() === "") {
    emitProgress({ task: "generate-module-tree", requestId, stage: "error", error: "requirementRelativePath 为必填字段，不能为空" });
    return res.status(400).json({
      status: "error",
      errorMessage: "requirementRelativePath 为必填字段，不能为空",
    } as ModuleTreeResponse);
  }

  if (!body.projectName || body.projectName.trim() === "") {
    emitProgress({ task: "generate-module-tree", requestId, stage: "error", error: "projectName 为必填字段，不能为空" });
    return res.status(400).json({
      status: "error",
      errorMessage: "projectName 为必填字段，不能为空",
    } as ModuleTreeResponse);
  }

  console.log(`收到模块树生成请求: ${new Date().toISOString()}`);
  console.log(`项目根目录: ${body.projectRoot}`);
  console.log(`需求文档路径: ${body.requirementRelativePath}`);
  console.log(`项目名称: ${body.projectName}`);

  try {
    const { moduleTree, rootDir, pipelineSummary } = await generateModuleTree(body, {
      requestId,
      onProgress: (stage, message, detail) => {
        const payload: any = { task: "generate-module-tree", requestId, stage };
        if (message !== undefined) {
          payload.message = message;
        }
        if (detail !== undefined) {
          payload.detail = detail;
        }
        emitProgress(payload);
      },
    });

    emitProgress({ task: "generate-module-tree", requestId, stage: "done", message: "模块树生成完成", detail: { rootDir } });
    res.json({
      status: "success",
      data: moduleTree,
      rootDir: rootDir,
      pipelineSummary,
    } as ModuleTreeResponse);

  } catch (error) {
    console.error("生成模块树时出错:", error);
    const errorMessage = error instanceof Error ? error.message : "服务器内部错误";
    emitProgress({ task: "generate-module-tree", requestId, stage: "error", error: errorMessage, message: "模块树生成失败" });
    res.status(500).json({
      status: "error",
      errorMessage: errorMessage,
    } as ModuleTreeResponse);
  }
});

/**
 * POST /generate-all-class-diagrams
 * 功能：为所有叶子模块生成类图 JSON
 */
app.post("/generate-all-class-diagrams", authMiddleware, async (req: Request, res: Response) => {
  const body = req.body as GenerateAllClassDiagramsRequest;

  console.log(`收到类图生成请求: ${new Date().toISOString()}`);

  try {
    const { results } = await generateAllClassDiagrams(body.moduleTreePath);

    const successCount = results.filter((r: { success: boolean }) => r.success).length;
    const allSuccess = successCount === results.length;

    res.json({
      status: allSuccess ? "success" : "error",
      results: results,
    } as GenerateAllClassDiagramsResponse);

  } catch (error) {
    console.error("生成类图时出错:", error);
    const errorMessage = error instanceof Error ? error.message : "服务器内部错误";
    res.status(500).json({
      status: "error",
      errorMessage: errorMessage,
    } as GenerateAllClassDiagramsResponse);
  }
});

/**
 * POST /generate-all-sequence-diagrams
 * 功能：为所有叶子模块生成时序图 JSON
 */
app.post("/generate-all-sequence-diagrams", authMiddleware, async (req: Request, res: Response) => {
  const body = req.body as GenerateAllSequenceDiagramsRequest;

  console.log(`收到时序图生成请求: ${new Date().toISOString()}`);

  try {
    const { results } = await generateAllSequenceDiagrams(body.moduleTreePath);

    const successCount = results.filter((r: { success: boolean }) => r.success).length;
    const allSuccess = successCount === results.length;

    res.json({
      status: allSuccess ? "success" : "error",
      results: results,
    } as GenerateAllSequenceDiagramsResponse);
  } catch (error) {
    console.error("生成时序图时出错:", error);
    const errorMessage = error instanceof Error ? error.message : "服务器内部错误";
    res.status(500).json({
      status: "error",
      errorMessage: errorMessage,
    } as GenerateAllSequenceDiagramsResponse);
  }
});

/**
 * POST /generate-all-pim-diagrams
 * 功能：为所有叶子模块生成 PIM 类图和时序图
 */
app.post("/generate-all-pim-diagrams", authMiddleware, async (req: Request, res: Response) => {
  const body = req.body as GeneratePimDiagramsRequest;
  const rootDir = body.rootDir || process.cwd();
  const moduleTreePath = path.join(rootDir, "design_model", "module_tree.json");

  console.log(`收到 PIM 生成请求: ${new Date().toISOString()}`);
  console.log(`项目根目录: ${rootDir}`);

  try {
    console.log("\n=== 步骤 1/2: PIM 类图 ===");
    const classResults = await generateAllPimClassDiagrams(moduleTreePath, rootDir);

    console.log("\n=== 步骤 2/2: PIM 时序图 ===");
    const sequenceResults = await generateAllPimSequenceDiagrams(moduleTreePath, rootDir);

    const classSuccess = classResults.results.filter((r) => r.success).length;
    const seqSuccess = sequenceResults.results.filter((r) => r.success).length;
    const totalModules = Math.max(classResults.results.length, sequenceResults.results.length);

    res.json({
      status: "success",
      classResults: classResults.results,
      sequenceResults: sequenceResults.results,
    } as GeneratePimDiagramsResponse);
  } catch (error) {
    console.error("生成 PIM 时出错:", error);
    const errorMessage = error instanceof Error ? error.message : "服务器内部错误";
    res.status(500).json({
      status: "error",
      errorMessage: errorMessage,
    } as GeneratePimDiagramsResponse);
  }
});

/**
 * POST /generate-all-psm-diagrams
 * 功能：为所有叶子模块生成 PSM 类图和时序图
 */
app.post("/generate-all-psm-diagrams", authMiddleware, async (req: Request, res: Response) => {
  const body = req.body as GeneratePsmDiagramsRequest;
  const rootDir = body.rootDir || process.cwd();
  const moduleTreePath = path.join(rootDir, "design_model", "module_tree.json");

  console.log(`收到 PSM 生成请求: ${new Date().toISOString()}`);
  console.log(`项目根目录: ${rootDir}`);

  try {
    console.log("\n=== 步骤 1/2: PSM 类图 ===");
    const classResults = await generateAllPsmClassDiagrams(moduleTreePath, rootDir);

    console.log("\n=== 步骤 2/2: PSM 时序图 ===");
    const sequenceResults = await generateAllPsmSequenceDiagrams(moduleTreePath, rootDir);

    res.json({
      status: "success",
      classResults: classResults.results,
      sequenceResults: sequenceResults.results,
    } as GeneratePsmDiagramsResponse);
  } catch (error) {
    console.error("生成 PSM 时出错:", error);
    const errorMessage = error instanceof Error ? error.message : "服务器内部错误";
    res.status(500).json({
      status: "error",
      errorMessage: errorMessage,
    } as GeneratePsmDiagramsResponse);
  }
});

/**
 * POST /continue-design-pipeline
 * 功能：扫描所有叶子模块，从当前进度继续执行下一步设计流水线
 * 顺序：business_model_class → business_model_sequence → pim_class → pim_sequence → psm_class → psm_sequence
 */
app.post("/continue-design-pipeline", authMiddleware, async (req: Request, res: Response) => {
  const body = req.body as { rootDir?: string };
  const rootDir = body.rootDir || process.cwd();
  const treePath = path.join(rootDir, "design_model", "module_tree.json");

  console.log(`收到继续流水线请求: ${new Date().toISOString()}`);
  console.log(`项目根目录: ${rootDir}`);

  try {
    if (!fs.existsSync(treePath)) {
      res.json({ status: "completed", message: "模块树不存在，请先执行生成设计模型" });
      return;
    }

    const moduleTree = JSON.parse(fs.readFileSync(treePath, "utf-8"));

    // 递归获取叶子模块及路径
    const buildPaths = (node: any, currentPath: string): { node: any; fullPath: string }[] => {
      const nodePath = path.join(currentPath, node.directory_name);
      if (node.is_leaf) return [{ node, fullPath: nodePath }];
      let leaves: { node: any; fullPath: string }[] = [];
      if (node.children) {
        const childrenPath = path.join(nodePath, "modules");
        for (const child of node.children) {
          leaves.push(...buildPaths(child, childrenPath));
        }
      }
      return leaves;
    };

    const modulesDir = path.join(rootDir, "design_model", "modules");
    const leaves: { node: any; fullPath: string }[] = [];
    if (moduleTree.root.children) {
      for (const child of moduleTree.root.children) {
        leaves.push(...buildPaths(child, modulesDir));
      }
    }

    console.log(` 发现 ${leaves.length} 个叶子模块`);

    // 流水线步骤定义（按顺序）
    const pipelineSteps = [
      { file: "business_model_class.json", name: "业务类图", action: "class" },
      { file: "business_model_sequence.json", name: "业务时序图", action: "sequence" },
      { file: "pim_class.json", name: "PIM 类图", action: "pim_class" },
      { file: "pim_sequence.json", name: "PIM 时序图", action: "pim_sequence" },
      { file: "psm_class.json", name: "PSM 类图", action: "psm_class" },
      { file: "psm_sequence.json", name: "PSM 时序图", action: "psm_sequence" },
    ];

    // 找到第一个未完成的步骤
    let nextStep: { file: string; name: string; action: string } | null = null;
    for (const step of pipelineSteps) {
      const anyMissing = leaves.some((leaf) => {
        const designDir = path.join(leaf.fullPath, "design");
        return !fs.existsSync(path.join(designDir, step.file));
      });
      if (anyMissing) {
        nextStep = step;
        break;
      }
    }

    if (!nextStep) {
      res.json({ status: "completed", message: "所有流水线步骤已完成" });
      return;
    }

    console.log(`▶️ 下一步: ${nextStep.name} (${nextStep.action})`);

    // 执行下一步
    let results: any;
    switch (nextStep.action) {
      case "class":
        results = await generateAllClassDiagrams(treePath, rootDir);
        break;
      case "sequence":
        results = await generateAllSequenceDiagrams(treePath, rootDir);
        break;
      case "pim_class":
        results = await generateAllPimClassDiagrams(treePath, rootDir);
        break;
      case "pim_sequence":
        results = await generateAllPimSequenceDiagrams(treePath, rootDir);
        break;
      case "psm_class":
        results = await generateAllPsmClassDiagrams(treePath, rootDir);
        break;
      case "psm_sequence":
        results = await generateAllPsmSequenceDiagrams(treePath, rootDir);
        break;
      default:
        res.status(400).json({ status: "error", errorMessage: `未知步骤: ${nextStep.action}` });
        return;
    }

    const successCount = results.results.filter((r: any) => r.success).length;
    res.json({
      status: "success",
      step: nextStep.name,
      stepAction: nextStep.action,
      results: results.results,
      summary: `${nextStep.name} 完成: ${successCount}/${results.results.length} 个模块成功`,
    });
  } catch (error) {
    console.error("继续流水线时出错:", error);
    const errorMessage = error instanceof Error ? error.message : "服务器内部错误";
    res.status(500).json({ status: "error", errorMessage });
  }
});

// 启动服务
const server = app.listen(PORT , "127.0.0.1", () => {
  console.log(`
  Agent 服务已启动
  📡 监听端口: http://127.0.0.1:${PORT}
  `);

});

// 长耗时流水线请求（/generate-module-tree 等）可能需要数分钟，避免 HTTP 连接超时断开
server.timeout = 1800000;           // 请求超时 30 分钟
server.keepAliveTimeout = 1800000;  // keep-alive 超时 30 分钟
server.headersTimeout = 1800000;    // 请求头超时 30 分钟
