//区分短文本，中文本，长文本
import { TextClassification } from "../../types/diagram.js";

export const classifyText = (text: string): TextClassification => {
  // 去除首尾空格后计算字符数
  const charCount = text.trim().length;

  // 纯按字符数划分，阈值可以根据实际测试情况微调
  const SHORT_THRESHOLD = 100;
  const MEDIUM_THRESHOLD = 3000;

  if (charCount <= SHORT_THRESHOLD) {
    // 短文本：信息严重不足，需要打断并进入澄清循环
    return TextClassification.SHORT_TEXT;
  } else if (charCount <= MEDIUM_THRESHOLD) {
    // 中文本：信息基本及格（单页文档级别），直接让 LLM 全局生成初稿，后续靠用户迭代
    return TextClassification.MEDIUM_TEXT;
  } else {
    // 长文本：几十页的长篇大论，需要防遗忘，可能要启动 Map-Reduce 或分块提取
    return TextClassification.LONG_TEXT;
  }
};
