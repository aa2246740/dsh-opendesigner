/**
 * 解耦型多模型 AI 网关 (Any-Model AI Gateway)
 * 原生支持 DeepSeek-V3 / DeepSeek-R1、OpenAI (GPT-4o) 及 Ollama/vLLM 本地模型
 * 生成严格符合 JSON Schema 的结构化代码切片补丁，并配合 aiMerge 的 AST 语法防线
 */
import type { CodePatchEdit } from "../compiler/aiMerge.ts";
export type AIProvider = "deepseek" | "openai" | "ollama" | "custom" | "openrouter" | "gemini" | "minimax";
export interface AIGatewayConfig {
    provider?: AIProvider;
    apiKey?: string;
    baseURL?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    fetchFn?: typeof fetch;
    mockMode?: boolean;
    timeoutMs?: number;
}
export interface GenerateEditsRequest {
    sourceCode: string;
    instruction: string;
    componentName?: string;
    context?: {
        canvasElements?: any[];
        themeTokens?: any;
        screenshotUrl?: string;
    };
}
export interface LiveAttempt {
    provider: string;
    model: string;
    label: string;
    ok: boolean;
    httpStatus?: number;
    error?: string;
}
export interface LiveProviderCandidate {
    provider: AIProvider;
    model: string;
    baseURL: string;
    apiKey: string;
    label: string;
}
export interface GenerateEditsResult {
    success: boolean;
    edits?: CodePatchEdit[];
    mergedCode?: string;
    model?: string;
    provider?: AIProvider | string;
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
    };
    rawOutput?: string;
    reasoning?: string;
    error?: string;
    attempts?: number;
    fallback?: boolean;
    liveError?: string;
    httpStatus?: number;
    attemptsLog?: LiveAttempt[];
}
export declare const DEEPSEEK_MODELS: {
    readonly V3: "deepseek-chat";
    readonly R1: "deepseek-reasoner";
};
export declare const PROVIDER_DEFAULTS: Record<AIProvider, {
    baseURL: string;
    defaultModel: string;
}>;
/** OpenRouter MiniMax free slug used when OPENROUTER_ONLYUSE_FREEMODEL_API_KEY is set. */
export declare const OPENROUTER_FREE_MINIMAX_MODEL = "minimax/minimax-m2.7:free";
export declare function redactProviderError(text: string): string;
/**
 * Live providers in prove order: OpenRouter MiniMax free → MiniMax CN → Gemini → DeepSeek → OpenAI → GLM CN.
 * Never include key material in logs; callers must not print apiKey.
 */
export declare function detectLiveProvidersFromEnv(env?: NodeJS.ProcessEnv): LiveProviderCandidate[];
export declare function detectAiConfigFromEnv(env?: NodeJS.ProcessEnv): Partial<AIGatewayConfig>;
export declare function liveProvidersStatus(env?: NodeJS.ProcessEnv): Array<{
    provider: string;
    model: string;
    label: string;
    hasApiKey: boolean;
}>;
export declare class AIGateway {
    provider: AIProvider;
    apiKey: string;
    baseURL: string;
    model: string;
    temperature: number;
    maxTokens: number;
    private fetchFn;
    mockMode: boolean;
    timeoutMs: number;
    private skipTools;
    constructor(config?: AIGatewayConfig);
    status(): {
        provider: AIProvider;
        model: string;
        baseURL: string;
        mockMode: boolean;
        hasApiKey: boolean;
    };
    /**
     * 构建系统级提示词，强制约束结构化代码切片输出与 AST 语法安全
     */
    private buildSystemPrompt;
    /**
     * 构建用户消息内容
     */
    private buildUserMessage;
    /**
     * 调用大模型并经过 AST 语法防线验证应用变更
     */
    generateAndApply(req: GenerateEditsRequest, options?: {
        maxRetries?: number;
        fallbackToMock?: boolean;
    }): Promise<GenerateEditsResult>;
    /**
     * 执行网络请求或模拟输出生成结构化代码补丁
     */
    requestEdits(req: GenerateEditsRequest, feedbackError?: string): Promise<{
        success: boolean;
        edits?: CodePatchEdit[];
        usage?: any;
        rawOutput?: string;
        reasoning?: string;
        error?: string;
        httpStatus?: number;
        retryAfterMs?: number;
    }>;
    /**
     * 离线确定性模拟生成器（用于单元测试及无网络环境安全自测）
     */
    private generateMockEdits;
}
export declare function generateAndApplyLive(req: GenerateEditsRequest, options?: {
    env?: NodeJS.ProcessEnv;
    fetchFn?: typeof fetch;
    fallbackToMock?: boolean;
    timeoutMs?: number;
    maxRetriesPerProvider?: number;
}): Promise<GenerateEditsResult>;
//# sourceMappingURL=aiGateway.d.ts.map