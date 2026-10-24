-- «الأرقام: 123 / ١٢٣» («نجمة وطريق», 2026-10-24): a person's choice of digit shapes, kept like the theme so it
-- follows them to every device. ONE new column with a default: additive only, nothing existing is read,
-- rewritten or dropped; every existing row reads "latin", which is what everybody sees today.
ALTER TABLE "User" ADD COLUMN "digits" TEXT NOT NULL DEFAULT 'latin';
