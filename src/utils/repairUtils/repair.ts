//生成json补全，校验，以及修复的工具函数
import { jsonrepair } from "jsonrepair";
import type {
  RelationshipType,
  Stage2Output,
} from "../../types/diagram.js";
import type {
  UMLModel,
  LinkData,
} from "../../types/diagram.js";

const RELATIONSHIP_MAP: Record<string, RelationshipType> = {
  inheritance: "inheritance",
  generalization: "inheritance",
  extends: "inheritance",
  realization: "realization",
  implements: "realization",
  association: "association",
  aggregation: "aggregation",
  composition: "composition",
  dependency: "dependency",
  uses: "dependency",
};

// 多重性格式规范化映射
const MULTIPLICITY_PATTERNS: Record<string, string> = {
  "0..*": "0..*",
  "0..1": "0..1",
  "1..*": "1..*",
  "*": "*",
  "0": "0",
  "1": "1",
  n: "*",
  many: "*",
  zero: "0",
  one: "1",
};

// 默认多重性配置
const DEFAULT_MULTIPLICITY: Record<string, { source: string; target: string }> =
  {
    inheritance: { source: "", target: "" },
    realization: { source: "", target: "" },
    dependency: { source: "1", target: "*" },
    composition: { source: "1", target: "1..*" },
    aggregation: { source: "1", target: "0..*" },
    association: { source: "*", target: "*" },
    default: { source: "", target: "" },
  };

// 职责：校验和修复生成的UML类图JSON结构，利用泛型来输出不同类型的数据
export const RepairJson = <T>(text: string): T => {
  const toError = (err: unknown) =>
    err instanceof Error ? err : new Error(String(err));

  try {
    let jsonStr = text.trim();

    // 移除 markdown 标记
    if (jsonStr.includes("```json")) {
      jsonStr = jsonStr.replace(/```json\s*/, "").replace(/\s*```/, "");
    } else if (jsonStr.includes("```")) {
      jsonStr = jsonStr.replace(/```\s*/, "").replace(/\s*```/, "");
    }

    const repaired = jsonrepair(jsonStr);
    return JSON.parse(repaired) as T;
  } catch (err: unknown) {
    const parseError = toError(err);
    console.error("JSON 解析失败:", parseError);
    console.log("JSON解析失败，尝试修复...");

    // 简单修复：查找JSON对象
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const repaired = jsonMatch[0];
        // 修复常见的JSON问题
        const fixed = repaired
          .replace(/'/g, '"') // 单引号转双引号
          .replace(/,\s*}/g, "}") // 移除尾随逗号
          .replace(/,\s*\]/g, "]") // 移除尾随逗号
          .replace(/(\w+):/g, '"$1":'); // 给属性名加引号

        return JSON.parse(fixed) as T;
      } catch (innerErr: unknown) {
        const repairError = toError(innerErr);
        console.error("修复失败:", repairError.message);
      }
    }

    throw new Error("Invalid JSON format", { cause: parseError });
  }
};

export const validateAndNormalizeResult_2 = (
  result: Stage2Output,
): Stage2Output => {
  // 深拷贝
  const cleanData: Stage2Output = {
    nodeDataArray: [...(result.nodeDataArray || [])],
    linkDataArray: [...(result.linkDataArray || [])],
  };

  // 单独处理description，因为它是可选的
  if (result.description !== undefined) {
    // 验证和规范化description
    if (typeof result.description !== 'string') {
      cleanData.description = String(result.description);
    } else {
      cleanData.description = result.description;
    }

    // 如果太长，截断并添加省略号
    if (cleanData.description && cleanData.description.length > 500) {
      cleanData.description = cleanData.description.substring(0, 197) + '...';
    }
  }

  // --- 步骤 A: 节点清洗与布局计算 ---，此处LLM返回应该是随机的位置
  // 如果 LLM 返回的坐标都是 "0 0"（常见情况），我们需要简单的网格布局算法
  const existingNames = new Set<string>();

  // 布局参数
  const gridSize = Math.ceil(Math.sqrt(cleanData.nodeDataArray.length));
  const startX = 0;
  const startY = 0;
  const spacingX = 250;
  const spacingY = 150;

  cleanData.nodeDataArray = cleanData.nodeDataArray.map((node, index) => {
    // A1. 确保类名唯一且 PascalCase
    let name = toPascalCase(node.name);
    // 简单防重名处理（如果重名，加序号）
    if (existingNames.has(name)) {
      let counter = 2;
      while (existingNames.has(`${name}${counter}`)) counter++;
      name = `${name}${counter}`;
    }
    existingNames.add(name);

    // A2. 修复坐标 (如果缺失或为 "0 0")
    let loc = node.loc;
    if (!loc || loc === "0 0" || loc === "0 0 0 0") {
      const row = Math.floor(index / gridSize);
      const col = index % gridSize;
      loc = `${startX + col * spacingX} ${startY + row * spacingY}`;
    }

    return {
      ...node,
      key: node.key || index + 1, // 确保有 Key
      name: name,
      stereotype: "Class", // 强制固定
      loc: loc,
      // 确保属性和方法数组存在
      properties: Array.isArray(node.properties) ? node.properties : [],
      methods: Array.isArray(node.methods) ? node.methods : [],
    };
  });

  // --- 步骤 B: 连线清洗与规范化 ---
  // 创建一个 Set 用于快速检查类是否存在
  const validClassNames = new Set(cleanData.nodeDataArray.map((n) => n.name));

  cleanData.linkDataArray = cleanData.linkDataArray
    .filter((link) => {
      // B1. 过滤无效连线（源或目标类不存在）
      const sourceName = toPascalCase(link.source);
      const targetName = toPascalCase(link.target);
      return validClassNames.has(sourceName) && validClassNames.has(targetName);
    })
    .map((link) => {
      // B2. 规范化关系类型
      const rawType = (link.relationship || "").toLowerCase();
      const type = RELATIONSHIP_MAP[rawType] || "association"; // 默认关联

      // B3. 规范化多重性
      let sText = normalizeMultiplicity(link.sourceText);
      let tText = normalizeMultiplicity(link.targetText);

      // B4. 如果多重性缺失，应用默认值
      if (!sText && !tText) {
        const defaults = DEFAULT_MULTIPLICITY[type] ||
          DEFAULT_MULTIPLICITY["default"] || { source: "", target: "" };
        sText = defaults.source;
        tText = defaults.target;
      }

      return {
        source: toPascalCase(link.source), // 确保引用的名字也是 PascalCase
        target: toPascalCase(link.target),
        relationship: type,
        text: link.text || "", // 可选文本
        sourceText: sText,
        targetText: tText,
      };
    });

  return cleanData;
};

export const transformToUMLModel = (cleanData: Stage2Output): UMLModel => {
  // 直接返回原始数据，不转换 key
  // 优先使用AI生成的description，如果没有则生成默认描述
  let description = cleanData.description;
  if (!description) {
    // 如果没有description，基于类名生成一个简单的描述
    const classCount = cleanData.nodeDataArray.length;
    const relationshipCount = cleanData.linkDataArray.length;
    description = `UML类图模型，包含 ${classCount} 个类${classCount > 0 ? '：' + cleanData.nodeDataArray.map(n => n.name).join('、') : ''}，${relationshipCount} 个关系。`;
  }

  return {
    nodeDataArray: cleanData.nodeDataArray,
    linkDataArray: cleanData.linkDataArray as unknown as LinkData[],
    description: description,
  };
};

// 转大驼峰 (PascalCase)
const toPascalCase = (str: string): string => {
  if (!str) return "UnknownClass";
  const clean = str.trim().replace(/[^a-zA-Z0-9_]/g, "");
  if (!clean) return "UnknownClass";
  return clean.charAt(0).toUpperCase() + clean.slice(1);
};

// 多重性清洗
const normalizeMultiplicity = (val: string | undefined): string => {
  if (!val) return "";
  const trimmed = val.trim().toLowerCase();
  return MULTIPLICITY_PATTERNS[trimmed] || val.trim(); // 如果不在映射里，原样返回
};