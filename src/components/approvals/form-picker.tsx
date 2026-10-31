import Link from "next/link";
import { AR } from "@/lib/i18n/dict";

/** «أو املأ نموذجًا»: the forms of the space, each a link to its filler (a form creates a request with its own preset chain). */
export function FormPicker({ forms }: { forms: { id: string; name: string; description: string | null }[] }) {
  return (
    <section className="space-y-2" data-form-picker>
      <h2 className="text-sm font-semibold text-fg">{AR["approvals.new.or_form"] ?? ""}</h2>
      <ul className="space-y-1">
        {forms.map((f) => (
          <li key={f.id} className="list-none">
            <Link href={`/approvals?fill=${f.id}`} className="block rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-fg hover:bg-surface-2">
              <span className="font-medium">{f.name}</span>
              {f.description ? <span className="block text-xs text-fg-muted">{f.description}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
