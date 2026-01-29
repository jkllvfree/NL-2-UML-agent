// 可见性修饰符
export type Visibility = "public" | "private" | "protected";

export enum TextClassification {
  SHORT_TEXT = "SHORT_TEXT",
  MEDIUM_TEXT = "MEDIUM_TEXT",
  LONG_TEXT = "LONG_TEXT",
}

// 关系类型
export type RelationshipType =
  | "inheritance" // 泛化/继承
  | "realization" // 实现
  | "association" // 关联
  | "aggregation" // 聚合
  | "composition" // 组合
  | "dependency"; // 依赖

// 编程语言枚举 (API 请求用)
export type ProgrammingLanguage =
  | "Java"
  | "Python"
  | "C#"
  | "TypeScript"
  | string;

// 类属性定义
export interface ClassProperty {
  name: string; // 属性名 (camelCase)
  type: string; // 类型: number/string/boolean/Date/自定义类
  visibility: Visibility;
  static?: boolean; // 可选，默认 false
  final?: boolean; // 可选，默认 false
}

// 方法参数定义
export interface MethodParameter {
  name: string;
  type: string;
}

// 类方法定义
export interface ClassMethod {
  name: string; // 方法名 (camelCase)
  parameters: MethodParameter[];
  type: string; // 返回类型，void 表示无返回值
  visibility: Visibility;
  static?: boolean; // 可选，默认 false
  abstract?: boolean; // 可选，默认 false
}

// 类节点 (对应 nodeDataArray 的元素)
export interface ClassNode {
  key: number; // 必须，唯一标识符，从 1 开始递增
  name: string; // 类名 (PascalCase)
  stereotype: "Class"; // 固定值
  properties: ClassProperty[];
  methods: ClassMethod[];
  loc: string; // 坐标字符串 "x y"，例如 "0 0"
}

// 连线数据 (对应 linkDataArray 的元素)
export interface RawLinkData {
  source: string; // 源节点 类名
  target: string; // 目标节点 类名
  relationship: RelationshipType;
  text?: string; // 可选，关系标签
  sourceText?: string; // 可选，源端多重性，如 '1'
  targetText?: string; // 可选，目标端多重性，如 '1..*'
}

export interface LinkData {
  from: number; // 源节点 key值
  to: number; // 目标节点 key值
  relationship: RelationshipType;
}

// 最终完整的 UML 模型 (前端主要消费的对象)
export interface UMLModel {
  class?: string; // 可选，文档示例中为 "GraphLinksModel"
  nodeDataArray: ClassNode[];
  linkDataArray: LinkData[];
  description?: string; // 描述信息 [cite: 1081]
}

// 2. 阶段一输出 (需求澄清结果)
export interface Stage1Relationship {
  from: string; // 类名
  to: string; // 类名
  type: RelationshipType;
  confidence: number;
}

export interface Stage1Output {
  identified_classes: string[];
  potential_relationships: Stage1Relationship[];
  ambiguities: string[]; // 需要澄清的问题列表
}

export interface Stage2Output {
  nodeDataArray: ClassNode[];
  linkDataArray: RawLinkData[];
}


/**
 * 一致性检查结果接口
 */
export interface ConsistencyCheckResult {
    isValid: boolean;
    issues: string[]; // 这些问题可以追加到 ambiguities 中
    summary: {
        totalClasses: number;
        totalRelationships: number;
        connectedClasses: number;
    };
}