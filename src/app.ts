// 职责：接收NL，调用模型，输出json
import "dotenv/config";
import express, { type Request, type Response } from "express";
import cors from "cors"; // 允许 VSCode 插件跨域调用
import {
  type UMLRequest,
  type UMLApiResponse
} from "./types/api.js";
import { classifyText } from "./utils/textUtils/classfication.js";
import { ShortTextProcess } from "./utils/textUtils/process.js";

const app = express();
const PORT = 3000;

// 中间件配置
app.use(cors());
app.use(express.json());

/**
 * POST /uml
 * 功能：接收自然语言需求，返回 UML 类图数据(json格式)
 */
app.post("/uml", async (req: Request, res: Response) => {
  const body = req.body as UMLRequest;

  console.log(`收到请求: ${new Date().toISOString()}`);
  console.log(`需求内容: ${body.requirement?.substring(0, 50)}...`);
  try {
    let result;
    let finalRequirement = body.requirement;
    let classification = classifyText(finalRequirement); //确认文本长度，用来区分短，中，长文本

    if (classification === "SHORT_TEXT") {
      //处理短文本
      result = await ShortTextProcess(body);
    } else if (classification === "MEDIUM_TEXT") {
      //处理中文本
    } else {
      //处理长文本
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

// 启动服务
app.listen(PORT, () => {
  console.log(`
  🚀 Agent 服务已启动
  📡 监听端口: http://localhost:${PORT}
  👉 测试接口: POST http://localhost:${PORT}/uml
  `);
});
