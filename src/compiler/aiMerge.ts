/**
 * Tier 2 AI 智能结构化代码合并器
 * 负责复杂逻辑变更、条件表达式、动态模板字符串及 Hooks 重构
 */

export interface CodePatchEdit {
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export interface SaveToCodePayload {
  edits: CodePatchEdit[];
}

/**
 * 结构化输出 JSON Schema，用于调用 DeepSeek / OpenAI 兼容接口
 */
export const SAVE_TO_CODE_JSON_SCHEMA = {
  name: "save_to_code_edits",
  description: "A set of surgical find-and-replace text edits to apply to the source file",
  parameters: {
    type: "object",
    properties: {
      edits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            old_string: {
              type: "string",
              description: "Exact text chunk in the original file to be replaced"
            },
            new_string: {
              type: "string",
              description: "New replacement code chunk"
            },
            replace_all: {
              type: "boolean",
              description: "Whether to replace all occurrences or only the unique one"
            }
          },
          required: ["old_string", "new_string"]
        }
      }
    },
    required: ["edits"]
  }
};

/**
 * 本地精确应用结构化补丁
 */
export function applySurgicalEdits(
  source: string,
  edits: CodePatchEdit[]
): { success: boolean; result?: string; error?: string } {
  let currentSource = source;

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];
    const { old_string, new_string, replace_all } = edit;

    if (!old_string) {
      return { success: false, error: `Edit #${i}: old_string cannot be empty` };
    }

    const firstIdx = currentSource.indexOf(old_string);
    if (firstIdx === -1) {
      return {
        success: false,
        error: `Edit #${i} failed: old_string not found in file: ${JSON.stringify(old_string.slice(0, 80))}`
      };
    }

    if (!replace_all) {
      const secondIdx = currentSource.indexOf(old_string, firstIdx + old_string.length);
      if (secondIdx !== -1) {
        return {
          success: false,
          error: `Edit #${i} failed: old_string occurs multiple times in file. Ambiguous replacement blocked.`
        };
      }
      currentSource =
        currentSource.slice(0, firstIdx) + new_string + currentSource.slice(firstIdx + old_string.length);
    } else {
      currentSource = currentSource.split(old_string).join(new_string);
    }
  }

  return { success: true, result: currentSource };
}
