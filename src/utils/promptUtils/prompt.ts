import type { Stage1Output } from "../../types/diagram.js";

export const generateStage1Prompt = (userInput: string): string => {
  return `
# Role
你是一个资深的软件系统分析师，精通 UML 建模。

# Task
分析用户的自然语言需求，过滤无关信息，提取核心领域模型，并输出为 JSON。

# Workflow
1. 需求澄清：识别模糊点（如缺失的关联、不明确的多重性）。
2. 识别实体 (Class)：提取名词作为候选类。
3. 识别属性与方法：虽不需要详细定义，但需感知其存在。
4. 识别关系 (Inheritance/Association)：判断类之间的交互方式。

# Example (Few-Shot Learning)
## User Input
"我们需要一个简单的电商后端模块。一个订单(Order)可以包含多个订单项(OrderItem),每个订单项关联到一个具体的商品（Product）。"

## Assistant Output
{
  "identified_classes": ["Order", "OrderItem", "Product"],
  "potential_relationships": [
    {"from": "Order", "to": "OrderItem", "type": "composition", "confidence": 0.95},
    {"from": "OrderItem", "to": "Product", "type": "association", "confidence": 0.9}
  ],
  "ambiguities": ["需澄清：订单是否有状态流转？"]
}

# User Input
"${userInput}"

# Constraints
1. 忽略所有关于 UI 设计、颜色、交互动画的描述。
2. 类名必须使用 PascalCase (大驼峰命名法)。
3. **重要：只返回纯 JSON 字符串，不要包含 markdown 标记(如 \`\`\`json),不要包含任何解释性文字。**

# Output Schema
请严格按照以下 JSON 格式输出：
{
  "identified_classes": ["Class1", "Class2"],
  "potential_relationships": [
    { "from": "Class1", "to": "Class2", "type": "association", "confidence": 0.9 }
  ],
  "ambiguities": ["..."]
}
`;
};

export const generateStage2Prompt = (stage1Output: Stage1Output): string => {
  return `
# Task
基于一阶段分析结果(Stage1 Output)，生成完整的JSON结构。

# Workflow
1. 识别实体 (Class) 并赋予唯一 Key。
2. 补充该类应有的核心属性（字段名 camelCase，类型明确）。
3. 补充该类应有的核心方法（方法名 camelCase，参数完整）。
4. 建立类与类之间的关系（注意多重性和关系类型）。
5. 生成 loc 坐标：简单的计算一下位置，避免所有节点挤在同一个坐标点。

# Example (One-Shot Learning)
## Stage1 Output Example
{
  "identified_classes": ["Order", "OrderItem", "Product"],
  "potential_relationships": [
    {"from": "Order", "to": "OrderItem", "type": "composition", "confidence": 0.95},
    {"from": "OrderItem", "to": "Product", "type": "association", "confidence": 0.9}
  ],
  "ambiguities": []
}

## Assistant Output Example
{
  "nodeDataArray": [
    {
      "key": 1,
      "name": "Order",
      "stereotype": "Class",
      "properties": [
        { "name": "orderId", "type": "string", "visibility": "private" },
        { "name": "createTime", "type": "Date", "visibility": "private" },
        { "name": "totalAmount", "type": "number", "visibility": "private" }
      ],
      "methods": [
        { "name": "calculateTotal", "parameters": [], "type": "number", "visibility": "public" },
        { "name": "pay", "parameters": [], "type": "boolean", "visibility": "public" }
      ],
      "loc": "0 0"
    },
    {
      "key": 2,
      "name": "OrderItem",
      "stereotype": "Class",
      "properties": [
        { "name": "quantity", "type": "number", "visibility": "private" },
        { "name": "priceSnapshot", "type": "number", "visibility": "private" }
      ],
      "methods": [],
      "loc": "250 0"
    },
    {
      "key": 3,
      "name": "Product",
      "stereotype": "Class",
      "properties": [
        { "name": "name", "type": "string", "visibility": "private" },
        { "name": "price", "type": "number", "visibility": "private" }
      ],
      "methods": [
        { "name": "updatePrice", "parameters": [{"name": "newPrice", "type": "number"}], "type": "void", "visibility": "public" }
      ],
      "loc": "500 0"
    }
  ],
  "linkDataArray": [
    {
      "source": "Order",
      "target": "OrderItem",
      "relationship": "composition",
      "sourceText": "1",
      "targetText": "1..*"
    },
    {
      "source": "OrderItem",
      "target": "Product",
      "relationship": "association",
      "sourceText": "*",
      "targetText": "1"
    }
  ]
}

# Stage1 Output
"${stage1Output}"

# Constraints
1. 类名使用 PascalCase, 属性/方法名使用 camelCase
2. 只返回 JSON 字符串，不要包含 markdown 标记 (如 \`\`\`JSON)
3. 包含完整的属性、方法、关系定义（即使用户未详细描述，也请基于常识补全核心字段）
4. 遵循面向对象设计原则
5. loc 字段不要全部固定为 "0 0"，请生成大致不重叠的随机坐标（例如 "0 0", "200 0", "0 200" 等）

# Output Schema
请严格按照以下 JSON 格式输出：
{
  "nodeDataArray": [
    {
      "key": "number（必须，节点的唯一标识符，从1开始递增）",
      "name": "string（必须，类名，PascalCase）",
      "stereotype": "string（必须，固定为'Class'）",
      "properties": [
        {
          "name": "string（必须，属性名，camelCase）",
          "type": "string（必须，类型：number/string/boolean/Date/自定义类）",
          "visibility": "string（必须，public/private/protected）",
          "static": "boolean（可选，默认false）",
          "final": "boolean（可选，默认false）"
        }
      ],
      "methods": [
        {
          "name": "string（必须，方法名，camelCase）",
          "parameters": [
            {
              "name": "string（必须，参数名）",
              "type": "string（必须，参数类型）"
            }
          ],
          "type": "string（必须，返回类型，void表示无返回值）",
          "visibility": "string（必须，public/private/protected）",
          "static": "boolean（可选，默认false）",
          "abstract": "boolean（可选，默认false）"
        }
      ],
      "loc": "string（必须，格式为'x y'，请生成随机或分散的坐标以避免节点完全重叠）"
    }
  ],
  "linkDataArray": [
    {
      "source": "string（必须，源节点类名）",
      "target": "string（必须，目标节点类名）",
      "relationship": "string（必须，inheritance/realization/association/aggregation/composition/dependency）",
      "text": "string（可选，关系标签）",
      "sourceText": "string（可选，源端多重性，如：'1'、'0..1'、'*'）",
      "targetText": "string（可选，目标端多重性）"
    }
  ]
}
`;
};
