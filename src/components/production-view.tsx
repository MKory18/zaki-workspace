"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, CheckSquare, ChevronLeft, ChevronRight, Cog, Factory, Plus, Square, Trash2, Pencil } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

function errText(err: unknown, t: (k: string) => string): string {
	if (err instanceof ApiError && err.messageKey) {
		const x = t(err.messageKey);
		return x !== err.messageKey ? x : t("common.error");
	}
	return t("common.error");
}

interface ChecklistItem {
	id: string;
	title: string;
	description: string | null;
	departmentName: string | null;
	assigneeId: string | null;
	assigneeName: string | null;
	doneAt: string | null;
}

interface RoutineRow {
	id: string;
	title: string;
	description: string | null;
	departmentId: string | null;
	departmentName: string | null;
	assigneeId: string | null;
	assigneeName: string | null;
	weekdays: string;
	active: boolean;
}

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function dayIso(d: Date): string {
	const m = d.getMonth() + 1;
	const day = d.getDate();
	return d.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (day < 10 ? "0" + day : day);
}

function shiftDay(s: string, delta: number): string {
	const p = s.split("-");
	const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12);
	d.setDate(d.getDate() + delta);
	const m = d.getMonth() + 1;
	const dd = d.getDate();
	return d.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (dd < 10 ? "0" + dd : dd);
}

function dayLabel(day: string, locale: string): string {
	const p = day.split("-");
	const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12);
	const AR = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
	const FR = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
	const EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
	const MO = {
		ar: ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"],
		fr: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
		en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
	}[locale] ?? [];
	const wd = { ar: AR, fr: FR, en: EN }[locale] ?? AR;
	return wd[d.getDay()] + " " + d.getDate() + " " + (MO[d.getMonth()] ?? "") + " " + d.getFullYear();
}

/** الإنتاج اليومي — recurring daily-production checklist with per-day completion. */
/** `readOnly`: an external partner (guest) sees the checklist but cannot tick anything (the server refuses too). */
export function ProductionView({ canManage, readOnly = false }: { canManage: boolean; readOnly?: boolean }) {
	const { t, locale } = useI18n();
	const { toast } = useToast();
	const qc = useQueryClient();
	const [day, setDay] = useState(() => dayIso(new Date()));
	const [manageOpen, setManageOpen] = useState(false);

	const checklist = useQuery({
		queryKey: ["production", "checklist", day],
		queryFn: () => apiGet<{ day: string; items: ChecklistItem[] }>(`/api/production?day=${day}`),
	});

	const routines = useQuery({
		queryKey: ["production", "routines"],
		queryFn: () => apiGet<{ routines: RoutineRow[] }>("/api/production/routines"),
		enabled: canManage && manageOpen,
	});

	const directory = useQuery({
		queryKey: ["ws-directory"],
		queryFn: () => apiGet<{ people: { userId: string; user: { id: string; name: string } }[] }>("/api/chat/directory"),
		enabled: canManage && manageOpen,
	});

	const toggle = useMutation({
		mutationFn: ({ routineId, done }: { routineId: string; done: boolean }) =>
			apiPost("/api/production/checklist", { routineId, day, done }),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["production", "checklist", day] }),
		onError: (err) => toast(errText(err, t), "error"),
	});

	const items = checklist.data?.items ?? [];
	const doneCount = items.filter((i) => i.doneAt).length;

	return (
		<div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
			<header className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="flex items-center gap-2 text-lg font-semibold text-fg">
						<Factory className="size-5 text-accent" />
						{t("prod.title")}
					</h1>
					<p className="text-xs text-fg-muted">{t("prod.subtitle")}</p>
				</div>
				{canManage ? (
					<Button size="sm" variant="secondary" onClick={() => setManageOpen(true)}>
						<Cog className="size-4" />
						{t("prod.manage")}
					</Button>
				) : null}
			</header>

			<div className="flex items-center justify-between rounded-xl border border-border bg-surface px-3 py-2 shadow-card">
				<Button size="sm" variant="ghost" aria-label={t("prod.prevDay")} onClick={() => setDay(shiftDay(day, -1))}>
					<ChevronRight className="size-4 rtl:rotate-0 ltr:rotate-180" />
				</Button>
				<div className="text-center">
					<p className="text-sm font-semibold text-fg">{dayLabel(day, locale)}</p>
					<p className="text-[11px] text-muted">
						{items.length > 0 ? `${doneCount}/${items.length} ${t("prod.doneRatio")}` : t("prod.noSchedule")}
					</p>
				</div>
				<Button size="sm" variant="ghost" aria-label={t("prod.nextDay")} onClick={() => setDay(shiftDay(day, 1))}>
					<ChevronLeft className="size-4 rtl:rotate-0 ltr:rotate-180" />
				</Button>
			</div>

			<div className="h-2 overflow-hidden rounded-full bg-surface-2">
				<div
					className="h-2 rounded-full bg-accent transition-all"
					style={{ width: items.length > 0 ? `${(doneCount / items.length) * 100}%` : "0%" }}
				/>
			</div>

			<ul className="space-y-2">
				{items.map((item) => {
					const done = item.doneAt != null;
					return (
						<li
							key={item.id}
							className={cn(
								"flex items-center gap-3 rounded-xl border border-border bg-surface p-3 shadow-card transition-colors",
								done && "border-emerald-500/40 bg-emerald-500/5",
							)}
						>
							<button
								aria-label={done ? t("prod.uncheck") : t("prod.check")}
								disabled={toggle.isPending || readOnly}
								onClick={() => toggle.mutate({ routineId: item.id, done: !done })}
								className="shrink-0"
							>
								{done ? (
									<CheckSquare className="size-5 text-emerald-500" />
								) : (
									<Square className="size-5 text-muted hover:text-accent" />
								)}
							</button>
							<div className="min-w-0 flex-1">
								<p className={cn("truncate text-sm font-medium", done ? "text-muted line-through" : "text-fg")}>
									{item.title}
								</p>
								<p className="truncate text-[11px] text-muted">
									{item.assigneeName ? `${t("prod.assignedTo")} ${item.assigneeName}` : t("prod.unassigned")}
									{item.departmentName ? ` · ${item.departmentName}` : ""}
								</p>
							</div>
							{item.doneAt ? (
								<span className="flex shrink-0 items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
									<CalendarCheck className="size-3.5" />
									{t("prod.done")}
								</span>
							) : null}
						</li>
					);
				})}
				{items.length === 0 ? (
					<li className="rounded-xl border border-border bg-surface-1 px-4 py-8 text-center text-sm text-muted">
						{t("prod.noSchedule")}
					</li>
				) : null}
			</ul>

			{canManage && manageOpen ? (
				<ManageRoutinesModal
					open
					onClose={() => setManageOpen(false)}
					routines={routines.data?.routines ?? []}
					loading={routines.isLoading}
					people={(directory.data?.people ?? []).map((p) => ({ id: p.userId, name: p.user.name }))}
				/>
			) : null}
		</div>
	);
}

function ManageRoutinesModal({
	open,
	onClose,
	routines,
	loading,
	people,
}: {
	open: boolean;
	onClose: () => void;
	routines: RoutineRow[];
	loading: boolean;
	people: { id: string; name: string }[];
}) {
	const { t } = useI18n();
	const { toast } = useToast();
	const qc = useQueryClient();
	const [editing, setEditing] = useState<RoutineRow | "new" | null>(null);

	const invalidate = () => {
		qc.invalidateQueries({ queryKey: ["production", "routines"] });
		qc.invalidateQueries({ queryKey: ["production", "checklist"] });
	};

	const remove = useMutation({
		mutationFn: (id: string) => apiDelete(`/api/production/routines/${id}`),
		onSuccess: () => {
			toast(t("prod.routineDeleted"), "success");
			invalidate();
		},
		onError: (err) => toast(errText(err, t), "error"),
	});

	return (
		<Modal open={open} onClose={onClose} title={t("prod.manageTitle")}>
			<div className="space-y-3">
				<Button
					size="sm"
					onClick={() => setEditing("new")}
					className="w-full"
				>
					<Plus className="size-4" />
					{t("prod.newRoutine")}
				</Button>
				<ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
					{routines.map((r) => (
						<li key={r.id} className="flex items-center gap-2 px-3 py-2">
							<div className="min-w-0 flex-1">
								<p className="truncate text-xs font-medium text-fg">{r.title}</p>
								<p className="truncate text-[10px] text-muted">
									{r.weekdays === "" ? t("prod.everyDay") : r.weekdays.split(",").map((w) => t(`prod.wd_${WEEKDAY_KEYS[Number(w)]}`)).join(" · ")}
									{r.assigneeName ? ` · ${r.assigneeName}` : ""}
									{!r.active ? ` · ${t("prod.paused")}` : ""}
								</p>
							</div>
							<Button size="sm" variant="ghost" aria-label={t("prod.editRoutine")} onClick={() => setEditing(r)}>
								<Pencil className="size-3.5" />
							</Button>
							<Button
								size="sm"
								variant="ghost"
								aria-label={t("prod.deleteRoutine")}
								className="text-red-500"
								onClick={() => remove.mutate(r.id)}
							>
								<Trash2 className="size-3.5" />
							</Button>
						</li>
					))}
					{loading ? <li className="px-3 py-3 text-xs text-muted">…</li> : null}
					{!loading && routines.length === 0 ? (
						<li className="px-3 py-4 text-center text-[11px] text-muted">{t("prod.noRoutines")}</li>
					) : null}
				</ul>
				{editing ? (
					<RoutineEditor
						routine={editing === "new" ? null : editing}
						people={people}
						onClose={() => setEditing(null)}
					/>
				) : null}
			</div>
		</Modal>
	);
}

function RoutineEditor({
	routine,
	people,
	onClose,
}: {
	routine: RoutineRow | null;
	people: { id: string; name: string }[];
	onClose: () => void;
}) {
	const { t } = useI18n();
	const { toast } = useToast();
	const qc = useQueryClient();
	const [title, setTitle] = useState(routine?.title ?? "");
	const [description, setDescription] = useState(routine?.description ?? "");
	const [assigneeId, setAssigneeId] = useState(routine?.assigneeId ?? "");
	const [weekdays, setWeekdays] = useState<string[]>(
		routine
			? routine.weekdays === ""
				? [...WEEKDAY_KEYS]
				: routine.weekdays.split(",").map((w) => WEEKDAY_KEYS[Number(w)] ?? "mon")
			: [...WEEKDAY_KEYS],
	);
	const [active, setActive] = useState(routine ? routine.active : true);

	const save = useMutation({
		mutationFn: (payload: Record<string, unknown>) =>
			routine ? apiPatch(`/api/production/routines/${routine.id}`, payload) : apiPost("/api/production/routines", payload),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["production"] });
			toast(t("prod.saved"), "success");
			onClose();
		},
		onError: (err) => toast(errText(err, t), "error"),
	});

	const toggleDay = (key: string) => {
		setWeekdays((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
	};

	return (
		<div className="rounded-lg border border-border bg-surface-1 p-3">
			<p className="mb-2 text-xs font-semibold text-fg">{routine ? t("prod.editRoutineTitle") : t("prod.newRoutineTitle")}</p>
			<form
				className="space-y-2"
				onSubmit={(e) => {
					e.preventDefault();
					const payload: Record<string, unknown> = {
						title: title.trim(),
						description: description || null,
						assigneeId: assigneeId || null,
						weekdays: weekdays.map((k) => WEEKDAY_KEYS.indexOf(k)),
						active,
					};
					save.mutate(payload);
				}}
			>
				<Input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} maxLength={120} placeholder={t("prod.routineTitle")} />
				<Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("prod.routineDesc")} />
				<div className="flex flex-wrap gap-1">
					{WEEKDAY_KEYS.map((k) => (
						<button
							key={k}
							type="button"
							onClick={() => toggleDay(k)}
							className={cn(
								"rounded-md border px-2 py-1 text-[10px] font-medium transition-colors",
								weekdays.includes(k) ? "border-accent/60 bg-accent/10 text-fg" : "border-border text-muted hover:border-accent/40",
							)}
						>
							{t(`prod.wd_${k}`)}
						</button>
					))}
				</div>
				<Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
					<option value="">{t("ticket.unassigned")}</option>
					{people.map((p) => (
						<option key={p.id} value={p.id}>
							{p.name}
						</option>
					))}
				</Select>
				<label className="flex items-center gap-2 text-xs text-fg">
					<input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
					{t("prod.active")}
				</label>
				<div className="flex justify-end gap-2 pt-1">
					<Button type="button" variant="ghost" size="sm" onClick={onClose}>
						{t("common.cancel")}
					</Button>
					<Button type="submit" size="sm" disabled={save.isPending}>
						{t("common.save")}
					</Button>
				</div>
			</form>
		</div>
	);
}
