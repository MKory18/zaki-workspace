/**
 * One-tap copy («نسخ» on a prompt card). The clipboard API needs a secure page and a tap; where it refuses (an old
 * browser, a webview) a hidden field and `execCommand` are the fallback. Answers whether the text was copied.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the field below */
  }
  try {
    if (typeof document === "undefined") return false;
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.insetInlineStart = "-9999px";
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(field);
    return ok;
  } catch {
    return false;
  }
}
