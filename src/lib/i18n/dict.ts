import base from "./ar.json";
import accounts from "./ar.accounts.json";
import policy from "./ar.policy.json";
import onboarding from "./ar.onboarding.json";
import members from "./ar.members.json";
import spaces from "./ar.spaces.json";
import access from "./ar.access.json";
import theme from "./ar.theme.json";
import ui from "./ar.ui.json";
import guide from "./ar.guide.json";
import enums from "./ar.enums.json";
import shell from "./ar.shell.json";
import today from "./ar.today.json";
import errors from "./ar.errors.json";
import chatErrors from "./ar.chat-errors.json";
import chatFiles from "./ar.chat-files.json";
import chatConversation from "./ar.chat-conversation.json";
import chatHome from "./ar.chat-home.json";
import archive from "./ar.archive.json";
import whiteboard from "./ar.whiteboard.json";
import calls from "./ar.calls.json";
import watch from "./ar.watch.json";
import features from "./ar.features.json";
import libraryDrive from "./ar.library-drive.json";
import instant from "./ar.instant.json";
import taskLinks from "./ar.task-links.json";
import milestones from "./ar.milestones.json";
import profileCard from "./ar.profile-card.json";
import navOrder from "./ar.nav-order.json";

/**
 * The Arabic dictionary: `ar.json` plus one fragment per feature (accounts, policy, onboarding,
 * members, spaces, access, theme, ui, guide, enums, shell, today, errors, ...). Fragments exist so that
 * several people can add strings at the same time without editing the same 700-line file; a later
 * fragment wins on a duplicate key (tests/encoding-hygiene fails on duplicates across files, so
 * none are expected).
 */
export const AR: Record<string, string> = {
  ...base,
  ...accounts,
  ...policy,
  ...onboarding,
  ...members,
  ...spaces,
  ...access,
  ...theme,
  ...ui,
  ...guide,
  ...enums,
  ...shell,
  ...today,
  ...errors,
  ...chatErrors,
  ...chatFiles,
  ...chatConversation,
  ...chatHome,
  ...archive,
  ...whiteboard,
  ...calls,
  ...watch,
  ...features,
  ...libraryDrive,
  ...instant,
  ...taskLinks,
  ...milestones,
  ...profileCard,
  ...navOrder,
};
