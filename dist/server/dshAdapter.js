import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as path from "node:path";
import * as fs from "node:fs";
/** Host CLI and `@deepseek-ai/dsh-tools` release this plugin is proved against. */
export const REQUIRED_DSH_RELEASE = "0.1.2-rc.1";
export const JSON_OUTPUT = {
    schema: { type: "object", additionalProperties: true },
    render: (_args, value) => [
        { type: "text", text: JSON.stringify(value, null, 2) }
    ]
};
export function toDshParameters(jsonSchema, extra) {
    const properties = jsonSchema?.properties || {};
    const required = new Set(Array.isArray(jsonSchema?.required) ? jsonSchema.required : []);
    const out = {};
    for (const [key, spec] of Object.entries(properties)) {
        out[key] = convertNode(spec, required.has(key));
    }
    if (extra) {
        Object.assign(out, extra);
    }
    return out;
}
function convertNode(spec, required) {
    const node = { ...spec };
    if (required)
        node.required = true;
    if (spec.type === "object") {
        if (spec.additionalProperties === undefined) {
            node.additionalProperties = true;
        }
        if (spec.properties && typeof spec.properties === "object") {
            const nestedRequired = new Set(Array.isArray(spec.required) ? spec.required : []);
            const nested = {};
            for (const [key, child] of Object.entries(spec.properties)) {
                nested[key] = convertNode(child, nestedRequired.has(key));
            }
            node.properties = nested;
        }
        delete node.required;
        if (required)
            node.required = true;
    }
    if (spec.type === "array" && spec.items && typeof spec.items === "object") {
        node.items = convertNode(spec.items, false);
    }
    return node;
}
function defineToolResolvers() {
    const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const bases = [
        import.meta.url,
        pathToFileURL(path.join(pluginRoot, "package.json")).href,
        pathToFileURL(path.join(process.cwd(), "package.json")).href
    ];
    if (typeof process.argv[1] === "string") {
        try {
            bases.push(pathToFileURL(path.resolve(process.argv[1])).href);
        }
        catch {
            // argv[1] is not always a file path.
        }
    }
    const home = process.env.DSH_HOME;
    if (home) {
        try {
            for (const entry of fs.readdirSync(path.join(home, "profiles"), { withFileTypes: true })) {
                if (entry.isDirectory()) {
                    bases.push(pathToFileURL(path.join(home, "profiles", entry.name, "package.json")).href);
                }
            }
        }
        catch {
            // Isolated tests have no DSH_HOME profiles.
        }
    }
    return bases;
}
function parametersToJsonSchema(params) {
    const properties = {};
    const required = [];
    for (const [key, spec] of Object.entries(params)) {
        const node = { ...spec };
        if (node.required === true) {
            required.push(key);
            delete node.required;
        }
        properties[key] = node;
    }
    return {
        type: "object",
        additionalProperties: true,
        properties,
        ...(required.length > 0 ? { required } : {})
    };
}
function loadDefineTool() {
    for (const base of defineToolResolvers()) {
        try {
            const req = createRequire(base);
            const mod = req("@deepseek-ai/dsh-tools");
            if (typeof mod.defineTool === "function") {
                return mod.defineTool.bind(mod);
            }
        }
        catch {
            // Keep walking. The host package is a peer, not always next to this file.
        }
    }
    return undefined;
}
export function wrapDefineTool(def) {
    const hostDef = {
        ...def,
        output: JSON_OUTPUT
    };
    const defineTool = loadDefineTool();
    if (defineTool) {
        return defineTool(hostDef);
    }
    return {
        ...hostDef,
        parameters: parametersToJsonSchema(def.parameters)
    };
}
export function extraApproveParam(tool) {
    if (!tool.destructive)
        return {};
    return {
        approve: {
            type: "boolean",
            description: "Ignored. The model cannot authorize destructive tools by setting this flag. Hosts must issue a one-shot approval receipt."
        },
        approvalReceipt: {
            type: "string",
            description: "One-shot host approval receipt bound to project, revision, and diff hash."
        }
    };
}
//# sourceMappingURL=dshAdapter.js.map