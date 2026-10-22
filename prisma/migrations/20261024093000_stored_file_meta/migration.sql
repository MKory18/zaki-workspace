-- FILES-VOICE (wave 3B): an upload is created BEFORE its message, so the attachment facts
-- the client measured (image width/height, voice durationMs and waveform peaks) must survive
-- on the StoredFile row until `claimUploads` copies them into MessageAttachment. Nullable,
-- additive: no data move, no backfill, NULLs are the default for every existing row.
ALTER TABLE "StoredFile" ADD COLUMN "meta" JSONB;
