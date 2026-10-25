import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ServiceError } from './mcp.mjs';
import { defaultPreferences, parseNutrition, nutritionIndex, buildVariants } from './planner.mjs';

export function createData({ directory, callMcd, assertActive = () => {} }) {
const local = resolve(directory);
async function readState(name, fallback) {
  assertActive();
  try { return JSON.parse(await readFile(resolve(local, `${name}.json`), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
// Serialize read-modify-write operations; a quote can only enter "creating" once.
let stateQueue = Promise.resolve();
function updateState(name, updater, fallback = {}) {
  const next = stateQueue.then(async () => {
    assertActive();
    const value = await updater(await readState(name, fallback));
    assertActive();
    await mkdir(local, { recursive: true, mode: 0o700 });
    const path = resolve(local, `${name}.json`);
    await writeFile(`${path}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
    return value;
  });
  stateQueue = next.catch(() => {});
  return next;
}

async function getPreferences() {
  return { ...defaultPreferences, ...await readState('preferences', {}) };
}

const cache = new Map();
function clearCache() { cache.clear(); }
async function cached(key, ttl, loader) {
  assertActive();
  const entry = cache.get(key);
  if (entry && entry.expires > Date.now()) return entry.promise;
  if (cache.size >= 100) cache.delete(cache.keys().next().value);
  const promise = Promise.resolve().then(loader).then(value => { assertActive(); return value; })
    .catch(error => { if (cache.get(key)?.promise === promise) cache.delete(key); throw error; });
  cache.set(key, { expires: Date.now() + ttl, promise });
  return promise;
}
const getNutrition = () => cached('nutrition', 86400000, async () => parseNutrition(await callMcd('list-nutrition-foods')));
const getCoupons = input => cached(`coupons:${JSON.stringify(mealContext(input))}`, 60000,
  () => callMcd('query-store-coupons', mealContext(input)));

async function mapLimit(items, limit, callback) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await callback(items[index]);
    }
  }));
  return results;
}

async function getCatalog(input) {
  const context = mealContext(input);
  return cached(`menu:${JSON.stringify(context)}`, 180000, async () => {
    const data = await callMcd('query-meals', context);
    const index = nutritionIndex(await getNutrition());
    let couponError = null;
    const coupons = await getCoupons(input).catch(error => { couponError = error.message; return []; });
    const categories = new Map();
    for (const category of data.categories ?? []) {
      for (const meal of category.meals ?? []) {
        const existing = categories.get(meal.code);
        categories.set(meal.code, {
          category: existing?.category ?? category.name.replace(/\n/g, ''),
          tags: [...new Set([...(existing?.tags ?? []), ...(meal.tags ?? [])])],
        });
      }
    }
    const bases = Object.entries(data.meals ?? {}).map(([code, meal]) => ({
      code, name: meal.name, price: meal.currentPrice !== undefined && meal.currentPrice !== null && meal.currentPrice !== '' && Number.isFinite(Number(meal.currentPrice)) ? Number(meal.currentPrice) : null,
      originalPrice: meal.originalPrice !== undefined && meal.originalPrice !== null && meal.originalPrice !== '' && Number.isFinite(Number(meal.originalPrice)) ? Number(meal.originalPrice) : null,
      ...categories.get(code),
    }));
    const seenCoupons = new Set();
    for (const coupon of Array.isArray(coupons) ? coupons : coupons.coupons ?? []) {
      for (const product of coupon.products ?? []) {
        const key = `${coupon.couponId}:${coupon.couponCode}:${product.productCode}`;
        if (seenCoupons.has(key) || !coupon.couponId || !coupon.couponCode) continue;
        seenCoupons.add(key);
        bases.push({ code: product.productCode, name: product.productName, price: null,
          originalPrice: null, category: '我的可用优惠券', tags: [], coupon });
      }
    }
    bases.sort((a, b) => {
      const priority = base => base.coupon || /随心配|套餐|件套/.test(base.name) ? 0 : 1;
      return priority(a) - priority(b) || (a.price ?? 0) - (b.price ?? 0);
    });
    let skipped = 0, truncated = 0, defaultOnly = 0;
    const unavailable = [];
    const detailCache = new Map();
    const details = await mapLimit(bases, 3, async base => {
      // Multi-person offers and membership purchases are outside a one-person meal.
      if (/双人|二人|多人|三人|全家|随单购|早餐卡|麦金卡|会员卡|棒球帽|徽章|丝巾/.test(base.name)) return [];
      try {
        if (!detailCache.has(base.code)) detailCache.set(base.code,
          readWithRetry(() => callMcd('query-meal-detail', { ...context, code: base.code })));
        const detail = await detailCache.get(base.code);
        if (base.coupon) {
          // Coupon-only products have no menu price. Establish the actual default line price first.
          const roundList = (detail.rounds ?? []).map(r => {
            const positive = r.choices.filter(c => c.quantity > 0);
            const choices = positive.length ? positive : r.choices.filter(c => c.isDefault === 1);
            return { round: String(r.id), comboItemList: choices.map(c => ({ code: c.code, quantity: c.quantity > 0 ? c.quantity : 1 })) };
          });
          const item = { productCode: base.code, quantity: 1, couponId: base.coupon.couponId, couponCode: base.coupon.couponCode,
            ...(roundList.length ? { roundList } : {}) };
          const price = await callMcd('calculate-price', { ...context, needTableware: false, items: [item] });
          const subtotal = price.productList?.[0]?.subtotal;
          if (!Number.isInteger(subtotal) || subtotal < 0) throw new ServiceError('优惠券没有有效的餐品金额');
          // The default round choices have zero diffPrice for official coupon products.
          const defaults = buildVariants({ ...base, price: 0 }, detail, index);
          const probe = defaults.find(v => JSON.stringify(v.item.roundList) === JSON.stringify(item.roundList));
          if (!probe || probe.price === null) throw new ServiceError('优惠券默认组成无法核对');
          base.price = subtotal / 100 - probe.price;
        }
        const variants = buildVariants({ ...base, tags: base.tags ?? [], category: base.category ?? '其他' }, detail, index);
        if (variants.truncated) truncated++;
        if (variants.defaultOnly) defaultOnly++;
        return variants;
      } catch (error) {
        if (!(error instanceof ServiceError) || /token|网络|连接|限流/.test(error.message)) throw error;
        skipped++;
        unavailable.push({ code: base.code, name: base.name, error: error.message });
        return [];
      }
    });
    const foods = details.flat();
    if (!foods.length) throw new ServiceError('这家门店当前没有可点餐品，请换一家门店或稍后重试。', 422);
    // Keep all combinations authoritative on the server; show a small selection of each package in the menu.
    const displayed = new Map();
    const displayFoods = foods.filter(food => {
      if (food.role !== 'bundle') return true;
      const key = `${food.code}:${food.item.couponCode ?? ''}`;
      const count = displayed.get(key) ?? 0;
      if (count >= 6) return false;
      displayed.set(key, count + 1);
      return true;
    });
    return { foods, displayFoods, skipped, unavailable, truncated, defaultOnly, couponError,
      couponOffers: seenCoupons.size, updatedAt: new Date().toISOString() };
  });
}

const englishCities = {
  上海: 'Shanghai', 北京: 'Beijing', 广州: 'Guangzhou', 深圳: 'Shenzhen',
  杭州: 'Hangzhou', 成都: 'Chengdu', 南京: 'Nanjing', 武汉: 'Wuhan',
  苏州: 'Suzhou', 厦门: 'Xiamen', 漳州: 'Zhangzhou', 重庆: 'Chongqing',
};
async function getWeather(city) {
  return cached(`weather:${city}`, 600000, async () => {
    try {
      const name = englishCities[city.replace(/市$/, '')] ?? city;
      const geoResponse = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=5&language=zh&format=json`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!geoResponse.ok) throw new Error('geocoding unavailable');
      const geo = await geoResponse.json();
      const place = geo.results?.find(r => r.country_code === 'CN');
      if (!place) return null;
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,precipitation,weather_code&timezone=Asia%2FShanghai`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error('weather unavailable');
      const { current } = await response.json();
      if (!Number.isFinite(current?.temperature_2m)) return null;
      return {
        city: city.replace(/市$/, ''), temperature: current.temperature_2m,
        rain: current.precipitation, code: current.weather_code,
        updatedAt: current.time, source: 'Open-Meteo',
        label: weatherLabel(current.weather_code),
      };
    } catch { return null; }
  });
}

function weatherLabel(code) {
  if (code === 0) return '晴';
  if (code <= 3) return '多云';
  if (code <= 48) return '雾';
  if (code <= 67) return '雨';
  if (code <= 77) return '雪';
  if (code <= 82) return '阵雨';
  if (code <= 86) return '阵雪';
  return '雷雨';
}

return { readState, updateState, getPreferences, cached, clearCache, getNutrition, getCoupons, getCatalog, getWeather, callMcd,
  drain: () => stateQueue };
}

export async function readWithRetry(loader) {
  try { return await loader(); }
  catch (error) {
    if (!(error instanceof ServiceError) || /token|网络|连接|限流/.test(error.message)) throw error;
    return loader();
  }
}

export function mealContext(input) {
  const result = { storeCode: input.storeCode, orderType: input.orderType, beType: input.beType };
  if (input.orderType === 2) {
    if (!input.beCode || !input.addressId) throw new ServiceError('麦乐送需要选择完整的配送地址和门店。', 400);
    result.beCode = input.beCode;
  }
  return result;
}
