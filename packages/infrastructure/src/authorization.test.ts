import { describe, expect, it } from "vitest";

import { FormalEnvironmentAuthorization, LocalAuthorization } from "./indexeddb-project-repository.js";

// 实施单元 09 业务规则：签发只能来自正式环境，本机授权拒绝复核签发命令
describe("签发授权", () => {
  it("本机授权拒绝复核签发，其余命令照常", async () => {
    const local = new LocalAuthorization();
    await expect(local.assertAuthorized({ commandType: "RecordReviewSignoff" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(local.assertAuthorized({ commandType: "CommitFacts" })).resolves.toBeUndefined();
  });

  it("正式环境授权放行复核签发", async () => {
    await expect(new FormalEnvironmentAuthorization().assertAuthorized()).resolves.toBeUndefined();
  });
});
