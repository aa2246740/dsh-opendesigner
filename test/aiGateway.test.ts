import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AIGateway, PROVIDER_DEFAULTS, detectAiConfigFromEnv } from "../src/server/aiGateway.ts";

describe("Server - Decoupled Multi-Model AI Gateway", () => {
  it("should configure correct endpoints and defaults for DeepSeek, OpenAI, and Ollama", () => {
    const dsGateway = new AIGateway({ provider: "deepseek" });
    assert.equal(dsGateway.baseURL, PROVIDER_DEFAULTS.deepseek.baseURL);
    assert.equal(dsGateway.model, "deepseek-chat");

    const oaGateway = new AIGateway({ provider: "openai" });
    assert.equal(oaGateway.baseURL, PROVIDER_DEFAULTS.openai.baseURL);
    assert.equal(oaGateway.model, "gpt-4o");

    const olGateway = new AIGateway({ provider: "ollama" });
    assert.equal(olGateway.baseURL, PROVIDER_DEFAULTS.ollama.baseURL);
    assert.equal(olGateway.model, "qwen2.5-coder:latest");

    const gemGateway = new AIGateway({ provider: "gemini" });
    assert.equal(gemGateway.baseURL, PROVIDER_DEFAULTS.gemini.baseURL);
    assert.equal(gemGateway.model, "gemini-flash-latest");
    assert.equal(gemGateway.mockMode, true);
  });

  it("should generate deterministic mock edits and merge into source code with AST validation", async () => {
    const gateway = new AIGateway({ mockMode: true });
    const source = `export function Card() {\n  return <div className="p-4"><span>Submit</span></div>;\n}`;

    const res = await gateway.generateAndApply({
      sourceCode: source,
      instruction: "Add bg-blue-600 color to the card"
    });

    assert.equal(res.success, true);
    assert.ok(res.mergedCode);
    assert.ok(res.mergedCode.includes("bg-blue-600"));
    assert.ok(res.mergedCode.includes('className="p-4 bg-blue-600 text-white"'));
  });

  it("should trigger AST syntax defense and retry on syntax error", async () => {
    const gateway = new AIGateway({ mockMode: true });
    const source = `export function Button() {\n  return <button className="px-4">Click</button>;\n}`;

    // Instruction FAIL_THEN_FIX triggers intentional syntax failure on first attempt, then succeeds on retry
    const res = await gateway.generateAndApply(
      {
        sourceCode: source,
        instruction: "FAIL_THEN_FIX color update"
      },
      { maxRetries: 2 }
    );

    assert.equal(res.success, true);
    assert.equal(res.attempts, 2);
    assert.ok(res.mergedCode?.includes("bg-blue-600"));
  });

  it("should parse OpenAI/DeepSeek tool_calls responses from custom fetch", async () => {
    const mockToolResponse = {
      choices: [
        {
          message: {
            role: "assistant",
            tool_calls: [
              {
                id: "call_123",
                type: "function",
                function: {
                  name: "save_to_code_edits",
                  arguments: JSON.stringify({
                    edits: [
                      {
                        old_string: 'className="border"',
                        new_string: 'className="border border-indigo-500 shadow-sm"'
                      }
                    ]
                  })
                }
              }
            ]
          }
        }
      ],
      usage: { total_tokens: 120 }
    };

    const mockFetch = async () =>
      new Response(JSON.stringify(mockToolResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });

    const gateway = new AIGateway({
      provider: "deepseek",
      apiKey: "sk-mock-key",
      fetchFn: mockFetch as any,
      mockMode: false
    });

    const source = `export const Box = () => <div className="border">Hello</div>;`;
    const res = await gateway.generateAndApply({
      sourceCode: source,
      instruction: "Enhance border style with indigo and shadow"
    });

    assert.equal(res.success, true);
    assert.ok(res.mergedCode?.includes("border-indigo-500 shadow-sm"));
    assert.equal(res.usage?.total_tokens, 120);
  });

  it("should handle DeepSeek-R1 reasoning_content and markdown codeblock JSON output", async () => {
    let capturedBody: any = null;

    const mockR1Response = {
      choices: [
        {
          message: {
            role: "assistant",
            reasoning_content: "The user wants to add rounded-2xl to the button. Target className is px-4 py-2.",
            content: "```json\n{\n  \"edits\": [\n    {\n      \"old_string\": \"className=\\\"px-4 py-2\\\"\",\n      \"new_string\": \"className=\\\"px-4 py-2 rounded-2xl\\\"\",\n      \"replace_all\": false\n    }\n  ]\n}\n```"
          }
        }
      ],
      usage: { prompt_tokens: 50, completion_tokens: 80, total_tokens: 130 }
    };

    const mockFetch = async (_url: string, init: any) => {
      capturedBody = JSON.parse(init.body);
      return new Response(JSON.stringify(mockR1Response), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    };

    const gateway = new AIGateway({
      provider: "deepseek",
      model: "deepseek-reasoner",
      apiKey: "sk-mock-key",
      fetchFn: mockFetch as any,
      mockMode: false
    });

    const source = `export function Button() { return <button className="px-4 py-2">Click</button>; }`;
    const res = await gateway.generateAndApply({
      sourceCode: source,
      instruction: "Add rounded-2xl corners"
    });

    assert.equal(res.success, true);
    assert.ok(res.mergedCode?.includes("rounded-2xl"));
    assert.equal(res.reasoning, "The user wants to add rounded-2xl to the button. Target className is px-4 py-2.");
    assert.equal(res.usage?.total_tokens, 130);

    // 确认推理模型不发送 tools 或 temperature 参数
    assert.equal(capturedBody.tools, undefined);
    assert.equal(capturedBody.temperature, undefined);
  });

  it("should extract CoT from <think> tags when reasoning model returns think tags in content", async () => {
    const mockOllamaR1Response = {
      choices: [
        {
          message: {
            role: "assistant",
            content: "<think>\nAnalyze AST structure.\nTarget element is a heading.\nNeed to add text-2xl.\n</think>\n```json\n{\n  \"edits\": [\n    {\n      \"old_string\": \"<h1>Title</h1>\",\n      \"new_string\": \"<h1 className=\\\"text-2xl\\\">Title</h1>\"\n    }\n  ]\n}\n```"
          }
        }
      ]
    };

    const mockFetch = async () =>
      new Response(JSON.stringify(mockOllamaR1Response), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });

    const gateway = new AIGateway({
      provider: "ollama",
      model: "deepseek-r1:7b",
      fetchFn: mockFetch as any,
      mockMode: false
    });

    const source = `export function Page() { return <div><h1>Title</h1></div>; }`;
    const res = await gateway.generateAndApply({
      sourceCode: source,
      instruction: "Enlarge title font"
    });

    assert.equal(res.success, true);
    assert.ok(res.mergedCode?.includes('className="text-2xl"'));
    assert.ok(res.reasoning?.includes("Analyze AST structure"));
  });

  it("should trigger complete AST rollback defense when syntax errors cannot be recovered", async () => {
    const gateway = new AIGateway({ mockMode: true });
    const originalSource = `export function Nav() {\n  return <nav className="flex">Nav</nav>;\n}`;

    // FAIL_SYNTAX_PERMANENT 模拟无法修复的语法错误
    const res = await gateway.generateAndApply(
      {
        sourceCode: originalSource,
        instruction: "FAIL_SYNTAX_PERMANENT broken update"
      },
      { maxRetries: 2 }
    );

    // 语法防线必须拦截并拒绝合并
    assert.equal(res.success, false);
    assert.equal(res.mergedCode, undefined);
    assert.ok(res.error?.includes("AST validation rejected edits"));
    assert.equal(res.attempts, 3); // 第 1 次尝试 + 2 次重试
  });

  it("should defensively reject HTTP error responses from AI model provider", async () => {
    const mockErrorFetch = async () =>
      new Response("Rate limit exceeded", { status: 429 });

    const gateway = new AIGateway({
      provider: "deepseek",
      apiKey: "sk-mock-key",
      fetchFn: mockErrorFetch as any,
      mockMode: false
    });

    const res = await gateway.generateAndApply({
      sourceCode: `export const A = () => <div />;`,
      instruction: "change"
    });

    assert.equal(res.success, false);
    assert.ok(res.error?.includes("HTTP 429"));
  });

  it("should parse direct JSON array patch and handle curly braces in reasoning prefix", async () => {
    const mockContent = `Let's inspect element {id: "main_nav", type: "container"}:
Now we apply the edits:
\`\`\`json
[
  {
    "old_string": "bg-red-500",
    "new_string": "bg-emerald-600",
    "replace_all": false
  }
]
\`\`\`
Hope this helps!`;

    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: mockContent,
                reasoning_content: "Checking theme colors {bg: 'emerald'}..."
              }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );

    const gateway = new AIGateway({
      provider: "deepseek",
      model: "deepseek-reasoner",
      apiKey: "sk-mock-key",
      fetchFn: mockFetch as any,
      mockMode: false
    });

    const res = await gateway.requestEdits({
      sourceCode: `export const Nav = () => <div className="bg-red-500" />;`,
      instruction: "change to emerald"
    });

    assert.equal(res.success, true);
    assert.ok(res.edits);
    assert.equal(res.edits.length, 1);
    assert.equal(res.edits[0].old_string, "bg-red-500");
    assert.equal(res.edits[0].new_string, "bg-emerald-600");
    assert.ok(res.reasoning?.includes("Checking theme colors"));
  });

  it("detects Gemini before OpenRouter and never returns the key in status()", () => {
    const gemini = detectAiConfigFromEnv({
      GEMINI_API_KEY: "secret-gemini",
      OPENROUTER_ONLYUSE_FREEMODEL_API_KEY: "secret-openrouter"
    });
    assert.equal(gemini.provider, "gemini");
    assert.equal(gemini.model, PROVIDER_DEFAULTS.gemini.defaultModel);

    const gateway = new AIGateway(gemini);
    const status = gateway.status();
    assert.equal(status.hasApiKey, true);
    assert.equal(status.mockMode, false);
    assert.equal(JSON.stringify(status).includes("secret-gemini"), false);

    const none = detectAiConfigFromEnv({});
    assert.deepEqual(none, {});
    const mock = new AIGateway({ provider: "gemini" });
    assert.equal(mock.mockMode, true);
    assert.equal(mock.status().hasApiKey, false);
  });
});
