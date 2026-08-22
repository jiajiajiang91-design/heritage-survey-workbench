// 模型单价表。此前运行账本一律写费用待核算，理由是没有可靠单价依据；
// 单价是公开的，去官网取即可，不构成理由。
//
// 取值方式：按 provider 加 model 精确匹配。表里没有的模型不估算，如实写明，
// 不拿别的模型的单价顶替。缓存命中的输入按另一档计价，用量记录里带 cachedTokens，
// 不折算成命中价会把费用算高。

export interface ModelPrice {
  readonly provider: string;
  readonly model: string;
  readonly currency: "USD";
  /** 每百万输入 token，缓存未命中 */
  readonly inputPerMillion: number;
  /** 每百万输入 token，缓存命中 */
  readonly cachedInputPerMillion: number;
  /** 每百万输出 token */
  readonly outputPerMillion: number;
  /** 单价出处，写清是哪一页、什么时候取的 */
  readonly sourceZh: string;
}

export const MODEL_PRICES: readonly ModelPrice[] = [
  {
    provider: "moonshot",
    model: "kimi-k2.6",
    currency: "USD",
    inputPerMillion: 0.95,
    cachedInputPerMillion: 0.16,
    outputPerMillion: 4,
    sourceZh: "platform.kimi.ai 的 Kimi K2.6 定价页，2026-08-22 取",
  },
];

export interface ModelRunCost {
  readonly currency: "USD";
  readonly amount: number;
  readonly sourceZh: string;
}

export function findModelPrice(provider: string, model: string): ModelPrice | null {
  return MODEL_PRICES.find((item) => item.provider === provider && item.model === model) ?? null;
}

/**
 * 按用量与单价算一次运行的费用。单价表里没有这个模型，或用量没有记录下来，
 * 都返回 null 由调用方如实显示，不用零或估值顶替。
 */
export function estimateRunCost(input: {
  provider: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  cachedTokens: number | null;
}): ModelRunCost | null {
  const price = findModelPrice(input.provider, input.model);
  if (!price) return null;
  if (input.promptTokens === null || input.completionTokens === null) return null;

  // 缓存命中的部分从输入里扣出来单独计价。cachedTokens 缺失时按全部未命中算，
  // 这个方向只会把费用算高，不会让人以为更便宜。
  const cached = Math.min(input.cachedTokens ?? 0, input.promptTokens);
  const uncached = input.promptTokens - cached;
  const amount = (uncached * price.inputPerMillion
    + cached * price.cachedInputPerMillion
    + input.completionTokens * price.outputPerMillion) / 1_000_000;

  return { currency: price.currency, amount, sourceZh: price.sourceZh };
}

/** 费用金额的显示形态。小于一分钱的按四位小数写，免得一屏全是 $0.00。 */
export function formatCost(cost: ModelRunCost): string {
  const digits = cost.amount > 0 && cost.amount < 0.01 ? 4 : 2;
  return `$${cost.amount.toFixed(digits)}`;
}
