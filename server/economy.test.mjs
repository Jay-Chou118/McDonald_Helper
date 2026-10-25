import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './index.mjs';
import { ServiceError } from './mcp.mjs';
import { priceSummary, compareSingles, foodSignature, journalSummary, yuanToCents, shanghaiDate } from './savings.mjs';

const context = { storeCode: '1450226', orderType: 1, beType: 1 };
const nutrition = [
  { productName: '双层吉士汉堡', energyKcal: 450, protein: 30, fat: 20, carbohydrate: 40, sodium: 900, calcium: 100 },
  { productName: '纯牛奶', energyKcal: 100, protein: 8, fat: 4, carbohydrate: 10, sodium: 100, calcium: 100 },
];
async function setup(t, { failClaim = false, failPrice = false, deliveryFee = 0, tablewareFee = 0 } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'mai-economy-test-'));
  const calls = [], claimed = new Set();
  let paymentStatus = '1';
  const app = await createApp({ directory, makeMcd: token => ({
    close() {},
    async callMcd(name, args = {}) {
      calls.push({ token, name, args });
      switch (name) {
        case 'list-nutrition-foods': return nutrition;
        case 'available-coupons': return claimed.has(token) ? [] : [{ couponName: '11.9元双吉', couponStatus: 'CAN_GET' }];
        case 'campaign-calendar': return { dailyList: [{ date: shanghaiDate(Date.now()), events: [
          { activityCode: 'food', articleDto: { title: '下周优惠预告', content: '请按实际门店核价' } },
          { activityCode: 'card', articleDto: { title: '麦金学期卡', content: '购卡49元' } },
          { activityCode: 'merch', articleDto: { title: '限定棒球帽', content: '39.9元' } },
        ] }] };
        case 'query-my-coupons': return { coupons: [{ id: token, code: 'coupon', title: `${token}的券`,
          tradeEndDate: shanghaiDate(Date.now()), currentChannelCanRedeem: false }], totalPages: 1 };
        case 'query-store-coupons': return claimed.has(token)
          ? [{ couponId: token, couponCode: 'coupon', title: `${token}的券`,
            products: [{ productCode: 'main', productName: '双层吉士汉堡' }] }] : [];
        case 'auto-bind-coupons':
          if (failClaim) throw new ServiceError('网络连接失败');
          claimed.add(token); return { success: true };
        case 'query-meals': return { categories: [], meals: {
          main: { name: '双层吉士汉堡', currentPrice: 20 },
          milk: { name: '纯牛奶', currentPrice: 8 },
          bundle: { name: '1+1随心配', currentPrice: 14.9 },
        } };
        case 'query-meal-detail':
          if (args.code === 'bundle') return { name: '1+1随心配', rounds: [
            { id: '1', minQuantity: 1, maxQuantity: 1, choices: [{ code: 'main', name: '双层吉士汉堡', quantity: 1, isDefault: 1 }] },
            { id: '2', minQuantity: 1, maxQuantity: 1, choices: [{ code: 'milk', name: '纯牛奶', quantity: 1, isDefault: 1 }] },
          ] };
          return { name: args.code === 'main' ? '双层吉士汉堡' : '纯牛奶', rounds: [] };
        case 'calculate-price': {
          if (failPrice) throw new ServiceError('餐品暂时不可售');
          const productList = args.items.map(item => ({ productCode: item.productCode, quantity: item.quantity,
            subtotal: (item.couponId ? 1190 : item.productCode === 'bundle' ? 1490 : item.productCode === 'milk' ? 800 : 2000) * item.quantity }));
          const price = productList.reduce((s, p) => s + p.subtotal, 0)
            + (args.orderType === 2 ? deliveryFee : 0) + (args.needTableware ? tablewareFee : 0);
          return { price, originalPrice: price + 600, discount: 100, productList, takeWayList: [{ code: 'out' }] };
        }
        case 'create-order': return { orderId: `fake-${token}` };
        case 'query-order': return { orderId: args.orderId, orderStatus: paymentStatus,
          realTotalAmount: '14.90', totalAmount: '20.90', totalDiscountAmount: '6.00' };
        default: throw new Error(`Unexpected tool ${name}`);
      }
    },
  }) });
  const server = app.listen(0, 'localhost');
  await new Promise(r => server.once('listening', r));
  const url = `http://localhost:${server.address().port}`;
  t.after(async () => {
    app.locals.sessions.close();
    await new Promise(r => server.close(r));
    await rm(directory, { recursive: true, force: true });
  });
  async function browser(token) {
    let cookie = '', key = '';
    const request = async (path, body, method = body === undefined ? 'GET' : 'POST') => {
      const response = await fetch(`${url}/api${path}`, { method, headers: {
        'Content-Type': 'application/json', 'X-Mai-Request': '1', Cookie: cookie, 'X-Mai-Session': key,
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      const data = await response.json();
      if (data.session) key = data.session.key;
      return { status: response.status, data };
    };
    await request('/bootstrap');
    await request('/connection', { token }, 'PUT');
    const preferences = (await request('/bootstrap')).data.preferences;
    await request('/preferences', { ...preferences, weatherEnabled: false }, 'PUT');
    return { request };
  }
  return { browser, calls, pay: status => { paymentStatus = status; } };
}

test('amounts use integer cents, comparable official totals and do not double count discounts', () => {
  const s = priceSummary({ price: 1490, originalPrice: 2800, discount: 500,
    enjoyable: { amountType: '2', realDiscount: 6, balance: 300 } }, 20);
  assert.equal(s.officialSavings, 1310);
  assert.equal(s.budgetRemaining, 510);
  assert.equal(s.threshold.gap, 300);
  assert.equal(priceSummary({ price: 0, originalPrice: 100 }, 1).officialSavings, 100);
  assert.equal(priceSummary({ price: 2000, originalPrice: 1000 }, 1).officialSavings, null);
  assert.equal(priceSummary({ price: 2000 }, 1).officialSavings, null);
  assert.equal(yuanToCents('14.90'), 1490);
  assert.equal(yuanToCents('0'), 0);
  for (const value of ['1e3', '1.001', '-1', 'NaN', '', undefined]) assert.equal(yuanToCents(value), null);
});

test('same portion comparison uses real single-product codes and includes the same order fees', async () => {
  const selected = [{ code: 'bundle', quantity: 2, item: {}, components: [{ code: 'main', quantity: 1 }, { code: 'milk', quantity: 1 }] }];
  const catalog = ['main', 'milk'].map(code => ({ code, item: { productCode: code, quantity: 1 } }));
  const result = await compareSingles(selected, catalog, async items => {
    assert.deepEqual(items, [{ productCode: 'main', quantity: 2 }, { productCode: 'milk', quantity: 2 }]);
    return { price: 5600 };
  }, 2980);
  assert.equal(result.saving, 2620);
  assert.equal(await compareSingles(selected, [catalog[0]], () => { throw new Error('must not call'); }, 2980), null);
  assert.equal(foodSignature(selected), foodSignature(catalog.map(f => ({ ...f, quantity: 2 }))));
});

test('journal excludes unpaid, cancelled and unknown totals and respects Shanghai month boundaries', () => {
  const time = Date.parse('2026-10-31T17:00:00Z');
  const quote = payment => ({ createdAt: time, payment });
  const result = journalSummary([
    quote({ status: '2', paid: 1490, savings: 600 }), quote({ status: '6', paid: 1000, savings: null }),
    quote({ status: '1', paid: 2000 }), quote({ status: '7', paid: 3000 }), quote({ status: '2', paid: null }),
    { createdAt: Date.parse('2026-10-20T00:00Z'), payment: { status: '6', paid: 5000 } },
  ], 100, time);
  assert.equal(result.month, '2026-11'); assert.equal(result.spent, 2490); assert.equal(result.saved, 600);
  assert.equal(result.savingsKnown, 1); assert.equal(result.paidOrders, 2); assert.equal(result.remaining, 7510);
});

test('offers distinguish wallet from usable coupons and protect claiming across sessions and retries', async t => {
  const h = await setup(t);
  const a = await h.browser('fake_economy_alpha'), b = await h.browser('fake_economy_beta');
  const offer = (await a.request(`/offers?${new URLSearchParams(context)}`)).data;
  assert.equal(offer.coupons[0].expiresToday, true);
  assert.equal(offer.coupons[0].availableHere, false);
  assert.equal(offer.activities.length, 2); assert.equal(offer.activities[1].requiresMembership, true);
  assert.equal(h.calls.filter(c => c.name === 'auto-bind-coupons').length, 0);
  assert.equal((await a.request('/offers/claim', { claimId: offer.claimId })).status, 400);
  assert.equal((await b.request('/offers/claim', { claimId: offer.claimId, confirmed: true })).status, 409);
  const menu = (await a.request(`/menu?${new URLSearchParams(context)}`)).data;
  const quote = (await a.request('/quote', { context, selections: [{ id: menu.foods[0].id, quantity: 1 }], needTableware: false })).data;
  const body = { claimId: offer.claimId, confirmed: true };
  const responses = await Promise.all([a.request('/offers/claim', body), a.request('/offers/claim', body)]);
  assert.equal(responses.filter(r => r.status === 200).length >= 1, true);
  assert.equal(h.calls.filter(c => c.name === 'auto-bind-coupons').length, 1);
  assert.equal((await a.request('/offers/claim', body)).data.existing, true);
  assert.equal((await a.request('/orders', { quoteId: quote.id, takeWayCode: 'out', confirmed: true })).status, 409);
  const after = (await a.request(`/offers?${new URLSearchParams(context)}`)).data;
  assert.equal(after.coupons[0].availableHere, true);
  const rec = (await a.request('/recommend', { context })).data;
  assert.equal(rec.plans[0].price, 11.9);
  const recB = (await b.request('/recommend', { context })).data;
  assert.equal(recB.plans[0].price, 14.9);
  assert.equal(h.calls.filter(c => c.name === 'create-order').length, 0);
});

test('uncertain claims never retry automatically and can be reset only after explicit official verification', async t => {
  const h = await setup(t, { failClaim: true });
  const a = await h.browser('fake_economy_alpha');
  const offer = (await a.request('/offers')).data;
  const body = { claimId: offer.claimId, confirmed: true };
  assert.equal((await a.request('/offers/claim', body)).status, 502);
  assert.equal((await a.request('/offers/claim', body)).status, 409);
  assert.equal((await a.request('/offers?refresh=true')).data.claimState, 'uncertain');
  assert.equal(h.calls.filter(c => c.name === 'auto-bind-coupons').length, 1);
  assert.equal((await a.request('/offers/claim-reset', {})).status, 400);
  assert.equal((await a.request('/offers/claim-reset', { verifiedInOfficialApp: true })).status, 200);
  assert.notEqual((await a.request('/offers')).data.claimId, offer.claimId);
});

test('favorites are owned per session, reuse current discounts and reject changed nutrition constraints', async t => {
  const h = await setup(t);
  const a = await h.browser('fake_economy_alpha'), b = await h.browser('fake_economy_beta');
  const menu = (await a.request(`/menu?${new URLSearchParams(context)}`)).data.foods;
  const food = menu.find(f => f.code === 'main');
  const body = { context, selections: [{ id: food.id, quantity: 1 }] };
  const saved = (await a.request('/favorites', body)).data.favorites[0];
  await a.request('/favorites', body);
  assert.equal((await a.request('/favorites')).data.favorites.length, 1);
  assert.equal((await b.request('/favorites')).data.favorites.length, 0);
  assert.equal((await b.request(`/favorites/${saved.id}/reuse`, { context })).status, 404);
  const offers = (await a.request('/offers')).data;
  await a.request('/offers/claim', { claimId: offers.claimId, confirmed: true });
  const reuse = (await a.request(`/favorites/${saved.id}/reuse`, { context })).data.plan;
  assert.equal(reuse.price, 11.9); assert.equal(reuse.foods[0].item.couponId, 'fake_economy_alpha');
  const prefs = (await a.request('/bootstrap')).data.preferences;
  await a.request('/preferences', { ...prefs, excludes: '吉士' }, 'PUT');
  assert.equal((await a.request(`/favorites/${saved.id}/reuse`, { context })).status, 422);
});

test('payment sync uses official status and paid amounts, does not count created orders as spending', async t => {
  const h = await setup(t);
  const a = await h.browser('fake_economy_alpha'), b = await h.browser('fake_economy_beta');
  const menu = (await a.request(`/menu?${new URLSearchParams(context)}`)).data.foods;
  const quote = (await a.request('/quote', { context, selections: [{ id: menu.find(f => f.code === 'bundle').id, quantity: 1 }], needTableware: false })).data;
  assert.equal(quote.comparison.price, 2800); assert.equal(quote.comparison.saving, 1310);
  await a.request('/orders', { quoteId: quote.id, takeWayCode: 'out', confirmed: true });
  assert.equal((await a.request('/journal')).data.summary.spent, 0);
  await a.request('/history/sync', {});
  assert.equal((await a.request('/journal')).data.summary.spent, 0);
  h.pay('2'); await a.request('/history/sync', {});
  const summary = (await a.request('/journal')).data.summary;
  assert.equal(summary.spent, 1490); assert.equal(summary.saved, 600);
  assert.equal((await b.request('/journal')).data.summary.spent, 0);
  h.pay('7'); await a.request('/history/sync', {});
  assert.equal((await a.request('/journal')).data.summary.spent, 0);
  assert.equal(h.calls.filter(c => c.name === 'auto-bind-coupons').length, 0);
});

test('challenge budgets are temporary, isolated, use exact cents and reuse candidate prices', async t => {
  const h = await setup(t);
  const a = await h.browser('fake_challenge_alpha'), b = await h.browser('fake_challenge_beta');
  const before = (await a.request('/bootstrap')).data.preferences;
  const challenge = async budget => a.request('/recommend', { context, challengeBudget: budget });
  const first = await challenge(15);
  assert.equal(first.status, 200);
  assert.equal(first.data.challenge.status, 'matched');
  assert.equal(first.data.plans[0].price, 14.9);
  assert.equal(first.data.plans[0].savings.budgetRemaining, 10);
  const count = h.calls.filter(c => c.name === 'calculate-price').length;
  const second = await challenge(20);
  assert.equal(second.data.plans[0].savings.budgetRemaining, 510);
  assert.equal(h.calls.filter(c => c.name === 'calculate-price').length, count);
  assert.equal((await challenge(14.9)).data.challenge.status, 'matched');
  const low = (await challenge(14.89)).data;
  assert.equal(low.plans.length, 0);
  assert.equal(low.challenge.status, 'over_budget');
  assert.equal(low.challenge.gap, 1);
  assert.equal(low.challenge.lowestVerified, 1490);
  assert.deepEqual((await a.request('/bootstrap')).data.preferences, before);
  assert.equal((await b.request('/recommend', { context })).data.challenge, null);
  for (const budget of [0, 501, 14.999, '15', null]) assert.equal((await challenge(budget)).status, 400);
  assert.equal(h.calls.some(c => ['auto-bind-coupons', 'create-order'].includes(c.name)), false);
});

test('challenge includes delivery and tableware fees and rechecks edited baskets at checkout', async t => {
  const h = await setup(t, { deliveryFee: 600, tablewareFee: 100 });
  const a = await h.browser('fake_challenge_alpha');
  const delivery = { storeCode: context.storeCode, orderType: 2, beType: 2, addressId: 'fake-address', beCode: 'fake-delivery' };
  const result = (await a.request('/recommend', { context: delivery, challengeBudget: 20 })).data;
  assert.equal(result.challenge.status, 'over_budget');
  assert.equal(result.challenge.lowestVerified, 2090);
  assert.equal(result.challenge.gap, 90);
  const menu = (await a.request(`/menu?${new URLSearchParams(context)}`)).data.foods;
  const bundle = menu.find(f => f.code === 'bundle');
  const body = { context, selections: [{ id: bundle.id, quantity: 1 }], needTableware: false, challengeBudget: 15 };
  const quote = await a.request('/quote', body);
  assert.equal(quote.status, 200); assert.equal(quote.data.challengeBudget, 15);
  assert.equal(quote.data.savings.budgetRemaining, 10);
  assert.equal((await a.request('/quote', { ...body, needTableware: true })).status, 422);
  assert.equal((await a.request('/quote', { ...body, selections: [{ id: bundle.id, quantity: 2 }] })).status, 422);
  const prefs = (await a.request('/bootstrap')).data.preferences;
  await a.request('/preferences', { ...prefs, excludes: '牛奶' }, 'PUT');
  assert.equal((await a.request('/quote', body)).status, 422);
  const noMatch = (await a.request('/recommend', { context, challengeBudget: 15 })).data;
  assert.equal(noMatch.plans.length, 0);
  assert.equal(noMatch.challenge.lowestVerified, 2000);
  await a.request('/preferences', { ...prefs, proteinMin: 100 }, 'PUT');
  const impossible = (await a.request('/recommend', { context, challengeBudget: 500 })).data;
  assert.equal(impossible.challenge.status, 'no_match');
  assert.equal(impossible.challenge.lowestVerified, null);
  assert.equal((await a.request('/bootstrap')).data.preferences.proteinMin, 100);
});

test('failed prices produce an unknown challenge result rather than a false over-budget verdict', async t => {
  const h = await setup(t, { failPrice: true });
  const a = await h.browser('fake_challenge_alpha');
  const result = (await a.request('/recommend', { context, challengeBudget: 15 })).data;
  assert.equal(result.challenge.status, 'unverified');
  assert.equal(result.challenge.lowestVerified, null);
  assert.equal(result.challenge.gap, null);
  assert.equal(result.stats.verified, 0);
});
