export const PORTFOLIO_CASE_URL = "https://jiajiajiang.com/%E5%8F%A4%E5%BB%BA%E4%BF%9D%E6%8A%A4%E5%BD%92%E6%A1%A3%E4%BA%A7%E5%93%81%E8%AF%A6%E6%83%85%E9%A1%B5_20260802/index.html#product-tour";
const LOCAL_PORTFOLIO_CASE_URL = "http://127.0.0.1:8765/%E5%8F%A4%E5%BB%BA%E4%BF%9D%E6%8A%A4%E5%BD%92%E6%A1%A3%E4%BA%A7%E5%93%81%E8%AF%A6%E6%83%85%E9%A1%B5_20260802/index.html#product-tour";

export function portfolioReturnHref(search: string, hostname = ""): string | null {
  if (new URLSearchParams(search).get("from") !== "portfolio") return null;
  return hostname === "127.0.0.1" || hostname === "localhost" ? LOCAL_PORTFOLIO_CASE_URL : PORTFOLIO_CASE_URL;
}
