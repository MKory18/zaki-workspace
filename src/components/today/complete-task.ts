import { ApiError, apiPost } from "@/lib/api-client";
import { requiredFieldsOf } from "@/lib/custom-fields";

/** Why finishing a task did not work, as the dictionary key of the sentence the person reads. */
export type CompleteResult = { ok: true } | { ok: false; messageKey: "forbidden" | "today.done_no_column" | "today.done_failed" | "fields.required" };

type Post = (path: string, body?: unknown) => Promise<unknown>;

/**
 * Finishes a task through the endpoint that already exists (`POST /api/tasks/<id>/complete`, which moves the
 * task to its board's done column and tells n8n). The server decides who may: a refusal comes back as a 403 and
 * is said as «ليس لديك صلاحية», except the one 403 that is not about the person at all - a board that has no
 * done column to move the task to (`board.no_done_column`) - which says so; anything else (the network, a task
 * that is gone) is «تعذّر إنجاز المهمة».
 * `post` is a parameter only so that a test can stand in for the network.
 */
export async function completeTask(taskId: string, post: Post = apiPost): Promise<CompleteResult> {
  try {
    await post(`/api/tasks/${encodeURIComponent(taskId)}/complete`, { complete: true });
    return { ok: true };
  } catch (err) {
    // «حقول مخصصة»: the project has required fields this task leaves empty (the task's page is where they are filled)
    if (requiredFieldsOf(err)) return { ok: false, messageKey: "fields.required" };
    if (err instanceof ApiError && err.messageKey === "board.no_done_column") return { ok: false, messageKey: "today.done_no_column" };
    return { ok: false, messageKey: err instanceof ApiError && err.code === "forbidden" ? "forbidden" : "today.done_failed" };
  }
}
