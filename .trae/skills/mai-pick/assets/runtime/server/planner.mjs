export const defaultPreferences = {
  calorieMin: 350, calorieMax: 750, proteinMin: 25, sodiumMax: 1800,
  budget: 45, monthlyBudget: 300, goal: 'balanced', likes: ['鸡肉'], excludes: '',
  drink: 'auto', side: 'any', weatherEnabled: true,
  week: ['balanced', 'balanced', 'protein', 'balanced', 'balanced', 'comfort', 'comfort'],
  city: '上海',
};

export function normalizeName(name) {
  return String(name).normalize('NFKC').replace(/^麦咖啡[™®]?/, '')
    .replace(/[\s“”"'‘’™®]/g, '').toLowerCase();
}

function csvRow(line) {
  const values = []; let value = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && line[i + 1] === '"' && quoted) { value += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) { values.push(value.trim()); value = ''; }
    else value += c;
  }
  values.push(value.trim());
  return values;
}

export function parseNutrition(data) {
  if (Array.isArray(data)) return data;
  if (typeof data !== 'string') throw new Error('营养数据格式不支持');
  const lines = data.trim().split('\n');
  const header = lines.shift()?.match(/^\[(\d+)\]\{([^}]+)\}:$/);
  if (!header) throw new Error('营养数据格式不支持');
  const keys = header[2].split(',');
  const rows = lines.filter(l => l.trim()).map(line => {
    const values = csvRow(line.trim());
    if (values.length !== keys.length) throw new Error('营养数据列数不一致');
    const row = Object.fromEntries(keys.map((key, i) => [key, i < 2 ? values[i] : Number(values[i])]));
    if (['energyKcal', 'protein', 'fat', 'carbohydrate', 'sodium'].some(k => !Number.isFinite(row[k]) || row[k] < 0)) {
      throw new Error('营养数据不完整');
    }
    return row;
  });
  if (rows.length !== Number(header[1])) throw new Error('营养数据条数不一致');
  return rows;
}

export function nutritionIndex(rows) {
  const index = new Map();
  for (const row of rows) {
    const value = {
      kcal: row.energyKcal, protein: row.protein, fat: row.fat,
      carbs: row.carbohydrate, sodium: row.sodium, calcium: row.calcium,
      sourceName: row.productName,
    };
    const key = normalizeName(row.productName);
    // Duplicate identical entries are fine; conflicting entries remain unknown.
    if (!index.has(key)) index.set(key, value);
    else if (JSON.stringify(index.get(key)) !== JSON.stringify(value)) index.set(key, null);
  }
  return index;
}

export function addNutrition(items) {
  if (!items.length || items.some(i => !i.nutrition)) return null;
  return Object.fromEntries(['kcal', 'protein', 'fat', 'carbs', 'sodium', 'calcium']
    .map(key => [key, Math.round(items.reduce((sum, i) => sum + (i.nutrition[key] ?? 0) * (i.quantity ?? 1), 0) * 10) / 10]));
}

export function foodRole(name) {
  if (/堡|麦满分|卷|粥/.test(name) || /^(麦香鸡|麦香鱼)$/.test(name)) return 'main';
  if (/套餐|件套|随心配|任选|随心拼/.test(name)) return 'bundle';
  if (/新地|麦旋风|冰淇淋/.test(name)) return 'side';
  if (/可乐|雪碧|茶|咖啡|美式|奶铁|牛奶|豆浆|果汁|苹果汁|纯悦|橙橙|麦炫酷|麦旋酷|燕麦奶|朱古力|黑巧|雪冰|怡泉/.test(name)) return 'drink';
  return 'side';
}

function parseDiffPrice(value) {
  if (value === undefined || value === null) return 0;
  const match = String(value).match(/([+-]?)\s*[¥￥]?\s*(\d+(?:\.\d+)?)/);
  return match ? Number(`${match[1]}${match[2]}`) : null;
}

export function buildVariants(base, detail, index) {
  // These aliases preserve the same official portion; no fuzzy name matching.
  const aliases = { '1700': ['麦辣鸡翅2块', '麦辣鸡翅-2块'], '3755': ['纯牛奶', '纯牛奶（盒装）'] };
  const lookup = (name, code) => index.get(normalizeName(name))
    ?? (aliases[code]?.includes(name) ? aliases[code].map(n => index.get(normalizeName(n))).find(Boolean) : null) ?? null;
  const rounds = detail.rounds ?? [];
  const coupon = base.coupon ? { couponId: base.coupon.couponId, couponCode: base.coupon.couponCode } : {};
  const finish = (name, item, nutrition, price, parts = []) => ({
    id: `${base.code}${base.coupon ? `@${base.coupon.couponId}-${base.coupon.couponCode}` : ''}:${parts.map(p => `${p.round}-${p.code}-${p.quantity ?? 1}`).join('_') || 'default'}`,
    code: base.code, name, role: rounds.length > 1 ? 'bundle' : foodRole(name), price,
    originalPrice: base.originalPrice, category: base.category, tags: base.tags,
    nutrition, item: { ...item, ...coupon }, parts: parts.map(p => `${p.name}${p.quantity > 1 ? ` ×${p.quantity}` : ''}`),
    components: parts.map(p => ({ code: p.code, name: p.name, role: foodRole(p.name), quantity: p.quantity ?? 1 })),
    offer: base.coupon?.title ?? (rounds.length > 1 ? detail.name : null),
    coupon: base.coupon ? { title: base.coupon.title } : null,
    nutritionSource: nutrition ? '麦当劳官方 MCP · 标准份量' : null,
  });
  if (!rounds.length) return [finish(detail.name, { productCode: base.code, quantity: 1 }, lookup(detail.name, base.code), base.price)];
  const options = rounds.map(round => {
    const positive = round.choices?.filter(c => c.quantity > 0) ?? [];
    const chosen = positive.length ? positive : round.choices?.filter(c => c.isDefault === 1) ?? [];
    return { round: String(round.id), choices: chosen, raw: round };
  });
  const itemFor = chosen => ({
    productCode: base.code, quantity: 1,
    roundList: chosen.map(({ round, choices }) => ({
      round, comboItemList: choices.map(c => ({ code: c.code, quantity: c.quantity > 0 ? c.quantity : 1 })),
    })),
  });
  // One-choice groups (e.g. cola sizes) have a separate nutrient record per choice.
  if (rounds.length === 1 && rounds[0].minQuantity === 1 && rounds[0].maxQuantity === 1) {
    return rounds[0].choices.map(c => {
      const diff = parseDiffPrice(c.diffPrice);
      const choice = { ...c, quantity: 1 };
      return finish(c.name, itemFor([{ round: String(rounds[0].id), choices: [choice] }]), lookup(c.name, c.code),
        diff === null || base.price === null ? null : Math.round((base.price + diff) * 100) / 100,
        [{ ...c, round: rounds[0].id }]);
    });
  }
  const fromOptions = chosen => {
    const parts = chosen.flatMap(({ round, choices }) => choices.map(c => ({ ...c, quantity: c.quantity > 0 ? c.quantity : 1, round })));
    const diffs = parts.map(c => parseDiffPrice(c.diffPrice));
    const price = base.price === null || diffs.includes(null) ? null
      : Math.round((base.price + parts.reduce((sum, c, i) => sum + diffs[i] * c.quantity, 0)) * 100) / 100;
    return finish(detail.name, itemFor(chosen), addNutrition(parts.map(c => ({
      nutrition: lookup(c.name, c.code), quantity: c.quantity,
    }))), price, parts);
  };
  const variants = [];
  // Expand single-person, one-choice-per-round packages. Other groups keep their valid default.
  if (rounds.length <= 4 && rounds.every(r => r.minQuantity === 1 && r.maxQuantity === 1)) {
    const choices = rounds.map(r => (r.choices ?? []).filter(c => c.maxQuantity !== 0 && lookup(c.name, c.code)));
    const walk = (i, chosen) => {
      if (variants.length >= 20000) { variants.truncated = true; return; }
      if (i === rounds.length) { variants.push(fromOptions(chosen)); return; }
      for (const c of choices[i]) walk(i + 1, [...chosen, { round: String(rounds[i].id), choices: [{ ...c, quantity: 1 }] }]);
    };
    walk(0, []);
  } else variants.defaultOnly = true;
  const validDefault = options.every(({ choices, raw }) => {
    const qty = choices.reduce((sum, c) => sum + (c.quantity > 0 ? c.quantity : 1), 0);
    return qty >= raw.minQuantity && (raw.maxQuantity < 0 || qty <= raw.maxQuantity);
  });
  if (validDefault) {
    const variant = fromOptions(options);
    if (!variants.some(v => v.id === variant.id)) variants.push(variant);
  }
  return variants;
}

export function isExcluded(food, preferences) {
  const exclusions = preferences.excludes.split(/[,，、\n]/).map(s => s.trim()).filter(Boolean);
  const names = [food.name, ...(food.parts ?? [])].map(normalizeName);
  if (exclusions.some(e => names.some(name => name.includes(normalizeName(e))))) return true;
  // A combo with unknown component names cannot satisfy ingredient exclusions.
  if (exclusions.length && food.item.roundList?.length && !food.parts.length) return true;
  const components = food.components?.length ? food.components : [{ name: food.name, role: food.role }];
  if (components.some(c => c.role === 'drink' && preferences.drink === 'sugarfree'
    && !/无糖|纯悦|美式|鲜萃咖啡|锡兰红茶|伯爵红茶/.test(c.name))) return true;
  if (components.some(c => c.role === 'drink' && preferences.drink === 'hot'
    && !/热|锡兰红茶|伯爵红茶|鲜萃咖啡/.test(c.name))) return true;
  if (components.some(c => c.role === 'side' && preferences.side === 'corn' && !/玉米|苹果片/.test(c.name))) return true;
  if (components.some(c => c.role === 'side' && preferences.side === 'none')) return true;
  return false;
}

export function contextFor(preferences, weather, now = new Date()) {
  const local = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const weekday = (local.getDay() + 6) % 7;
  const dayGoal = preferences.week[weekday] ?? preferences.goal;
  const goal = preferences.goal !== 'balanced' ? preferences.goal : dayGoal;
  const cold = preferences.weatherEnabled && weather && weather.temperature <= 18;
  const hot = preferences.weatherEnabled && weather && weather.temperature >= 27;
  const rain = preferences.weatherEnabled && weather && (weather.rain > 0 || weather.code >= 51);
  return { weekday, goal, cold: Boolean(cold), hot: Boolean(hot), rain: Boolean(rain),
    weekdayLabel: `星期${'一二三四五六日'[weekday]}`,
    date: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(now),
    weather, diningSuggestion: rain ? '今天有降水，可以考虑麦乐送' : '到店取餐，顺路带走',
  };
}

export function mealSignature(plan) {
  const parts = plan.foods.flatMap(f => f.components?.length ? f.components : [{ name: f.name, role: f.role }]);
  return parts.find(p => p.role === 'main')?.name ?? parts.find(p => /鸡|翅|鱼|牛/.test(p.name))?.name ?? parts[0]?.name;
}

export const comparePlans = (a, b) => a.price - b.price || b.score - a.score;

export function recommend(foods, preferences, context, { limit = 3, checkEstimatedBudget = true } = {}) {
  const known = foods.filter(f => f.nutrition && f.price !== null && !isExcluded(f, preferences));
  const mains = known.filter(f => ['main', 'bundle'].includes(f.role));
  const sides = known.filter(f => f.role === 'side');
  const drinks = known.filter(f => f.role === 'drink');
  const combinations = [];
  for (const main of mains) {
    for (const side of [null, ...sides]) {
      for (const drink of [null, ...drinks]) {
        const components = main.components ?? [];
        if (side && components.some(c => c.role === 'side') || drink && components.some(c => c.role === 'drink')) continue;
        const items = [main, side, drink].filter(Boolean);
        const nutrition = addNutrition(items);
        const price = Math.round(items.reduce((sum, f) => sum + f.price, 0) * 100) / 100;
        if (nutrition.kcal < preferences.calorieMin || nutrition.kcal > preferences.calorieMax
          || nutrition.protein < preferences.proteinMin || nutrition.sodium > preferences.sodiumMax
          || checkEstimatedBudget && price > preferences.budget) continue;
        const target = context.goal === 'light' ? preferences.calorieMin + 100 : (preferences.calorieMin + preferences.calorieMax) / 2;
        let score = 70 - Math.abs(nutrition.kcal - target) / 20;
        score += Math.min(nutrition.protein - preferences.proteinMin, 20) * (context.goal === 'protein' ? 1.2 : 0.4);
        score -= nutrition.sodium / 200;
        const reasons = [`${nutrition.kcal} kcal，符合你的热量范围`, `蛋白质 ${nutrition.protein} g，达到目标`];
        if (preferences.likes.some(like => items.some(f => [f.name, ...f.parts].join(' ').includes(like.replace('肉', ''))))) {
          score += 10; reasons.push('优先搭配你喜欢的口味');
        }
        if (drink && /无糖|纯悦|美式|鲜萃|锡兰|伯爵/.test(drink.name)) score += 3;
        const drinkName = drink?.name ?? components.find(c => c.role === 'drink')?.name;
        const sideName = side?.name ?? components.find(c => c.role === 'side')?.name;
        if (preferences.drink === 'auto' && context.cold && drinkName && /热|锡兰红茶|伯爵红茶|鲜萃/.test(drinkName)) {
          score += 7; reasons.push('天气偏凉，搭配一杯热饮');
        }
        if (preferences.drink === 'auto' && context.hot && drinkName && /冰|可乐|纯悦/.test(drinkName)) {
          score += 7; reasons.push('天气偏热，搭配清爽饮品');
        }
        if (context.goal === 'comfort' && sideName && /薯条|麦乐鸡|翅/.test(sideName)) {
          score += 7; reasons.push(`${context.weekdayLabel}，给自己一点喜欢的味道`);
        }
        if (context.goal === 'light' && sideName && /玉米|苹果/.test(sideName)) { score += 7; reasons.push('今日轻盈偏好，优先蔬果小食'); }
        if (drink) score += 2;
        combinations.push({ id: items.map(i => i.id).join('|'), foods: items, nutrition, price, score, reasons });
      }
    }
  }
  combinations.sort(comparePlans);
  const result = [];
  for (const combo of combinations) {
    if (limit !== Infinity && result.some(r => mealSignature(r) === mealSignature(combo))) continue;
    result.push(combo);
    if (result.length === limit) break;
  }
  return {
    plans: result,
    stats: { menu: foods.length, matched: foods.filter(f => f.nutrition).length, eligible: known.length, combinations: combinations.length },
    message: result.length ? null : '当前门店没有同时满足全部条件的组合。可以调整预算、蛋白质或热量范围后重试；限制没有被自动放宽。',
  };
}
