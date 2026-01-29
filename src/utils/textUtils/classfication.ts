//区分短文本，中文本，长文本
import { TextClassification } from "../../types/diagram.js";

export const classifyText = (text: string): TextClassification => {
  const charCount = text.length;
  // 简单的分词逻辑，这里不需要太复杂
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

  const shortConfig = { maxChars: 200, maxWords: 50 };
  const mediumConfig = { maxChars: 1000, maxWords: 200 };

  if (charCount <= shortConfig.maxChars && wordCount <= shortConfig.maxWords) {
    return TextClassification.SHORT_TEXT;
  } else if (charCount <= mediumConfig.maxChars && wordCount <= mediumConfig.maxWords) {
    return TextClassification.MEDIUM_TEXT;
  } else {
    return TextClassification.LONG_TEXT;
  }
};
