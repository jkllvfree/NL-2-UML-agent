<p align="center">
  <h1 align="center">NL2UML Agent</h1>
  <p align="center">
    <strong>自然语言 → UML 设计模型 ｜ 多阶段 LLM 流水线引擎</strong>
  </p>

  <p align="center">
    <img src="https://img.shields.io/badge/Node.js-20+-339933?logo=node.js" alt="Node.js" />
    <img src="https://img.shields.io/badge/TypeScript-5.3-3178C6?logo=typescript" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Express-4.18-000000?logo=express" alt="Express" />
    <img src="https://img.shields.io/badge/Vercel_AI_SDK-6.0-000000?logo=vercel" alt="Vercel AI SDK" />
  </p>

  <p align="center">
    <a href="README.md">中文</a> | <a href="README_EN.md">English</a>
  </p>
</p>

---

## 项目简介

NL2UML Agent 是一个 **Express 服务进程**，作为 VS Code 插件 NL2UML 的后端引擎运行。它接收前端传来的自然语言需求文档，通过 **多阶段 LLM 流水线** 将其转化为结构化的 UML 设计模型（JSON 格式），输出到项目目录的 `design_model/` 下。

### 核心能力

- 从需求文档自动提取 **模块树**（Module Tree）
- 为每个叶子模块生成 **业务类图**（Business Model Class Diagram）
- 为每个叶子模块生成 **业务时序图**（Business Model Sequence Diagram）
- 从业务模型派生 **平台无关模型**（PIM：类图 + 时序图）
- 从 PIM 派生 **平台相关模型**（PSM：类图 + 时序图，支持 Java/Spring Boot）
- 同时生成等效的 **PlantUML (.puml)** 文件，便于可视化
- 支持 **短文本 / 中文本 / 长文本** 三种处理策略
- 支持对已有 UML 模型的 **迭代修改**

---

## 系统架构

```
前端 (VS Code Webview)
        │
        ▼  HTTP POST (Bearer Token)
┌───────────────────────────────────┐
│         Express 服务层             │
│  CORS + Auth 中间件                │
│                                    │
│  POST /uml                  ← 短/中/长文本快速生成     │
│  POST /generate-module-tree  ← 阶段1: 模块树           │
│  POST /generate-all-class-diagrams    ← 阶段2: 业务类图 │
│  POST /generate-all-sequence-diagrams ← 阶段3: 业务时序图│
│  POST /generate-all-pim-diagrams      ← 阶段4: PIM     │
│  POST /generate-all-psm-diagrams      ← 阶段5: PSM     │
│  POST /continue-design-pipeline ← 断点续跑              │
│  GET  /health                ← 健康检查                │
└───────────┬───────────────────────┘
            │
            ▼
┌───────────────────────────────────┐
│       流水线处理层                 │
│                                    │
│  textUtils/                        │
│  ├── classfication.ts    文本分类   │
│  ├── process.ts          短/中/修改处理│
│  ├── longTextProcess.ts  长文本分块合并│
│  ├── generateModuleTree.ts   模块树生成│
│  ├── generateClassDiagram.ts 类图生成 │
│  ├── generateSequenceDiagram.ts 时序图│
│  ├── generatePim.ts       PIM 生成   │
│  ├── generatePsm.ts       PSM 生成   │
│  ├── fallbackPim.ts       PIM 降级   │
│  └── fallbackPsm.ts       PSM 降级   │
└───────────┬───────────────────────┘
            │
            ▼
┌───────────────────────────────────┐
│       LLM 调用层 (Vercel AI SDK)    │
│  utils/utils.ts                    │
│  ├── callUMLGenerator              │
│  ├── callModuleTreeLLM             │
│  ├── callClassDiagramLLM           │
│  ├── callSequenceDiagramLLM        │
│  ├── callMultiSequenceDiagramLLM   │
│  ├── callPimClassLLM / callPimSequenceLLM │
│  ├── callPsmClassLLM / callPsmSequenceLLM │
│  └── repair*Json (Schema 修复重试)  │
└───────────┬───────────────────────┘
            │
            ▼
┌───────────────────────────────────┐
│       质量保障层                    │
│                                    │
│  repairUtils/repair.ts            │
│  ├── RepairJson<T>()  JSON 修复+解析│
│  ├── validateAndNormalizeResult_2() │
│  └── transformToUMLModel()         │
│                                    │
│  schemaUtils/businessModelSchemas.ts│
│  ├── 6 套 JSON Schema 定义         │
│  └── validate*Schema() 校验 + $ref │
│                                    │
│  pumlUtils/                        │
│  ├── convertToPuml.ts   JSON→PUML  │
│  └── validatePuml.ts    PUML 校验  │
└───────────────────────────────────┘
```

### 数据流

```
需求文档 (.md)
    │
    ▼
[文本分类] → SHORT / MEDIUM / LONG
    │
    ▼
[模块树生成] → design_model/module_tree.json
    │
    ├── [业务类图] → modules/{module}/design/business_model_class.json + .puml
    │
    ├── [业务时序图] → modules/{module}/design/business_model_sequence.json + .puml
    │
    ├── [PIM 类图] → modules/{module}/design/pim_class.json + .puml
    │
    ├── [PIM 时序图] → modules/{module}/design/pim_sequence.json + .puml
    │
    ├── [PSM 类图] → modules/{module}/design/psm_class.json + .puml
    │
    └── [PSM 时序图] → modules/{module}/design/psm_sequence.json + .puml
```

---

## 目录结构

```
agent/
├── src/
│   ├── app.ts                          # Express 服务入口，路由定义 + 中间件
│   ├── types/
│   │   ├── api.ts                      # API 请求/响应类型定义
│   │   └── diagram.ts                  # UML 模型类型（类图、时序图、模块树、PIM/PSM）
│   └── utils/
│       ├── utils.ts                    # LLM 调用层（Vercel AI SDK 封装）
│       ├── progress.ts                 # 进度事件发射（stdout JSON lines）
│       ├── promptUtils/
│       │   ├── prompt.ts               # 模块树/类图/时序图 System Prompt
│       │   ├── pimPrompts.ts           # PIM 转换 Prompt
│       │   └── psmPrompts.ts           # PSM 转换 Prompt
│       ├── repairUtils/
│       │   └── repair.ts               # JSON 修复、校验、规范化、转换
│       ├── schemaUtils/
│       │   └── businessModelSchemas.ts # JSON Schema 加载、缓存、校验引擎
│       ├── pumlUtils/
│       │   ├── convertToPuml.ts        # UML JSON → PlantUML 文本转换
│       │   └── validatePuml.ts         # PlantUML 语法校验
│       └── textUtils/
│           ├── classfication.ts        # 文本长度分类（SHORT/MEDIUM/LONG）
│           ├── process.ts              # 短文本/中文本/修改模式处理
│           ├── longTextProcess.ts      # 长文本分块 + 并行 + 合并
│           ├── generateModuleTree.ts   # 模块树生成 + 全流水线编排
│           ├── generateClassDiagram.ts # 叶子模块类图批量生成
│           ├── generateSequenceDiagram.ts # 叶子模块时序图批量生成
│           ├── generatePim.ts          # PIM 类图/时序图批量生成
│           ├── generatePsm.ts          # PSM 类图/时序图批量生成
│           ├── fallbackPim.ts          # PIM 时序图降级构造器
│           └── fallbackPsm.ts          # PSM 类图降级构造器
├── schemas/                            # 6 套 JSON Schema 定义文件
│   ├── business_model_class.schema.json
│   ├── business_model_sequence.schema.json
│   ├── pim_class.schema.json
│   ├── pim_sequence.schema.json
│   ├── psm_class.schema.json
│   └── psm_sequence.schema.json
├── package.json
├── tsconfig.json
└── README.md
```

---

## 技术栈

| 类别 | 技术 |
|------|------|
| 运行时 | Node.js 20+ |
| 语言 | TypeScript 5.3 (ESM) |
| Web 框架 | Express 4.18 |
| LLM SDK | Vercel AI SDK 6.0 (`ai` + `@ai-sdk/openai-compatible`) |
| JSON 修复 | `jsonrepair` 3.13 |
| 环境变量 | `dotenv` 17 |
| 跨域 | `cors` 2.8 |
| Schema 校验 | 自研 JSON Schema 校验引擎（支持 `$ref`、`allOf`、`if/then`、`additionalProperties`） |
| 图表输出 | PlantUML (.puml) |

---

## API 端点

所有端点（除 `/health`）均需要 `Authorization: Bearer <TOKEN>` 鉴权。

### `GET /health`
健康检查，返回 `{ status: "ok" }`。

### `POST /uml`
快速生成 UML 类图。根据文本长度自动选择处理策略。

**请求体：**
```typescript
{
  requirement: string;          // 自然语言需求（必填，≤10000 字符）
  language?: string;            // 目标编程语言
  history?: ClarificationTurn[]; // 多轮澄清历史
  currentModel?: UMLModel;      // 当前模型（存在时进入修改模式）
}
```

### `POST /generate-module-tree`
从需求文档生成模块树，并自动执行完整的 6 阶段设计流水线。

**请求体：**
```typescript
{
  projectRoot: string;              // 项目根目录绝对路径
  requirementRelativePath: string;  // 需求文档相对路径
  projectName: string;              // 项目名称
  documentVersion?: string;         // 文档版本（默认 "1.0.0"）
}
```

### `POST /generate-all-class-diagrams`
为所有叶子模块生成业务类图。

### `POST /generate-all-sequence-diagrams`
为所有叶子模块生成业务时序图。

### `POST /generate-all-pim-diagrams`
为所有叶子模块生成 PIM 类图和时序图。

### `POST /generate-all-psm-diagrams`
为所有叶子模块生成 PSM 类图和时序图。

### `POST /continue-design-pipeline`
断点续跑：扫描所有叶子模块，从第一个缺失的步骤继续执行流水线：
`business_model_class → business_model_sequence → pim_class → pim_sequence → psm_class → psm_sequence`

---

## 安装与运行

### 环境变量

Agent 启动时从环境变量读取配置（由 VS Code 扩展进程注入）：

| 变量 | 说明 |
|------|------|
| `AGENT_PORT` | 服务监听端口 |
| `AGENT_TOKEN` | Bearer Token 鉴权密钥 |
| `NL2UML_LLM_BASE_URL` | LLM API 地址 |
| `NL2UML_LLM_MODEL` | LLM 模型名称 |
| `NL2UML_LLM_API_KEY` | LLM API 密钥 |
| `NL2UML_LLM_PROVIDER` | LLM 提供商名称（可选） |
| `NL2UML_LLM_TEMPERATURE` | LLM 温度参数（可选，默认 0.1） |

### 本地开发

```bash
cd agent
npm install
npm run dev      # ts-node 开发模式
```

### 生产构建

```bash
npm run build    # TypeScript 编译 → dist/
npm start        # 运行编译产物
```

---

## 设计亮点

### 1. 六阶段分层流水线

采用 **业务模型 → PIM → PSM** 的经典 MDA（Model-Driven Architecture）分层设计：

- **业务模型层**：面向领域专家，表达业务语义（Entity、AggregateRoot、DomainService）
- **PIM 层**：平台无关的逻辑架构（分层/六边形/事件驱动），引入接口、抽象
- **PSM 层**：平台相关的技术实现（Spring Boot 注解、Java 包结构、JPA 映射）

每一层都有独立的 JSON Schema 校验和 LLM 修复重试机制，确保输出质量。

### 2. LLM 输出鲁棒性保障

- **三层容错**：`jsonrepair` 修复 → 正则回退解析 → Schema 校验驱动的 LLM 重试（最多 5 次）
- **降级机制**：`fallbackPim.ts` / `fallbackPsm.ts` 在 LLM 完全失败时，从上游模型构建最小有效输出
- **规范化后处理**：类名 PascalCase 修正、重名防冲突、网格布局自动布局、关系类型映射、多重性默认值填充

### 3. 分级处理策略

根据输入文本长度（字符数阈值：100 / 3000）自动选择策略：

| 级别 | 阈值 | 策略 |
|------|------|------|
| SHORT | ≤100 | 单阶段生成 + 多轮澄清循环 |
| MEDIUM | 100~3000 | 单阶段直接生成 |
| LONG | >3000 | 按句子分块（1500字/块，200字重叠）→ 并行生成 → 去重合并 |

同时支持 **修改模式**：传入 `currentModel` 时，LLM 基于现有模型进行增量修改，而非全量生成。

### 4. 批量并行与进度反馈

- 模块级并行：每批 3 个模块并发处理
- 功能需求级并行：每个模块的时序图按功能需求分批（每批 10 个），单次 LLM 调用批量生成
- 通过 stdout JSON Lines 实时发射进度事件，VS Code 扩展端解析并展示进度通知

### 5. JSON Schema 校验引擎

自研轻量级 Schema 校验器，支持：
- `$ref` 引用解析
- `type` 类型匹配（含 `integer`）
- `enum` 枚举校验
- `required` 必填字段检查
- `additionalProperties: false` 多余字段拦截
- `allOf` / `if-then` 条件校验
- 嵌套对象和数组递归校验

### 6. PlantUML 同步输出

每个阶段生成的 JSON 文件旁同步输出 `.puml` 文件，支持在 IDE 中直接可视化预览，覆盖类图（class diagram）和时序图（sequence diagram）两种图表类型。

### 7. 超长请求支持

Express 服务器配置了 **30 分钟超时**（`server.timeout = 1800000`），确保完整的 6 阶段流水线（从模块树到 PSM 时序图）在单次 HTTP 请求中有足够时间完成。

---

## 未来工作

- [ ] 支持更多 PSM 目标平台（Python/Django、C#/.NET、TypeScript/NestJS）
- [ ] 引入向量数据库缓存相似模块的设计结果，减少 LLM 调用成本
- [ ] 增加设计模型版本管理与增量更新
- [ ] 支持用户自定义 JSON Schema 扩展
- [ ] 增加流水线各阶段的单元测试与集成测试
