"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { ApiError, apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { quickTaskBody, TASK_TITLE_MAX, type QuickDue, type TodayQuickAddData } from "@/lib/today";
import { cn } from "@/lib/utils";
import { useNewIntent } from "@/lib/nav/use-new-intent";

type Post = (path: string, body?: unknown) => Promise<unknown>;

/**
 * «إضافة سريعة» at the foot of «مهمّاتي اليوم» («نجمة وطريق»): a dashed line to type a title into and press
 * Enter — the task is YOURS, due TODAY, in your first project with a board (the owner's defaults), so typing is
 * the whole job. «المشروع والموعد» opens the full sheet for the other cases, and so does «جديد» → «مهمّة»
 * (`?new=task`). It sends exactly what the sheet sends (`quickTaskBody`, `POST /api/tasks`) through the same
 * server rules, then refreshes the page so the task is in the list.
 *
 * The field is the tour's hook `quick-add`. With no project that has a board yet there is nothing to add to:
 * only «المشروع والموعد» is shown, and its sheet says so and points to «المشاريع».
 */
export function TodayQuickAdd({ quickAdd, timeZone, post = apiPost }: { quickAdd: TodayQuickAddData; timeZone: string; post?: Post }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  // «جديد» → «مهمّة» lands here with ?new=task
  useNewIntent("task", () => setOpen(true));
  const target = quickAdd.targets[0];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !target) return;
    const body = quickTaskBody(quickAdd, { projectId: target.projectId, title, due: "today", timeZone });
    if (!body) return;
    setPending(true);
    try {
      await post("/api/tasks", body);
      setTitle("");
      toast(t("today.quick.inline_added"), "success");
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiError && err.code === "forbidden" ? t("forbidden") : t("task.createFailed"), "error");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 px-2 pt-2">
      {target ? (
        <form onSubmit={submit} className="min-w-0 flex-1 basis-60">
          <input
            type="text"
            data-tour="quick-add"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={pending}
            maxLength={TASK_TITLE_MAX}
            enterKeyHint="done"
            aria-label={t("today.quick.inline_aria")}
            placeholder={t("today.quick.inline_placeholder")}
            className="min-h-11 w-full rounded-lg border border-dashed border-muted bg-transparent px-3 text-base text-fg placeholder:text-fg-muted transition-colors focus:border-solid focus:border-accent focus:bg-surface-2 disabled:opacity-60 md:text-sm"
          />
        </form>
      ) : null}
      <button
        type="button"
        data-tour={target ? undefined : "quick-add"}
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-accent transition-colors hover:bg-surface-2"
      >
        <Plus className="size-4" aria-hidden="true" />
        {target ? t("today.quick.more") : t("today.quick_add")}
      </button>
      <QuickAddSheet open={open} onOpenChange={setOpen} quickAdd={quickAdd} timeZone={timeZone} />
    </div>
  );
}

/**
 * The sheet itself, apart from the button that opens it. `portal={false}` draws it in place instead of on
 * <body>: for a test that renders on the server, where a portal draws nothing.
 */
export function QuickAddSheet({
  open,
  onOpenChange,
  quickAdd,
  timeZone,
  portal = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quickAdd: TodayQuickAddData;
  timeZone: string;
  portal?: boolean;
}) {
  const { t } = useI18n();
  const ready = quickAdd.targets.length > 0;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent portal={portal}>
        <SheetHeader>
          <SheetTitle>{t("task.new")}</SheetTitle>
          <SheetDescription>{ready ? t("today.quick.assigned_hint") : t("today.quick.no_target_hint")}</SheetDescription>
        </SheetHeader>
        <SheetBody>
          {ready ? (
            <QuickAddForm quickAdd={quickAdd} timeZone={timeZone} onDone={() => onOpenChange(false)} />
          ) : (
            <div className="space-y-3 pb-2">
              <p className="text-sm font-semibold text-fg">{t("today.quick.no_target_title")}</p>
              <Link
                href="/projects"
                className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-accent px-4 text-base font-semibold text-accent-fg hover:opacity-90"
              >
                {t("today.quick.open_projects")}
              </Link>
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

const FIELD = "min-h-11 w-full rounded-lg border-muted bg-surface px-3 text-base text-fg placeholder:text-muted transition-colors focus:border-accent/60";

/**
 * The form inside the sheet. `post` is a parameter only so that a test can stand in for the network. It owns no
 * decision: what is sent is built by `quickTaskBody` (tested on its own), and what is allowed is up to the server.
 */
export function QuickAddForm({ quickAdd, timeZone, onDone, post = apiPost }: { quickAdd: TodayQuickAddData; timeZone: string; onDone: () => void; post?: Post }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState(quickAdd.targets[0]?.projectId ?? "");
  const [due, setDue] = useState<QuickDue>("today");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On a desktop the sheet takes the keyboard the moment it opens. On a phone it must not: the
  // keyboard rising fights the drag-to-dismiss gesture, so focus waits for a tap (item 10).
  const titleRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) titleRef.current?.focus();
  }, []);

  // the space is named beside the project only when the projects are in more than one space
  const manySpaces = new Set(quickAdd.targets.map((x) => x.workspaceId)).size > 1;
  const days: { value: QuickDue; label: string }[] = [
    { value: "today", label: t("time.today") },
    { value: "tomorrow", label: t("time.tomorrow") },
    { value: "none", label: t("today.quick.no_date") },
  ];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const body = quickTaskBody(quickAdd, { projectId, title, due, timeZone });
    if (!body) return;
    setPending(true);
    setError(null);
    try {
      await post("/api/tasks", body);
      toast(t("common.created"), "success");
      router.refresh();
      onDone();
    } catch (err) {
      const message = err instanceof ApiError && err.code === "forbidden" ? t("forbidden") : t("task.createFailed");
      setError(message);
      toast(message, "error");
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 pb-2">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-muted">{t("task.title")}</span>
        <input
          type="text"
          name="title"
          ref={titleRef}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          maxLength={TASK_TITLE_MAX}
          placeholder={t("today.quick.title_placeholder")}
          className={FIELD}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-muted">{t("proj.one")}</span>
        <select name="projectId" value={projectId} onChange={(event) => setProjectId(event.target.value)} className={FIELD}>
          {quickAdd.targets.map((target) => (
            <option key={target.projectId} value={target.projectId}>
              {manySpaces ? `${target.projectName} · ${target.workspaceName}` : target.projectName}
            </option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend className="mb-1 text-xs font-medium text-fg-muted">{t("task.due")}</legend>
        <div className="flex flex-wrap gap-2">
          {days.map((day) => (
            <label
              key={day.value}
              className={cn(
                "inline-flex min-h-11 cursor-pointer items-center rounded-lg border px-4 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
                due === day.value ? "border-accent bg-accent/10 text-fg" : "border-border text-fg-muted hover:bg-surface-2",
              )}
            >
              <input type="radio" name="due" value={day.value} checked={due === day.value} onChange={() => setDue(day.value)} className="sr-only" />
              {day.label}
            </label>
          ))}
        </div>
      </fieldset>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-accent px-4 text-base font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? t("common.saving") : t("today.quick.submit")}
      </button>
    </form>
  );
}
