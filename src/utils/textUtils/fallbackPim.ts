/**
 * PIM 时序图降级构造器 — LLM 生成失败时，从 PIM 类图构建最小有效 PIM 时序图。
 */
import * as fs from "fs";

interface PimClassEntry {
  classifier_id: string;
  name: string;
  kind?: string;
  layer?: string;
}

export function buildMinimalPimSequenceFromClass(
  pimClassPath: string,
  moduleId: string,
  interactionId: string,
  sourceInteractionId: string,
  description: string,
  useCaseId?: string
): Record<string, unknown> {
  const pimClass: { classifiers?: PimClassEntry[] } = JSON.parse(fs.readFileSync(pimClassPath, "utf-8"));
  const classifiers = pimClass.classifiers || [];

  const lifelines: Record<string, unknown>[] = [
    {
      lifeline_id: `lifeline_actor_${moduleId}`,
      name: "用户/外部系统",
      isActor: true,
      role: "Actor",
      classifier_id: null,
      designResponsibility: "发起操作请求",
    },
  ];

  for (const cls of classifiers) {
    const layer = cls.layer || "domain";
    const role =
      layer === "domain" ? "DomainObject" :
      layer === "service" ? "Service" :
      layer === "repository" ? "Repository" :
      layer === "controller" ? "Controller" :
      layer === "dto" ? "Service" : "DomainObject";

    lifelines.push({
      lifeline_id: `lifeline_${cls.classifier_id}`,
      name: cls.name,
      isActor: false,
      role,
      classifier_id: cls.classifier_id,
      designResponsibility: `${cls.name} 的${layer}层设计职责`,
    });
  }

  return {
    schema_version: "0.2.1",
    module_id: moduleId,
    description,
    interaction_id: interactionId,
    name: `${description} PIM时序图`,
    use_case_id: useCaseId || `${moduleId}_default`,
    preconditions: ["系统已初始化"],
    postconditions: ["操作完成"],
    businessOutcome: "完成业务操作流程",
    source_interaction_id: sourceInteractionId,
    lifelines,
    sequence: {
      elements: [
        {
          element_id: `fragment_${moduleId}_default`,
          type: "Fragment",
          fragment: {
            fragment_type: "opt",
            businessPurpose: "用例: 主流程",
            operands: [
              {
                operand_id: `op_${moduleId}_1`,
                guardCondition: `[用例: ${useCaseId || moduleId}]`,
                elements: [],
              },
            ],
          },
        },
      ],
    },
  };
}
