export interface MentionQuery {
  query: string;
  /** Index of the `@` token, after any separating whitespace. */
  start: number;
}

/** Find an `@name` query only at the start of a word or after whitespace. */
export function findMentionQuery(value: string): MentionQuery | null {
  const match = /(^|\s)@([^\s@]*)$/.exec(value);
  if (!match) return null;
  const separator = match[1] ?? "";
  return { query: match[2] ?? "", start: match.index + separator.length };
}

/** Replace the active mention query while preserving whitespace before it. */
export function insertMention(value: string, name: string): string {
  const active = findMentionQuery(value);
  if (!active) return value;
  return `${value.slice(0, active.start)}@${name} `;
}

export function selectedMentionIds(value: string, selected: readonly { id: string; name: string }[]): string[] {
  return selected
    .filter(({ name }) => {
      const token = `@${name}`;
      let index = value.indexOf(token);
      while (index >= 0) {
        const before = index === 0 || /\s/.test(value[index - 1] ?? "");
        const next = value[index + token.length];
        const after = next === undefined || /[\s,،.!?؟]/.test(next);
        if (before && after) return true;
        index = value.indexOf(token, index + token.length);
      }
      return false;
    })
    .map(({ id }) => id);
}
