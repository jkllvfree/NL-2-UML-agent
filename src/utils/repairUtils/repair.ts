//生成json补全，校验，以及修复的工具函数
import { jsonrepair } from "jsonrepair";
import type {
  Stage1Output,
  Stage1Relationship,
  RelationshipType,
  Stage2Output,
} from "../../types/diagram.js";
import type {
  ConsistencyCheckResult,
  UMLModel,
  LinkData,
} from "../../types/diagram.js";

const VALID_RELATIONSHIP_TYPES: RelationshipType[] = [
  "inheritance",
  "realization",
  "association",
  "aggregation",
  "composition",
  "dependency",
];

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

// 验证并规范化 Stage1Output 结构
export const validateAndNormalizeResult_1 = (
  result: Stage1Output,
): Stage1Output => {
  const validated: Stage1Output = {
    identified_classes: [],
    potential_relationships: [],
    ambiguities: [],
    //   clarification_questions: []
  };

  // 验证类名 (PascalCase + 去重)
  if (result.identified_classes && Array.isArray(result.identified_classes)) {
    validated.identified_classes = result.identified_classes
      .filter(
        (cls): cls is string =>
          typeof cls === "string" && cls.trim().length > 0,
      )
      .map((cls) => {
        let className = cls.trim();
        // 强制首字母大写
        if (className.length > 0 && /^[a-z]/.test(className)) {
          className = className.charAt(0).toUpperCase() + className.slice(1);
        }
        return className;
      })
      // 简单的合法性检查：必须以大写字母开头
      .filter((cls) => /^[A-Z][A-Za-z0-9_]*$/.test(cls))
      .filter((cls, index, self) => self.indexOf(cls) === index) // 去重
      .sort();
  }

  // 2. 验证关系
  if (
    result.potential_relationships &&
    Array.isArray(result.potential_relationships)
  ) {
    validated.potential_relationships = result.potential_relationships
      .filter((rel): rel is Stage1Relationship => {
        if (!rel || typeof rel !== "object") return false;
        // 必须有 from, to, type
        if (!rel.from || !rel.to || !rel.type) return false;

        // 类型验证,这里需要断言 rel.type 是 string 才能调用 toLowerCase
        const typeStr = (rel.type as string).toLowerCase();
        if (!VALID_RELATIONSHIP_TYPES.includes(typeStr as RelationshipType))
          return false;

        const fromClass = rel.from.trim();
        const toClass = rel.to.trim();
        // 自引用检查
        if (fromClass === toClass) return false;

        // 类名存在性检查（如果已经识别了类，要求关系中的类必须在列表中）
        // 策略：严格模式下，只有在 identified_classes 里的类才能建立关系
        if (validated.identified_classes.length > 0) {
          if (
            !validated.identified_classes.includes(fromClass) ||
            !validated.identified_classes.includes(toClass)
          ) {
            return false;
          }
          // 注意：这里需要考虑大小写归一化后的匹配，简单起见我们假设上面已经归一化了
          // 这里的 rel.from 还没归一化，所以先不做严格剔除，放到 map 之后或者允许“隐式类”
          // 建议：暂时不剔除，而是后续补全 identified_classes，或者在下面 map 时修正
        }
        return true;
      })
      .map((rel) => {
        // 规范化类名 (PascalCase)
        const normalizeName = (name: string) => {
          let n = name.trim();
          if (n.length > 0 && /^[a-z]/.test(n)) {
            n = n.charAt(0).toUpperCase() + n.slice(1);
          }
          return n;
        };

        const fromClass = normalizeName(rel.from);
        const toClass = normalizeName(rel.to);
        const type = (rel.type as string).toLowerCase() as RelationshipType;

        // 处理置信度
        let confidence = 0.7;
        if (typeof rel.confidence === "number") {
          confidence = Math.max(0.1, Math.min(0.95, rel.confidence));
        } else if (typeof rel.confidence === "string") {
          const parsed = parseFloat(rel.confidence);
          if (!isNaN(parsed))
            confidence = Math.max(0.1, Math.min(0.95, parsed));
        }

        return {
          from: fromClass,
          to: toClass,
          type: type,
          confidence: Number(confidence.toFixed(2)),
        } as Stage1Relationship;
      })
      // 二次去重 (from-to-type 唯一)
      .filter((rel, index, self) => {
        const key = `${rel.from}|${rel.to}|${rel.type}`;
        return (
          self.findIndex((r) => `${r.from}|${r.to}|${r.type}` === key) === index
        );
      })
      // 确保 from/to 都在 identified_classes 中 (可选：如果不强制，可以把缺失的类加回去)
      .filter((rel) => {
        // 策略：如果关系里的类不在 identified_classes 里，自动补充进去
        if (!validated.identified_classes.includes(rel.from))
          validated.identified_classes.push(rel.from);
        if (!validated.identified_classes.includes(rel.to))
          validated.identified_classes.push(rel.to);
        return true;
      });
  }

  // 3. 验证歧义/模糊点
  if (result.ambiguities && Array.isArray(result.ambiguities)) {
    validated.ambiguities = result.ambiguities
      .filter(
        (amb): amb is string =>
          typeof amb === "string" && amb.trim().length > 0,
      )
      .map((amb) => amb.trim())
      .slice(0, 5); // 限制数量
  }

  return validated;
};

export const validateAndNormalizeResult_2 = (
  result: Stage2Output,
): Stage2Output => {
  // 深拷贝
  const cleanData: Stage2Output = {
    nodeDataArray: [...(result.nodeDataArray || [])],
    linkDataArray: [...(result.linkDataArray || [])],
  };

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

//一致性检查结果
export const checkConsistency = (
  umlData: Stage1Output,
): ConsistencyCheckResult => {
  const issues: string[] = [];
  const classes = new Set(umlData.identified_classes);
  const relationships = umlData.potential_relationships;

  // 检查关系中的类是否存在 (理论上 validateAndNormalizeResult 已经处理了补充，这里做双重保险)
  for (const rel of relationships) {
    if (!classes.has(rel.from)) {
      issues.push(`关系中的源类 "${rel.from}" 未在类列表中定义`);
    }
    if (!classes.has(rel.to)) {
      issues.push(`关系中的目标类 "${rel.to}" 未在类列表中定义`);
    }
  }

  // 2. 检查循环继承 (仅针对 inheritance)
  const inheritanceEdges = relationships.filter(
    (r) => r.type === "inheritance",
  );
  const graph: Record<string, string[]> = {};

  for (const edge of inheritanceEdges) {
    if (!graph[edge.from]) graph[edge.from] = [];
    graph[edge.from]!.push(edge.to);
  }

  const visited: Record<string, boolean> = {};
  const recStack: Record<string, boolean> = {};

  function hasCycle(node: string): boolean {
    if (!graph[node]) return false;

    visited[node] = true;
    recStack[node] = true;

    for (const neighbor of graph[node]) {
      if (!visited[neighbor]) {
        if (hasCycle(neighbor)) {
          issues.push(`逻辑错误：发现循环继承 ${node} -> ${neighbor}`);
          return true;
        }
      } else if (recStack[neighbor]) {
        issues.push(`逻辑错误：发现循环继承 ${node} -> ${neighbor}`);
        return true;
      }
    }

    recStack[node] = false;
    return false;
  }

  for (const node of Object.keys(graph)) {
    if (!visited[node]) {
      hasCycle(node);
    }
  }

  // 3. 检查孤立类 (Warning 级别，算作 issue 提示用户)
  const connectedClasses = new Set<string>();
  for (const rel of relationships) {
    connectedClasses.add(rel.from);
    connectedClasses.add(rel.to);
  }

  if (classes.size > 1) {
    for (const cls of classes) {
      if (!connectedClasses.has(cls)) {
        // 孤立类不一定是错误，但在 Stage1 阶段最好提示一下
        issues.push(`提示：类 "${cls}" 未参与任何关系，请确认是否遗漏`);
      }
    }
  }

  return {
    isValid: issues.filter((i) => i.startsWith("逻辑错误")).length === 0, // 只有逻辑错误算 invalid，提示不算
    issues: issues.slice(0, 5),
    summary: {
      totalClasses: classes.size,
      totalRelationships: relationships.length,
      connectedClasses: connectedClasses.size,
    },
  };
};

export const transformToUMLModel = (cleanData: Stage2Output): UMLModel => {
  // 1. 建立映射表: 类名 -> Key ID
  const nameToKeyMap = new Map<string, number>();

  cleanData.nodeDataArray.forEach((node) => {
    nameToKeyMap.set(node.name, node.key);
  });

  // 2. 转换连线数据
  const finalLinks: LinkData[] = [];

  cleanData.linkDataArray.forEach((link) => {
    const fromKey = nameToKeyMap.get(link.source);
    const toKey = nameToKeyMap.get(link.target);

    // 只有当源节点和目标节点都存在时，才生成连线
    if (fromKey !== undefined && toKey !== undefined) {
      finalLinks.push({
        from: fromKey,
        to: toKey,
        relationship: link.relationship,
        // 如果有 text/sourceText/targetText 也带上，虽然 LinkData 接口里可能没定义可选字段，
        // 但通常 GoJS 需要这些展示信息，建议在 LinkData 接口里补上这些可选字段
        // text: link.text,
        // sourceText: link.sourceText,
        // targetText: link.targetText
      } as any); // 使用 as any 或者更新 LinkData 接口定义
    } else {
      console.warn(
        `[Transform] 忽略无效连线: ${link.source} -> ${link.target} (节点未找到)`,
      );
    }
  });

  return {
    class: "GraphLinksModel", // GoJS 需要的固定标记
    nodeDataArray: cleanData.nodeDataArray,
    linkDataArray: finalLinks,
    description: "Generated by AI Agent",
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
