-- «لمين» with more than one person: a request for a person BESIDE the first one (a higher rank than the giver)
-- is marked `asCo`, so that accepting it adds the person to the task's people instead of replacing the main assignee.
-- Additive only: one new column with a DEFAULT, every existing request keeps its meaning (false = the main assignee).

ALTER TABLE "TaskAssignRequest" ADD COLUMN "asCo" BOOLEAN NOT NULL DEFAULT false;
