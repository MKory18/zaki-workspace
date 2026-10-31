/**
 * «حقول مخصصة»: finishing a task whose project has required fields that are empty. A 422 `validation.failed` whose
 * `message` is `fields.required` and whose `details.missing` lists the fields (id and label), so the screen can say which
 * ones and open the editor. Lives apart from the service so `withApi` can read it without importing the service.
 */
export class RequiredFieldsError extends Error {
  readonly missing: { id: string; label: string }[];
  constructor(missing: { id: string; label: string }[]) {
    super("fields.required");
    this.name = "RequiredFieldsError";
    this.missing = missing;
  }
}
