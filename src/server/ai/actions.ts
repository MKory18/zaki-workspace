import { z } from "zod";
import { parseDayKey } from "@/lib/owner-board";
import type { RefTable } from "./redact";

/**
 * «مساعد المالك» — WHAT THE MODEL MAY PROPOSE. A whitelist of five actions, in code. Anything else (a delete, a reward, a
 * permission, a rank, an account, a space, a file, a message, an integration, a tool the model made up) is dropped, and only a
 * COUNTER is logged for it (`ai.proposal_dropped`), never the model's text.
 *
 * A proposal travels in two shapes:
 *   - `MODEL_PARAMS`   what the model writes: it names things by REFERENCE (`T5`, `U2`, `S1`, `P3`), never by id;
 *   - `STORED_PARAMS`  what is stored and executed: real ids, mapped back on the server ONLY from the table of references that
 *                      was in the context of that conversation (`resolveParams`), and parsed again, plus every id re-checked
 *                      against the database, when the owner presses «وافق».
 */

export const ACTION_TYPES = ["create_task", "reassign_task", "set_due_date", "pin_task", "remind_person"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const isActionType = (value: unknown): value is ActionType => typeof value === "string" && (ACTION_TYPES as readonly string[]).includes(value);

export const TOOL_NAME = "propose_action";
export const REASON_MAX = 500;
export const TITLE_MAX_LENGTH = 200;
export const REMINDER_MAX = 200;
/** At most this many proposals are kept from ONE answer. */
export const MAX_PROPOSALS_PER_ANSWER = 5;
/** A pending proposal expires after this long. */
export const PROPOSAL_TTL_MS = 48 * 3_600_000;

const ref = (kind: "U" | "T" | "S" | "P") => z.string().trim().regex(new RegExp(`^${kind}\\d{1,5}$`));
const day = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => parseDayKey(d) !== null, "day")
  .refine((d) => Number(d.slice(0, 4)) >= 2000 && Number(d.slice(0, 4)) <= 2100, "year");
const priority = z.enum(["URGENT", "HIGH", "NORMAL", "LOW"]);
const id = z.string().trim().min(5).max(60).regex(/^[A-Za-z0-9_-]+$/);

export const MODEL_PARAMS = {
  create_task: z.object({ title: z.string().trim().min(1).max(TITLE_MAX_LENGTH), space: ref("S"), project: ref("P"), assignee: ref("U").optional(), dueDate: day.optional(), priority: priority.optional() }).strict(),
  reassign_task: z.object({ task: ref("T"), assignee: ref("U") }).strict(),
  set_due_date: z.object({ task: ref("T"), dueDate: day }).strict(),
  pin_task: z.object({ task: ref("T") }).strict(),
  remind_person: z.object({ person: ref("U"), text: z.string().trim().min(1).max(REMINDER_MAX) }).strict(),
} as const;

export const STORED_PARAMS = {
  create_task: z.object({ title: z.string().trim().min(1).max(TITLE_MAX_LENGTH), workspaceId: id, projectId: id, boardId: id.optional(), assigneeId: id.optional(), dueDate: day.optional(), priority: priority.optional() }).strict(),
  reassign_task: z.object({ taskId: id, assigneeId: id }).strict(),
  set_due_date: z.object({ taskId: id, dueDate: day }).strict(),
  pin_task: z.object({ taskId: id }).strict(),
  remind_person: z.object({ userId: id, text: z.string().trim().min(1).max(REMINDER_MAX) }).strict(),
} as const;

export type StoredParams = {
  create_task: z.infer<typeof STORED_PARAMS.create_task>;
  reassign_task: z.infer<typeof STORED_PARAMS.reassign_task>;
  set_due_date: z.infer<typeof STORED_PARAMS.set_due_date>;
  pin_task: z.infer<typeof STORED_PARAMS.pin_task>;
  remind_person: z.infer<typeof STORED_PARAMS.remind_person>;
};

/** What the model is given to call: one tool, `propose_action`. Nothing here runs anything. */
export const PROPOSE_TOOL = {
  name: TOOL_NAME,
  description:
    "Propose ONE action for the owner to approve. Nothing is done until the owner presses approve. Use only the references (U1, T3, S1, P2) found in the data. " +
    "Types and params: create_task {title, space, project, assignee?, dueDate? (YYYY-MM-DD), priority? (URGENT|HIGH|NORMAL|LOW)}; reassign_task {task, assignee}; " +
    "set_due_date {task, dueDate}; pin_task {task}; remind_person {person, text (max 200 characters)}.",
  inputSchema: {
    type: "object",
    properties: {
      type: { type: "string", enum: [...ACTION_TYPES] },
      params: { type: "object" },
      reason: { type: "string", description: "Why, in one or two sentences, with the numbers it rests on." },
    },
    required: ["type", "params", "reason"],
  },
} as const;

export type DropReason = "tool" | "shape" | "type" | "params" | "reference" | "limit";

export interface Proposed {
  type: ActionType;
  /** Real ids (what `STORED_PARAMS[type]` accepts, before the database re-check). */
  params: Record<string, unknown>;
  reason: string;
}

const callShape = z.object({ type: z.string(), params: z.record(z.unknown()), reason: z.string().optional() });

/** The reference of each parameter, and the kind of id it stands for. */
const REF_FIELDS: Record<ActionType, Record<string, { to: string; kind: "U" | "T" | "S" | "P" }>> = {
  create_task: { space: { to: "workspaceId", kind: "S" }, project: { to: "projectId", kind: "P" }, assignee: { to: "assigneeId", kind: "U" } },
  reassign_task: { task: { to: "taskId", kind: "T" }, assignee: { to: "assigneeId", kind: "U" } },
  set_due_date: { task: { to: "taskId", kind: "T" } },
  pin_task: { task: { to: "taskId", kind: "T" } },
  remind_person: { person: { to: "userId", kind: "U" } },
};

/**
 * One tool call of the model as a proposal, or the reason it is dropped. The type must be on the whitelist, the params must
 * parse, and every reference must be in the conversation's table (a real id written by the model is NOT a reference and is
 * refused). `board` is chosen by the caller for `create_task` (the project's first board), so it is not in the model's params.
 */
export function proposalFromCall(call: { name: string; input: unknown }, table: RefTable): { ok: true; proposal: Omit<Proposed, "params"> & { params: Record<string, unknown> } } | { ok: false; reason: DropReason } {
  if (call.name !== TOOL_NAME) return { ok: false, reason: "tool" };
  const shape = callShape.safeParse(call.input);
  if (!shape.success) return { ok: false, reason: "shape" };
  if (!isActionType(shape.data.type)) return { ok: false, reason: "type" };
  const type = shape.data.type;
  const parsed = MODEL_PARAMS[type].safeParse(shape.data.params);
  if (!parsed.success) return { ok: false, reason: "params" };
  const given = parsed.data as Record<string, unknown>;
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(given)) {
    const mapping = REF_FIELDS[type][key];
    if (!mapping) {
      params[key] = value;
      continue;
    }
    const real = typeof value === "string" ? table[value] : undefined;
    if (!real || typeof value !== "string" || value[0] !== mapping.kind) return { ok: false, reason: "reference" };
    params[mapping.to] = real;
  }
  return { ok: true, proposal: { type, params, reason: (shape.data.reason ?? "").trim().slice(0, REASON_MAX) } };
}

/** The stored params of a row, parsed again (null: they no longer parse, the proposal cannot run). */
export function parseStored<T extends ActionType>(type: T, params: unknown): StoredParams[T] | null {
  const parsed = STORED_PARAMS[type].safeParse(params);
  return parsed.success ? (parsed.data as StoredParams[T]) : null;
}
