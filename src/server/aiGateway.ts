/**
 * 解耦型多模型 AI 网关 (Any-Model AI Gateway)
 * 原生支持 DeepSeek-V3 / DeepSeek-R1、OpenAI (GPT-4o) 及 Ollama/vLLM 本地模型
 * 生成严格符合 JSON Schema 的结构化代码切片补丁，并配合 aiMerge 的 AST 语法防线
 */

import { SAVE_TO_CODE_JSON_SCHEMA, applySurgicalEdits } from "../compiler/aiMerge.ts";
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
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  rawOutput?: string;
  reasoning?: string;
  error?: string;
  attempts?: number;
  fallback?: boolean;
  liveError?: string;
  httpStatus?: number;
  attemptsLog?: LiveAttempt[];
}

export const DEEPSEEK_MODELS = {
  V3: "deepseek-chat",
  R1: "deepseek-reasoner"
} as const;

export const PROVIDER_DEFAULTS: Record<AIProvider, { baseURL: string; defaultModel: string }> = {
  deepseek: {
    baseURL: "https://api.deepseek.com/v1",
    defaultModel: DEEPSEEK_MODELS.V3
  },
  openai: {
    baseURL: "https://api.openai.com/v1",
    defaultModel: "gpt-4o"
  },
  ollama: {
    baseURL: "http://localhost:11434/v1",
    defaultModel: "qwen2.5-coder:latest"
  },
  openrouter: {
    baseURL: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-oss-20b:free"
  },
  gemini: {
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-flash-latest"
  },
  minimax: {
    baseURL: "https://api.minimaxi.com/v1",
    defaultModel: "MiniMax-Text-01"
  },
  custom: {
    baseURL: "http://127.0.0.1:8000/v1",
    defaultModel: "default-model"
  }
};

/** OpenRouter MiniMax free slug used when OPENROUTER_ONLYUSE_FREEMODEL_API_KEY is set. */
export const OPENROUTER_FREE_MINIMAX_MODEL = "minimax/minimax-m2.7:free";

const LIVE_TIMEOUT_MS = 90_000;
const RETRY_AFTER_CAP_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function redactProviderError(text: string): string {
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer REDACTED")
    .replace(/\b(sk-|AIza)[A-Za-z0-9_\-]{8,}/g, "REDACTED")
    .slice(0, 180);
}

function parseRetryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get("retry-after");
  if (!raw) return undefined;
  const asSeconds = Number(raw);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.min(asSeconds * 1000, RETRY_AFTER_CAP_MS);
  }
  const when = Date.parse(raw);
  if (!Number.isNaN(when)) {
    return Math.min(Math.max(0, when - Date.now()), RETRY_AFTER_CAP_MS);
  }
  return undefined;
}

function withFreeSuffix(model: string): string {
  return model.endsWith(":free") ? model : `${model}:free`;
}

/**
 * Live providers in prove order: OpenRouter MiniMax free → MiniMax CN → Gemini → DeepSeek → OpenAI → GLM CN.
 * Never include key material in logs; callers must not print apiKey.
 */
export function detectLiveProvidersFromEnv(env: NodeJS.ProcessEnv = process.env): LiveProviderCandidate[] {
  const out: LiveProviderCandidate[] = [];

  const openrouterKey = env.OPENROUTER_ONLYUSE_FREEMODEL_API_KEY || env.OPENROUTER_API_KEY;
  if (openrouterKey) {
    const raw = env.OPENROUTER_MODEL || OPENROUTER_FREE_MINIMAX_MODEL;
    const model = env.OPENROUTER_ONLYUSE_FREEMODEL_API_KEY ? withFreeSuffix(raw) : raw;
    out.push({
      provider: "openrouter",
      apiKey: openrouterKey,
      baseURL: PROVIDER_DEFAULTS.openrouter.baseURL,
      model,
      label: "openrouter-minimax-free"
    });
  }

  const minimaxKey = env.MINIMAXCN_API_KEY || env.MINIMAX_CN_API_KEY;
  if (minimaxKey) {
    out.push({
      provider: "minimax",
      apiKey: minimaxKey,
      baseURL: env.MINIMAX_BASE_URL || PROVIDER_DEFAULTS.minimax.baseURL,
      model: env.MINIMAX_MODEL || PROVIDER_DEFAULTS.minimax.defaultModel,
      label: "minimax-cn"
    });
  }

  const geminiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (geminiKey) {
    out.push({
      provider: "gemini",
      apiKey: geminiKey,
      baseURL: PROVIDER_DEFAULTS.gemini.baseURL,
      model: env.GEMINI_MODEL || PROVIDER_DEFAULTS.gemini.defaultModel,
      label: "gemini"
    });
  }

  if (env.DEEPSEEK_API_KEY) {
    out.push({
      provider: "deepseek",
      apiKey: env.DEEPSEEK_API_KEY,
      baseURL: PROVIDER_DEFAULTS.deepseek.baseURL,
      model: env.DEEPSEEK_MODEL || PROVIDER_DEFAULTS.deepseek.defaultModel,
      label: "deepseek"
    });
  }

  if (env.OPENAI_API_KEY) {
    out.push({
      provider: "openai",
      apiKey: env.OPENAI_API_KEY,
      baseURL: env.OPENAI_BASE_URL || PROVIDER_DEFAULTS.openai.baseURL,
      model: env.OPENAI_MODEL || PROVIDER_DEFAULTS.openai.defaultModel,
      label: "openai"
    });
  }

  if (env.GLM_CN_API_KEY) {
    out.push({
      provider: "custom",
      apiKey: env.GLM_CN_API_KEY,
      baseURL: env.GLM_CN_BASE_URL || "https://open.bigmodel.cn/api/paas/v4",
      model: env.GLM_CN_MODEL || "glm-4-flash",
      label: "glm-cn"
    });
  }

  return out;
}

export function detectAiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): Partial<AIGatewayConfig> {
  const first = detectLiveProvidersFromEnv(env)[0];
  if (!first) return {};
  return {
    provider: first.provider,
    apiKey: first.apiKey,
    baseURL: first.baseURL,
    model: first.model
  };
}

export function liveProvidersStatus(env: NodeJS.ProcessEnv = process.env): Array<{
  provider: string;
  model: string;
  label: string;
  hasApiKey: boolean;
}> {
  return detectLiveProvidersFromEnv(env).map((item) => ({
    provider: item.provider,
    model: item.model,
    label: item.label,
    hasApiKey: true
  }));
}

export class AIGateway {
  public provider: AIProvider;
  public apiKey: string;
  public baseURL: string;
  public model: string;
  public temperature: number;
  public maxTokens: number;
  private fetchFn: typeof fetch;
  public mockMode: boolean;
  public timeoutMs: number;
  private skipTools = false;

  constructor(config: AIGatewayConfig = {}) {
    this.provider = config.provider || "deepseek";
    const defaults = PROVIDER_DEFAULTS[this.provider] || PROVIDER_DEFAULTS.deepseek;

    this.baseURL = config.baseURL || defaults.baseURL;
    this.model = config.model || defaults.defaultModel;
    this.apiKey = config.apiKey || "";
    this.temperature = config.temperature ?? 0.2;
    this.maxTokens = config.maxTokens ?? 4096;
    this.fetchFn = config.fetchFn || (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : (async () => {}) as any);
    this.mockMode = config.mockMode ?? !this.apiKey;
    this.timeoutMs = config.timeoutMs ?? LIVE_TIMEOUT_MS;
  }

  public status(): { provider: AIProvider; model: string; baseURL: string; mockMode: boolean; hasApiKey: boolean } {
    return {
      provider: this.provider,
      model: this.model,
      baseURL: this.baseURL,
      mockMode: this.mockMode,
      hasApiKey: Boolean(this.apiKey)
    };
  }

  /**
   * 构建系统级提示词，强制约束结构化代码切片输出与 AST 语法安全
   */
  private buildSystemPrompt(): string {
    return [
      "You are the OpenDesigner Visual Code Agent for DeepSeek Harness.",
      "Your objective is to generate minimal, surgical find-and-replace text edits for React 19 + Tailwind CSS components.",
      "Rules:",
      "1. Target EXACT characters in `old_string` from the provided source.",
      "2. `new_string` must keep the code syntactically valid TypeScript/JSX.",
      "3. Use Tailwind v4 utility classes wherever styling changes are requested.",
      "4. Do NOT rewrite the whole file; only return surgical edits.",
      "5. You MUST output strictly structured JSON matching the schema:",
      JSON.stringify(SAVE_TO_CODE_JSON_SCHEMA.parameters, null, 2),
      'Example JSON output: {"edits": [{"old_string": "exact old code", "new_string": "new code", "replace_all": false}]}'
    ].join("\n");
  }

  /**
   * 构建用户消息内容
   */
  private buildUserMessage(req: GenerateEditsRequest): string {
    let msg = `### SOURCE FILE:\n\`\`\`tsx\n${req.sourceCode}\n\`\`\`\n\n`;
    if (req.componentName) {
      msg += `### TARGET COMPONENT: ${req.componentName}\n\n`;
    }
    if (req.context?.themeTokens) {
      msg += `### DESIGN TOKENS:\n${JSON.stringify(req.context.themeTokens, null, 2)}\n\n`;
    }
    msg += `### INSTRUCTION:\n${req.instruction}\n\n`;
    msg += `Respond ONLY with the surgical edits.`;
    return msg;
  }

  /**
   * 调用大模型并经过 AST 语法防线验证应用变更
   */
  public async generateAndApply(
    req: GenerateEditsRequest,
    options: { maxRetries?: number; fallbackToMock?: boolean } = {}
  ): Promise<GenerateEditsResult> {
    const maxRetries = options.maxRetries ?? 1;
    const fallbackToMock = options.fallbackToMock === true;
    let attempts = 0;
    let lastError = "";
    let lastHttp: number | undefined;
    this.skipTools = false;

    while (attempts <= maxRetries) {
      attempts++;
      try {
        const editsRes = await this.requestEdits(req, lastError);
        if (!editsRes.success || !editsRes.edits) {
          lastError = editsRes.error || "Failed to generate edits";
          lastHttp = editsRes.httpStatus;
          if (
            editsRes.httpStatus === 400 &&
            /tool/i.test(editsRes.error || "") &&
            !this.skipTools
          ) {
            this.skipTools = true;
          }
          if ((editsRes.retryAfterMs ?? 0) > 0 && attempts <= maxRetries) {
            await sleep(editsRes.retryAfterMs as number);
          }
          continue;
        }

        const mergeRes = applySurgicalEdits(req.sourceCode, editsRes.edits);
        if (!mergeRes.success) {
          lastError = `AST validation rejected edits: ${mergeRes.error}`;
          continue;
        }

        return {
          success: true,
          edits: editsRes.edits,
          mergedCode: mergeRes.result,
          model: this.model,
          provider: this.provider,
          usage: editsRes.usage,
          rawOutput: editsRes.rawOutput,
          reasoning: editsRes.reasoning,
          attempts,
          fallback: false
        };
      } catch (err: any) {
        lastError = redactProviderError(err.message || String(err));
      }
    }

    if (fallbackToMock && !this.mockMode) {
      const mock = this.generateMockEdits(req);
      if (mock.success && mock.edits && mock.edits.length > 0) {
        const mergeRes = applySurgicalEdits(req.sourceCode, mock.edits);
        if (mergeRes.success) {
          return {
            success: true,
            edits: mock.edits,
            mergedCode: mergeRes.result,
            model: "mock-offline",
            provider: "mock",
            attempts,
            fallback: true,
            liveError: lastError,
            httpStatus: lastHttp
          };
        }
      }
    }

    return {
      success: false,
      mergedCode: undefined,
      error: `AI Merge failed after ${attempts} attempts: ${lastError}`,
      attempts,
      fallback: false,
      httpStatus: lastHttp
    };
  }

  /**
   * 执行网络请求或模拟输出生成结构化代码补丁
   */
  public async requestEdits(
    req: GenerateEditsRequest,
    feedbackError?: string
  ): Promise<{
    success: boolean;
    edits?: CodePatchEdit[];
    usage?: any;
    rawOutput?: string;
    reasoning?: string;
    error?: string;
    httpStatus?: number;
    retryAfterMs?: number;
  }> {
    // 离线/测试模拟模式
    if (this.mockMode) {
      return this.generateMockEdits(req, feedbackError);
    }

    const messages = [
      { role: "system", content: this.buildSystemPrompt() },
      { role: "user", content: this.buildUserMessage(req) }
    ];

    if (feedbackError) {
      messages.push({
        role: "user",
        content: `Your previous patch caused a syntax error: ${feedbackError}. Please correct the edits and return valid code.`
      });
    }

    const endpoint = `${this.baseURL.replace(/\/+$/, "")}/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }
    if (this.provider === "openrouter") {
      headers["HTTP-Referer"] = "https://github.com/aa2246740/dsh-opendesigner";
      headers["X-Title"] = "dsh-opendesigner";
    }

    const isReasoningModel = this.model.includes("reasoner") || this.model.includes("r1");
    const useTools = !this.skipTools && !isReasoningModel;

    const requestBody: any = {
      model: this.model,
      messages,
      max_tokens: this.maxTokens
    };

    if (useTools) {
      requestBody.temperature = this.temperature;
      requestBody.tools = [
        {
          type: "function",
          function: SAVE_TO_CODE_JSON_SCHEMA
        }
      ];
      requestBody.tool_choice = {
        type: "function",
        function: { name: "save_to_code_edits" }
      };
    } else if (!isReasoningModel) {
      requestBody.temperature = this.temperature;
    }

    let response: Response;
    try {
      response = await this.fetchFn(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (err: any) {
      const msg = err?.message || String(err);
      const name = err?.name || "";
      if (name === "TimeoutError" || name === "AbortError" || /aborted|timeout/i.test(msg)) {
        return {
          success: false,
          error: `AI gateway timeout after ${this.timeoutMs}ms`,
          httpStatus: 0
        };
      }
      return { success: false, error: redactProviderError(msg) };
    }

    if (!response.ok) {
      const errText = redactProviderError(await response.text().catch(() => ""));
      const retryAfterMs =
        response.status === 429 || response.status === 503 ? parseRetryAfterMs(response) : undefined;
      return {
        success: false,
        error: `AI gateway HTTP ${response.status}: ${errText}`,
        httpStatus: response.status,
        retryAfterMs
      };
    }

    const json: any = await response.json();
    const choice = json.choices?.[0];
    if (!choice) {
      return { success: false, error: "Empty choices in model response" };
    }

    let reasoning = choice.message?.reasoning_content;
    let content = choice.message?.content || "";

    // 支持 <think> 标签中的思考链提取 (用于兼容部分通过 content 返回思考流的模型/代理)
    const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
    if (thinkMatch) {
      if (!reasoning) {
        reasoning = thinkMatch[1].trim();
      }
      content = content.replace(/<think>[\s\S]*?<\/think>/, "").trim();
    }

    // 1. 尝试从 Tool Call 中提取结构化参数
    const toolCalls = choice.message?.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      const call = toolCalls[0];
      try {
        const rawArgs = call.function.arguments;
        const parsed = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs;
        const editsList = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.edits) ? parsed.edits : null;
        if (editsList) {
          return {
            success: true,
            edits: editsList,
            usage: json.usage,
            rawOutput: typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs),
            reasoning
          };
        }
      } catch (err: any) {
        return { success: false, error: `Invalid tool call JSON: ${err.message}` };
      }
    }

    // 2. 尝试从正文解析 JSON
    // 候选字符串列表：优先提取 Markdown 代码块，其次提取平衡的 JSON 对象或数组
    const candidateJsonStrings: string[] = [];

    const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g;
    let cbMatch: RegExpExecArray | null;
    while ((cbMatch = codeBlockRegex.exec(content)) !== null) {
      if (cbMatch[1]?.trim()) candidateJsonStrings.push(cbMatch[1].trim());
    }

    if (candidateJsonStrings.length === 0) {
      // 尝试提取 {"edits": ...}
      const editsObjIdx = content.indexOf('{"edits"');
      if (editsObjIdx !== -1) {
        const slice = content.slice(editsObjIdx);
        let depth = 0;
        let endIdx = -1;
        for (let i = 0; i < slice.length; i++) {
          if (slice[i] === "{") depth++;
          else if (slice[i] === "}") {
            depth--;
            if (depth === 0) {
              endIdx = i + 1;
              break;
            }
          }
        }
        if (endIdx !== -1) candidateJsonStrings.push(slice.slice(0, endIdx));
      }

      // 尝试提取 [{"old_string": ...}]
      const arrayIdx = content.search(/\[\s*\{/);
      if (arrayIdx !== -1) {
        const slice = content.slice(arrayIdx);
        let depth = 0;
        let endIdx = -1;
        for (let i = 0; i < slice.length; i++) {
          if (slice[i] === "[") depth++;
          else if (slice[i] === "]") {
            depth--;
            if (depth === 0) {
              endIdx = i + 1;
              break;
            }
          }
        }
        if (endIdx !== -1) candidateJsonStrings.push(slice.slice(0, endIdx));
      }

      // 兜底全量括号匹配
      const fallbackMatch = content.match(/\{[\s\S]*\}/);
      if (fallbackMatch) candidateJsonStrings.push(fallbackMatch[0].trim());
    }

    for (const jsonStr of candidateJsonStrings) {
      try {
        const parsed = JSON.parse(jsonStr);
        const editsList = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.edits) ? parsed.edits : null;
        if (editsList) {
          return {
            success: true,
            edits: editsList,
            usage: json.usage,
            rawOutput: content,
            reasoning
          };
        }
      } catch {
        // 继续尝试下一个候选
      }
    }

    return {
      success: false,
      error: `Could not parse edits from model completion: ${content.slice(0, 100)}`
    };
  }

  /**
   * 离线确定性模拟生成器（用于单元测试及无网络环境安全自测）
   */
  private generateMockEdits(
    req: GenerateEditsRequest,
    feedbackError?: string
  ): {
    success: boolean;
    edits?: CodePatchEdit[];
    usage?: any;
    rawOutput?: string;
    reasoning?: string;
    error?: string;
  } {
    const { sourceCode, instruction } = req;

    // 模拟持续语法错误（用于测试重试上限与安全回滚防线）
    if (instruction.includes("FAIL_SYNTAX_PERMANENT")) {
      return {
        success: true,
        edits: [
          {
            old_string: "<button",
            new_string: "<button unclosed_bracket {"
          }
        ]
      };
    }

    // 模拟 DeepSeek-R1 推理链输出
    if (instruction.includes("DEEPSEEK_R1_MOCK")) {
      const match = sourceCode.match(/className="([^"]*)"/);
      const oldClass = match ? match[0] : "";
      const newClass = match ? `className="${match[1]} shadow-lg"` : "";
      return {
        success: true,
        edits: oldClass ? [{ old_string: oldClass, new_string: newClass }] : [],
        reasoning: "DeepSeek-R1 reasoning: User requested shadow styling. Identified target element className attribute and appended shadow-lg."
      };
    }

    // 模拟语法错误重试场景
    if (instruction.includes("FAIL_THEN_FIX") && !feedbackError) {
      return {
        success: true,
        edits: [
          {
            old_string: "<button",
            new_string: "<button unclosed_bracket {"
          }
        ]
      };
    }

    // 针对常见指令做确定性切片映射
    if (instruction.includes("bg-") || instruction.includes("color")) {
      const match = sourceCode.match(/className="([^"]*)"/);
      if (match) {
        const oldClass = match[0];
        const newClass = `className="${match[1]} bg-blue-600 text-white"`;
        return {
          success: true,
          edits: [{ old_string: oldClass, new_string: newClass }]
        };
      }
    }

    if (instruction.includes("shadow")) {
      const match = sourceCode.match(/className="([^"]*)"/);
      if (match) {
        return {
          success: true,
          edits: [
            {
              old_string: match[0],
              new_string: `className="${match[1]} shadow-lg"`
            }
          ]
        };
      }
    }

    if (instruction.includes("rounded")) {
      const match = sourceCode.match(/className="([^"]*)"/);
      if (match) {
        return {
          success: true,
          edits: [
            {
              old_string: match[0],
              new_string: `className="${match[1]} rounded-xl"`
            }
          ]
        };
      }
    }

    // 通用文本内容替换测试
    const textMatch = sourceCode.match(/>([^<>{}\n]+)</);
    if (textMatch && textMatch[1].trim()) {
      const oldText = textMatch[1].trim();
      return {
        success: true,
        edits: [
          {
            old_string: oldText,
            new_string: `${oldText} Updated`
          }
        ]
      };
    }

    return {
      success: true,
      edits: []
    };
  }
}

export async function generateAndApplyLive(
  req: GenerateEditsRequest,
  options: {
    env?: NodeJS.ProcessEnv;
    fetchFn?: typeof fetch;
    fallbackToMock?: boolean;
    timeoutMs?: number;
    maxRetriesPerProvider?: number;
  } = {}
): Promise<GenerateEditsResult> {
  const candidates = detectLiveProvidersFromEnv(options.env);
  const attemptsLog: LiveAttempt[] = [];

  if (candidates.length === 0) {
    if (options.fallbackToMock === true) {
      const gw = new AIGateway({ mockMode: true, fetchFn: options.fetchFn });
      const mock = await gw.generateAndApply(req, { fallbackToMock: true });
      return { ...mock, attemptsLog };
    }
    return {
      success: false,
      fallback: false,
      error: "No live AI providers configured",
      attemptsLog
    };
  }

  for (const candidate of candidates) {
    const gw = new AIGateway({
      provider: candidate.provider,
      apiKey: candidate.apiKey,
      baseURL: candidate.baseURL,
      model: candidate.model,
      mockMode: false,
      fetchFn: options.fetchFn,
      timeoutMs: options.timeoutMs ?? LIVE_TIMEOUT_MS
    });
    const res = await gw.generateAndApply(req, {
      maxRetries: options.maxRetriesPerProvider ?? 1,
      fallbackToMock: false
    });
    const timeout = Boolean(res.error?.includes("timeout"));
    attemptsLog.push({
      provider: candidate.provider,
      model: candidate.model,
      label: candidate.label,
      ok: res.success === true,
      httpStatus: res.httpStatus ?? (res.success ? 200 : timeout ? 0 : undefined),
      error: res.success ? undefined : redactProviderError(res.error || "")
    });
    if (res.success) {
      return {
        ...res,
        provider: candidate.provider,
        model: gw.model,
        fallback: false,
        attemptsLog
      };
    }
  }

  if (options.fallbackToMock === true) {
    const gw = new AIGateway({ mockMode: true, fetchFn: options.fetchFn });
    const mock = await gw.generateAndApply(req, { fallbackToMock: true });
    return {
      ...mock,
      attemptsLog,
      liveError: attemptsLog.map((row) => `${row.label} HTTP ${row.httpStatus ?? "?"}`).join("; ")
    };
  }

  return {
    success: false,
    fallback: false,
    error: `All live providers failed: ${attemptsLog
      .map((row) => `${row.label} HTTP ${row.httpStatus ?? "err"}`)
      .join(" → ")}`,
    attemptsLog
  };
}
