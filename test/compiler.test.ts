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

  it("should correctly handle negative and positive margins mutually excluding each other", () => {
    const res1 = mergeTailwindTokens("m-4 px-2", "-m-6");
    assert.equal(res1, "px-2 -m-6");

    const res2 = mergeTailwindTokens("-m-4 px-2", "m-6");
    assert.equal(res2, "px-2 m-6");
  });

  it("should preserve opacity and clip when updating color tokens", () => {
    const res1 = mergeTailwindTokens("text-red-500 text-opacity-50", "text-blue-500");
    assert.ok(res1.includes("text-opacity-50"), "text-opacity-50 must be preserved");
    assert.ok(res1.includes("text-blue-500"), "text-blue-500 must be present");
    assert.ok(!res1.includes("text-red-500"), "text-red-500 must be removed");

    const res2 = mergeTailwindTokens("bg-red-500 bg-clip-text", "bg-blue-500");
    assert.ok(res2.includes("bg-clip-text"), "bg-clip-text must be preserved");
    assert.ok(res2.includes("bg-blue-500"), "bg-blue-500 must be present");
    assert.ok(!res2.includes("bg-red-500"), "bg-red-500 must be removed");
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

  it("should accurately target specific element when multiple elements reside on the same line", () => {
    const source = `<div><span className="first">1</span><span className="second">2</span></div>`;

    // 针对第二个 span 进行修改 (col 40 在第二个 span 范围内)
    const res = updateSourceCodeDeterministically({
      sourceCode: source,
      targetLine: 1,
      targetColumn: 40,
      newClassName: "second-updated"
    });

    assert.equal(res.ok, true);
    assert.ok(res.code?.includes('<span className="second second-updated">2</span>'));
    assert.ok(res.code?.includes('<span className="first">1</span>'));
    assert.ok(!res.code?.includes('<div className='));
  });

  it("should parse and edit TSX elements with TypeScript generic type arguments and spaced spreads", () => {
    const source = `export function Table() {
  return (
    <DataTable<User, number> { ...tableProps } className="bg-red-500 p-4">
      <Column key="name" />
    </DataTable>
  );
}`;

    const res = updateSourceCodeDeterministically({
      sourceCode: source,
      targetLine: 3,
      targetColumn: 5,
      newClassName: "bg-blue-500 p-6"
    });

    assert.equal(res.ok, true);
    assert.ok(res.code?.includes('className="bg-blue-500 p-6"'));
    assert.ok(!res.code?.includes("bg-red-500"));
    assert.ok(!res.code?.includes("p-4"));
    assert.ok(res.code?.includes('<DataTable<User, number> { ...tableProps }'));
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
