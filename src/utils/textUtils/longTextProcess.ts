import { callUMLGenerator } from "../utils.js";
import type { UMLApiResponse, UMLRequest } from "../../types/api.js";
import type { UMLModel, ClassNode } from "../../types/diagram.js";

// 配置常量
const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;
const MAX_PARALLEL_CHUNKS = 3;

/**
 * 长文本处理策略：
 * 1. 将长文本分割成多个重叠的块
 * 2. 并行对每个块调用 UML 生成
 * 3. 合并和去重所有块的结果
 */
export const LongTextProcess = async (
  userInput: UMLRequest,
): Promise<UMLApiResponse> => {
  console.log("[LongText] 开始处理长文本...");
  const startTime = Date.now();

  try {
    // 步骤1: 文本分块
    const chunks = splitTextIntoChunks(userInput.requirement, CHUNK_SIZE, CHUNK_OVERLAP);
    console.log(` [LongText] 文本已分割为 ${chunks.length} 个块`);

    if (chunks.length === 1) {
      // 单块直接处理
      const singleChunk = chunks[0] ?? "";
      console.log(` [LongText] 单块直接生成 UML 模型...`);
      const finalModel: UMLModel = await callUMLGenerator(singleChunk);
      return { status: "success", data: finalModel };
    }

    // 步骤2: 并行处理每个块
    console.log(`[LongText] 并行处理 ${Math.min(chunks.length, MAX_PARALLEL_CHUNKS)} 个块...`);
    const chunkModels = await processChunksInBatches(chunks);

    // 步骤3: 合并结果
    console.log(`[LongText] 合并 ${chunkModels.length} 个块的结果...`);
    const mergedModel = mergeChunkModels(chunkModels);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[LongText] 处理完成，耗时 ${duration}秒`);

    return { status: "success", data: mergedModel };
  } catch (error) {
    console.error("[LongText] 处理失败:", error);
    return {
      status: "error",
      errorMessage: `长文本处理失败: ${error instanceof Error ? error.message : String(error)}`,
    } as UMLApiResponse;
  }
};

// 按句子分块，保留重叠区域避免信息丢失
function splitTextIntoChunks(text: string, chunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

  let currentChunk = "";

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      const overlapText = currentChunk.slice(-overlap);
      currentChunk = overlapText + sentence;
    } else {
      currentChunk += sentence;
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

// 分批并行处理
async function processChunksInBatches(chunks: string[]): Promise<UMLModel[]> {
  const results: UMLModel[] = [];

  for (let i = 0; i < chunks.length; i += MAX_PARALLEL_CHUNKS) {
    const batch = chunks.slice(i, i + MAX_PARALLEL_CHUNKS);
    const batchNum = Math.floor(i / MAX_PARALLEL_CHUNKS) + 1;
    const totalBatches = Math.ceil(chunks.length / MAX_PARALLEL_CHUNKS);
    console.log(`  处理批次 ${batchNum}/${totalBatches}`);

    const batchPromises = batch.map(async (chunk, index) => {
      const chunkNumber = i + index + 1;
      try {
        const model = await callUMLGenerator(chunk);
        console.log(`    块 ${chunkNumber}/${chunks.length} 生成完成`);
        return model;
      } catch (error) {
        console.error(`    块 ${chunkNumber}/${chunks.length} 生成失败:`, error);
        return { nodeDataArray: [], linkDataArray: [], description: "" };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  return results;
}

// 合并多个 UML 模型
function mergeChunkModels(chunkModels: UMLModel[]): UMLModel {
  const classSet = new Set<string>();
  const nodes: ClassNode[] = [];
  const links: { source: string; target: string; relationship: string }[] = [];

  for (const model of chunkModels) {
    if (!model) continue;

    // 合并节点（去重）
    for (const node of model.nodeDataArray || []) {
      if (node && node.name && !classSet.has(node.name)) {
        classSet.add(node.name);
        nodes.push(node);
      }
    }

    // 合并连线（RawLinkData 用 source/target）
    for (const link of (model as any).linkDataArray || []) {
      if (link && link.source && link.target) {
        links.push(link);
      }
    }
  }

  // 生成合并后的描述
  const classCount = nodes.length;
  const linkCount = links.length;
  const description = `UML类图模型（多块合并），包含 ${classCount} 个类，${linkCount} 个关系。`;

  return {
    nodeDataArray: nodes,
    linkDataArray: links as any,
    description,
  };
}