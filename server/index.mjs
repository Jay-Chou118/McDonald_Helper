import express from 'express';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { safeError, ServiceError } from './mcp.mjs';
import { mealContext } from './data.mjs';
import { createSessionManager } from './sessions.mjs';
import { contextFor, recommend, addNutrition } from './planner.mjs';
import { verifyValue } from './value.mjs';
import { getOffers, claimOffers } from './offers.mjs';
import { priceSummary, compareSingles, foodSignature, journalSummary, yuanToCents } from './savings.mjs';

export async function createApp(options = {}) {
const sessions = await createSessionManager(options);
const app = express();
app.locals.sessions = sessions;
app.disable('x-powered-by');
app.use((req, res, next) => {
  const host = req.hostname;
  if (host !== 'localhost') return res.status(403).json({ error: '只允许本机访问，请使用 localhost 打开网页。' });
  if (req.headers.origin) {
    try {
      const origin = new URL(req.headers.origin);
      if (origin.hostname !== 'localhost'
        || !['3001', '5173', '5174', String(options.port ?? 3001)].includes(origin.port)) {
        return res.status(403).json({ error: '请求来源不被允许。' });
      }
    } catch { return res.status(403).json({ error: '请求来源无效。' }); }
  }
  if (req.path.startsWith('/api') && !['GET', 'HEAD'].includes(req.method) && req.headers['x-mai-request'] !== '1') {
    return res.status(403).json({ error: '请求来源不被允许。' });
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '32kb' }));
app.use('/api', async (req, res, next) => {
  req.session = await sessions.acquire(req, res, req.path === '/bootstrap' && req.method === 'GET');
  if (!req.session) return res.status(401).json({ error: '会话已过期，请重新连接。', code: 'SESSION_CHANGED' });
  req.scope = req.session.scope;
  if (req.path !== '/bootstrap' && req.headers['x-mai-session'] !== req.scope.key) {
    return res.status(401).json({ error: '连接已变化，请刷新后重新操作。', code: 'SESSION_CHANGED' });
  }
  const localRoutes = ['/bootstrap', '/connection', '/preferences', '/weather'];
  if (!localRoutes.includes(req.path) && !req.scope.configured) {
    return res.status(401).json({ error: '请先连接你自己的麦当劳账号。', code: 'SESSION_CHANGED' });
  }
  // Ignore successful responses from a credential scope invalidated while the request was in flight.
  const json = res.json.bind(res);
  res.json = body => {
    if (res.statusCode < 400 && req.scope && (!req.scope.active || req.session.expiresAt <= Date.now())) {
      res.status(401);
      return json({ error: '会话已变化，请刷新后重新操作。', code: 'SESSION_CHANGED' });
    }
    return json(body);
  };
  next();
});

const goals = z.enum(['balanced', 'protein', 'light', 'comfort']);
const preferencesSchema = z.object({
  calorieMin: z.number().int().min(0).max(2000),
  calorieMax: z.number().int().min(100).max(2500),
  proteinMin: z.number().min(0).max(150),
  sodiumMax: z.number().int().min(100).max(5000),
  budget: z.number().min(1).max(500),
  monthlyBudget: z.number().min(0).max(10000).default(300),
  goal: goals, likes: z.array(z.string().min(1).max(20)).max(10),
  excludes: z.string().max(200),
  drink: z.enum(['auto', 'sugarfree', 'hot', 'any']),
  side: z.enum(['any', 'corn', 'none']),
  weatherEnabled: z.boolean(),
  week: z.array(goals).length(7),
  city: z.string().min(1).max(40),
}).strict().refine(p => p.calorieMin <= p.calorieMax, { message: '热量下限不能高于上限。' });
const contextSchema = z.object({
  storeCode: z.string().regex(/^\d{1,20}$/),
  orderType: z.union([z.literal(1), z.literal(2)]),
  beType: z.union([z.literal(1), z.literal(2)]),
  beCode: z.string().max(100).optional(),
  addressId: z.string().max(100).optional(),
}).strict().refine(c => c.orderType === c.beType, { message: '取餐方式与订单类型不一致。' });

const parseContext = query => contextSchema.parse({
  storeCode: query.storeCode,
  orderType: Number(query.orderType),
  beType: Number(query.beType),
  ...(query.beCode ? { beCode: query.beCode } : {}),
  ...(query.addressId ? { addressId: query.addressId } : {}),
});
app.get('/api/bootstrap', async (req, res) => {
  const preferences = await req.scope.data.getPreferences();
  const connection = { configured: req.scope.configured, connected: req.scope.connected, error: null };
  let nutritionCount = 0;
  if (connection.configured) try {
    nutritionCount = (await req.scope.data.getNutrition()).length;
    connection.connected = true;
  } catch (error) { connection.connected = false; connection.error = safeError(error); }
  res.json({ preferences, connection, nutritionCount, session: { key: req.scope.key, expiresAt: req.session.expiresAt },
    context: contextFor(preferences, null) });
});

app.put('/api/preferences', async (req, res) => {
  const preferences = preferencesSchema.parse(req.body);
  await req.scope.data.updateState('preferences', () => preferences);
  res.json({ preferences });
});
app.put('/api/connection', async (req, res) => {
  const { token } = z.object({ token: z.string().regex(/^[a-zA-Z0-9_-]{10,200}$/) }).strict().parse(req.body);
  const result = await sessions.connect(req.session, token);
  req.scope = result.scope;
  const preferences = await req.scope.data.getPreferences();
  res.json({ connected: true, nutritionCount: result.nutritionCount, preferences, context: contextFor(preferences, null),
    session: { key: req.scope.key, expiresAt: req.session.expiresAt } });
});
app.delete('/api/connection', async (req, res) => {
  await sessions.remove(req.session, res);
  req.scope = null;
  res.json({ connected: false });
});

app.get('/api/weather', async (req, res) => {
  const city = z.string().min(1).max(40).parse(req.query.city);
  const weather = await req.scope.data.getWeather(city);
  const preferences = await req.scope.data.getPreferences();
  res.json({ weather, context: contextFor(preferences, weather) });
});

app.get('/api/addresses', async (req, res) => {
  const data = await req.scope.data.cached('addresses', 300000, () => req.scope.callMcd('delivery-query-addresses'));
  res.json({ addresses: data.addresses ?? [] });
});
app.get('/api/stores', async (req, res) => {
  const mode = z.enum(['pickup', 'delivery']).parse(req.query.mode ?? 'pickup');
  if (mode === 'delivery') {
    const addressId = z.string().min(1).max(100).parse(req.query.addressId);
    const data = await req.scope.callMcd('delivery-query-stores', { addressId, beType: 2 });
    const stores = Array.isArray(data) ? data : data.stores ?? [];
    res.json({ stores });
  } else {
    const city = z.string().max(40).parse(req.query.city ?? '');
    const keyword = z.string().max(100).parse(req.query.keyword ?? '');
    const args = req.query.favorites === 'true'
      ? { beType: 1, searchType: 1 }
      : { beType: 1, searchType: 2, city, keyword: keyword || city };
    const data = await req.scope.callMcd('query-nearby-stores', args);
    res.json({ stores: Array.isArray(data) ? data : data.stores ?? [] });
  }
});
app.get('/api/menu', async (req, res) => {
  const catalog = await req.scope.data.getCatalog(parseContext(req.query));
  res.json({ foods: catalog.displayFoods, skipped: catalog.skipped,
    unavailable: catalog.unavailable.map(f => f.name), updatedAt: catalog.updatedAt });
});
app.get('/api/coupons', async (req, res) => {
  const context = parseContext(req.query);
  const data = await req.scope.data.getCoupons(context);
  res.json({ data });
});
app.get('/api/offers', async (req, res) => {
  const context = req.query.storeCode ? parseContext(req.query) : null;
  if (req.query.refresh === 'true') req.scope.data.clearCache();
  res.json(await getOffers(req.scope.data, context));
});
app.post('/api/offers/claim', async (req, res) => {
  const { claimId } = z.object({ claimId: z.string().uuid(), confirmed: z.literal(true) }).strict().parse(req.body);
  if (req.session.changing || req.scope.ordersBusy) throw new ServiceError('正在处理领券或订单，请完成后再操作。', 409);
  req.scope.claiming = true;
  req.scope.offersRevision = (req.scope.offersRevision ?? 0) + 1;
  req.scope.ordersBusy++;
  try { res.json({ ...await claimOffers(req.scope.data, claimId), message: '领券请求已完成，请刷新券包并按门店重新核价。' }); }
  finally { req.scope.ordersBusy--; req.scope.claiming = false; }
});
app.post('/api/offers/claim-reset', async (req, res) => {
  z.object({ verifiedInOfficialApp: z.literal(true) }).strict().parse(req.body);
  await req.scope.data.updateState('claim', state => {
    if (state.status === 'claiming') throw new ServiceError('领券请求正在处理，请稍后再试。', 409);
    return {};
  });
  req.scope.data.clearCache();
  res.json({ reset: true });
});
const selectionsSchema = z.array(z.object({
  id: z.string().max(500), quantity: z.number().int().min(1).max(10),
}).strict()).min(1).max(20).refine(items => new Set(items.map(i => i.id)).size === items.length, {
  message: '同一餐品请合并数量。',
});
const selectFoods = (catalog, selections) => selections.map(selection => {
  const food = catalog.foods.find(f => f.id === selection.id);
  if (!food) throw new ServiceError('餐品已变化，请重新选择并核价。', 409);
  return { ...food, quantity: selection.quantity };
});
app.get('/api/favorites', async (req, res) => {
  res.json({ favorites: await req.scope.data.readState('favorites', []) });
});
app.post('/api/favorites', async (req, res) => {
  const input = z.object({ context: contextSchema, selections: selectionsSchema }).strict().parse(req.body);
  const selected = selectFoods(await req.scope.data.getCatalog(input.context), input.selections);
  const signature = foodSignature(selected);
  const favorite = { id: randomUUID(), signature, createdAt: Date.now(),
    foods: selected.map(f => ({ name: f.name, quantity: f.quantity, parts: f.parts })),
    nutrition: addNutrition(selected) };
  const favorites = await req.scope.data.updateState('favorites', list => {
    const previous = list.find(f => f.signature === signature);
    if (previous) return list;
    return [favorite, ...list].slice(0, 20);
  }, []);
  res.json({ favorites });
});
app.delete('/api/favorites/:id', async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  res.json({ favorites: await req.scope.data.updateState('favorites', list => list.filter(f => f.id !== id), []) });
});
app.post('/api/favorites/:id/reuse', async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { context } = z.object({ context: contextSchema }).strict().parse(req.body);
  const favorites = await req.scope.data.readState('favorites', []);
  const favorite = favorites.find(f => f.id === id);
  if (!favorite) throw new ServiceError('常点搭配不存在。', 404);
  const catalog = await req.scope.data.getCatalog(context);
  const preferences = await req.scope.data.getPreferences();
  const candidates = recommend(catalog.foods, preferences, contextFor(preferences, null),
    { limit: Infinity, checkEstimatedBudget: false }).plans.filter(plan => foodSignature(plan.foods) === favorite.signature);
  const priced = await verifyValue(candidates, preferences, items => req.scope.callMcd('calculate-price', {
    ...mealContext(context), items, needTableware: false,
  }));
  if (!priced.plans.length) throw new ServiceError('当前门店没有可售且符合最新营养、忌口和预算的相同搭配，请重新推荐。', 422);
  res.json({ plan: priced.plans[0] });
});
app.get('/api/journal', async (req, res) => {
  const preferences = await req.scope.data.getPreferences();
  const quotes = await req.scope.data.readState('quotes', {});
  res.json({ summary: journalSummary(Object.values(quotes).filter(q => q.identity === req.scope.identity
    && ['submitted', 'uncertain', 'creating'].includes(q.status)), preferences.monthlyBudget) });
});
app.post('/api/history/sync', async (req, res) => {
  z.object({}).strict().parse(req.body);
  const quotes = await req.scope.data.readState('quotes', {});
  const pending = Object.values(quotes).filter(q => q.identity === req.scope.identity && q.status === 'submitted'
    && q.order?.orderId);
  let cursor = 0, updated = 0;
  const errors = [];
  await Promise.all(Array.from({ length: Math.min(3, pending.length) }, async () => {
    while (cursor < pending.length) {
      const quote = pending[cursor++];
      try {
        const order = await req.scope.callMcd('query-order', { orderId: quote.order.orderId });
        const status = String(order.orderStatus ?? '');
        const paid = ['2', '4', '6', '8', '10'].includes(status) ? yuanToCents(order.realTotalAmount) : null;
        const discount = yuanToCents(order.totalDiscountAmount);
        const original = yuanToCents(order.totalAmount);
        const savings = paid === null ? null : discount ?? (original !== null && original >= paid ? original - paid : null);
        await req.scope.data.updateState('quotes', state => ({ ...state, [quote.id]: {
          ...state[quote.id], payment: { status, paid, savings, syncedAt: Date.now() },
        } }));
        updated++;
      } catch (error) { errors.push(safeError(error)); }
    }
  }));
  res.json({ updated, errors: [...new Set(errors)] });
});
app.post('/api/recommend', async (req, res) => {
  const input = z.object({ context: contextSchema }).strict().parse(req.body);
  const preferences = await req.scope.data.getPreferences();
  const catalog = await req.scope.data.getCatalog(input.context);
  const weather = preferences.weatherEnabled ? await req.scope.data.getWeather(preferences.city) : null;
  const context = contextFor(preferences, weather);
  const result = await req.scope.data.cached(`value:${JSON.stringify([input.context, preferences, context])}`, 45000, async () => {
    const candidates = recommend(catalog.foods, preferences, context, { limit: Infinity, checkEstimatedBudget: false });
    const priced = await verifyValue(candidates.plans, preferences, items => req.scope.callMcd('calculate-price', {
      ...mealContext(input.context), items, needTableware: false,
    }));
    return { ...priced, stats: { ...candidates.stats, ...priced.stats, couponOffers: catalog.couponOffers,
      truncated: catalog.truncated, defaultOnly: catalog.defaultOnly },
      couponError: catalog.couponError, scope: '按菜单估价选取最多 24 个不同低价候选，按官方实付金额排序；价格含接口返回的费用，不含餐具。结算时再次核价。' };
  });
  res.json({ ...result, context, updatedAt: catalog.updatedAt, skipped: catalog.skipped });
});

const quoteSchema = z.object({
  context: contextSchema,
  selections: selectionsSchema,
  needTableware: z.boolean(),
}).strict();

app.post('/api/quote', async (req, res) => {
  if (req.scope.claiming) throw new ServiceError('正在领取优惠券，请完成后重新结算。', 409);
  const offersRevision = req.scope.offersRevision ?? 0;
  const input = quoteSchema.parse(req.body);
  const catalog = await req.scope.data.getCatalog(input.context);
  const selected = selectFoods(catalog, input.selections);
  const items = selected.map(f => ({ ...f.item, quantity: f.quantity }));
  const args = { ...mealContext(input.context), items, needTableware: input.needTableware };
  const price = await req.scope.callMcd('calculate-price', args);
  if (!Number.isInteger(price.price) || price.price < 0) throw new ServiceError('麦当劳未返回有效金额，无法继续下单。');
  const preferences = await req.scope.data.getPreferences();
  const savings = priceSummary(price, preferences.budget);
  const comparison = await compareSingles(selected, catalog.foods, items => req.scope.callMcd('calculate-price', {
    ...args, items,
  }), price.price);
  if (offersRevision !== (req.scope.offersRevision ?? 0)) throw new ServiceError('优惠券已变化，请重新结算。', 409);
  const id = randomUUID();
  const quote = {
    id, args, context: input.context, price, selected, savings, comparison, offersRevision,
    nutrition: addNutrition(selected), identity: req.scope.identity, revision: req.scope.key, status: 'prepared',
    createdAt: Date.now(), expiresAt: Date.now() + 180000,
  };
  await req.scope.data.updateState('quotes', quotes => {
    const retained = Object.fromEntries(Object.entries(quotes).filter(([, q]) => q.status !== 'prepared'
      || (q.expiresAt > Date.now() && q.revision === req.scope.key)));
    if (Object.keys(retained).length >= 200) throw new ServiceError('本会话记录已达上限，请断开连接后重新开始。', 409);
    return { ...retained, [id]: quote };
  });
  res.json({ id, price, savings, comparison, nutrition: quote.nutrition, expiresAt: quote.expiresAt,
    unknownNutrition: selected.filter(f => !f.nutrition).map(f => f.name) });
});

app.post('/api/orders', async (req, res) => {
  if (req.session.changing || req.scope.claiming) throw new ServiceError('连接或优惠券正在变化，请稍后重新结算。', 409);
  req.scope.ordersBusy++;
  try {
  const { quoteId, takeWayCode, confirmed, remark } = z.object({
    quoteId: z.string().uuid(), takeWayCode: z.string().max(50).optional(),
    confirmed: z.literal(true), remark: z.string().max(50).optional(),
  }).strict().parse(req.body);
  let quote;
  await req.scope.data.updateState('quotes', quotes => {
    quote = quotes[quoteId];
    if (!quote || quote.identity !== req.scope.identity || quote.revision !== req.scope.key) throw new ServiceError('报价无效，请重新结算。', 409);
    if (quote.status === 'submitted') return quotes;
    if ((quote.offersRevision ?? 0) !== (req.scope.offersRevision ?? 0)) throw new ServiceError('优惠券已变化，请重新结算。', 409);
    if (quote.status !== 'prepared') throw new ServiceError('这次提交已经处理或结果待核实，请先查看点餐记录或麦当劳 App，避免重复下单。', 409);
    if (quote.expiresAt < Date.now()) throw new ServiceError('报价已过期，请重新结算。', 409);
    if (quote.context.orderType === 1 && !quote.price.takeWayList?.some(t => t.code === takeWayCode)) {
      throw new ServiceError('请选择麦当劳返回的有效取餐方式。', 400);
    }
    return { ...quotes, [quoteId]: { ...quote, status: 'creating' } };
  });
  if (quote.status === 'submitted') return res.json({ order: quote.order, existing: true });
  try {
    // Recheck price immediately before creating an order; never silently accept a changed total.
    const freshPrice = await req.scope.callMcd('calculate-price', quote.args);
    if (freshPrice.price !== quote.price.price) {
      await req.scope.data.updateState('quotes', quotes => ({ ...quotes, [quoteId]: { ...quotes[quoteId], status: 'price_changed' } }));
      throw new ServiceError('价格已变化，请重新结算并确认新的金额。', 409);
    }
    if (quote.context.orderType === 1 && !freshPrice.takeWayList?.some(t => t.code === takeWayCode)) {
      throw new ServiceError('取餐方式已变化，请重新结算。', 409);
    }
    const args = {
      ...quote.args,
      ...(quote.context.orderType === 2 ? { addressId: quote.context.addressId, ...(remark ? { remark } : {}) } : { takeWayCode }),
    };
    let order;
    try { order = await req.scope.callMcd('create-order', args); }
    catch (error) {
      await req.scope.data.updateState('quotes', quotes => ({
        ...quotes, [quoteId]: { ...quotes[quoteId], status: 'uncertain', error: safeError(error) },
      }));
      throw new ServiceError('提交结果未能确认。请先在麦当劳 App 查看订单，避免重复下单。');
    }
    if (!order.orderId) {
      await req.scope.data.updateState('quotes', quotes => ({ ...quotes, [quoteId]: { ...quotes[quoteId], status: 'uncertain' } }));
      throw new ServiceError('未返回订单编号，请先在麦当劳 App 核实订单。');
    }
    await req.scope.data.updateState('quotes', quotes => ({
      ...quotes, [quoteId]: { ...quotes[quoteId], status: 'submitted', order, submittedAt: Date.now() },
    }));
    res.json({ order });
  } catch (error) {
    await req.scope.data.updateState('quotes', quotes => {
      if (quotes[quoteId]?.status !== 'creating') return quotes;
      return { ...quotes, [quoteId]: { ...quotes[quoteId], status: 'prepared' } };
    });
    throw error;
  }
  } finally { req.scope.ordersBusy--; }
});
app.get('/api/history', async (req, res) => {
  const quotes = await req.scope.data.readState('quotes', {});
  res.json({ orders: Object.values(quotes)
    .filter(q => q.identity === req.scope.identity && ['submitted', 'uncertain', 'creating'].includes(q.status))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(q => ({
      id: q.id, status: q.status, createdAt: q.createdAt, submittedAt: q.submittedAt,
      foods: q.selected.map(f => ({ name: f.name, quantity: f.quantity })),
      nutrition: q.nutrition, price: q.price.price, payment: q.payment ?? null, savings: q.savings ?? null,
      order: q.order ?? null,
    })) });
});

if (await stat(resolve('dist')).then(s => s.isDirectory()).catch(() => false)) {
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: '接口不存在。' });
    res.sendFile(resolve('dist/index.html'));
  });
}
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0]?.message ?? '请求参数不完整。' });
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: '请求格式不正确。' });
  res.status(error.status ?? 500).json({ error: error instanceof ServiceError ? safeError(error, req.body?.token) : '本地服务处理失败，请重试。',
    ...(error.status === 401 ? { code: 'SESSION_CHANGED' } : {}) });
});
return app;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const port = Number(process.env.PORT ?? 3001);
const app = await createApp({ port,
  directory: resolve(port === 3001 ? '.local/sessions' : `.local/sessions-${port}`),
  cookieName: port === 3001 ? 'mai_session' : `mai_session_${port}`,
});
const server = app.listen(port, 'localhost', () => console.log(`麦搭服务已启动：http://localhost:${port}`));
process.once('SIGTERM', () => { server.close(); app.locals.sessions.close(); });
}
