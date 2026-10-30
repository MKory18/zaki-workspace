-- «ترتيب»: a person's own order of their chat list (their topics per space, their private chats).
--
-- ONE new table; nothing existing is altered, so this is safe on a database that already has rows: the table
-- is empty and every constraint is on it alone. `order` is a JSON array of conversation ids (the service
-- keeps it to 500 and only ids the person may read); `scope` is "space:<id>", "dm" or "dm:<id>".

-- CreateTable
CREATE TABLE "UserChatOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "order" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserChatOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserChatOrder_userId_orgId_scope_key" ON "UserChatOrder"("userId", "orgId", "scope");

-- AddForeignKey
ALTER TABLE "UserChatOrder" ADD CONSTRAINT "UserChatOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserChatOrder" ADD CONSTRAINT "UserChatOrder_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
