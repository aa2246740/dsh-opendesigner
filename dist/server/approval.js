export class ApprovalRequiredError extends Error {
    code = "APPROVAL_REQUIRED";
    constructor(toolName) {
        super(`Destructive tool ${toolName} requires a one-shot host approval receipt bound to project, revision, and diff hash. Model-supplied approve:true is ignored. autoApprove is an operator setting only; it does not expand the project-root jail.`);
        this.name = "ApprovalRequiredError";
    }
}
export const PERSIST_APPROVAL = {
    checkpoint: "auto",
    rewind: "auto",
    list_checkpoints: "auto",
    autosave: "auto",
    apply_to_project: "gated",
    batch_create: "auto",
    batch_discard: "auto",
    batch_preview: "auto",
    batch_apply: "gated",
    propose_source_patch: "auto",
    reject_source_patch: "auto",
    accept_source_patch: "gated"
};
export function catalogApprovalMode(tool) {
    return tool.destructive ? "gated" : "auto";
}
export function persistApprovalMode(toolName) {
    return PERSIST_APPROVAL[toolName] ?? "gated";
}
export function isApproved(mode, ctx, _args, _channel = "model") {
    if (mode === "auto")
        return true;
    if (ctx.autoApprove === true)
        return true;
    if (ctx.approvalGranted === true)
        return true;
    return false;
}
export function assertDestructiveApproval(tool, ctx, args) {
    if (catalogApprovalMode(tool) === "auto")
        return;
    const channel = ctx.approvalChannel ?? "model";
    if (isApproved("gated", ctx, args, channel))
        return;
    throw new ApprovalRequiredError(tool.name);
}
export function assertPersistApproval(toolName, ctx, args) {
    const mode = persistApprovalMode(toolName);
    const channel = ctx.approvalChannel ?? "model";
    if (isApproved(mode, ctx, args, channel))
        return;
    throw new ApprovalRequiredError(toolName);
}
//# sourceMappingURL=approval.js.map