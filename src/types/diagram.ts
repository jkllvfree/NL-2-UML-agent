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
  text?: string;        // 关系标签
  sourceText?: string; // 源端多重性
  targetText?: string; // 目标端多重性
}

// 最终完整的 UML 模型 (前端主要消费的对象)
export interface UMLModel {
  class?: string; // 可选，文档示例中为 "GraphLinksModel"
  nodeDataArray: ClassNode[];
  linkDataArray: LinkData[];
  description?: string; // 描述信息，现在会包含原始自然语言需求
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
  description?: string; // 可选，模型的概括性描述
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

// ============ 模块树类型定义 (schema_version: 0.2.1) ============

// 模块树节点
export interface ModuleTreeNode {
  module_id: string;       // 模块唯一ID
  module_name: string;     // 模块名称
  directory_name: string;  // 目录名(由模块名称规范化生成)
  full_path: string;       // 完整路径(相对于 design_model/modules)
  requirement_scope: Record<string, unknown>; // 当前模块需求范围摘要
  is_leaf: boolean;        // 是否为叶子模块
  children: ModuleTreeNode[]; // 子模块列表
}

// 模块树统计信息
export interface ModuleTreeStats {
  total_nodes: number;     // 模块总数
  leaf_nodes: number;      // 叶子模块数量
  max_depth: number;      // 最大层级深度
}

// 来源信息
export interface GeneratedFrom {
  requirement_file: string;  // 来源需求文档路径
  document_version: string;  // 来源文档版本
}

// 完整的模块树结构
export interface ModuleTree {
  schema_version: string;   // 模块树 schema 版本
  project_name: string;      // 所属项目名称
  generated_from: GeneratedFrom; // 来源信息
  root: ModuleTreeNode;      // 根节点
  stats: ModuleTreeStats;   // 统计信息
}

// ============ 叶子模块类图类型定义 (leaf_model.json 格式) ============

// 属性定义
export interface Attribute {
  name: string;            // 属性名 (camelCase)
  type: string;            // 数据类型
  multiplicity?: string | null;
}

// 方法参数
export interface Parameter {
  name: string;
  type: string;
  multiplicity?: string | null;
}

// 方法定义
export interface Operation {
  name: string;            // 方法名 (camelCase)
  returnType?: string | null;
  parameters: Parameter[];
  businessGoal: string;
  preconditions: string[];
  postconditions: string[];
}

// 依赖关系
export interface Dependency {
  target: string;          // 目标 classifier_id 或名称
  kind: "generalization" | "realization" | "association" | "aggregation" | "composition" | "dependency";
  name?: string | null;
  multiplicityFrom?: string | null;
  multiplicityTo?: string | null;
  businessRelation?: string | null;
}

// 分类器（类/接口/枚举）
export interface Classifier {
  classifier_id: string;   // 唯一标识
  name: string;            // 类名 (PascalCase)
  kind: "Entity" | "ValueObject" | "Service" | "Enum";
  module_id: string;       // 所属模块的唯一标识ID
  stereotype: "Entity" | "ValueObject" | "AggregateRoot" | "DomainService" | "Repository" | "Policy" | "Event";
  businessMeaning: string;
  responsibilities: string[];
  businessRules: string[];
  attributes: Attribute[];
  operations: Operation[];
  dependencies: Dependency[];
}

// 关系
export interface Relation {
  relation_id: string;
  level: string;
  kind: "generalization" | "realization" | "association" | "aggregation" | "composition" | "dependency";
  from: string;            // 源端 classifier_id
  to: string;              // 目标端 classifier_id
  from_module_id: string;
  to_module_id: string;
  derived_from: string[];
}

// 叶子模块类图模型
export interface LeafModel {
  description: string;     // 100-200字概括描述
  classifiers: Classifier[];
  relations?: Relation[];
}

// ============ 时序图类型定义 ============

export interface SequenceContextVariable {
  name: string;
  type: string;
  initialValue?: string;
}

export interface SequenceContext {
  variables: SequenceContextVariable[];
}

export interface LifelineCreation {
  created_by_message_id?: string;
}

export interface LifelineDestruction {
  destroyed_by_message_id?: string;
}

export interface SequenceLifeline {
  lifeline_id: string;
  name: string;
  isActor: boolean;
  classifier_id?: string | null;
  role: "Actor" | "Aggregate" | "Service" | "ExternalSystem" | "Policy";
  businessResponsibility: string;
}

export type SequenceElementType = "Message" | "Fragment";

export type SequenceMessageKind = "request" | "notify" | "response";

export interface SequenceMessageArgument {
  name: string;
  value: string;
  type?: string;
}

export interface SequenceMessageReturn {
  variable?: string;
  type?: string;
}

export interface SequenceMessageActivation {
  start?: boolean;
  end?: boolean;
}

export interface SequenceMessageException {
  throws?: string[];
  onException?: string;
}

export interface SequenceMessageElement {
  element_id: string;
  type: "Message";
  message: {
    message_kind: SequenceMessageKind;
    name: string;
    sequence_number?: string;
    source: { lifeline_id: string };
    target: { lifeline_id: string };
    arguments?: SequenceMessageArgument[];
    guard?: string;
    businessGoal: string;
    businessResult: string;
    businessRuleRefs: string[];
    outputs: string[];
  };
}

export type SequenceFragmentType = "alt" | "opt" | "loop" | "par";

export interface SequenceFragmentLoop {
  min?: number;
  max?: string;
  condition?: string;
}

export interface SequenceFragmentOperand {
  operand_id: string;
  guardCondition?: string | null;
  elements: SequenceElement[];
}

export interface SequenceFragmentElement {
  element_id: string;
  type: "Fragment";
  fragment: {
    fragment_type: SequenceFragmentType;
    sequence_number?: string;
    businessPurpose: string;
    loop?: { condition?: string };
    operands: SequenceFragmentOperand[];
  };
}

export type SequenceElement =
  | SequenceMessageElement
  | SequenceFragmentElement;

export interface SequenceModel {
  description: string;
  interaction_id: string;
  name: string;
  module_id: string;
  use_case_id: string;
  preconditions: string[];
  postconditions: string[];
  businessOutcome: string;
  context: SequenceContext;
  lifelines: SequenceLifeline[];
  sequence: { elements: SequenceElement[] };
}

export interface SequenceView {
  module_id: string;
  module_name: string;
  schema_version: string;
  interactions: SequenceModel[];
}
