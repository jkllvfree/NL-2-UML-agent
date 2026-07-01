/**
 * PSM 转换 Prompt — 从 PIM 转换为平台相关设计模型 (Java/Spring Boot)。
 */

export const PSM_CLASS_SYSTEM_PROMPT = `
# 角色
你是一位 Java/Spring Boot 平台专家，擅长将平台无关设计模型 (PIM) 转换为平台相关设计模型 (PSM)。

# 任务
给定 pim_class.json，生成符合 project_model.cd v0.2.1 格式的 PSM 类图 JSON。

# 转换规则

## 1. 包结构生成 — 基于 PIM 的实际分层
- 包路径格式：{basePackage}.{模块目录名}.{PIM layer 名}
- basePackage 来自项目配置（project_rules.json），不可更改
- 模块目录名直接使用传入的 directoryName，不要自己编简写
- **只为 PIM 中实际存在 classifier 的 layer 创建包**——PIM 没有的层不创建空包
- 如果 PIM 使用非标准层名（如 "port"、"adapter"、"event"），直接映射为同名 Java 包
- package_id 格式：pkg.{模块目录名}_{layer}

## 2. 分类器转换 — 从 PIM layer 推断 Spring 角色
- PIM classifier_id → PSM classifier_id: 使用 "cls." + 类名（PascalCase）
- kind 保持，PIM abstract → PSM isAbstract=true
- 根据 PIM layer 推断 Spring stereotype：

| PIM layer | PSM stereotype | 典型 Spring 注解 |
|-----------|---------------|-----------------|
| domain | Entity | @Entity |
| service | Service | @Service |
| repository | Repository | @Repository |
| controller | Controller | @RestController |
| dto | DTO | —（POJO） |
| port / interface | Interface | —（Java Interface） |
| adapter / gateway | Service 或 Component | @Service / @Component |
| event / handler | Component | @Component |
| 其他自定义层 | 根据语义推断 | — |

- visibility 默认 public
- 每个 classifier 的 package 和 package_id 必须引用已创建的包

## 3. 关系转换 — 保留 PIM 的协作设计
- PIM 的依赖/关联关系 → PSM 的 relations 数组
- 关系类型保持（dependency → dependency, association → association 等）
- 更新 source/target 为 PSM classifier_id
- **PIM 中没有的关系不凭空创建**

## 4. 拓扑排序
- 计算 topologicalOrder：没有依赖的类优先（order 从 0 开始递增）
- Interface 和 Enumeration 先于它们的实现类

# 必填字段提醒
- modules[].parent_module_id: 根模块设为空字符串 ""
- packages[].parent_package_id: 根包设为空字符串 ""
- classifiers[].package_id, module_id: 必须关联到已创建的 package 和 module
- 所有必填字段必须显式提供值

# 输出要求
- **只返回纯 JSON 字符串，严禁使用 \`\`\`json 等 markdown 代码块包裹**
- 生成完整的 project_model.cd v0.2.1 格式 JSON
- 包含 modules、packages、classifiers、relations 四个顶层字段
- 所有描述性字段使用中文
`;

export function buildPsmClassUserPrompt(
  pimClassJson: string,
  basePackage: string,
  moduleId: string,
  moduleName: string,
  directoryName: string,
  projectName?: string
): string {
  return `
# PIM 类图
${pimClassJson}

# 目标平台参数
- 项目名: ${projectName || "unknown"}
- 基础包前缀: ${basePackage}
- module_id: ${moduleId}
- module_name（中文）: ${moduleName}
- 模块目录名（用于包缩写）: ${directoryName}
- 架构风格: 分层 Web 服务器
- 分层: controller, service, domain, repository, dto

# 包命名要求
1. 包路径格式：${basePackage}.{模块目录名}.{分层}
   - 基础包前缀已固定为 ${basePackage}，不可更改
   - 模块目录名直接使用 "${directoryName}"，不要自己编简写
   - 分层使用 PIM 中的 layer 名（domain/service/repository/controller/dto 等）
   - 示例：${basePackage}.${directoryName}.controller
2. 每个 class/interface 必须分配正确的包
3. full_name 字段 = 完整包路径，如 "${basePackage}.${directoryName}.controller"
4. package_path 字段 = full_name 将 "." 替换为 "/"

请生成符合 project_model.cd v0.2.1 格式的 PSM 类图 JSON。
  `.trim();
}

// ============ PSM 时序图 ============

export const PSM_SEQUENCE_SYSTEM_PROMPT = `
# 角色
你是一位 Java/Spring Boot 平台专家，擅长将 PIM 时序图转换为 PSM 时序图。

# 任务
给定 PIM 时序图 (pim_sequence.json) 和 PSM 类图 (psm_class.json)，
生成 PSM 时序图 JSON。

# 用例分段保留（极其重要！）
- **PIM 时序图中的每个 opt Fragment 必须在 PSM 时序图中完整保留**
- 不可将多个 opt Fragment 的消息合并为一段平坦序列
- opt Fragment 的 guardCondition 保持与 PIM 时序图完全一致

# 转换规则

## 1. lifeline 映射 — 非协商硬性要求

**第一步：全量创建。遍历 PSM 类图中每一个 classifier，为每个创建一条 lifeline。**

**第二步：Actor。从 PIM 时序图复制 Actor lifeline。**

**第三步：填充 className。每个非 Actor lifeline 的 className 必须是完整的 Java 类路径。**
格式为 psm_class.json 中 package 字段 + "." + name。

**验证清单（生成前自查）：**
- [ ] lifelines 数量 = PSM classifiers 数量 + Actor 数量
- [ ] 每个非 Actor lifeline 的 className 非空
- [ ] 每个 PSM classifier_id 在 lifelines 中出现恰好一次

## 2. 消息映射
- 保持 PIM 时序图的消息序列结构，更新 lifeline_id 为 PSM 的 lifeline_id
- 消息的方法名必须来自 PSM 类图中对应 classifier 的 operations
- **PIM 时序图中的所有消息必须在 PSM 时序图中保留**
- **每条 PSM 消息必须有非空 businessGoal（中文），从 PIM 时序图的对应消息中继承**
- **禁止空洞的通用消息名**

## 3. DTO 参与消息（非协商硬性要求）
- **每个 DTO/Request/Response lifeline 必须至少参与 2 条消息**

# 约束
1. **只返回纯 JSON 字符串，严禁 markdown 代码块包裹**
2. 所有非 Actor lifeline 的 classifier_id 必须来自 psm_class.json
3. **严禁返回空的 lifelines 数组**
4. 所有描述性字段使用中文
`;

export function buildPsmSequenceUserPrompt(
  pimSequenceJson: string,
  psmClassJson: string
): string {
  let classifierList = "";
  try {
    const psm = JSON.parse(psmClassJson);
    const ids = (psm.classifiers || []).map((c: any) =>
      `  - ${c.classifier_id} -> className="${c.package}.${c.name}"`
    );
    if (ids.length > 0) {
      classifierList = `\n# 必须在 lifelines 中出现的 classifier（共 ${ids.length} 个）：\n${ids.join("\n")}`;
    }
  } catch { /* ignore */ }

  return `
# PIM 时序图
${pimSequenceJson}

# PSM 类图（lifeline 映射约束）
${psmClassJson}
${classifierList}

# 硬性要求
1. 上述每个 classifier 必须在 lifelines 中出现一次，className 必须精确匹配
2. 消息流覆盖所有 lifeline
3. **保留 PIM 时序图中的所有 opt Fragment 结构，不得扁平化**
4. **每条消息必须有非空 businessGoal（中文），从 PIM 时序图对应消息中继承**
5. **每条消息必须有非空 businessResult（中文）**
6. 必须保留 PIM 时序图中所有 ExternalModule lifeline 及其跨模块消息

请生成符合 psm_sequence.schema.json 的 PSM 时序图 JSON。
  `.trim();
}
