/**
 * «طلبات الموافقة» — the pure part: the states, the limits, the chain rules and what a decision does to the chain.
 *
 * Pure (no React, no Next, no server imports): the routes validate with it, the screens draw from it and the tests pin it.
 *
 * AN APPROVAL ONLY RECORDS A DECISION. It never moves money: an optional amount is a note in integer minor units
 * (src/lib/rewards.ts holds the one set of money helpers; this file adds none).
 */
import { AR } from "@/lib/i18n/dict";
import { fmtReward } from "@/lib/rewards";

export const APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED", "CHANGES_REQUESTED"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const STEP_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CHANGES_REQUESTED", "SKIPPED"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const DECISIONS = ["APPROVE", "REJECT", "CHANGES"] as const;
export type Decision = (typeof DECISIONS)[number];

export const LINK_KINDS = ["TASK", "CARD", "MESSAGE"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const APPROVAL_LIMITS = {
  /** The chain: one approver or up to three, in order. */
  approvers: 3,
  title: 200,
  details: 4000,
  reason: 1000,
  attachments: 10,
  /** A request that keeps coming back for changes stops here (every version keeps its history). */
  versions: 20,
} as const;

export const VIEWS = ["mine", "waiting", "all"] as const;
export type ApprovalView = (typeof VIEWS)[number];

export function isApprovalStatus(value: unknown): value is ApprovalStatus {
  return typeof value === "string" && (APPROVAL_STATUSES as readonly string[]).includes(value);
}

export function isDecision(value: unknown): value is Decision {
  return typeof value === "string" && (DECISIONS as readonly string[]).includes(value);
}

/** A request that is still being decided. */
export function isOpen(status: string): boolean {
  return status === "PENDING";
}

/** A request that is over for good: nothing more can be done to it. */
export function isFinal(status: string): boolean {
  return status === "APPROVED" || status === "REJECTED" || status === "CANCELLED";
}

/** The theme token a status is drawn with (never a palette colour). */
export function statusTone(status: string): "warn" | "ok" | "danger" | "info" | "muted" {
  switch (status) {
    case "PENDING":
      return "warn";
    case "APPROVED":
      return "ok";
    case "REJECTED":
      return "danger";
    case "CHANGES_REQUESTED":
      return "info";
    default:
      return "muted";
  }
}

/** The Arabic name of a request status or a step status. An unknown value is never printed raw. */
export function statusText(status: string | null | undefined): string {
  if (!status) return "—";
  return AR[`approvals.status.${status}`] ?? AR["enum.unknown"] ?? "—";
}

/** The Arabic name of a decision button. */
export function decisionText(decision: string): string {
  return AR[`approvals.decision.${decision}`] ?? "—";
}

/** «150 دينار» for a request's amount; empty when it has none. */
export function amountText(minor: number | null | undefined, currency: string | null | undefined): string {
  return fmtReward(minor, currency);
}

/**
 * The reason a chain is refused, as a dictionary key; `null` = fine. One to three approvers, each once, and never the person
 * who asks (nobody approves their own request). Whether each person MAY approve (active, staff, in the space) is the
 * server's to check, from the database.
 */
export function chainProblem(approverIds: readonly unknown[], requesterId: string): string | null {
  if (!Array.isArray(approverIds) || approverIds.length === 0) return "approvals.e.chain_empty";
  if (approverIds.length > APPROVAL_LIMITS.approvers) return "approvals.e.chain_long";
  if (approverIds.some((id) => typeof id !== "string" || id === "")) return "approvals.e.chain_invalid";
  if (new Set(approverIds).size !== approverIds.length) return "approvals.e.chain_duplicate";
  if (approverIds.includes(requesterId)) return "approvals.e.own_request";
  return null;
}

/** What a decision at `position` of a chain of `total` does. */
export interface Outcome {
  /** The step's own new status. */
  step: Exclude<StepStatus, "PENDING" | "SKIPPED">;
  /** The request's status afterwards. */
  request: ApprovalStatus;
  /** The step that decides next (null: nobody: the request is finished or sent back). */
  next: number | null;
  /** The steps from this position up are never reached (SKIPPED): the chain ended here. */
  skipAfter: number | null;
}

/**
 * The chain advances one step at a time: an approval hands over to the next approver (or finishes the request at the last
 * one); a rejection ends it; «اطلب تعديل» sends it back to the requester. Later steps are never decided out of turn.
 */
export function outcomeOf(decision: Decision, position: number, total: number): Outcome {
  if (decision === "APPROVE") {
    return position >= total
      ? { step: "APPROVED", request: "APPROVED", next: null, skipAfter: null }
      : { step: "APPROVED", request: "PENDING", next: position + 1, skipAfter: null };
  }
  if (decision === "REJECT") return { step: "REJECTED", request: "REJECTED", next: null, skipAfter: position };
  return { step: "CHANGES_REQUESTED", request: "CHANGES_REQUESTED", next: null, skipAfter: position };
}

/** A written reason, tidied: white space collapsed, ends trimmed. */
export function tidyReason(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The reason a written reason is refused (a key); `null` = fine. Needed to reject and to ask for changes. */
export function reasonProblem(decision: Decision, reason: string | null | undefined): string | null {
  const text = tidyReason(reason ?? "");
  if (decision === "APPROVE") return text.length > APPROVAL_LIMITS.reason ? "approvals.e.reason_long" : null;
  if (!text) return decision === "REJECT" ? "approvals.e.reason_required" : "approvals.e.changes_required";
  return text.length > APPROVAL_LIMITS.reason ? "approvals.e.reason_long" : null;
}

/** The earlier content of a request, kept when it is sent back and resubmitted. */
export interface RevisionSnapshot {
  version: number;
  title: string;
  details: string;
  amountMinor: number | null;
  currency: string | null;
  answers: unknown;
  submittedAt: string;
}

/** Reads the stored `history` column defensively: anything that is not a well-formed snapshot is dropped. */
export function readHistory(raw: unknown): RevisionSnapshot[] {
  if (!Array.isArray(raw)) return [];
  const out: RevisionSnapshot[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r["version"] !== "number" || typeof r["title"] !== "string") continue;
    out.push({
      version: r["version"],
      title: r["title"],
      details: typeof r["details"] === "string" ? r["details"] : "",
      amountMinor: typeof r["amountMinor"] === "number" ? r["amountMinor"] : null,
      currency: typeof r["currency"] === "string" ? r["currency"] : null,
      answers: r["answers"] ?? null,
      submittedAt: typeof r["submittedAt"] === "string" ? r["submittedAt"] : "",
    });
  }
  return out;
}

/** The three lists of the page, by name (anything else is «طلباتي»). */
export function viewOf(value: string | null | undefined): ApprovalView {
  return (VIEWS as readonly string[]).includes(value ?? "") ? (value as ApprovalView) : "mine";
}
