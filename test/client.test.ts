import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  worldToScreen,
  screenToWorld,
  CanvasAffineMatrix,
  companionGeometry,
  multiResize,
  computeBoundingBox
} from "../src/client/geometry.ts";
import { compute6LineSnapping } from "../src/client/snapping.ts";
import { Image } from "../src/client/next-shims/image.ts";
import { Link } from "../src/client/next-shims/link.ts";
import {
  useRouter,
  usePathname,
  useSearchParams,
  setVirtualLocation
} from "../src/client/next-shims/navigation.ts";
import { Inter, createGoogleFontStub } from "../src/client/next-shims/font.ts";

describe("Client - 2D Affine Transform & Coordinate Mapping", () => {
  it("should accurately transform world to screen and back", () => {
    const worldPoint = { x: 150, y: 300 };
    const zoom = 1.5;
    const panX = 100;
    const panY = -50;

    const screenPoint = worldToScreen(worldPoint, zoom, panX, panY);
    assert.equal(screenPoint.x, 150 * 1.5 + 100);
    assert.equal(screenPoint.y, 300 * 1.5 - 50);

    const backToWorld = screenToWorld(screenPoint, zoom, panX, panY);
    assert.equal(backToWorld.x, worldPoint.x);
    assert.equal(backToWorld.y, worldPoint.y);
  });

  it("should invert affine matrix accurately", () => {
    const matrix = new CanvasAffineMatrix(2.0, 50, 80);
    const p = { x: 40, y: 70 };
    const transformed = matrix.transformPoint(p);
    const inverted = matrix.inverseTransformPoint(transformed);

    assert.equal(Math.round(inverted.x), p.x);
    assert.equal(Math.round(inverted.y), p.y);
  });
});

describe("Client - 8-Direction Companion Geometry & Multi-Resize", () => {
  const startRect = { left: 100, top: 100, width: 200, height: 150 };

  it("should expand east handle without altering left or top", () => {
    const res = companionGeometry(startRect, "e", 50, 0);
    assert.equal(res.width, 250);
    assert.equal(res.height, 150);
    assert.equal(res.left, 100);
    assert.equal(res.top, 100);
  });

  it("should expand west handle with compensated left position", () => {
    const res = companionGeometry(startRect, "w", 50, 0);
    assert.equal(res.width, 250);
    // left is compensated by -(250 - 200) = -50 => 50
    assert.equal(res.left, 50);
    assert.equal(res.top, 100);
  });

  it("should expand north handle with compensated top position", () => {
    const res = companionGeometry(startRect, "n", 0, 50);
    assert.equal(res.height, 200);
    // top is compensated by -(200 - 150) = -50 => 50
    assert.equal(res.top, 50);
    assert.equal(res.left, 100);
  });

  it("should clamp minimum dimension to 1px", () => {
    const res = companionGeometry(startRect, "se", -500, -500);
    assert.equal(res.width, 1);
    assert.equal(res.height, 1);
  });

  it("should scale multiple elements proportionally in group resize", () => {
    const el1 = { id: "a", rect: { left: 0, top: 0, width: 50, height: 50 } };
    const el2 = { id: "b", rect: { left: 50, top: 0, width: 50, height: 50 } };
    const groupStart = computeBoundingBox([el1.rect, el2.rect]);

    assert.deepEqual(groupStart, { left: 0, top: 0, width: 100, height: 50 });

    // Double the width via 'e' handle
    const resized = multiResize([el1, el2], groupStart, "e", 100, 0);
    assert.equal(resized[0].rect.width, 100);
    assert.equal(resized[0].rect.left, 0);
    assert.equal(resized[1].rect.width, 100);
    assert.equal(resized[1].rect.left, 100);
  });
});

describe("Client - 6-Line Smart Snapping", () => {
  it("should snap when near alignment threshold and generate guides", () => {
    const candidate = { left: 200, top: 100, width: 100, height: 100 };
    // Active element left is at 198 (delta of 2 from candidate.left = 200)
    const active = { left: 198, top: 250, width: 80, height: 80 };

    const res = compute6LineSnapping(active, [candidate], 5);
    assert.equal(res.snappedX, true);
    assert.equal(res.snappedRect.left, 200);
    assert.equal(res.guides.length, 1);
    assert.equal(res.guides[0].orientation, "vertical");
    assert.equal(res.guides[0].coordinate, 200);
  });

  it("should not snap when distance exceeds threshold", () => {
    const candidate = { left: 200, top: 100, width: 100, height: 100 };
    const active = { left: 180, top: 250, width: 80, height: 80 };

    const res = compute6LineSnapping(active, [candidate], 5);
    assert.equal(res.snappedX, false);
    assert.equal(res.snappedY, false);
    assert.equal(res.snappedRect.left, 180);
    assert.equal(res.guides.length, 0);
  });

  it("should snap center to center", () => {
    const candidate = { left: 100, top: 100, width: 100, height: 100 }; // center x = 150
    // Active width 60, center initially at 122 + 30 = 152
    const active = { left: 122, top: 300, width: 60, height: 60 };

    const res = compute6LineSnapping(active, [candidate], 5);
    assert.equal(res.snappedX, true);
    // Snapped center x should be 150 => left = 150 - 30 = 120
    assert.equal(res.snappedRect.left, 120);
  });
});

describe("Client - next-shims Runtime Stubs", () => {
  it("should render Image stub with fill or explicit dimensions", () => {
    const fixedImage = Image({ src: "/avatar.png", alt: "Avatar", width: 40, height: 40 });
    assert.equal(fixedImage.type, "img");
    assert.equal(fixedImage.props.src, "/avatar.png");
    assert.equal(fixedImage.props.style.width, 40);

    const fillImage = Image({ src: { src: "/bg.png" }, alt: "Bg", fill: true });
    assert.equal(fillImage.props.src, "/bg.png");
    assert.equal(fillImage.props.style.position, "absolute");
    assert.equal(fillImage.props.style.objectFit, "cover");
  });

  it("should render Link stub and handle virtual navigation", () => {
    let eventFired = false;
    if (typeof globalThis !== "undefined" && typeof (globalThis as any).addEventListener === "function") {
      (globalThis as any).addEventListener("designer:navigate", (e: any) => {
        if (e.detail?.href === "/about") eventFired = true;
      });
    }

    const link = Link({ href: "/about", children: "About" });
    assert.equal(link.type, "a");
    assert.equal(link.props.href, "/about");

    // Invoke click handler
    let prevented = false;
    link.props.onClick({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
  });

  it("should manage virtual navigation state", () => {
    setVirtualLocation("/dashboard", "tab=profile");
    assert.equal(usePathname(), "/dashboard");
    assert.equal(useSearchParams().get("tab"), "profile");

    const router = useRouter();
    router.push("/settings?view=general");
    assert.equal(usePathname(), "/settings");
    assert.equal(useSearchParams().get("view"), "general");
  });

  it("should produce valid font stubs", () => {
    const fontFn = Inter();
    assert.equal(fontFn.className, "font-inter");
    assert.equal(fontFn.variable, "--font-inter");
    assert.ok(fontFn.style.fontFamily.includes("Inter"));

    const custom = createGoogleFontStub("CustomFont", "--font-custom")();
    assert.equal(custom.className, "font-customfont");
  });
});

describe("Client - DSH Web Client Artifact lib/client.js", () => {
  it("should register with window.__ModuleLoader__ and export client capabilities", async () => {
    let loaderEntry: any = null;
    (globalThis as any).window = globalThis;
    (globalThis as any).window.__ModuleLoader__ = {
      load: (entry: any) => {
        loaderEntry = entry;
      }
    };

    // Dynamically import lib/client.js
    const clientModule = await import("../lib/client.js");
    assert.ok(loaderEntry);
    assert.equal(loaderEntry.id, "dsh-opendesigner");

    const exported = loaderEntry.factory();
    assert.ok(exported.InfiniteCanvasViewport);
    assert.ok(exported.SelectionManager);
    assert.ok(exported.CanvasPanel);
    assert.ok(exported.CanvasInteractionController);
    assert.ok(exported.SelectionOverlayRenderer);
    assert.ok(exported.worldToScreen);

    const clientState = exported.initDesignerClient();
    assert.equal(clientState.viewport.getZoom(), 1.0);
    assert.equal(clientState.selectedElementIds.length, 0);
    assert.ok(clientState.panel);
    assert.equal(typeof clientState.panel.registerElement, "function");
  });
});
