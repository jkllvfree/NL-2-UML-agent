/**
 * PSM 降级构造器 — LLM 生成失败时，从 PIM 构建最小有效 PSM。
 */
import * as fs from "fs";

// ============ PSM 类图降级 ============

export function buildMinimalPsmFromPim(
  pimClass: { classifiers?: PimClassifier[] },
  basePackage: string,
  moduleId: string,
  moduleName: string,
  directoryName: string
): Record<string, unknown> {
  const classifiers = pimClass.classifiers || [];
  const modId = `mod.${directoryName}`;

  // 从 PIM 的 layer 字段收集实际分层
  const layerSet = new Set<string>();
  for (const c of classifiers) {
    layerSet.add(c.layer || "domain");
  }
  const actualLayers = Array.from(layerSet);

  // PIM layer → PSM stereotype 映射
  const stereotypeByLayer: Record<string, string> = {
    domain: "Entity",
    service: "Service",
    repository: "Repository",
    controller: "Controller",
    dto: "DTO",
    port: "Interface",
    adapter: "Service",
    gateway: "Service",
    event: "Component",
    handler: "Component",
  };

  const packages = actualLayers.map((layer) => ({
    package_id: `pkg.${directoryName}_${layer}`,
    name: layer,
    full_name: `${basePackage}.${directoryName}.${layer}`,
    module_id: modId,
    parent_package_id: "",
    package_path: `${basePackage.replace(/\./g, "/")}/${directoryName}/${layer}`,
    classifier_ids: [] as string[],
  }));

  const psmClassifiers: Record<string, unknown>[] = [];
  const pkgClassifierMap: Record<string, string[]> = {};
  for (const layer of actualLayers) pkgClassifierMap[layer] = [];

  for (const pim of classifiers) {
    const targetLayer = pim.layer || "domain";
    const pkgId = `pkg.${directoryName}_${targetLayer}`;
    const clsId = `cls.${pim.name}`;
    const stereotype = stereotypeByLayer[targetLayer] || guessStereotype(targetLayer, pim.kind);

    psmClassifiers.push({
      classifier_id: clsId,
      name: pim.name,
      kind: pim.kind || "Class",
      package: `${basePackage}.${directoryName}.${targetLayer}`,
      package_id: pkgId,
      module_id: modId,
      visibility: "public",
      isAbstract: pim.isAbstract || false,
      stereotype,
      typeParameters: [],
      attributes: (pim.attributes || []).map((a: Record<string, unknown>) => ({
        name: a.name,
        type: mapJavaType(a.type as string),
        visibility: (a.visibility as string) || "private",
        isStatic: false,
        multiplicity: "",
        defaultValue: "",
        isDerived: false,
      })),
      operations: (pim.operations || []).map((op: Record<string, unknown>) => ({
        name: op.name,
        returnType: (op.returnType as string) || "void",
        visibility: (op.visibility as string) || "public",
        isStatic: false,
        isAbstract: false,
        parameters: ((op.parameters || []) as Record<string, unknown>[]).map((p: Record<string, unknown>) => ({
          name: p.name,
          type: mapJavaType(p.type as string),
        })),
      })),
      dependencies: [],
    });

    pkgClassifierMap[targetLayer] = pkgClassifierMap[targetLayer] || [];
    pkgClassifierMap[targetLayer].push(clsId);
  }

  // 更新包的 classifier_ids
  for (const pkg of packages) {
    pkg.classifier_ids = pkgClassifierMap[pkg.name] || [];
  }

  return {
    schema_version: "v0.2.1",
    modules: [{
      module_id: modId,
      module_name: moduleName,
      parent_module_id: "",
      is_leaf: true,
      package_ids: packages.map((p) => p.package_id),
    }],
    packages,
    classifiers: psmClassifiers,
    relations: [],
  };
}

// ============ PSM 时序图降级 ============

interface PsmClassifier {
  classifier_id: string;
  name: string;
  package?: string;
  kind?: string;
}

export function buildMinimalPsmSequenceFromClass(
  psmClassPath: string,
  pimSequencePath: string,
  moduleId: string
): Record<string, unknown> {
  const psmClass: { classifiers?: PsmClassifier[] } = JSON.parse(fs.readFileSync(psmClassPath, "utf-8"));
  const pimSequence: Record<string, unknown> = JSON.parse(fs.readFileSync(pimSequencePath, "utf-8"));

  const classifiers = psmClass.classifiers || [];
  const pimLifelines = (pimSequence.lifelines || []) as Record<string, unknown>[];

  const lifelineIdMap = new Map<string, string>();
  const lifelines: Record<string, unknown>[] = [];

  // Actor
  const actorLifeline = pimLifelines.find((l) => l.isActor);
  if (actorLifeline) {
    const actorId = actorLifeline.lifeline_id as string || `lifeline_actor_${moduleId}`;
    lifelineIdMap.set(actorLifeline.lifeline_id as string, actorId);
    lifelines.push({
      lifeline_id: actorId,
      name: actorLifeline.name || "用户/外部系统",
      isActor: true,
      role: "Actor",
      classifier_id: null,
      className: null,
      designResponsibility: actorLifeline.designResponsibility || "发起操作请求",
    });
  }

  // 构建 PIM name → PIM lifeline 映射
  const pimNameToLifelineId = new Map<string, string>();
  for (const lf of pimLifelines) {
    if (!lf.isActor && lf.name) {
      pimNameToLifelineId.set(lf.name as string, lf.lifeline_id as string);
    }
  }

  // 从 PIM 复制 ExternalModule lifelines
  for (const lf of pimLifelines) {
    if ((lf.role === "ExternalModule" || lf.external_module_id) && lf.isActor !== true) {
      const extId = lf.lifeline_id as string;
      lifelineIdMap.set(extId, extId);
      lifelines.push({ ...lf });
    }
  }

  // 为每个 PSM classifier 创建 lifeline
  for (const cls of classifiers) {
    const pimLfId = pimNameToLifelineId.get(cls.name);
    const psmLfId = pimLfId || `lifeline_psm_${cls.classifier_id}`;
    if (pimLfId) {
      lifelineIdMap.set(pimLfId, psmLfId);
    }
    const pimLf = pimLifelines.find((l) => l.lifeline_id === pimLfId);
    lifelines.push({
      lifeline_id: psmLfId,
      name: cls.name,
      isActor: false,
      role: pimLf?.role || roleForLayer(cls),
      classifier_id: cls.classifier_id,
      className: cls.package ? `${cls.package}.${cls.name}` : cls.name,
      designResponsibility: pimLf?.designResponsibility || `${cls.name} 的平台相关设计职责`,
    });
  }

  // 复制 PIM sequence elements，更新 lifeline_id 引用
  const pimElements = (pimSequence.sequence as Record<string, unknown>)?.elements || [];
  const psmElements = remapLifelineIds(
    JSON.parse(JSON.stringify(pimElements)),
    lifelineIdMap
  );

  return {
    schema_version: "0.2.1",
    module_id: moduleId,
    description: pimSequence.description || "",
    interaction_id: `seq_psm_${moduleId}`,
    name: `${pimSequence.name || ""} (PSM)`,
    use_case_id: pimSequence.use_case_id || moduleId,
    preconditions: pimSequence.preconditions || [],
    postconditions: pimSequence.postconditions || [],
    businessOutcome: pimSequence.businessOutcome || "",
    source_interaction_id: pimSequence.interaction_id || "",
    lifelines,
    sequence: { elements: psmElements },
  };
}

function remapLifelineIds(elements: unknown[], idMap: Map<string, string>): unknown[] {
  return elements.map((el: any) => {
    const cloned = { ...el };
    if (cloned.type === "Message") {
      if (typeof cloned.source === "string") {
        cloned.source = idMap.get(cloned.source) || cloned.source;
      } else if (cloned.source?.lifeline_id) {
        cloned.source = { ...cloned.source, lifeline_id: idMap.get(cloned.source.lifeline_id) || cloned.source.lifeline_id };
      }
      if (typeof cloned.target === "string") {
        cloned.target = idMap.get(cloned.target) || cloned.target;
      } else if (cloned.target?.lifeline_id) {
        cloned.target = { ...cloned.target, lifeline_id: idMap.get(cloned.target.lifeline_id) || cloned.target.lifeline_id };
      }
      const msg = cloned.message;
      if (msg) {
        if (msg.source?.lifeline_id) {
          msg.source = { ...msg.source, lifeline_id: idMap.get(msg.source.lifeline_id) || msg.source.lifeline_id };
        }
        if (msg.target?.lifeline_id) {
          msg.target = { ...msg.target, lifeline_id: idMap.get(msg.target.lifeline_id) || msg.target.lifeline_id };
        }
      }
    }
    if (cloned.type === "Fragment" && cloned.fragment?.operands) {
      cloned.fragment = {
        ...cloned.fragment,
        operands: cloned.fragment.operands.map((op: any) => ({
          ...op,
          elements: remapLifelineIds(op.elements || [], idMap),
        })),
      };
    }
    return cloned;
  });
}

function roleForLayer(cls: PsmClassifier): string {
  const id = cls.classifier_id || "";
  if (id.includes("Repository") || cls.name?.endsWith("Repository")) return "Repository";
  if (id.includes("Controller") || cls.name?.endsWith("Controller")) return "Controller";
  if (id.includes("Service") || cls.name?.endsWith("Service")) return "Service";
  return "DomainObject";
}

function guessStereotype(layer: string, kind?: string): string {
  if (kind === "Interface") return "Interface";
  return layer.charAt(0).toUpperCase() + layer.slice(1);
}

function mapJavaType(type: string): string {
  if (!type) return "String";
  const t = type.toLowerCase();
  if (t === "string" || t === "text") return "String";
  if (t === "int" || t === "integer" || t === "long") return "Long";
  if (t === "float" || t === "double" || t === "number") return "Double";
  if (t === "bool" || t === "boolean") return "Boolean";
  if (t === "datetime" || t === "date" || t === "timestamp") return "LocalDateTime";
  if (t === "void") return "void";
  if (t === "object" || t === "map") return "Map<String, Object>";
  if (t === "list" || t === "array") return "List";
  return type;
}

interface PimClassifier {
  classifier_id: string;
  name: string;
  kind?: string;
  layer?: string;
  isAbstract?: boolean;
  attributes?: Record<string, unknown>[];
  operations?: Record<string, unknown>[];
}
