import * as fs from "fs";
import * as path from "path";
import type {
  LeafModel,
  Classifier,
  SequenceView,
  SequenceModel,
  SequenceElement,
  SequenceLifeline,
} from "../../types/diagram.js";

// ---------- helper: escape PUML special characters ----------

const escapeTitle = (text: string): string =>
  text.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");

const escapeString = (text: string): string =>
  text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");

// ---------- class diagram ----------

const RELATION_ARROW: Record<string, string> = {
  generalization: "<|--",
  realization: "<|..",
  association: "-->",
  aggregation: "o--",
  composition: "*--",
  dependency: "..>",
};

const renderAttributes = (cls: Classifier): string[] => {
  return (cls.attributes || []).map((a) => {
    const mult = a.multiplicity ? ` [${a.multiplicity}]` : "";
    return `  +${escapeString(a.name)}: ${escapeString(a.type)}${mult}`;
  });
};

const renderOperations = (cls: Classifier): string[] => {
  return (cls.operations || []).map((op) => {
    const params = (op.parameters || [])
      .map((p) => `${escapeString(p.name)}: ${escapeString(p.type)}`)
      .join(", ");
    const ret = op.returnType ? `: ${escapeString(op.returnType)}` : "";
    return `  +${escapeString(op.name)}(${params})${ret}`;
  });
};

const renderClassifier = (cls: Classifier): string => {
  const lines: string[] = [];
  const kind = cls.kind === "Enum" ? "enum" : "class";

  lines.push(`${kind} "${escapeString(cls.name)}" <<${escapeString(cls.stereotype)}>> {`);
  lines.push(...renderAttributes(cls));
  if (cls.operations.length > 0 && cls.attributes.length > 0) {
    lines.push("  --");
  }
  lines.push(...renderOperations(cls));
  lines.push("}");

  if (cls.businessMeaning) {
    lines.push(`note right of "${escapeString(cls.name)}"`);
    lines.push(`  <b>Business Meaning</b>`);
    lines.push(`  ${escapeString(cls.businessMeaning)}`);
    if (cls.responsibilities.length > 0) {
      lines.push(`  --`);
      lines.push(`  <b>Responsibilities</b>`);
      for (const r of cls.responsibilities) {
        lines.push(`  - ${escapeString(r)}`);
      }
    }
    if (cls.businessRules.length > 0) {
      lines.push(`  --`);
      lines.push(`  <b>Business Rules</b>`);
      for (const r of cls.businessRules) {
        lines.push(`  - ${escapeString(r)}`);
      }
    }
    lines.push(`end note`);
  }

  return lines.join("\n");
};

const renderDependencies = (
  sourceName: string,
  deps: LeafModel["classifiers"][number]["dependencies"],
  idToName: Map<string, string>
): string[] => {
  return (deps || []).map((dep) => {
    const targetName = idToName.get(dep.target) || dep.target;
    const arrow = RELATION_ARROW[dep.kind] || "-->";
    const label = dep.businessRelation ? ` : "${escapeString(dep.businessRelation)}"` : "";
    const fromMult = dep.multiplicityFrom ? ` "${dep.multiplicityFrom}"` : "";
    const toMult = dep.multiplicityTo ? ` "${dep.multiplicityTo}"` : "";
    return `"${escapeString(sourceName)}"${fromMult} ${arrow}${toMult} "${escapeString(targetName)}"${label}`;
  });
};

export const convertClassJsonToPuml = (model: LeafModel): string => {
  const lines: string[] = [];
  lines.push("@startuml");
  lines.push("");

  if (model.description) {
    lines.push(`title ${escapeTitle(model.description)}`);
    lines.push("");
  }

  const idToName = new Map<string, string>();
  for (const cls of model.classifiers) {
    idToName.set(cls.classifier_id, cls.name);
  }

  for (const cls of model.classifiers) {
    lines.push(renderClassifier(cls));
    lines.push("");
  }

  const allDeps = model.classifiers.flatMap((cls) =>
    renderDependencies(cls.name, cls.dependencies, idToName)
  );
  if (allDeps.length > 0) {
    lines.push(...allDeps);
    lines.push("");
  }

  lines.push("@enduml");
  return lines.join("\n");
};

// ---------- sequence diagram ----------

const LIFELINE_TYPE: Record<string, string> = {
  Actor: "actor",
  Aggregate: "participant",
  Service: "participant",
  ExternalSystem: "participant",
  Policy: "participant",
};

const MESSAGE_ARROW: Record<string, string> = {
  request: "->",
  notify: "->>",
  response: "-->",
};

/** PlantUML 不允许在消息箭头中使用带引号的 lifeline 引用，因此需转为安全的标识符 */
const safeId = (id: string): string => id.replace(/[^a-zA-Z0-9_]/g, "_");

const renderElements = (
  elements: SequenceElement[],
  lifelines: SequenceLifeline[],
  depth: number
): string[] => {
  const lines: string[] = [];
  const indent = "  ".repeat(depth);

  for (const el of elements) {
    if (el.type === "Message" && "message" in el) {
      const msg = el.message;
      const arrow = MESSAGE_ARROW[msg.message_kind] || "->>";
      const seq = msg.sequence_number ? `[${msg.sequence_number}] ` : "";
      const guard = msg.guard ? `[${msg.guard}] ` : "";
      const name = escapeString(msg.name);

      lines.push(`${indent}${safeId(msg.source.lifeline_id)} ${arrow} ${safeId(msg.target.lifeline_id)} : ${guard}${seq}${name}`);

      if (msg.businessGoal) {
        lines.push(`${indent}note right`);
        lines.push(`${indent}  <b>${escapeString(msg.businessGoal)}</b>`);
        if (msg.businessResult) {
          lines.push(`${indent}  Result: ${escapeString(msg.businessResult)}`);
        }
        lines.push(`${indent}end note`);
      }
    } else if (el.type === "Fragment" && "fragment" in el) {
      const frag = el.fragment;
      const ftype = frag.fragment_type;
      const firstGuard = frag.operands[0]?.guardCondition
        ? ` ${escapeString(frag.operands[0].guardCondition)}`
        : "";

      lines.push(`${indent}${ftype} ${escapeString(frag.businessPurpose || "")}${firstGuard}`);

      for (let i = 0; i < frag.operands.length; i++) {
        const operand = frag.operands[i]!;
        if (i > 0) {
          const guard = operand.guardCondition
            ? `else ${escapeString(operand.guardCondition)}`
            : "else";
          lines.push(`${indent}${guard}`);
        }
        lines.push(...renderElements(operand.elements, lifelines, depth + 1));
      }

      lines.push(`${indent}end`);
    }
  }

  return lines;
};

const renderSingleInteraction = (interaction: SequenceModel): string => {
  const lines: string[] = [];
  lines.push("@startuml");
  lines.push("");

  lines.push(`title ${escapeTitle(interaction.name)}`);
  if (interaction.description) {
    lines.push(`caption ${escapeTitle(interaction.description)}`);
  }
  lines.push("");

  // preconditions / postconditions as notes
  if (interaction.preconditions.length > 0 || interaction.postconditions.length > 0) {
    lines.push("note over title");
    if (interaction.preconditions.length > 0) {
      lines.push("  <b>Preconditions:</b>");
      for (const c of interaction.preconditions) {
        lines.push(`  - ${escapeString(c)}`);
      }
    }
    if (interaction.postconditions.length > 0) {
      if (interaction.preconditions.length > 0) lines.push("  --");
      lines.push("  <b>Postconditions:</b>");
      for (const c of interaction.postconditions) {
        lines.push(`  - ${escapeString(c)}`);
      }
    }
    if (interaction.businessOutcome) {
      lines.push("  --");
      lines.push(`  <b>Outcome:</b> ${escapeString(interaction.businessOutcome)}`);
    }
    lines.push("end note");
    lines.push("");
  }

  // lifelines
  for (const lf of interaction.lifelines) {
    const ptype = LIFELINE_TYPE[lf.role] || "participant";
    const stereo = lf.role !== "Actor" ? ` <<${lf.role}>>` : "";
    lines.push(`${ptype} "${escapeString(lf.name)}" as ${safeId(lf.lifeline_id)}${stereo}`);
  }
  lines.push("");

  // sequence elements
  lines.push(...renderElements(interaction.sequence.elements, interaction.lifelines, 0));

  lines.push("");
  lines.push("@enduml");
  return lines.join("\n");
};

export const convertSequenceJsonToPuml = (view: SequenceView): string => {
  const blocks = view.interactions.map(renderSingleInteraction);
  return blocks.join("\n\n");
};

// ===================== PIM 类图 → PlantUML =====================

const PIM_LAYER_COLOR: Record<string, string> = {
  domain: "#4488FF",
  service: "#44BB44",
  repository: "#FFAA00",
  controller: "#FF4444",
  dto: "#888888",
};

export const convertPimClassJsonToPuml = (json: Record<string, unknown>): string => {
  const classifiers = (json.classifiers || []) as Record<string, unknown>[];
  const description = (json.description as string) || "";

  const lines: string[] = [
    "@startuml",
    `title PIM 设计类图${description ? "\\n" + escapeTitle(description) : ""}`,
    "skinparam classAttributeIconSize 0",
    "",
  ];

  lines.push("' 分层着色: domain=蓝, service=绿, repository=橙, controller=红, dto=灰");

  for (const cls of classifiers) {
    const layer = cls.layer as string || "domain";
    const kind = cls.kind as string || "Class";
    const layerColor = PIM_LAYER_COLOR[layer] || "#000000";

    let plantUmlType = "class";
    const layerInit = (layer.charAt(0)?.toUpperCase() || "") + layer.slice(1);
    let stereotypeTag = ` <<(${layerInit},${layerColor}) ${layer}>>`;
    if (kind === "Interface") plantUmlType = "interface";
    else if (kind === "Enumeration") plantUmlType = "enum";
    else if (kind === "Abstract Class" || cls.isAbstract) plantUmlType = "abstract class";

    lines.push(`${plantUmlType} "${escapeString(cls.name as string)}"${stereotypeTag} {`);

    const attrs = (cls.attributes || []) as Record<string, unknown>[];
    for (const attr of attrs) {
      const vis = visibilitySymbol(attr.visibility as string);
      lines.push(`  ${vis}${escapeString(attr.name as string)} : ${escapeString(attr.type as string)}`);
    }

    const ops = (cls.operations || []) as Record<string, unknown>[];
    if (attrs.length > 0 && ops.length > 0) lines.push("  .. 方法 ..");
    for (const op of ops) {
      const vis = visibilitySymbol(op.visibility as string);
      const params = (op.parameters || []) as Record<string, unknown>[];
      const paramStr = params.map((p) => `${escapeString(p.name as string)}: ${escapeString(p.type as string)}`).join(", ");
      const retType = op.returnType as string || "void";
      lines.push(`  ${vis}${escapeString(op.name as string)}(${paramStr}) : ${escapeString(retType)}`);
    }

    lines.push("}");
    lines.push("");
  }

  // 关系
  const clsMap = new Map<string, string>();
  for (const cls of classifiers) {
    clsMap.set(cls.classifier_id as string, cls.name as string);
  }

  for (const cls of classifiers) {
    const deps = (cls.dependencies || []) as Record<string, unknown>[];
    const clsName = cls.name as string;
    for (const dep of deps) {
      const target = dep.target as string;
      const targetName = clsMap.get(target) || target;
      const relType = (dep.kind || "dependency") as string;
      const arrow = RELATION_ARROW[relType] || "-->";
      lines.push(`"${escapeString(clsName)}" ${arrow} "${escapeString(targetName)}"`);
    }
  }

  // 横切关注点
  const concerns = (json.crossCuttingConcerns || []) as Record<string, unknown>[];
  if (concerns.length > 0) {
    lines.push("note as CrossCutting");
    for (const cc of concerns) {
      const ccType = cc.type as string;
      const ccDesc = cc.description as string;
      lines.push(`  <b>[${escapeString(ccType)}]</b> ${escapeString(ccDesc)}`);
    }
    lines.push("end note");
  }

  lines.push("@enduml");
  return lines.join("\n");
};

// ===================== PIM 时序图 → PlantUML =====================

export const convertPimSequenceJsonToPuml = (json: Record<string, unknown>): string => {
  return genericSequenceToPuml(json, "PIM 时序图");
};

// ===================== PSM 类图 → PlantUML =====================

export const convertPsmClassJsonToPuml = (json: Record<string, unknown>): string => {
  const classifiers = (json.classifiers || []) as Record<string, unknown>[];
  const packages = (json.packages || []) as Record<string, unknown>[];

  const lines: string[] = [
    "@startuml",
    "title PSM Java/Spring 设计类图",
    "skinparam classAttributeIconSize 0",
    "skinparam packageStyle rectangle",
    "",
  ];

  // 按 package 分组 classifiers
  const pkgMap = new Map<string, Record<string, unknown>[]>();
  for (const cls of classifiers) {
    const pkgId = (cls.package_id || cls.package || "") as string;
    if (!pkgMap.has(pkgId)) pkgMap.set(pkgId, []);
    pkgMap.get(pkgId)!.push(cls);
  }

  for (const pkg of packages) {
    const pkgId = pkg.package_id as string;
    const pkgName = pkg.name as string;
    const pkgPath = pkg.package_path as string || pkgId;
    const classes = pkgMap.get(pkgId) || [];
    if (classes.length === 0) continue;

    lines.push(`package "${escapeString(pkgName)}\\n(${escapeString(pkgPath)})" {`);

    for (const cls of classes) {
      const stereotype = cls.stereotype as string || "";
      const kind = cls.kind as string || "Class";
      const isAbstract = cls.isAbstract as boolean || false;

      let plantUmlType = "class";
      let stereotypeTag = stereotype ? ` <<${escapeString(stereotype)}>>` : "";
      if (kind === "Interface") plantUmlType = "interface";
      else if (kind === "Enumeration") plantUmlType = "enum";
      else if (isAbstract) plantUmlType = "abstract class";

      lines.push(`  ${plantUmlType} "${escapeString(cls.name as string)}"${stereotypeTag} {`);

      const attrs = (cls.attributes || []) as Record<string, unknown>[];
      for (const attr of attrs) {
        const vis = visibilitySymbol(attr.visibility as string);
        const staticMark = attr.isStatic ? "{static} " : "";
        lines.push(`    ${staticMark}${vis}${escapeString(attr.name as string)} : ${escapeString(attr.type as string)}`);
      }

      const ops = (cls.operations || cls.methods || []) as Record<string, unknown>[];
      if (attrs.length > 0 && ops.length > 0) lines.push("    .. 方法 ..");
      for (const op of ops) {
        const vis = visibilitySymbol(op.visibility as string);
        const params = (op.parameters || []) as Record<string, unknown>[];
        const paramStr = params.map((p) => `${escapeString(p.name as string)}: ${escapeString(p.type as string)}`).join(", ");
        const retType = op.returnType as string || "void";
        const staticMark = op.isStatic ? "{static} " : "";
        lines.push(`    ${staticMark}${vis}${escapeString(op.name as string)}(${paramStr}) : ${escapeString(retType)}`);
      }

      lines.push("  }");
    }

    lines.push("}");
    lines.push("");
  }

  // 关系
  const clsMap = new Map<string, string>();
  for (const cls of classifiers) {
    clsMap.set(cls.classifier_id as string, cls.name as string);
  }

  const relations = (json.relations || []) as Record<string, unknown>[];
  for (const rel of relations) {
    const srcId = (rel.from || rel.source) as string;
    const tgtId = (rel.to || rel.target) as string;
    let from = clsMap.get(srcId);
    let to = clsMap.get(tgtId);
    if (!from) from = srcId;
    if (!to) to = tgtId;
    if (from && to) {
      const relType = (rel.kind || rel.type || "dependency") as string;
      const arrow = RELATION_ARROW[relType] || "-->";
      lines.push(`"${escapeString(from)}" ${arrow} "${escapeString(to)}"`);
    }
  }

  lines.push("@enduml");
  return lines.join("\n");
};

// ===================== PSM 时序图 → PlantUML =====================

export const convertPsmSequenceJsonToPuml = (json: Record<string, unknown>): string => {
  return genericSequenceToPuml(json, "PSM 时序图");
};

// ===================== 通用时序图转换（PIM/PSM 共用） =====================

function genericSequenceToPuml(json: Record<string, unknown>, titlePrefix: string): string {
  const name = (json.name as string) || (json.interaction_id as string) || titlePrefix;
  const lines: string[] = [
    "@startuml",
    `title ${escapeTitle(name)}`,
    "",
  ];

  const lifelines = (json.lifelines || []) as Record<string, unknown>[];
  const lifelineMap = new Map<string, string>();

  for (const lf of lifelines) {
    const alias = safeId(lf.lifeline_id as string);
    lifelineMap.set(lf.lifeline_id as string, alias);
    if (lf.isActor) {
      lines.push(`actor "${escapeString(lf.name as string)}" as ${alias}`);
    } else {
      const role = lf.role as string || "";
      const className = lf.className as string || "";
      const label = className
        ? `${escapeString(lf.name as string)}\\n[${escapeString(className)}]`
        : `${escapeString(lf.name as string)}${role ? "\\n[" + escapeString(role) + "]" : ""}`;
      lines.push(`participant "${label}" as ${alias}`);
    }
  }
  lines.push("");

  const seq = json.sequence as Record<string, unknown> | undefined;
  const elements = (seq?.elements || []) as Record<string, unknown>[];
  renderGenericSequenceElements(elements, lines, lifelineMap, 0);

  lines.push("@enduml");
  return lines.join("\n");
}

function renderGenericSequenceElements(
  elements: Record<string, unknown>[],
  lines: string[],
  lifelineMap: Map<string, string>,
  depth: number
): void {
  const indent = "  ".repeat(depth);

  for (const el of elements) {
    const elType = el.type as string;

    if (elType === "Message") {
      const msg = (el.message || {}) as Record<string, unknown>;
      const srcObj = (el.source || msg.source || {}) as Record<string, unknown>;
      const tgtObj = (el.target || msg.target || {}) as Record<string, unknown>;
      const srcId = srcObj.lifeline_id as string || "";
      const tgtId = tgtObj.lifeline_id as string || "";
      const from = lifelineMap.get(srcId) || safeId(srcId);
      const to = lifelineMap.get(tgtId) || safeId(tgtId);
      const msgName = (msg.name || el.name || el.message_kind || "") as string;
      const msgKind = (el.message_kind || msg.message_kind || "request") as string;
      const arrow = MESSAGE_ARROW[msgKind] || "->>";
      const goal = (el.businessGoal || msg.businessGoal || "") as string;
      const note = goal ? ` : ${escapeString(goal)}` : "";
      lines.push(`${indent}${from} ${arrow} ${to} : ${escapeString(msgName)}${note}`);
    } else if (elType === "Fragment") {
      const fragment = el.fragment as Record<string, unknown> || {};
      const ft = fragment.fragment_type as string || "opt";
      const purpose = fragment.businessPurpose as string || "";
      const operands = (fragment.operands || []) as Record<string, unknown>[];
      const isMultiBranch = ft === "alt";

      if (isMultiBranch && operands.length > 0) {
        const firstGuard = (operands[0]?.guardCondition as string) || purpose || "";
        lines.push(`${indent}${ft} ${escapeString(firstGuard)}`);
        for (let i = 0; i < operands.length; i++) {
          const op = operands[i]!;
          if (i > 0) {
            const guard = (op.guardCondition as string) || "";
            lines.push(`${indent}else ${escapeString(guard)}`);
          }
          renderGenericSequenceElements((op.elements || []) as Record<string, unknown>[], lines, lifelineMap, depth + 1);
        }
      } else {
        const guard = (operands[0]?.guardCondition as string) || purpose || "";
        lines.push(`${indent}${ft} ${escapeString(guard)}`);
        for (const op of operands) {
          renderGenericSequenceElements((op.elements || []) as Record<string, unknown>[], lines, lifelineMap, depth + 1);
        }
      }
      lines.push(`${indent}end`);
    }
  }
}

function visibilitySymbol(vis: string): string {
  switch (vis) {
    case "private": return "-";
    case "protected": return "#";
    case "package": return "~";
    default: return "+";
  }
}

// ---------- disk I/O helpers ----------

export const writePumlFile = (dir: string, filename: string, content: string): string => {
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content, "utf-8");
  console.log(`已写入 PUML: ${filePath}`);
  return filePath;
};
