-- Two new stages of an idea (the owner's ask: ideas are shared, planned and launched): PLANNING and LAUNCHED.
-- An enum value is added alone in its own migration.
ALTER TYPE "IdeaStatus" ADD VALUE 'PLANNING';
ALTER TYPE "IdeaStatus" ADD VALUE 'LAUNCHED';
