import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  KiwiReader,
  KiwiWriter,
  packKiwiBinary,
  unpackKiwiBinary,
  figmaColorToTailwind,
  figmaNodeToTailwindClasses,
  buildSceneIndex,
  sceneToFlatStore,
  parseFigmaClipboard,
  figmaToReact19,
  importFigmaToStore,
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

  it("should round-trip encode and decode Kiwi binary streams with KiwiWriter and KiwiReader", () => {
    const writer = new KiwiWriter();
    writer.writeHeader("figma");
    writer.writeVarUint(65535);
    writer.writeVarInt(-12345);
    writer.writeFloat32(3.14159);
    writer.writeString("OpenDesigner-Figma-Engine");

    const bytes = writer.toUint8Array();
    const reader = new KiwiReader(bytes);

    assert.equal(reader.checkHeader(), true);
    assert.equal(reader.readVarUint(), 65535);
    assert.equal(reader.readVarInt(), -12345);
    assert.ok(Math.abs(reader.readFloat32() - 3.14159) < 0.0001);
    assert.equal(reader.readString(), "OpenDesigner-Figma-Engine");
    assert.equal(reader.isEOF(), true);
  });

  it("should pack and unpack FigmaNode scene tree to/from binary buffer via packKiwiBinary and unpackKiwiBinary", () => {
    const inputNodes: FigmaNode[] = [
      {
        id: "hero_banner",
        name: "HeroBanner",
        type: "FRAME",
        stackMode: "VERTICAL",
        itemSpacing: 16,
        paddingLeft: 24,
        paddingRight: 24,
        paddingTop: 32,
        paddingBottom: 32,
        cornerRadius: 12,
        fills: [{ type: "SOLID", color: { r: 0.1, g: 0.2, b: 0.3, a: 1 } }]
      },
      {
        id: "hero_title",
        name: "Title",
        type: "TEXT",
        parentId: "hero_banner",
        characters: "Welcome to OpenDesigner",
        fontSize: 24,
        fontWeight: 700,
        fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }]
      }
    ];

    const binary = packKiwiBinary(inputNodes, "figma");
    assert.ok(binary instanceof Uint8Array);
    assert.ok(binary.length > 30);

    const unpacked = unpackKiwiBinary(binary);
    assert.equal(unpacked.length, 2);
    assert.equal(unpacked[0].id, "hero_banner");
    assert.equal(unpacked[0].name, "HeroBanner");
    assert.equal(unpacked[0].type, "FRAME");
    assert.equal(unpacked[0].stackMode, "VERTICAL");
    assert.equal(unpacked[0].itemSpacing, 16);
    assert.equal(unpacked[0].paddingTop, 32);
    assert.equal(unpacked[0].cornerRadius, 12);

    assert.equal(unpacked[1].id, "hero_title");
    assert.equal(unpacked[1].type, "TEXT");
    assert.equal(unpacked[1].parentId, "hero_banner");
    assert.equal(unpacked[1].characters, "Welcome to OpenDesigner");
    assert.equal(unpacked[1].fontSize, 24);
    assert.equal(unpacked[1].fontWeight, 700);

    // 通过完整剪贴板入口解析二进制数据
    const clipboardRes = parseFigmaClipboard(binary);
    assert.equal(clipboardRes.success, true);
    assert.equal(clipboardRes.rootId, "hero_banner");
    assert.equal(clipboardRes.elements.length, 2);
    assert.ok(clipboardRes.jsx.includes("Welcome to OpenDesigner"));
  });

  it("should convert Figma scene to production-ready React 19 / Tailwind v4 component code via figmaToReact19", () => {
    const nodes: FigmaNode[] = [
      {
        id: "card_root",
        name: "PricingCard",
        type: "FRAME",
        stackMode: "VERTICAL",
        itemSpacing: 16,
        paddingLeft: 24,
        paddingRight: 24,
        paddingTop: 24,
        paddingBottom: 24,
        cornerRadius: 16,
        fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
        strokes: [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.9, a: 1 } }],
        strokeWeight: 1
      },
      {
        id: "card_title",
        name: "Title",
        type: "TEXT",
        parentId: "card_root",
        characters: "Pro Plan",
        fontSize: 20,
        fontWeight: 700
      },
      {
        id: "buy_btn",
        name: "PurchaseButton",
        type: "FRAME",
        parentId: "card_root",
        cornerRadius: 8,
        fills: [{ type: "SOLID", color: { r: 0.1, g: 0.5, b: 0.9, a: 1 } }],
        characters: "Get Started"
      }
    ];

    const reactOutput = figmaToReact19(nodes, {
      componentName: "PricingCard",
      exportType: "named"
    });

    assert.equal(reactOutput.componentName, "PricingCard");
    assert.equal(reactOutput.rootId, "card_root");
    assert.equal(reactOutput.elements.length, 3);

    // 验证生成的 React 19 JSX 语法结构
    assert.ok(reactOutput.code.includes('import React from "react";'));
    assert.ok(reactOutput.code.includes("export function PricingCard() {"));
    assert.ok(reactOutput.code.includes("return ("));
    assert.ok(reactOutput.code.includes("<section className="));
    assert.ok(reactOutput.code.includes("flex-col"));
    assert.ok(reactOutput.code.includes("rounded-xl"));
    assert.ok(reactOutput.code.includes("border"));
    assert.ok(reactOutput.code.includes("<p className="));
    assert.ok(reactOutput.code.includes("Pro Plan"));
    assert.ok(reactOutput.code.includes("<button className="));
    assert.ok(reactOutput.code.includes("Get Started"));
  });

  it("should mount Figma import result directly into FlatStore via importFigmaToStore", () => {
    const store: any = {
      elements: new Map(),
      childrenMap: new Map(),
      setElement(el: any) {
        this.elements.set(el.id, el);
      },
      attachChild(parentId: string, childId: string) {
        const list = this.childrenMap.get(parentId) || [];
        list.push(childId);
        this.childrenMap.set(parentId, list);
      }
    };

    const nodes: FigmaNode[] = [
      { id: "parent_node", name: "Container", type: "FRAME" },
      { id: "child_node", name: "Label", type: "TEXT", parentId: "parent_node", characters: "Hello" }
    ];

    const scene = buildSceneIndex(nodes);
    const rootId = importFigmaToStore(store, scene);

    assert.equal(rootId, "parent_node");
    assert.equal(store.elements.size, 2);
    assert.ok(store.elements.has("parent_node"));
    assert.ok(store.elements.has("child_node"));
    assert.deepEqual(store.childrenMap.get("parent_node"), ["child_node"]);
  });
});
