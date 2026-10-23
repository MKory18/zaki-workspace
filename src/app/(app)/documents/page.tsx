import { redirect } from "next/navigation";

/**
 * "Documents" was an empty «coming soon» page. The library is where a team's files live now, so the
 * old address (/documents) keeps working by sending the visitor there instead of showing a
 * placeholder.
 */
export default function DocumentsPage(): never {
  redirect("/files");
}
