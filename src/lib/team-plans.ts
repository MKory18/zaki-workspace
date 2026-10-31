/** «خطة التطوير» and «ملاحظات ١:١» — the limits, in one place for the services, the forms and the tests. */
export const PLAN_LIMITS = {
  title: 120,
  actions: 500,
  /** A 1:1 note. */
  note: 1000,
  /** Goals per person, every status (nothing is deleted, so this is what bounds the table). */
  maxGoals: 100,
} as const;
