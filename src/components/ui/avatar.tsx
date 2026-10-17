import { avatarHue, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Initials avatar with a deterministic per-name hue. */
export function Avatar({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const hue = avatarHue(name);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white",
        className,
      )}
      style={{ backgroundColor: `hsl(${hue}, 55%, 45%)` }}
    >
      {initials(name)}
    </span>
  );
}
