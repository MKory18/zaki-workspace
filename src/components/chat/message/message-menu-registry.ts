export type MessageMenuAction = { id: string; label: string; available?: (context: { mine: boolean; canModerate: boolean }) => boolean };
export const messageMenuItems: MessageMenuAction[] = [
  { id: "reply", label: "رد" }, { id: "react", label: "تفاعل" }, { id: "pin", label: "تثبيت", available: c => c.canModerate },
  { id: "forward", label: "تحويل" }, { id: "edit", label: "تعديل", available: c => c.mine },
  { id: "delete", label: "حذف", available: c => c.mine || c.canModerate }, { id: "note", label: "ملاحظة داخلية", available: c => c.canModerate }, { id: "copy", label: "نسخ" },
];
