import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AIGateway, PROVIDER_DEFAULTS } from "../src/server/aiGateway.ts";

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
});
