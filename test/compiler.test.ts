import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mergeTailwindTokens,
  getTailwindCategory,
  updateClassNameDeterministically,
  updateSourceCodeDeterministically
} from "../src/compiler/sourceEdit.ts";
import { applySurgicalEdits } from "../src/compiler/aiMerge.ts";

describe("Compiler - Tailwind Token Merge", () => {
  it("should replace text color without keeping previous color", () => {
    const res = mergeTailwindTokens("p-4 text-red-500 font-bold", "text-blue-500");
    assert.ok(!res.includes("text-red-500"), "Old text-red-500 should be removed");
    assert.ok(res.includes("text-blue-500"), "New text-blue-500 should be present");
    assert.ok(res.includes("p-4"), "p-4 should be preserved");
    assert.ok(res.includes("font-bold"), "font-bold should be preserved");
  });

  it("should allow text color and font size to coexist", () => {
    const res = mergeTailwindTokens("text-lg text-red-500", "text-blue-500");
    assert.ok(!res.includes("text-red-500"), "text-red-500 should be removed");
    assert.ok(res.includes("text-blue-500"), "text-blue-500 should be present");
    assert.ok(res.includes("text-lg"), "text-lg should be preserved");
  });

  it("should replace background color and padding independently", () => {
    const res = mergeTailwindTokens("bg-red-500 p-2 rounded", "bg-emerald-600 p-6");
    assert.ok(!res.includes("bg-red-500"));
    assert.ok(res.includes("bg-emerald-600"));
    assert.ok(!res.includes("p-2"));
    assert.ok(res.includes("p-6"));
    assert.ok(res.includes("rounded"));
  });

  it("should handle hover and focus variants separately", () => {
    const res = mergeTailwindTokens("hover:bg-red-500 bg-white", "hover:bg-blue-500");
    assert.ok(res.includes("bg-white"));
    assert.ok(!res.includes("hover:bg-red-500"));
    assert.ok(res.includes("hover:bg-blue-500"));
  });
});

describe("Compiler - Deterministic Source Editing", () => {
  it("should replace className at exact line and column", () => {
    const source = `export function Card() {
  // Header section
  return (
    <div className="flex items-center text-red-500">
      <span>Title</span>
    </div>
  );
}`;

    const res = updateSourceCodeDeterministically({
      sourceCode: source,
      targetLine: 4,
      targetColumn: 5,
      newClassName: "text-blue-500"
    });

    assert.equal(res.ok, true);
    assert.ok(res.code?.includes("text-blue-500"));
    assert.ok(!res.code?.includes("text-red-500"));
    assert.ok(res.code?.includes("// Header section"), "Comments must be preserved");
    assert.ok(res.code?.includes("flex items-center"));
  });

  it("should insert className when target element lacks one", () => {
    const source = `export function Box() {
  return <div id="box">Content</div>;
}`;

    const res = updateSourceCodeDeterministically({
      sourceCode: source,
      targetLine: 2,
      targetColumn: 9,
      newClassName: "p-4 bg-gray-100"
    });

    assert.equal(res.ok, true);
    assert.ok(res.code?.includes('<div id="box" className="p-4 bg-gray-100">'));
  });

  it("should downgrade to not-literal when encountering dynamic className", () => {
    const source = `export function Dynamic() {
  return <div className={cn("base", isActive && "active")}>Text</div>;
}`;

    const res = updateSourceCodeDeterministically({
      sourceCode: source,
      targetLine: 2,
      targetColumn: 9,
      newClassName: "text-green-500"
    });

    assert.equal(res.ok, false);
    assert.equal(res.reason, "not-literal");
  });

  it("should update style property cleanly", () => {
    const source = `export function Styled() {
  return <div style={{ color: "red", fontSize: 14 }}>Hello</div>;
}`;

    const res = updateSourceCodeDeterministically({
      sourceCode: source,
      targetLine: 2,
      targetColumn: 9,
      newStyleProp: { key: "color", value: "blue" }
    });

    assert.equal(res.ok, true);
    assert.ok(res.code?.includes('color: "blue"'));
    assert.ok(res.code?.includes("fontSize: 14"));
  });
});

describe("Compiler - AI Merge AST Syntax Validation", () => {
  it("should apply valid surgical edits successfully", () => {
    const source = `function App() {
  return <div className="card">Hello</div>;
}`;

    const res = applySurgicalEdits(source, [
      { old_string: "Hello", new_string: "World" },
      { old_string: 'className="card"', new_string: 'className="card shadow-lg"' }
    ]);

    assert.equal(res.success, true);
    assert.ok(res.result?.includes("World"));
    assert.ok(res.result?.includes("shadow-lg"));
  });

  it("should block and rollback edits that cause SyntaxError", () => {
    const source = `function App() {
  return <div><p>Hello</p></div>;
}`;

    // Edit creates a broken mismatched JSX tag
    const res = applySurgicalEdits(source, [
      { old_string: "<p>Hello</p>", new_string: "<p>Hello</div>" }
    ]);

    assert.equal(res.success, false);
    assert.ok(res.error?.includes("Syntax validation failed"));
    assert.equal(res.result, undefined);
  });

  it("should reject ambiguous replacements when replace_all is false", () => {
    const source = `const a = 1;
const b = 1;`;

    const res = applySurgicalEdits(source, [
      { old_string: "1", new_string: "2", replace_all: false }
    ]);

    assert.equal(res.success, false);
    assert.ok(res.error?.includes("Ambiguous replacement blocked"));
  });
});
