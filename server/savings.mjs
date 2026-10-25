const cents = value => Number.isSafeInteger(value) && value >= 0;
export function yuanToCents(value) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(String(value))) return null;
  const [whole, decimal = ''] = String(value).split('.');
  const result = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  return cents(result) ? result : null;
}

// Official totals describe the same priced basket. Never add discount fields together.
export function priceSummary(price, budget) {
  const payable = cents(price.price) ? price.price : null;
  const original = cents(price.originalPrice) && price.originalPrice >= payable ? price.originalPrice : null;
  return {
    payable, original, officialSavings: payable !== null && original !== null ? original - payable : null,
    reportedDiscount: cents(price.discount) ? price.discount : null,
    budgetRemaining: payable === null ? null : Math.round(budget * 100) - payable,
    threshold: price.enjoyable && cents(price.enjoyable.balance) && price.enjoyable.balance > 0
      ? { gap: price.enjoyable.balance, description: '距官方优惠门槛的金额；加购是否划算需重新核价，不能直接用券面值抵扣。' } : null,
  };
}

export function foodSignature(foods) {
  const components = foods.flatMap(food => food.components?.length
    ? food.components.map(c => ({ code: c.code, quantity: (c.quantity ?? 1) * (food.quantity ?? 1) }))
    : [{ code: food.code, quantity: food.quantity ?? 1 }]);
  const counts = new Map();
  for (const c of components) counts.set(c.code, (counts.get(c.code) ?? 0) + c.quantity);
  return JSON.stringify([...counts].sort(([a], [b]) => a.localeCompare(b)));
}

// Compare precisely the same portions as single menu products in the same order context.
export async function compareSingles(selected, catalog, calculate, payable) {
  const quantities = new Map();
  for (const food of selected) {
    if (food.item.modification) return null;
    const components = food.components?.length ? food.components : [{ code: food.code, quantity: 1 }];
    for (const c of components) quantities.set(c.code, (quantities.get(c.code) ?? 0) + c.quantity * (food.quantity ?? 1));
  }
  const items = [];
  for (const [code, quantity] of quantities) {
    const food = catalog.find(f => f.code === code && !f.coupon && !f.components?.length
      && !f.item.roundList?.length && !f.item.modification);
    if (!food || quantity > 10) return null;
    items.push({ ...food.item, quantity });
  }
  if (items.length > 20) return null;
  try {
    const baseline = await calculate(items);
    if (!cents(baseline.price)) return null;
    return { price: baseline.price, saving: baseline.price - payable, source: '同门店、同份量、同取餐方式单点核价' };
  } catch (error) {
    if (/token|网络|连接|限流/.test(error.message)) throw error;
    return null;
  }
}

export const shanghaiDate = timestamp => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(timestamp);

export function journalSummary(quotes, monthlyBudget, now = Date.now()) {
  const month = shanghaiDate(now).slice(0, 7);
  const monthly = quotes.filter(q => shanghaiDate(q.createdAt).startsWith(month));
  const paid = monthly.filter(q => ['2', '4', '6', '8', '10'].includes(q.payment?.status) && cents(q.payment?.paid));
  const spent = paid.reduce((sum, q) => sum + q.payment.paid, 0);
  const savingsRecords = paid.filter(q => cents(q.payment.savings));
  const saved = savingsRecords.reduce((sum, q) => sum + q.payment.savings, 0);
  const budget = Math.round(monthlyBudget * 100);
  return { month, monthlyBudget: budget, spent, saved, paidOrders: paid.length,
    savingsKnown: savingsRecords.length, pendingOrders: monthly.filter(q => !q.payment || q.payment.status === '1').length,
    remaining: budget - spent, average: paid.length ? Math.round(spent / paid.length) : null };
}
