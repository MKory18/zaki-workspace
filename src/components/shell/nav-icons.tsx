import { BarChart3, Building2, Circle, House, Library, ListChecks, MessageCircle, Send, Settings, Users, Workflow, type LucideIcon } from "lucide-react";
import type { NavIconKey } from "@/lib/nav/places";

/**
 * The drawing of each place. The map (src/lib/nav/places.ts) names an icon and never holds a component,
 * so it can travel from the server to the browser as plain data; this is where a name becomes a picture.
 * An icon is decoration: the label beside it (or the link's name) says what it is.
 */
const ICONS: Readonly<Record<NavIconKey, LucideIcon>> = {
  today: House,
  chat: MessageCircle,
  work: ListChecks,
  library: Library,
  admin: Building2,
  team: Users,
  reports: BarChart3,
  automation: Workflow,
  telegram: Send,
  settings: Settings,
};

export function NavIcon({ icon, className }: { icon: NavIconKey; className?: string }) {
  const Icon = ICONS[icon] ?? Circle;
  return <Icon aria-hidden="true" className={className} />;
}
