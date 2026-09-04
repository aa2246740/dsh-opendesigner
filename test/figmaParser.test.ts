import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  KiwiReader,
  figmaColorToTailwind,
  figmaNodeToTailwindClasses,
  buildSceneIndex,
  sceneToFlatStore,
  parseFigmaClipboard,
  type FigmaNode
} from "../src/compiler/figmaParser.ts";

describe("Compiler - Figma Kiwi Binary Protocol & Tailwind Mapping", () => {
  it("should read varuint, varint, float32, and strings correctly from binary stream", () => {
    // Manually construct a binary payload with Kiwi header
    const buffer = new Uint8Array(64);
    const view = new DataView(buffer.buffer);

    // Header "figma"
    buffer.set([0x66, 0x69, 0x67, 0x6d, 0x61], 0);

    // VarUint: 300 -> 0xAC 0x02
    buffer[5] = 0xac;
    buffer[6] = 0x02;

    // String "Button": len 6, then bytes
    buffer[7] = 6;
    buffer.set([0x42, 0x75, 0x74, 0x74, 0x6f, 0x6e], 8);

    // Float32: 0.5 at offset 14
    view.setFloat32(14, 0.5, true);

    const reader = new KiwiReader(buffer);
    assert.equal(reader.checkHeader(), true);
    assert.equal(reader.getOffset(), 5);

    const num = reader.readVarUint();
    assert.equal(num, 300);

    const str = reader.readString();
    assert.equal(str, "Button");

    const flt = reader.readFloat32();
    assert.ok(Math.abs(flt - 0.5) < 0.0001);
  });

  it("should correctly map Figma colors to Tailwind color tokens and hex fallback", () => {
    assert.equal(figmaColorToTailwind({ r: 1, g: 1, b: 1, a: 1 }, "bg"), "bg-white");
    assert.equal(figmaColorToTailwind({ r: 0, g: 0, b: 0, a: 1 }, "bg"), "bg-black");
    assert.equal(figmaColorToTailwind({ r: 0.1, g: 0.5, b: 0.9, a: 1 }, "bg"), "bg-blue-500");
    assert.equal(figmaColorToTailwind({ r: 0.9, g: 0.1, b: 0.1, a: 1 }, "text"), "text-red-500");
    assert.equal(figmaColorToTailwind({ r: 0.95, g: 0.95, b: 0.95, a: 1 }, "bg"), "bg-gray-100");
  });

  it("should map Figma AutoLayout, padding, borders, and radius to Tailwind classes", () => {
    const cardNode: FigmaNode = {
      id: "figma_card_1",
      name: "ProductCard",
      type: "FRAME",
      stackMode: "VERTICAL",
      itemSpacing: 16,
      paddingLeft: 24,
      paddingRight: 24,
      paddingTop: 16,
      paddingBottom: 16,
      counterAxisAlignItems: "CENTER",
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
      strokes: [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.9, a: 1 } }],
      strokeWeight: 1,
      cornerRadius: 16,
      effects: [{ type: "DROP_SHADOW", radius: 8, visible: true }]
    };

    const classes = figmaNodeToTailwindClasses(cardNode);
    assert.ok(classes.includes("flex"));
    assert.ok(classes.includes("flex-col"));
    assert.ok(classes.includes("gap-4")); // 16px -> 4
    assert.ok(classes.includes("px-6"));  // 24px -> 6
    assert.ok(classes.includes("py-4"));  // 16px -> 4
    assert.ok(classes.includes("bg-white"));
    assert.ok(classes.includes("border"));
    assert.ok(classes.includes("rounded-xl")); // 16px -> xl
    assert.ok(classes.includes("shadow-md"));
  });

  it("should map text node typography, alignment, and fills", () => {
    const textNode: FigmaNode = {
      id: "figma_txt_1",
      name: "Title",
      type: "TEXT",
      characters: "Confirm Purchase",
      fontSize: 18,
      fontWeight: 600,
      textAlignHorizontal: "CENTER",
      fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }]
    };

    const classes = figmaNodeToTailwindClasses(textNode);
    assert.ok(classes.includes("text-lg"));
    assert.ok(classes.includes("font-semibold"));
    assert.ok(classes.includes("text-center"));
    assert.ok(classes.includes("text-black"));
  });

  it("should build scene index and convert nested tree to FlatStore nodes and JSX", () => {
    const parentNode: FigmaNode = {
      id: "parent_frame",
      name: "ButtonGroup",
      type: "FRAME",
      stackMode: "HORIZONTAL",
      itemSpacing: 8
    };

    const btn1: FigmaNode = {
      id: "btn_1",
      name: "ButtonCancel",
      type: "FRAME",
      parentId: "parent_frame",
      cornerRadius: 8,
      characters: "Cancel"
    };

    const btn2: FigmaNode = {
      id: "btn_2",
      name: "ButtonSave",
      type: "FRAME",
      parentId: "parent_frame",
      cornerRadius: 8,
      fills: [{ type: "SOLID", color: { r: 0.1, g: 0.5, b: 0.9, a: 1 } }],
      characters: "Save"
    };

    const scene = buildSceneIndex([parentNode, btn1, btn2]);
    assert.deepEqual(scene.rootIds, ["parent_frame"]);
    assert.deepEqual(scene.childrenMap.get("parent_frame"), ["btn_1", "btn_2"]);

    const converted = sceneToFlatStore(scene);
    assert.equal(converted.elements.length, 3);
    assert.ok(converted.jsx.includes("<button"));
    assert.ok(converted.jsx.includes("Cancel"));
    assert.ok(converted.jsx.includes("Save"));
  });

  it("should parse clipboard with JSON fallback payload", () => {
    const jsonClipboard = JSON.stringify({
      id: "nav_bar",
      name: "HeaderNav",
      type: "FRAME",
      stackMode: "HORIZONTAL",
      itemSpacing: 12,
      paddingLeft: 16,
      paddingRight: 16,
      paddingTop: 12,
      paddingBottom: 12,
      children: [
        {
          id: "brand_logo",
          name: "BrandText",
          type: "TEXT",
          characters: "OpenDesigner",
          fontSize: 20,
          fontWeight: 700
        }
      ]
    });

    const res = parseFigmaClipboard(jsonClipboard);
    assert.equal(res.success, true);
    assert.equal(res.rootId, "nav_bar");
    assert.equal(res.elements.length, 2);
    assert.ok(res.jsx.includes("OpenDesigner"));
    assert.ok(res.jsx.includes("flex-row"));
  });

  it("should gracefully handle HTML/SVG fallback input", () => {
    const svgInput = `<svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>`;
    const res = parseFigmaClipboard(svgInput);
    assert.equal(res.success, true);
    assert.equal(res.elements.length, 1);
    assert.ok(res.jsx.includes("div"));
  });
});
