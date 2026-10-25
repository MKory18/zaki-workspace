import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activeOrgCtx: vi.fn(), listDms: vi.fn(), openDm: vi.fn(), createGroup: vi.fn(), currentSpace: vi.fn(),
}));
// the space the person is in (its DMs are listed, a new DM is opened there)
vi.mock("@/server/services/current-space", () => ({ currentSpace: mocks.currentSpace }));
vi.mock("@/server/services/integrations", () => ({ activeOrgCtx: mocks.activeOrgCtx }));
vi.mock("@/server/chat/dm", () => ({ listDms: mocks.listDms, openDm: mocks.openDm, createGroup: mocks.createGroup }));

import { GET, POST } from "../src/app/api/chat/conversations/route";

describe("legacy conversations route adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeOrgCtx.mockResolvedValue({ orgId: "org-1", userId: "user-1" });
    mocks.listDms.mockResolvedValue([{ id: "dm-1" }]);
    mocks.openDm.mockResolvedValue({ id: "dm-1", created: true });
    mocks.createGroup.mockResolvedValue({ id: "group-1" });
    mocks.currentSpace.mockResolvedValue({ id: "space-1", name: "A", emoji: null, kind: "STANDARD", manager: false });
  });

  it("returns legacy conversations envelope from the new DM listing service", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ conversations: [{ id: "dm-1" }] });
    expect(mocks.listDms).toHaveBeenCalledWith({ orgId: "org-1", userId: "user-1" }, "space-1");
  });

  it("opens DMs with the new service while preserving 201 {id} contract", async () => {
    const response = await POST(new Request("http://local/api/chat/conversations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "DM", userId: "user-2" }) }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: "dm-1" });
    expect(mocks.openDm).toHaveBeenCalledWith({ orgId: "org-1", userId: "user-1" }, "user-2", "space-1");
  });

  it("creates groups with the new service while preserving 201 {id} contract", async () => {
    const input = { kind: "GROUP", title: "فريق العمل", memberIds: ["user-2"], emoji: "🌿" };
    const response = await POST(new Request("http://local/api/chat/conversations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: "group-1" });
    expect(mocks.createGroup).toHaveBeenCalledWith({ orgId: "org-1", userId: "user-1" }, { title: "فريق العمل", memberIds: ["user-2"], emoji: "🌿" });
  });
});
