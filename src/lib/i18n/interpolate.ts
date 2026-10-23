/**
 * Fills the `{name}` placeholders of a translated string in ONE pass.
 *
 * - A replacer FUNCTION is used on purpose: with a plain replacement string, `$&`, `$1` or `$$`
 *   inside a value (a person's name, a temporary password) would be read as replacement patterns
 *   and change what the person sees.
 * - One pass over the template means a value that happens to look like `{other}` is never filled
 *   in a second time.
 * - A placeholder without a value stays as written.
 */
export function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{([^{}]+)\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : whole,
  );
}
