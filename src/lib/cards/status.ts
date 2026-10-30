/**
 * «حالة الاعتماد» of a card: مسودة → قيد المراجعة → معتمدة → مؤرشفة. Pure: the server decides with it, the screen draws
 * only the moves the server would accept. It is NOT the card's «حذف» (`archivedAt`): a card marked «مؤرشفة» is still on
 * the board, only labelled; a deleted card is gone from sight.
 *
 * Only a space moderator (the space's ADMIN, an org ADMIN who is in the space) or the OWNER moves the status.
 */

export const CARD_STATUSES = ["DRAFT", "REVIEW", "APPROVED", "ARCHIVED"] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

export function isCardStatus(v: unknown): v is CardStatus {
  return typeof v === "string" && (CARD_STATUSES as readonly string[]).includes(v);
}

/** A stored value read back as a status (anything unknown is a draft). */
export function statusOf(raw: unknown): CardStatus {
  return isCardStatus(raw) ? raw : "DRAFT";
}

/** Where each status may go. An approved card is reopened through «قيد المراجعة», never straight to a draft. */
const MOVES: Record<CardStatus, readonly CardStatus[]> = {
  DRAFT: ["REVIEW", "ARCHIVED"],
  REVIEW: ["DRAFT", "APPROVED", "ARCHIVED"],
  APPROVED: ["REVIEW", "ARCHIVED"],
  ARCHIVED: ["DRAFT"],
};

/** The statuses this person may move a card from `from` to (none unless they moderate the space). */
export function allowedStatusMoves(from: CardStatus, who: { moderator: boolean }): CardStatus[] {
  return who.moderator ? [...MOVES[from]] : [];
}

export function canMoveStatus(from: CardStatus, to: CardStatus, who: { moderator: boolean }): boolean {
  return allowedStatusMoves(from, who).includes(to);
}
