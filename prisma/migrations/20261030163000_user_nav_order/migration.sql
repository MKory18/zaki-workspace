-- «ترتيبي»: each person's own order of the menu's places and of the tabs inside each place.
--
-- One NEW nullable column on "User": NULL means "the code's order", which is what every account has today, so
-- nothing existing changes and no row needs a backfill. The value is { "places": [..], "tabs": { "<place>": [..] } },
-- validated by the application (src/lib/nav/order.ts); an entry the code no longer knows is ignored on read.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "navOrder" JSONB;
