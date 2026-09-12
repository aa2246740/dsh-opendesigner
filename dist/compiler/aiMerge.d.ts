/**
 * Tier 2 AI 智能结构化代码合并器
 * 负责复杂逻辑变更、条件表达式、动态模板字符串及 Hooks 重构
 * 接入 Babel AST 进行合并后语法复验与自动报错回滚
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
export declare const SAVE_TO_CODE_JSON_SCHEMA: {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {
            edits: {
                type: string;
                items: {
                    type: string;
                    properties: {
                        old_string: {
                            type: string;
                            description: string;
                        };
                        new_string: {
                            type: string;
                            description: string;
                        };
                        replace_all: {
                            type: string;
                            description: string;
                        };
                    };
                    required: string[];
                };
            };
        };
        required: string[];
    };
};
/**
 * 本地精确应用结构化补丁，并执行 AST 语法复验防线
 */
export declare function applySurgicalEdits(source: string, edits: CodePatchEdit[]): {
    success: boolean;
    result?: string;
    error?: string;
};
//# sourceMappingURL=aiMerge.d.ts.map