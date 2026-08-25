import { describe, expect, it } from "vitest";

import { PORTFOLIO_CASE_URL, portfolioReturnHref } from "./portfolio-return";

describe("作品集返回入口", () => {
  it("只在作品集来源参数存在时返回案例页地址", () => {
    expect(portfolioReturnHref("?from=portfolio", "heritage.jiajiajiang.com")).toBe(PORTFOLIO_CASE_URL);
    expect(portfolioReturnHref("?from=portfolio", "127.0.0.1")).toBe("http://127.0.0.1:8765/%E5%8F%A4%E5%BB%BA%E4%BF%9D%E6%8A%A4%E5%BD%92%E6%A1%A3%E4%BA%A7%E5%93%81%E8%AF%A6%E6%83%85%E9%A1%B5_20260802/index.html#product-tour");
    expect(portfolioReturnHref("?from=readme")).toBeNull();
    expect(portfolioReturnHref("")).toBeNull();
  });
});
