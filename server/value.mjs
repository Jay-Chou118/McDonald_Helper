import { comparePlans, mealSignature } from './planner.mjs';
import { priceSummary } from './savings.mjs';

// Price calls are read-only. Limit latency while retaining cheap choices from different meals/offers.
export async function verifyValue(candidates, preferences, calculate, maxChecks = 24) {
  const queue = [], ids = new Set();
  const add = plan => {
    if (plan && queue.length < maxChecks && !ids.has(plan.id)) { ids.add(plan.id); queue.push(plan); }
  };
  candidates.slice(0, 8).forEach(add);
  const meals = new Set(), offers = new Set();
  for (const plan of candidates) {
    const meal = mealSignature(plan);
    if (!meals.has(meal)) { meals.add(meal); add(plan); }
    if (queue.length >= Math.max(8, maxChecks - 8)) break;
  }
  for (const plan of candidates) {
    const anchor = plan.foods[0];
    const offer = `${anchor.code}:${anchor.item.couponCode ?? ''}`;
    if (!offers.has(offer)) { offers.add(offer); add(plan); }
  }
  candidates.forEach(add);
  let cursor = 0, verified = 0, failed = 0;
  const priced = [];
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (cursor < queue.length) {
      const plan = queue[cursor++];
      try {
        const result = await calculate(plan.foods.map(f => f.item));
        if (!Number.isInteger(result.price) || result.price < 0) throw new Error('无效金额');
        verified++;
        const price = result.price / 100;
        if (price > preferences.budget) continue;
        const foods = plan.foods.map((food, i) => {
          const line = result.productList?.[i];
          const actual = line?.productCode === food.code && Number.isInteger(line.subtotal) ? line.subtotal / 100 : food.price;
          return { ...food, price: actual };
        });
        priced.push({ ...plan, foods, estimatedPrice: plan.price, price, priceVerified: true,
          savings: priceSummary(result, preferences.budget),
          pricedAt: new Date().toISOString(),
          reasons: [`官方实付 ¥${price}，在已核价方案中优先低价`, ...plan.reasons] });
      } catch (error) {
        if (/token|网络|连接|限流/.test(error.message)) throw error;
        failed++;
      }
    }
  }));
  priced.sort(comparePlans);
  const plans = [];
  for (const plan of priced) {
    if (plans.some(p => mealSignature(p) === mealSignature(plan))) continue;
    plans.push(plan);
    if (plans.length === 3) break;
  }
  return { plans, stats: { checked: queue.length, verified, priceFailed: failed, affordable: priced.length },
    message: plans.length ? null : candidates.length
      ? '已核价的方案没有可售且符合实付预算的组合，请调整条件或换一家门店。'
      : '当前门店没有同时满足营养和口味限制的组合，请调整条件后重试。' };
}
