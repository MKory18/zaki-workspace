"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, ChevronLeft, ChevronRight, Pencil, Plus, Target, Trash2 } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { fmtShort, monthName } from "@/lib/format";
import { cn } from "@/lib/utils";

function errText(err: unknown, t: (k: string) => string): string {
	if (err instanceof ApiError && err.messageKey) {
		const x = t(err.messageKey);
		return x !== err.messageKey ? x : t("common.error");
	}
	return t("common.error");
}

interface GoalRow {
	id: string;
	title: string;
	description: string | null;
	period: "WEEKLY" | "MONTHLY";
	periodStart: string;
	periodEnd: string;
	progress: number;
	departmentId: string | null;
	departmentName: string | null;
	creatorName: string;
}

function shiftPeriod(period: "WEEKLY" | "MONTHLY", iso: string, delta: number): string {
	const p = iso.split("-").map(Number);
	const d = new Date(p[0]!, p[1]! - 1, p[2]!, 12);
	if (period === "WEEKLY") {
		d.setDate(d.getDate() + delta * 7);
	} else {
		d.setMonth(d.getMonth() + delta);
	}
	const m = d.getMonth() + 1;
	const dd = d.getDate();
	return d.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (dd < 10 ? "0" + dd : dd);
}

function inPeriod(goal: GoalRow, iso: string): boolean {
	const p = iso.split("-").map(Number);
	const day = new Date(p[0]!, p[1]! - 1, p[2]!, 12).getTime();
	return day >= new Date(goal.periodStart).getTime() && day <= new Date(goal.periodEnd).getTime();
}

function periodLabel(period: "WEEKLY" | "MONTHLY", iso: string): string {
	const p = iso.split("-").map(Number);
	const d = new Date(p[0]!, p[1]! - 1, p[2]!, 12);
	if (period === "MONTHLY") {
		return monthName(d.getMonth()) + " " + d.getFullYear();
	}
	const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay(), 12);
	const end = new Date(start.getTime() + 6 * 24 * 3600 * 1000);
	return fmtShort(start) + " — " + fmtShort(end);
}

/** الأهداف الأسبوعية والشهرية — period goals with live progress. */
/** `canManage`: the goals box «يضيف ويعدّل»; `canDelete`: «يحذف» (absent: as `canManage`). */
export function GoalsView({ canManage, canDelete = canManage }: { canManage: boolean; canDelete?: boolean }) {
	const { t } = useI18n();
	const { toast } = useToast();
	const qc = useQueryClient();
	const [period, setPeriod] = useState<"WEEKLY" | "MONTHLY">("WEEKLY");
	const [anchor, setAnchor] = useState(() => {
		const d = new Date();
		const m = d.getMonth() + 1;
		const dd = d.getDate();
		return d.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (dd < 10 ? "0" + dd : dd);
	});
	const [editing, setEditing] = useState<GoalRow | "new" | null>(null);

	const goals = useQuery({
		queryKey: ["goals"],
		queryFn: () => apiGet<{ goals: GoalRow[] }>("/api/goals"),
	});

	const invalidate = () => qc.invalidateQueries({ queryKey: ["goals"] });

	const remove = useMutation({
		mutationFn: (id: string) => apiDelete(`/api/goals/${id}`),
		onSuccess: () => {
			toast(t("goal.deleted"), "success");
			invalidate();
		},
		onError: (err) => toast(errText(err, t), "error"),
	});

	const progress = useMutation({
		mutationFn: ({ id, progress }: { id: string; progress: number }) =>
			apiPatch(`/api/goals/${id}`, { progress }),
		onSuccess: () => invalidate(),
		onError: (err) => toast(errText(err, t), "error"),
	});

	const inView = (goals.data?.goals ?? []).filter((g) => g.period === period && inPeriod(g, anchor));

	return (
		<div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
			<header className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="flex items-center gap-2 text-lg font-semibold text-fg">
						<Target className="size-5 text-accent" />
						{t("goal.title")}
					</h1>
					<p className="text-xs text-fg-muted">{t("goal.subtitle")}</p>
				</div>
				{canManage ? (
					<Button size="sm" onClick={() => setEditing("new")}>
						<Plus className="size-4" />
						{t("goal.new")}
					</Button>
				) : null}
			</header>

			<div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3 py-2 shadow-card">
				<div className="flex items-center gap-1 rounded-lg bg-surface-2 p-0.5">
					{(["WEEKLY", "MONTHLY"] as const).map((p) => (
						<button
							key={p}
							type="button"
							onClick={() => setPeriod(p)}
							className={cn(
								"rounded-md px-3 py-1 text-xs font-medium transition-colors",
								period === p ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg",
							)}
						>
							{t(p === "WEEKLY" ? "goal.weekly" : "goal.monthly")}
						</button>
					))}
				</div>
				<div className="flex items-center gap-2">
					<Button size="sm" variant="ghost" aria-label={t("goal.prev")} onClick={() => setAnchor(shiftPeriod(period, anchor, -1))}>
						<ChevronRight className="size-4 rtl:rotate-0 ltr:rotate-180" />
					</Button>
					<span className="flex items-center gap-1.5 text-sm font-semibold text-fg">
						<CalendarRange className="size-4 text-accent" />
						{periodLabel(period, anchor)}
					</span>
					<Button size="sm" variant="ghost" aria-label={t("goal.next")} onClick={() => setAnchor(shiftPeriod(period, anchor, 1))}>
						<ChevronLeft className="size-4 rtl:rotate-0 ltr:rotate-180" />
					</Button>
				</div>
			</div>

			{inView.length === 0 ? (
				<p className="rounded-xl border border-border bg-surface-1 px-4 py-8 text-center text-sm text-muted">
					{t("goal.none")}
				</p>
			) : (
				<ul className="space-y-3">
					{inView.map((g) => {
						const achieved = g.progress >= 100;
						return (
							<li key={g.id} className="rounded-xl border border-border bg-surface p-4 shadow-card">
								<div className="flex flex-wrap items-start justify-between gap-2">
									<div className="min-w-0 flex-1">
										<p className={cn("text-sm font-semibold", achieved ? "text-ok" : "text-fg")}>
											{g.title}
										</p>
										{g.description ? <p className="mt-0.5 text-xs text-muted">{g.description}</p> : null}
										<p className="mt-0.5 text-xs text-muted">
											{g.departmentName ? g.departmentName + " · " : ""}
											{periodLabel(g.period, g.periodStart.slice(0, 10))}
										</p>
									</div>
									<div className="flex shrink-0 items-center gap-1">
										{achieved ? (
											<span className="rounded-full bg-ok/10 px-2 py-0.5 text-xs font-semibold text-ok">
												{t("goal.achieved")}
											</span>
										) : null}
										{canManage ? (
											<>
												<Button size="sm" variant="ghost" aria-label={t("goal.edit")} onClick={() => setEditing(g)}>
													<Pencil className="size-3.5" />
												</Button>
												{canDelete ? (
													<Button
														size="sm"
														variant="ghost"
														aria-label={t("goal.remove")}
														className="text-danger"
														onClick={() => {
															if (confirm(t("goal.removeConfirm", { title: g.title }))) remove.mutate(g.id);
														}}
													>
														<Trash2 className="size-3.5" />
													</Button>
												) : null}
											</>
										) : null}
									</div>
								</div>
								<div className="mt-2 flex items-center gap-3">
									<div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
										<div
											className={cn("h-2.5 rounded-full transition-all", achieved ? "bg-ok" : "bg-accent")}
											style={{ width: `${g.progress}%` }}
										/>
									</div>
									<span className="w-10 text-end text-xs font-semibold text-fg">{g.progress}%</span>
								</div>
								{canManage ? (
									<input
										type="range"
										min={0}
										max={100}
										value={g.progress}
										onChange={(e) => {
											const v = Number(e.target.value);
											progress.mutate({ id: g.id, progress: v });
										}}
										className="mt-2 w-full accent-[var(--accent)]"
										aria-label={t("goal.progress")}
									/>
								) : null}
							</li>
						);
					})}
				</ul>
			)}

			{editing ? (
				<GoalEditor
					goal={editing === "new" ? null : editing}
					defaultAnchor={anchor}
					defaultPeriod={period}
					onClose={() => setEditing(null)}
				/>
			) : null}
		</div>
	);
}

function GoalEditor({
	goal,
	defaultAnchor,
	defaultPeriod,
	onClose,
}: {
	goal: GoalRow | null;
	defaultAnchor: string;
	defaultPeriod: "WEEKLY" | "MONTHLY";
	onClose: () => void;
}) {
	const { t } = useI18n();
	const { toast } = useToast();
	const qc = useQueryClient();
	const [title, setTitle] = useState(goal?.title ?? "");
	const [description, setDescription] = useState(goal?.description ?? "");
	const [period, setPeriod] = useState<string>(goal?.period ?? defaultPeriod);
	const [anchorDate, setAnchorDate] = useState(goal ? goal.periodStart.slice(0, 10) : defaultAnchor);
	const [progress, setProgress] = useState(goal?.progress ?? 0);

	const save = useMutation({
		mutationFn: (payload: Record<string, unknown>) =>
			goal ? apiPatch(`/api/goals/${goal.id}`, payload) : apiPost("/api/goals", payload),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["goals"] });
			toast(t("goal.saved"), "success");
			onClose();
		},
		onError: (err) => toast(errText(err, t), "error"),
	});

	return (
		<Modal open onClose={onClose} title={goal ? t("goal.editTitle") : t("goal.newTitle")}>
			<form
				className="space-y-3"
				onSubmit={(e) => {
					e.preventDefault();
					const payload: Record<string, unknown> = {
						title: title.trim(),
						description: description || null,
						period,
						anchorDate,
					};
					if (goal) payload.progress = progress;
					else payload.progress = 0;
					save.mutate(payload);
				}}
			>
				<Input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} maxLength={160} placeholder={t("goal.titlePlaceholder")} />
				<Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder={t("goal.descPlaceholder")} />
				<div className="grid grid-cols-2 gap-2">
					<label className="block space-y-1">
						<span className="text-xs font-medium text-fg-muted">{t("goal.periodLabel")}</span>
						<Select value={period} onChange={(e) => setPeriod(e.target.value)}>
							<option value="WEEKLY">{t("goal.weekly")}</option>
							<option value="MONTHLY">{t("goal.monthly")}</option>
						</Select>
					</label>
					<label className="block space-y-1">
						<span className="text-xs font-medium text-fg-muted">{t("goal.anchorLabel")}</span>
						<Input type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} className="h-8" />
					</label>
				</div>
				{goal ? (
					<label className="block space-y-1">
						<span className="text-xs font-medium text-fg-muted">{t("goal.progress")}: {progress}%</span>
						<input
							type="range"
							min={0}
							max={100}
							value={progress}
							onChange={(e) => setProgress(Number(e.target.value))}
							className="w-full accent-[var(--accent)]"
						/>
					</label>
				) : null}
				<div className="flex justify-end gap-2 pt-1">
					<Button type="button" variant="ghost" size="sm" onClick={onClose}>
						{t("common.cancel")}
					</Button>
					<Button type="submit" size="sm" disabled={save.isPending}>
						{t("common.save")}
					</Button>
				</div>
			</form>
		</Modal>
	);
}
