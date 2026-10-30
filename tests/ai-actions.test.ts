import { describe, expect, it } from "vitest";
import { ACTION_TYPES, MODEL_PARAMS, PROPOSE_TOOL, STORED_PARAMS, TOOL_NAME, isActionType, parseStored, proposalFromCall } from "@/server/ai/actions";
import { AR } from "@/lib/i18n/dict";

/**
 * «مساعد المالك» — what the model may propose: five actions on a whitelist, named by reference, mapped back to ids only from the
 * conversation's own table. Everything else is dropped.
 */

const table = { U1: "user-1", U2: "user-2", T1: "task-1", S1: "space-1", P1: "project-1" } as Record<string, string>;
const call = (input: unknown, name = TOOL_NAME) => ({ name, input });

describe("the whitelist", () => {
  it("is exactly five actions", () => {
    expect([...ACTION_TYPES]).toEqual(["create_task", "reassign_task", "set_due_date", "pin_task", "remind_person"]);
    expect(Object.keys(MODEL_PARAMS).sort()).toEqual([...ACTION_TYPES].sort());
    expect(Object.keys(STORED_PARAMS).sort()).toEqual([...ACTION_TYPES].sort());
    expect(PROPOSE_TOOL.name).toBe("propose_action");
    for (const type of ACTION_TYPES) expect(AR[`assistant.proposal.${type}`], type).toMatch(/[؀-ۿ]/);
  });

  it("anything that destroys, pays, grants or reaches outside it is not a type", () => {
    for (const type of [
      "delete_task", "delete_all", "archive_task", "edit_reward", "set_reward", "award_reward", "change_rank", "set_role", "grant_capability", "create_account", "suspend_user", "delete_space", "delete_file", "send_message",
      "post_message", "edit_integration", "set_webhook", "send_key", "transfer_money", "approve_payment", "", "CREATE_TASK", "pin_task ",
    ]) {
      expect(isActionType(type), type).toBe(false);
      const r = proposalFromCall(call({ type, params: { task: "T1" }, reason: "x" }), table);
      expect(r.ok, type).toBe(false);
    }
  });

  it("a tool other than propose_action is dropped", () => {
    expect(proposalFromCall(call({ type: "pin_task", params: { task: "T1" }, reason: "x" }, "run_shell"), table)).toEqual({ ok: false, reason: "tool" });
    expect(proposalFromCall(call({}, "delete_everything"), table)).toEqual({ ok: false, reason: "tool" });
  });
});

describe("a proposal from a tool call", () => {
  it("maps references to the real ids of the conversation's table", () => {
    expect(proposalFromCall(call({ type: "reassign_task", params: { task: "T1", assignee: "U2" }, reason: "لأن موظف 1 مثقل" }), table)).toEqual({
      ok: true,
      proposal: { type: "reassign_task", params: { taskId: "task-1", assigneeId: "user-2" }, reason: "لأن موظف 1 مثقل" },
    });
    expect(proposalFromCall(call({ type: "create_task", params: { title: "متابعة", space: "S1", project: "P1", assignee: "U1", dueDate: "2026-11-05", priority: "HIGH" }, reason: "r" }), table)).toEqual({
      ok: true,
      proposal: { type: "create_task", params: { title: "متابعة", workspaceId: "space-1", projectId: "project-1", assigneeId: "user-1", dueDate: "2026-11-05", priority: "HIGH" }, reason: "r" },
    });
    expect(proposalFromCall(call({ type: "pin_task", params: { task: "T1" }, reason: "r" }), table).ok).toBe(true);
    expect(proposalFromCall(call({ type: "set_due_date", params: { task: "T1", dueDate: "2026-12-01" }, reason: "r" }), table).ok).toBe(true);
    expect(proposalFromCall(call({ type: "remind_person", params: { person: "U2", text: "تذكير" }, reason: "r" }), table).ok).toBe(true);
  });

  it("a reference that is not in the table, a real id written by the model, or a reference of the wrong kind is refused", () => {
    expect(proposalFromCall(call({ type: "pin_task", params: { task: "T9" }, reason: "r" }), table)).toEqual({ ok: false, reason: "reference" });
    expect(proposalFromCall(call({ type: "pin_task", params: { task: "task-1" }, reason: "r" }), table)).toEqual({ ok: false, reason: "params" });
    expect(proposalFromCall(call({ type: "pin_task", params: { task: "U1" }, reason: "r" }), table)).toEqual({ ok: false, reason: "params" });
    expect(proposalFromCall(call({ type: "reassign_task", params: { task: "T1", assignee: "user-2" }, reason: "r" }), table)).toEqual({ ok: false, reason: "params" });
    // a key the table does not hold is refused even when it LOOKS like a reference of the right kind
    expect(proposalFromCall(call({ type: "reassign_task", params: { task: "T1", assignee: "U7" }, reason: "r" }), table)).toEqual({ ok: false, reason: "reference" });
  });

  it("extra params, bad days, a long reminder, an empty title, a bad priority or a malformed call are refused", () => {
    for (const params of [
      { task: "T1", extra: 1 },
      { task: "T1", assignee: "U1", dueDate: "2026-01-01" },
    ]) expect(proposalFromCall(call({ type: "pin_task", params, reason: "r" }), table).ok).toBe(false);
    expect(proposalFromCall(call({ type: "set_due_date", params: { task: "T1", dueDate: "غدًا" }, reason: "r" }), table).ok).toBe(false);
    expect(proposalFromCall(call({ type: "set_due_date", params: { task: "T1", dueDate: "2026-02-31" }, reason: "r" }), table).ok).toBe(false);
    expect(proposalFromCall(call({ type: "remind_person", params: { person: "U1", text: "ب".repeat(201) }, reason: "r" }), table).ok).toBe(false);
    expect(proposalFromCall(call({ type: "create_task", params: { title: "", space: "S1", project: "P1" }, reason: "r" }), table).ok).toBe(false);
    expect(proposalFromCall(call({ type: "create_task", params: { title: "x", space: "S1", project: "P1", priority: "NONE" }, reason: "r" }), table).ok).toBe(false);
    for (const input of [null, "x", 5, [], { type: 5 }, { type: "pin_task" }]) expect(proposalFromCall(call(input), table).ok, JSON.stringify(input)).toBe(false);
  });

  it("the reason is cut at 500 characters and may be missing", () => {
    const r = proposalFromCall(call({ type: "pin_task", params: { task: "T1" }, reason: "ب".repeat(900) }), table);
    expect(r.ok && r.proposal.reason.length).toBe(500);
    const none = proposalFromCall(call({ type: "pin_task", params: { task: "T1" } }), table);
    expect(none.ok && none.proposal.reason).toBe("");
  });

  it("stored params parse again at execution; a row that no longer parses is refused", () => {
    expect(parseStored("pin_task", { taskId: "task-12345" })).toEqual({ taskId: "task-12345" });
    expect(parseStored("pin_task", { taskId: "x" })).toBeNull();
    expect(parseStored("pin_task", { taskId: "task-12345", extra: true })).toBeNull();
    expect(parseStored("remind_person", { userId: "user-12345", text: "" })).toBeNull();
    expect(parseStored("create_task", { title: "t", workspaceId: "ws-12345", projectId: "pr-12345", boardId: "bd-12345" })).not.toBeNull();
  });
});
