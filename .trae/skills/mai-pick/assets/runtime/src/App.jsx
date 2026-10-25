import { useEffect, useRef, useState } from 'react';
import { OffersPage, JournalPage, PriceSavings } from './Economy.jsx';
import {
  ArrowUpRight, ArrowRight, Check, ChevronDown, ChevronRight, CloudSun, Coffee,
  Flame, Heart, History, Leaf, LoaderCircle, MapPin, Menu, Minus, Plus,
  RefreshCw, Settings2, ShieldCheck, ShoppingBag, SlidersHorizontal, Sparkles,
  Sun, Utensils, X, Zap, AlertCircle, Bike, Store, CircleHelp, CheckCircle2, Ticket, Wallet,
} from 'lucide-react';

const goals = [
  { id: 'balanced', name: '均衡一点', icon: Leaf, description: '营养与口味，刚好平衡' },
  { id: 'protein', name: '多点蛋白', icon: Zap, description: '同价时，优先多一点蛋白' },
  { id: 'light', name: '轻盈一餐', icon: Flame, description: '在热量范围内，吃得轻一点' },
  { id: 'comfort', name: '快乐就好', icon: Heart, description: '满足营养条件，也满足胃口' },
];
const initialPreferences = {
  calorieMin: 350, calorieMax: 750, proteinMin: 25, sodiumMax: 1800,
  budget: 45, monthlyBudget: 300, goal: 'balanced', likes: ['鸡肉'], excludes: '', drink: 'auto',
  side: 'any', weatherEnabled: true, city: '上海',
  week: ['balanced', 'balanced', 'protein', 'balanced', 'balanced', 'comfort', 'comfort'],
};
const navItems = [
  { id: 'home', label: '智能搭配', icon: Sparkles },
  { id: 'menu', label: '门店菜单', icon: Utensils },
  { id: 'offers', label: '优惠与领券', icon: Ticket },
  { id: 'journal', label: '常点与预算', icon: Wallet },
  { id: 'preferences', label: '我的偏好', icon: SlidersHorizontal },
  { id: 'history', label: '点餐记录', icon: History },
];
async function api(path, options = {}) {
  const requestKey = sessionKey;
  const response = await fetch(`/api${path}`, {
    ...options, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Mai-Request': '1',
      ...(requestKey ? { 'X-Mai-Session': requestKey } : {}), ...options.headers },
  });
  let data;
  try { data = await response.json(); }
  catch { throw new Error('本地服务未响应，请确认服务已经启动。'); }
  if (path !== '/bootstrap' && requestKey !== sessionKey) {
    const error = new Error('连接已变化，已忽略旧请求。'); error.stale = true; throw error;
  }
  if (!response.ok) {
    const error = new Error(data.error ?? '请求失败，请重试。');
    if (data.code === 'SESSION_CHANGED') {
      error.stale = true;
      window.dispatchEvent(new Event('mai-session-changed'));
    }
    throw error;
  }
  return data;
}
let sessionKey = '';
const post = body => ({ method: 'POST', body: JSON.stringify(body) });
const money = value => Number(value).toFixed(2).replace(/\.00$/, '');
const foodEmoji = name => /牛|巨无霸|吉士|堡|麦满分|卷/.test(name) ? '🍔'
  : /薯/.test(name) ? '🍟' : /玉米/.test(name) ? '🌽' : /鸡|翅/.test(name) ? '🍗'
    : /奶|豆浆/.test(name) ? '🥛' : /茶|咖啡|美式|奶铁/.test(name) ? '☕'
      : /可乐|雪碧|纯悦|汁|橙/.test(name) ? '🥤' : /冰|新地|麦旋风/.test(name) ? '🍦' : '🥣';
const goalName = id => goals.find(g => g.id === id)?.name ?? '均衡一点';
function readSelection(key) {
  try { return JSON.parse(sessionStorage.getItem(`mai-pick-store:${key}`)); } catch { return null; }
}
function getContext(selection) {
  return {
    storeCode: selection.store.storeCode,
    orderType: selection.mode === 'delivery' ? 2 : 1,
    beType: selection.mode === 'delivery' ? 2 : 1,
    ...(selection.mode === 'delivery' ? { beCode: selection.store.beCode, addressId: selection.address.addressId } : {}),
  };
}
const params = object => new URLSearchParams(Object.entries(object).filter(([, v]) => v !== undefined)).toString();

function ConnectionGuide({ connection, nutritionCount, token, onToken, onConnect, busy, error, onDisconnect }) {
  return <div className="connection-guide">
    <div className="connection-banner"><ShieldCheck size={24} /><div>
      <strong>{connection.connected ? '你的麦当劳账号已连接' : '先连接你自己的麦当劳账号'}</strong>
      <p>{connection.connected ? `已获得 ${nutritionCount} 条官方营养记录` : '用你的账号查询门店、优惠券和配送地址。'}</p>
    </div></div>
    <ol className="connection-steps">
      <li><span>1</span><div><strong>打开麦当劳官方平台</strong>
        <a href="https://open.mcd.cn/mcp" target="_blank" rel="noopener noreferrer" className="text-button">前往开放平台 <ArrowUpRight size={14} /></a></div></li>
      <li><span>2</span><div><strong>登录自己的账号，获取 MCP token</strong><p>在官方平台完成登录和授权，然后复制 token。</p></div></li>
      <li><span>3</span><div><strong>粘贴到下面，验证连接</strong><p>连接成功后，就可以选餐厅、设偏好、比较实付价。</p></div></li>
    </ol>
    <form onSubmit={e => { e.preventDefault(); onConnect(); }}>
      <div className="field"><label htmlFor="token">{connection.connected ? '更新账号连接' : '你的 MCP token'}</label>
        <input id="token" type="password" autoComplete="off" spellCheck={false} value={token}
          onChange={e => onToken(e.target.value)} placeholder="粘贴从官方平台复制的 token" required minLength={10} maxLength={200} disabled={busy} />
      </div>
      {error && <div className="inline-error" role="alert"><AlertCircle size={16} />{error}</div>}
      <button className="button primary checkout" disabled={busy || !token.trim()}>{busy ? <LoaderCircle size={17} className="spin" /> : <ShieldCheck size={17} />}
        {busy ? '正在验证你的连接…' : connection.connected ? '验证并更新连接' : '验证连接，开始搭餐'}<ArrowRight size={16} /></button>
    </form>
    <p className="connection-privacy"><ShieldCheck size={14} /><span>token 仅保存在服务端内存中；验证后清空输入框。<br />同一浏览器的标签页共用会话；其他浏览器会话分别连接。服务重启后需重新连接。</span></p>
    {onDisconnect && connection.configured && <button className="button outline checkout" disabled={busy} onClick={onDisconnect}>断开连接并清除本会话数据</button>}
  </div>;
}

function Modal({ title, subtitle, children, onClose, className = '' }) {
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', handler); document.body.style.overflow = before; };
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        <button className="icon-button" onClick={onClose} aria-label="关闭弹窗"><X size={20} /></button></div>
      {children}
    </section>
  </div>;
}

function StorePicker({ preferences, onSelect, onClose }) {
  const [mode, setMode] = useState('pickup');
  const [city, setCity] = useState(preferences.city);
  const [keyword, setKeyword] = useState('');
  const [stores, setStores] = useState([]);
  const [addresses, setAddresses] = useState([]);
  const [addressId, setAddressId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  async function search(favorites = false, nextMode = mode, selectedAddress = addressId) {
    setLoading(true); setError(''); setStores([]); setSearched(true);
    try {
      const query = nextMode === 'delivery'
        ? { mode: nextMode, addressId: selectedAddress }
        : { mode: nextMode, city, keyword, favorites };
      if (nextMode === 'delivery' && !selectedAddress) return;
      const result = await api(`/stores?${params(query)}`);
      setStores(result.stores);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }
  useEffect(() => { search(true); }, []);
  async function changeMode(value) {
    setMode(value); setStores([]); setError(''); setSearched(false);
    if (value === 'delivery') {
      setLoading(true);
      try {
        const result = await api('/addresses');
        setAddresses(result.addresses);
        if (result.addresses.length) {
          setAddressId(result.addresses[0].addressId);
          await search(false, value, result.addresses[0].addressId);
        }
      } catch (e) { setError(e.message); } finally { setLoading(false); }
    } else await search(true, value);
  }
  return <Modal title="今天从哪家出发？" subtitle="选择真实门店，获取它当前可售的菜单。" onClose={onClose}>
    <div className="segmented">
      <button className={mode === 'pickup' ? 'active' : ''} onClick={() => changeMode('pickup')}><Store size={17} /> 到店取餐</button>
      <button className={mode === 'delivery' ? 'active' : ''} onClick={() => changeMode('delivery')}><Bike size={17} /> 麦乐送</button>
    </div>
    {mode === 'pickup' ? <>
      <form className="store-search" onSubmit={e => { e.preventDefault(); search(); }}>
        <label className="sr-only" htmlFor="store-city">城市</label><input id="store-city" value={city} onChange={e => setCity(e.target.value)} placeholder="城市" required />
        <label className="sr-only" htmlFor="store-keyword">地址或门店关键词</label><input id="store-keyword" value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="地址 / 商场 / 餐厅名" />
        <button className="button primary small" disabled={loading}>搜索</button>
      </form>
      <button className="text-button favorite-link" disabled={loading} onClick={() => search(true)}><Heart size={14} /> 查看我收藏的餐厅</button>
    </> : <div className="field">
      <label htmlFor="delivery-address">送到已保存的地址</label>
      {addresses.length ? <select id="delivery-address" value={addressId} onChange={e => { setAddressId(e.target.value); search(false, 'delivery', e.target.value); }}>
        {addresses.map(a => <option value={a.addressId} key={a.addressId}>{a.fullAddress} · {a.contactName} {a.phone}</option>)}
      </select> : !loading && <p className="empty-message">暂无配送地址，请先在麦当劳 App 中添加地址。</p>}
    </div>}
    {error && <div className="inline-error"><AlertCircle size={16} />{error}</div>}
    <div className="store-results">
      {loading ? <Loading text="正在查询可用门店…" /> : stores.map(store => <button key={store.storeCode} className="store-option"
        onClick={() => onSelect({ mode, store, address: addresses.find(a => a.addressId === addressId) })}>
        <span className="store-icon"><Store size={20} /></span><span><strong>{store.storeName}</strong><small>{store.address ?? store.storeAddress}</small>
          {store.distance > 0 && <small>{store.distance >= 1000 ? `${(store.distance / 1000).toFixed(1)} km` : `${store.distance} m`}</small>}</span><ChevronRight size={18} />
      </button>)}
      {!loading && searched && !stores.length && !error && <div className="empty-state compact"><MapPin size={28} /><h3>暂时没有找到门店</h3><p>试试更具体的地址，或切换取餐方式。</p></div>}
    </div>
    <p className="fine-print">收藏餐厅可能位于不同城市，请确认本次要去的门店。</p>
  </Modal>;
}

function Loading({ text = '正在加载…' }) {
  return <div className="loading"><LoaderCircle size={22} className="spin" /><span>{text}</span></div>;
}
function NutritionGrid({ value, compact = false }) {
  return <div className={`nutrition-grid ${compact ? 'compact' : ''}`}>
    {[['kcal', '热量', 'kcal'], ['protein', '蛋白质', 'g'], ['carbs', '碳水', 'g'], ['fat', '脂肪', 'g']].map(([key, name, unit]) =>
      <div key={key}><strong>{value ? value[key] : '—'}<small>{unit}</small></strong><span>{name}</span></div>)}
  </div>;
}

function PlanCard({ plan, index, onAdd, onSave, busy }) {
  const parts = plan.foods.flatMap(f => f.parts?.length ? f.parts : [f.name]);
  return <article className={`plan-card ${index === 0 ? 'recommended' : ''}`}>
    <div className="plan-label"><span>{index === 0 ? <><Sparkles size={13} /> 已核价首选</> : index === 1 ? '换个口味' : '另一种搭配'}</span><span className="plan-number">0{index + 1}</span></div>
    <div className="plan-food-art" aria-hidden="true">{parts.slice(0, 3).map((name, i) => <span key={`${name}-${i}`} style={{ '--tilt': `${(i - 1) * 8}deg` }}>{foodEmoji(name)}</span>)}</div>
    <h3>{plan.foods[0].name}</h3><p className="plan-ingredients">{parts.join(' + ')}</p>
    {plan.foods.some(f => f.coupon) && <span className="offer-badge">使用账户可用优惠券</span>}
    <NutritionGrid value={plan.nutrition} compact />
    <div className="plan-reason"><CheckCircle2 size={14} /><span>{plan.reasons[0]}</span></div>
    {plan.savings?.officialSavings > 0 && <p className="plan-savings">较官方原价优惠 ¥{money(plan.savings.officialSavings / 100)}</p>}
    <div className="plan-bottom"><div><small>官方核价 · 不含餐具</small><strong><span>¥</span>{money(plan.price)}</strong></div>
      <button onClick={() => onAdd(plan.foods)} className={index === 0 ? 'button primary small' : 'button outline small'}><Plus size={15} /> 选这餐</button></div>
    <button className="text-button save-meal" disabled={busy} onClick={() => onSave(plan.foods)}><Heart size={14} />存为常点</button>
  </article>;
}

function Cart({ cart, preferences, selection, onQuantity, onRemove, onQuote, busy, onClear, onSave }) {
  const nutrition = cart.length ? cart.every(f => f.nutrition) ? {
    ...Object.fromEntries(['kcal', 'protein', 'carbs', 'fat', 'sodium'].map(k => [k, Math.round(cart.reduce((sum, f) => sum + f.nutrition[k] * f.quantity, 0) * 10) / 10])),
  } : null : null;
  const total = cart.reduce((sum, f) => sum + (f.price ?? 0) * f.quantity, 0);
  const [tableware, setTableware] = useState(false);
  const over = nutrition && (nutrition.kcal > preferences.calorieMax || nutrition.sodium > preferences.sodiumMax);
  return <aside className="cart-panel">
    <div className="cart-heading"><div><ShoppingBag size={18} /><h2>我的这一餐</h2><span>{cart.reduce((sum, f) => sum + f.quantity, 0)}</span></div>
      {!!cart.length && <button className="text-button" onClick={onClear}>清空</button>}</div>
    {cart.length ? <div className="cart-list">{cart.map(food => <div className="cart-item" key={food.id}>
      <span className="cart-food-icon">{foodEmoji(food.name)}</span><div className="cart-item-content"><strong>{food.name}</strong>
        {!!food.parts?.length && <p className="cart-components">{food.parts.join(' + ')}</p>}
        {food.coupon && <span className="offer-badge">已选优惠券</span>}
        <small>{food.nutrition ? `${food.nutrition.kcal} kcal / 份` : '暂无匹配的营养数据'}</small>
        <div className="cart-item-bottom"><span>¥{money(food.price)}</span><div className="quantity">
          <button onClick={() => food.quantity === 1 ? onRemove(food.id) : onQuantity(food.id, -1)} aria-label={`减少${food.name}`}><Minus size={12} /></button>
          <span>{food.quantity}</span><button disabled={food.quantity >= 10} onClick={() => onQuantity(food.id, 1)} aria-label={`增加${food.name}`}><Plus size={12} /></button>
        </div></div></div>
    </div>)}</div> : <div className="cart-empty"><span><ShoppingBag size={30} strokeWidth={1.4} /></span><h3>等一顿刚刚好的美味</h3><p>选一个推荐组合，<br />或者去菜单里自由搭配。</p></div>}
    <div className="cart-nutrition"><div className="mini-heading"><Leaf size={14} /><span>这一餐的营养</span><small>标准份量</small></div>
      <NutritionGrid value={nutrition} />
      <div className="calorie-bar"><div style={{ width: nutrition ? `${Math.min(nutrition.kcal / preferences.calorieMax * 100, 100)}%` : '0%' }} className={over ? 'over' : ''} /></div>
      <div className="calorie-caption"><span>{nutrition ? `${nutrition.kcal} / ${preferences.calorieMax} kcal` : '加入餐品后计算'}</span><span>{nutrition ? `钠 ${nutrition.sodium} mg` : '官方营养数据'}</span></div>
      {cart.length > 0 && !nutrition && <p className="cart-warning">含营养未知餐品，无法计算完整总量。</p>}
      {over && <p className="cart-warning">当前组合超过你设定的热量或钠上限。</p>}
      {nutrition && nutrition.protein < preferences.proteinMin && <p className="cart-warning">蛋白质未达到你设定的目标。</p>}
    </div>
    <label className="checkbox-line"><input type="checkbox" checked={tableware} onChange={e => setTableware(e.target.checked)} /><span>需要餐具</span><Leaf size={13} /></label>
    <div className="cart-total"><span>菜单预估</span><strong><small>¥</small>{cart.length ? money(total) : '0'}</strong></div>
    {!!cart.length && <button className="text-button save-meal" disabled={busy} onClick={() => onSave(cart)}><Heart size={14} />把这一餐存为常点</button>}
    {total > preferences.budget && <p className="cart-warning">菜单估价超过 ¥{preferences.budget} 预算。</p>}
    <button className="button primary checkout" disabled={!cart.length || !selection || busy} onClick={() => onQuote(tableware)}>
      {busy ? <LoaderCircle size={17} className="spin" /> : <ShoppingBag size={17} />}{busy ? '正在计算实时价格…' : '去结算'}<ArrowRight size={17} />
    </button>
    <p className="checkout-note"><ShieldCheck size={12} /> 确认金额后提交 · 在官方页面支付</p>
  </aside>;
}

function Preferences({ value, onSave, busy }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const change = (key, val) => setDraft(p => ({ ...p, [key]: val }));
  return <div className="preferences-page">
    <div className="page-intro"><span className="eyebrow">YOUR TASTE, YOUR RULES</span><h1>让每一餐，更懂你。</h1><p>把偏好告诉麦搭，以后的选择就简单一点。</p></div>
    <form onSubmit={e => { e.preventDefault(); onSave(draft); }}>
      <section className="settings-card"><div className="section-title"><Leaf size={20} /><div><h2>营养与预算</h2><p>以下条件会作为自动推荐的硬性限制。</p></div></div>
        <div className="settings-fields">
          <NumericField label="热量下限" unit="kcal" value={draft.calorieMin} onChange={v => change('calorieMin', v)} min={0} max={2000} />
          <NumericField label="热量上限" unit="kcal" value={draft.calorieMax} onChange={v => change('calorieMax', v)} min={100} max={2500} />
          <NumericField label="至少摄入蛋白质" unit="g" value={draft.proteinMin} onChange={v => change('proteinMin', v)} min={0} max={150} />
          <NumericField label="钠含量上限" unit="mg" value={draft.sodiumMax} onChange={v => change('sodiumMax', v)} min={100} max={5000} />
          <NumericField label="单餐预算" unit="元" value={draft.budget} onChange={v => change('budget', v)} min={1} max={500} step={0.5} />
          <NumericField label="本月麦当劳预算" unit="元" value={draft.monthlyBudget} onChange={v => change('monthlyBudget', v)} min={0} max={10000} step={1} />
          <div className="field"><label htmlFor="pref-city">天气所在城市</label><input id="pref-city" value={draft.city} required maxLength={40} onChange={e => change('city', e.target.value)} /></div>
        </div><p className="fine-print">单餐预算是推荐硬限制，包含配送、打包费用，不含餐具。月预算用于已确认支出的复盘和余额提醒，不强制阻止下单；设为 0 表示本月不计划支出。</p>
      </section>
      <section className="settings-card"><div className="section-title"><Heart size={20} /><div><h2>口味小档案</h2><p>满足营养和忌口后先选低价，同价时优先你喜欢的食物。</p></div></div>
        <label className="field-label">喜欢的口味</label><div className="preference-chips">{['鸡肉', '牛肉', '鱼', '薯条', '玉米', '咖啡'].map(like => <button key={like} type="button" className={`choice-chip ${draft.likes.includes(like) ? 'selected' : ''}`} onClick={() => change('likes', draft.likes.includes(like) ? draft.likes.filter(l => l !== like) : [...draft.likes, like])}>
          {draft.likes.includes(like) && <Check size={14} />}{like}</button>)}</div>
        <div className="field"><label htmlFor="excludes">不想吃的餐品 / 名称关键词</label><input id="excludes" placeholder="例如：麦辣、培根、薯条，用逗号分隔" maxLength={200} value={draft.excludes} onChange={e => change('excludes', e.target.value)} />
          <small>按餐品名称排除。官方营养接口不含完整配料和过敏原信息。</small></div>
        <div className="settings-fields">
          <div className="field"><label htmlFor="drink-pref">饮品偏好</label><select id="drink-pref" value={draft.drink} onChange={e => change('drink', e.target.value)}>
            <option value="auto">跟着天气走</option><option value="sugarfree">只要无糖饮品</option><option value="hot">只要热饮</option><option value="any">都可以</option>
          </select></div>
          <div className="field"><label htmlFor="side-pref">小食偏好</label><select id="side-pref" value={draft.side} onChange={e => change('side', e.target.value)}>
            <option value="any">自由搭配</option><option value="corn">只要玉米 / 苹果片</option><option value="none">不要小食</option>
          </select></div>
        </div>
        <label className="checkbox-line"><input type="checkbox" checked={draft.weatherEnabled} onChange={e => change('weatherEnabled', e.target.checked)} /><span>让实时天气参与推荐</span><CloudSun size={16} /></label>
      </section>
      <section className="settings-card"><div className="section-title"><Sun size={20} /><div><h2>一周的饮食节奏</h2><p>“均衡一点”模式下使用当天安排；其他模式优先于星期安排。</p></div></div>
        <div className="week-settings">{draft.week.map((goal, i) => <div key={i}><span>星期{'一二三四五六日'[i]}</span>
          <select aria-label={`星期${'一二三四五六日'[i]}饮食偏好`} value={goal} onChange={e => change('week', draft.week.map((g, j) => i === j ? e.target.value : g))}>{goals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
        </div>)}</div>
      </section>
      <div className="settings-save"><span><ShieldCheck size={15} /> 新会话最长保留 90 天，断开连接时清除</span><button className="button primary" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}保存我的偏好</button></div>
    </form>
  </div>;
}

function NumericField({ label, unit, value, onChange, ...props }) {
  return <label className="field"><span>{label}</span><span className="input-with-unit"><input type="number" required value={value} onChange={e => onChange(Number(e.target.value))} {...props} /><span>{unit}</span></span></label>;
}

function Checkout({ quote, selection, cart, busy, onSubmit, onClose }) {
  const [takeWay, setTakeWay] = useState('');
  const [remark, setRemark] = useState('');
  const [seconds, setSeconds] = useState(Math.max(0, Math.floor((quote.expiresAt - Date.now()) / 1000)));
  useEffect(() => { const timer = setInterval(() => setSeconds(Math.max(0, Math.floor((quote.expiresAt - Date.now()) / 1000))), 1000); return () => clearInterval(timer); }, [quote.expiresAt]);
  const { price } = quote;
  const valid = selection.mode === 'delivery' || takeWay;
  return <Modal title="确认这一餐" subtitle="金额来自麦当劳实时结算，请核对后提交。" onClose={busy ? () => {} : onClose}>
    <div className="checkout-location"><MapPin size={18} /><div><strong>{selection.store.storeName}</strong><small>{selection.mode === 'delivery' ? selection.address.fullAddress : selection.store.address}</small><small>{selection.mode === 'delivery' ? '麦乐送' : '到店取餐'}</small></div></div>
    <div className="checkout-products">{(price.productList ?? cart.map(f => ({ productCode: f.id, productName: f.name, quantity: f.quantity, subtotal: Math.round(f.price * f.quantity * 100) }))).map((f, i) => <div key={`${f.productCode}-${i}`}><span>{f.productName} <small>× {f.quantity}</small></span><strong>¥{money(f.subtotal / 100)}</strong></div>)}</div>
    {cart.some(f => f.parts?.length) && <p className="checkout-components">{cart.filter(f => f.parts?.length).map(f => `${f.name}：${f.parts.join(' + ')}`).join('；')}</p>}
    <div className="checkout-fees">{[['商品金额', price.productPrice], ['配送费', price.deliveryPrice], ['打包费', price.packingPrice], ['餐具费', price.tablewarePrice]].map(([name, amount]) => amount !== undefined && <div key={name}><span>{name}</span><span>¥{money(amount / 100)}</span></div>)}</div>
    <div className="checkout-final"><span>实际应付</span><strong>¥{money(price.price / 100)}</strong></div>
    <PriceSavings savings={quote.savings} comparison={quote.comparison} />
    {price.price / 100 > selection.budget && <div className="inline-error"><AlertCircle size={15} />实时总价已超出你设定的 ¥{selection.budget} 预算，请核对。</div>}
    {quote.unknownNutrition.length > 0 && <p className="inline-error">以下餐品营养未知：{quote.unknownNutrition.join('、')}，无法核对完整营养总量。</p>}
    {selection.mode === 'pickup' && <div className="field"><label>选择取餐方式</label><div className="takeways">{(price.takeWayList ?? []).map(t => <label key={t.code} className={takeWay === t.code ? 'selected' : ''}>
      <input type="radio" name="takeway" value={t.code} checked={takeWay === t.code} onChange={() => setTakeWay(t.code)} /><span><strong>{t.title}</strong><small>{t.subtitle}</small></span>
    </label>)}</div></div>}
    {selection.mode === 'delivery' && <div className="field"><label htmlFor="remark">配送备注（可选）</label><input id="remark" maxLength={50} value={remark} onChange={e => setRemark(e.target.value)} placeholder="例如：无接触配送" /></div>}
    <button className="button primary checkout" disabled={busy || !valid || !seconds} onClick={() => onSubmit(takeWay, remark)}>{busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}
      {busy ? '正在提交，请勿重复操作…' : '确认提交，前往官方支付'}<ArrowUpRight size={16} /></button>
    <p className="fine-print centered">{seconds ? `报价剩余 ${seconds} 秒；提交前会再次核验金额。` : '报价已过期，请关闭后重新结算。'}<br />点击提交会创建真实订单，支付由你在官方页面完成。</p>
  </Modal>;
}

function PaymentResult({ order, onClose }) {
  let url = null;
  try { const parsed = new URL(order.payH5Url); if (parsed.protocol === 'https:') url = parsed.href; } catch { /* Missing URL is shown explicitly. */ }
  return <Modal title="这一餐，准备好了。" onClose={onClose}>
    <div className="payment-success"><CheckCircle2 size={48} /><h3>订单已创建，请完成支付</h3><p>订单号：{order.orderId}</p><p>{order.orderDetail?.storeName}</p></div>
    {url ? <a className="button primary checkout" href={url} target="_blank" rel="noopener noreferrer">打开官方支付页面 <ArrowUpRight size={17} /></a> : <div className="inline-error">接口未返回有效支付链接，请在麦当劳 App 中查看并支付。</div>}
    <p className="fine-print centered">创建订单不代表已支付，请以麦当劳 App 的订单状态为准。</p>
  </Modal>;
}

export default function App() {
  const [page, setPage] = useState('home');
  const [preferences, setPreferences] = useState(initialPreferences);
  const [connection, setConnection] = useState({ configured: false, connected: false });
  const [nutritionCount, setNutritionCount] = useState(0);
  const [context, setContext] = useState(null);
  const [selection, setSelection] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [plans, setPlans] = useState([]);
  const [stats, setStats] = useState(null);
  const [planMessage, setPlanMessage] = useState('');
  const [priceScope, setPriceScope] = useState('');
  const [cart, setCart] = useState([]);
  const [busy, setBusy] = useState({});
  const [booting, setBooting] = useState(true);
  const [picker, setPicker] = useState(false);
  const [settings, setSettings] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [toast, setToast] = useState(null);
  const [quote, setQuote] = useState(null);
  const [order, setOrder] = useState(null);
  const [history, setHistory] = useState([]);
  const [offers, setOffers] = useState(null);
  const [journal, setJournal] = useState(null);
  const [favorites, setFavorites] = useState([]);
  const mealsRequest = useRef(0);
  const offersRequest = useRef(0);
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [token, setToken] = useState('');
  const [connectionError, setConnectionError] = useState('');

  const showError = e => { if (!e.stale) setToast({ type: 'error', text: e.message }); };
  const flag = (key, value) => setBusy(b => ({ ...b, [key]: value }));
  function clearAccountView() {
    try { sessionStorage.removeItem(`mai-pick-store:${sessionKey}`); localStorage.removeItem('mai-pick-store'); } catch {}
    mealsRequest.current++; offersRequest.current++;
    setSelection(null); setCart([]); setQuote(null); setOrder(null); setCatalog([]); setPlans([]); setHistory([]);
    setOffers(null); setJournal(null); setFavorites([]);
    setStats(null); setPlanMessage(''); setPriceScope(''); setCategory('all'); setSearch('');
    setPicker(false); setSettings(false); setPage('home'); setToken(''); setBusy({});
  }
  async function bootstrap() {
      setBooting(true);
      try {
        const data = await api('/bootstrap');
        sessionKey = data.session.key;
        setPreferences(data.preferences); setConnection(data.connection); setNutritionCount(data.nutritionCount); setContext(data.context);
        setConnectionError(data.connection.error ?? '');
        if (data.connection.connected) {
          api(`/weather?city=${encodeURIComponent(data.preferences.city)}`).then(w => setContext(w.context)).catch(() => {});
          const stored = readSelection(sessionKey);
          if (stored) { setSelection(stored); await loadMeals(stored); }
        }
      } catch (e) { setConnectionError(e.message); showError(e); } finally { setBooting(false); }
  }
  useEffect(() => {
    bootstrap();
    const changed = () => { clearAccountView(); sessionKey = ''; setConnection({ configured: false, connected: false }); bootstrap(); };
    window.addEventListener('mai-session-changed', changed);
    return () => window.removeEventListener('mai-session-changed', changed);
  }, []);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(null), toast.type === 'error' ? 10000 : 4000); return () => clearTimeout(timer); } }, [toast]);
  useEffect(() => { if (page === 'history' && connection.connected) api('/history').then(data => setHistory(data.orders)).catch(showError); }, [page, connection.connected]);
  useEffect(() => {
    if (connection.connected) {
      refreshOffers();
      refreshJournal();
    }
  }, [connection.connected, selection]);
  useEffect(() => { if (connection.connected && page === 'journal') refreshJournal(); }, [page]);

  async function refreshOffers(refresh = false) {
    const request = ++offersRequest.current;
    flag('offers', true);
    try {
      const query = { ...(selection ? getContext(selection) : {}), ...(refresh ? { refresh: true } : {}) };
      const data = await api(`/offers?${params(query)}`);
      if (request === offersRequest.current) setOffers(data);
    } catch (e) { showError(e); }
    finally { if (request === offersRequest.current) flag('offers', false); }
  }
  async function refreshJournal() {
    try {
      const [data, saved] = await Promise.all([api('/journal'), api('/favorites')]);
      setJournal(data.summary); setFavorites(saved.favorites);
    } catch (e) { showError(e); }
  }
  async function claimCoupons() {
    if (!offers?.claimId) return;
    mealsRequest.current++; setQuote(null); setPlans([]); setCart([]);
    flag('claim', true);
    try {
      const data = await api('/offers/claim', post({ claimId: offers.claimId, confirmed: true }));
      setToast({ type: 'success', text: data.message });
      await refreshOffers(true);
      if (selection) await loadMeals();
    } catch (e) { showError(e); await refreshOffers(true); }
    finally { flag('claim', false); }
  }
  async function resetClaim() {
    flag('claim', true);
    try { await api('/offers/claim-reset', post({ verifiedInOfficialApp: true })); await refreshOffers(true); }
    catch (e) { showError(e); }
    finally { flag('claim', false); }
  }
  async function saveFavorite(foods) {
    if (!selection) return;
    flag('favorite', true);
    try {
      const data = await api('/favorites', post({ context: getContext(selection),
        selections: foods.map(f => ({ id: f.id, quantity: f.quantity ?? 1 })) }));
      setFavorites(data.favorites); setToast({ type: 'success', text: '已存为常点，下次会重新核对价格和营养条件。' });
    } catch (e) { showError(e); }
    finally { flag('favorite', false); }
  }
  async function reuseFavorite(id) {
    if (!selection) { setPicker(true); return; }
    flag('favorite', true);
    try {
      const data = await api(`/favorites/${id}/reuse`, post({ context: getContext(selection) }));
      addFoods(data.plan.foods, true); setPage('home');
      setToast({ type: 'success', text: `已按当前优惠核价 ¥${money(data.plan.price)}，放入购物袋。` });
    } catch (e) { showError(e); }
    finally { flag('favorite', false); }
  }
  async function removeFavorite(id) {
    try { const data = await api(`/favorites/${id}`, { method: 'DELETE' }); setFavorites(data.favorites); }
    catch (e) { showError(e); }
  }
  async function syncHistory() {
    flag('sync', true);
    try {
      const result = await api('/history/sync', post({}));
      await refreshJournal();
      const data = await api('/history'); setHistory(data.orders);
      setToast({ type: result.errors.length ? 'info' : 'success',
        text: `已更新 ${result.updated} 笔官方订单状态。${result.errors.join('；')}` });
    } catch (e) { showError(e); }
    finally { flag('sync', false); }
  }

  async function loadMeals(nextSelection = selection) {
    if (!nextSelection) { setPicker(true); return; }
    const request = ++mealsRequest.current;
    flag('meals', true); setPlans([]); setCatalog([]); setPlanMessage(''); setPriceScope(''); setStats(null); setCategory('all'); setSearch('');
    try {
      const ctx = getContext(nextSelection);
      const [menu, recommendation] = await Promise.all([
        api(`/menu?${params(ctx)}`),
        api('/recommend', post({ context: ctx })),
      ]);
      if (request !== mealsRequest.current) return;
      setCatalog(menu.foods); setPlans(recommendation.plans); setStats(recommendation.stats);
      setPlanMessage(recommendation.message); setContext(recommendation.context);
      setPriceScope(recommendation.scope);
      if (recommendation.couponError) setPlanMessage('账户优惠券暂不可查询，本次只比较门店菜单。');
      if (menu.skipped) setToast({ type: 'info', text: `${menu.skipped} 款餐品详情暂不可用，已从菜单中移除。` });
    } catch (e) { if (request === mealsRequest.current) { showError(e); if (!e.stale) setPlanMessage(e.message); } }
    finally { if (request === mealsRequest.current) flag('meals', false); }
  }
  function chooseStore(value) {
    setSelection(value); setPicker(false); setCart([]); setQuote(null);
    try { sessionStorage.setItem(`mai-pick-store:${sessionKey}`, JSON.stringify(value)); } catch {}
    loadMeals(value);
  }
  async function savePreferences(value, notify = true) {
    flag('preferences', true);
    try {
      const data = await api('/preferences', { method: 'PUT', body: JSON.stringify(value) });
      setPreferences(data.preferences);
      refreshJournal();
      if (notify) setToast({ type: 'success', text: '偏好已保存，下一餐也会记得。' });
      if (selection) await loadMeals();
      else { const data = await api(`/weather?city=${encodeURIComponent(value.city)}`); setContext(data.context); }
    } catch (e) { showError(e); } finally { flag('preferences', false); }
  }
  function addFoods(foods, replace = false) {
    setCart(previous => {
      const next = replace ? [] : [...previous];
      for (const food of foods) {
        const found = next.findIndex(f => f.id === food.id);
        if (found >= 0) next[found] = { ...next[found], quantity: Math.min(10, next[found].quantity + 1) };
        else next.push({ ...food, quantity: 1 });
      }
      return next;
    });
    setQuote(null); setToast({ type: 'success', text: replace ? '这一餐已放进购物袋。' : '已加入我的这一餐。' });
  }
  async function getQuote(needTableware) {
    flag('quote', true);
    try {
      const data = await api('/quote', post({
        context: getContext(selection), selections: cart.map(f => ({ id: f.id, quantity: f.quantity })), needTableware,
      }));
      setQuote(data);
    } catch (e) { showError(e); } finally { flag('quote', false); }
  }
  async function submitOrder(takeWayCode, remark) {
    flag('order', true);
    try {
      const data = await api('/orders', post({ quoteId: quote.id, confirmed: true, ...(takeWayCode ? { takeWayCode } : {}), ...(remark ? { remark } : {}) }));
      setOrder(data.order); setQuote(null); setCart([]);
    } catch (e) { showError(e); setQuote(null); }
    finally { flag('order', false); }
  }
  async function saveToken() {
    flag('connection', true); setConnectionError('');
    try {
      const data = await api('/connection', { method: 'PUT', body: JSON.stringify({ token: token.trim() }) });
      clearAccountView();
      sessionKey = data.session.key;
      setConnection({ configured: true, connected: data.connected }); setNutritionCount(data.nutritionCount);
      setPreferences(data.preferences); setContext(data.context);
      setToast({ type: 'success', text: '已连接麦当劳官方服务。' });
      setPicker(true);
    } catch (e) { if (!e.stale) setConnectionError(e.message); }
    finally { setToken(''); flag('connection', false); }
  }
  async function disconnectAccount() {
    flag('connection', true); setConnectionError('');
    try {
      await api('/connection', { method: 'DELETE' });
      clearAccountView(); sessionKey = '';
      setConnection({ configured: false, connected: false }); setNutritionCount(0); setPreferences(initialPreferences); setContext(null);
      await bootstrap();
    } catch (e) { if (!e.stale) setConnectionError(e.message); }
    finally { flag('connection', false); }
  }

  if (booting && !connection.connected) return <div className="onboarding-shell"><Loading text="正在读取你的会话…" /></div>;
  if (!connection.connected) return <div className="onboarding-shell"><section className="onboarding-card">
    <div className="onboarding-brand"><span className="brand-mark"><Utensils size={25} /></span><strong>麦搭 <small>MAI PICK</small></strong></div>
    <span className="eyebrow">YOUR ACCOUNT, YOUR MEAL</span><h1>每一餐，从你的账号开始。</h1><p className="onboarding-intro">连接一次，用真实菜单和你的优惠券，搭一顿更划算的麦当劳。</p>
    <ConnectionGuide connection={connection} nutritionCount={nutritionCount} token={token} onToken={setToken}
      onConnect={saveToken} busy={busy.connection} error={connectionError} onDisconnect={disconnectAccount} />
    {connection.configured || connectionError ? <button className="external-help text-button" onClick={bootstrap}>重新检查会话 <RefreshCw size={13} /></button> : null}
    <p className="fine-print centered">独立点餐工具，非麦当劳官方产品。</p>
  </section></div>;

  const selectedNav = navItems.find(n => n.id === page);
  const weather = context?.weather;
  const currentGoal = context?.goal ?? preferences.goal;
  const visibleFoods = catalog.filter(f => (category === 'all' || f.role === category) && f.name.includes(search));
  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
      <a className="brand" href="#" onClick={e => { e.preventDefault(); setPage('home'); }}><span className="brand-mark"><Utensils size={25} /></span><span><strong>麦搭</strong><small>MAI PICK</small></span></a>
      <div className="sidebar-caption">每一餐，刚刚好。</div>
      <div className="nav-label">我的工作台</div>
      <nav aria-label="主导航">{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => { setPage(id); setMobileNav(false); }}>
        <Icon size={19} /><span>{label}</span>{page === id && <span className="nav-active-dot" />}
      </button>)}</nav>
      <div className="sidebar-tip"><span className="tip-icon"><Leaf size={21} /></span><h3>吃得开心，也吃得明白。</h3><p>用真实营养数据，<br />搭配适合今天的美味。</p><button onClick={() => setPage('preferences')}>完善我的偏好 <ArrowUpRight size={14} /></button></div>
      <div className="sidebar-bottom"><button className="nav-item" onClick={() => setSettings(true)}><Settings2 size={18} />连接设置</button>
        <div className="service-status"><span className={connection.connected ? 'status-dot' : 'status-dot offline'} /><div><strong>{booting ? '正在连接服务' : connection.connected ? '官方 MCP 已连接' : '服务尚未连接'}</strong><small>本机服务 · 会话独立</small></div><ShieldCheck size={17} /></div>
        <p className="brand-disclaimer">独立个人工具，非麦当劳官方产品</p></div>
    </aside>
    {mobileNav && <div className="nav-scrim" onClick={() => setMobileNav(false)} />}
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" onClick={() => setMobileNav(!mobileNav)} aria-label="打开导航"><Menu size={21} /></button><span>我的工作台</span><ChevronRight size={13} /><strong>{selectedNav.label}</strong></div>
        <div className="topbar-right"><span className="topbar-tag"><Leaf size={13} /> 为每一餐做个好选择</span><button className="avatar" onClick={() => setPage('preferences')} aria-label="我的偏好">我</button></div></header>
      <main>
        {page === 'home' && <>
          <div className="page-topline"><div><span className="eyebrow">A LITTLE SMARTER. A LOT TASTIER.</span><h1>嗨，今天想吃点什么？<span className="greeting-sun"><Sun size={26} /></span></h1></div><span className="date-label">{context?.date?.replaceAll('-', '.')}<span>{context?.weekdayLabel ?? ''}</span></span></div>
          <div className="context-bar"><button className="context-location" onClick={() => setPicker(true)}><MapPin size={16} /><strong>{selection?.store.storeName ?? '选择你的麦当劳餐厅'}</strong><ChevronDown size={14} /></button>
            <span className="context-divider" /><span className="context-weather"><CloudSun size={18} />{weather ? `${weather.city} ${weather.temperature}°C · ${weather.label}` : `${preferences.city} · 天气${booting ? '查询中' : '暂不可用'}`}</span>
            <span className="context-divider" /><button className="context-mode" onClick={() => setPicker(true)}>{selection?.mode === 'delivery' ? <Bike size={16} /> : <Store size={16} />}{selection?.mode === 'delivery' ? '麦乐送' : '到店取餐'}<ChevronDown size={13} /></button>
            <span className="context-right"><span className="status-dot" /> 营养来自官方数据</span>
          </div>
          <div className="workspace-grid"><div className="workspace-main">
            <section className="hero"><div className="hero-copy"><span className="hero-kicker"><Sparkles size={14} /> 你的专属搭餐助手</span><h2>今天这顿，<br /><em>更划算。</em></h2><p>套餐、随心配、可用优惠券，<br />满足营养后，帮你比较实付价。</p><button className="button yellow" disabled={booting || busy.meals} onClick={() => loadMeals()}>
              {busy.meals ? <LoaderCircle size={17} className="spin" /> : <Sparkles size={17} />}{busy.meals ? '正在搭配真实餐品…' : plans.length ? '再帮我搭一餐' : '帮我搭一餐'}<ArrowRight size={18} /></button>
              <span className="hero-footnote">少一点纠结，多一点喜欢。</span></div>
              <div className="hero-visual" aria-hidden="true"><div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" /><div className="hero-plate"><span className="hero-burger">🍔</span><span className="hero-fries">🍟</span><span className="hero-drink">🥤</span></div><span className="hero-art-caption">A HAPPY LITTLE MEAL.</span><span className="hero-sticker"><Leaf size={17} /><strong>GOOD FOOD<br />GOOD MOOD</strong></span><span className="hero-taste-label"><Heart size={11} /> 享受每一口</span></div>
            </section>
            <section className="economy-shortcuts">
              <button onClick={() => setPage('offers')}><Ticket size={20} /><span><strong>{offers ? `${offers.claimable.filter(c => c.canClaim).length} 张券当前可领` : '看看今天的优惠'}</strong><small>{offers?.coupons.filter(c => c.expiresToday).length ?? 0} 张本人券今日到期 · 领完再核价</small></span><ChevronRight size={17} /></button>
              <button onClick={() => setPage('journal')}><Wallet size={20} /><span><strong>{journal ? `本月已确认支出 ¥${money(journal.spent / 100)}` : '常点搭配与月预算'}</strong><small>{favorites.length} 个常点搭配 · {journal ? `预算余额 ¥${money(journal.remaining / 100)}` : '记住喜欢，也记清花费'}</small></span><ChevronRight size={17} /></button>
            </section>
            <section className="goal-section"><div className="section-row"><h2>这一餐，你更在意…</h2><button className="text-button" onClick={() => setPage('preferences')}>调整偏好 <SlidersHorizontal size={14} /></button></div>
              <div className="goal-grid">{goals.map(({ id, name, icon: Icon, description }) => <button key={id} className={`goal-option ${preferences.goal === id ? 'selected' : ''}`} disabled={busy.preferences || busy.meals} onClick={() => savePreferences({ ...preferences, goal: id }, false)}>
                <span className={`goal-icon ${id}`}><Icon size={19} /></span><strong>{name}</strong><small>{description}</small>{preferences.goal === id && <CheckCircle2 size={13} className="goal-check" />}</button>)}</div>
            </section>
            <section className="recommendation-section"><div className="section-row"><div className="title-with-icon"><Sparkles size={20} /><h2>为今天搭配的美味</h2></div><span className="subtle-pill">{context?.weekdayLabel ?? '今天'} · {goalName(currentGoal)}</span></div>
              <p className="section-description">先满足营养和忌口，再按实付价从低到高。同价时考虑口味、天气和星期。</p>
              {busy.meals ? <div className="recommendation-loading"><Loading text="正在核对份量、营养和门店价格…" /><p>首次加载需要查询餐品详情，下次搭配会更快。</p></div>
                : plans.length ? <div className="plans-grid">{plans.map((plan, i) => <PlanCard key={plan.id} plan={plan} index={i} onAdd={foods => addFoods(foods, true)} onSave={saveFavorite} busy={busy.favorite} />)}</div>
                  : <div className="empty-state recommendation-empty"><span className="empty-illustration"><Utensils size={30} /><Sparkles size={15} /></span><div><h3>{selection ? '给今天找一顿合适的美味' : '先选餐厅，再搭配美味'}</h3><p>{planMessage || '用餐厅的实时菜单，为你寻找符合条件的组合。'}</p></div><button className="button outline small" disabled={busy.meals || booting} onClick={() => loadMeals()}>{selection ? '重新搭配' : '选择餐厅'}<ArrowRight size={14} /></button></div>}
              {stats && <p className="source-note"><ShieldCheck size={13} />已核价 {stats.verified} / {stats.checked} 个候选 · 可用优惠券 {stats.couponOffers} 款<span>{stats.combinations} 个营养达标组合</span></p>}
              {stats && <p className="price-scope">{priceScope}{stats.priceFailed > 0 ? ` ${stats.priceFailed} 个候选无法核价，已移除。` : ''}{stats.truncated || stats.defaultOnly ? ' 部分复杂套餐仅比较默认组成，搜索未覆盖全部替换。' : ''}</p>}
              {!!plans.length && planMessage && <p className="cart-warning">{planMessage}</p>}
            </section>
            <section className="today-note"><span className="today-note-icon"><Coffee size={21} /></span><div><strong>今天的小提醒</strong><p>{context?.cold ? '天气偏凉，有合适热饮时会优先推荐。' : context?.hot ? '天气偏热，合适的清爽饮品会排在前面。' : context?.rain ? '今天有降水，麦乐送或许更方便。' : '吃饭不必复杂。喜欢的口味，也可以有明白的营养。'}{context?.rain && context?.cold ? ' 有降水，也可以考虑麦乐送。' : ''}</p></div><Leaf size={32} strokeWidth={1.2} /></section>
          </div>
            <Cart cart={cart} preferences={preferences} selection={selection} onQuantity={(id, delta) => { setCart(c => c.map(f => f.id === id ? { ...f, quantity: f.quantity + delta } : f)); setQuote(null); }} onRemove={id => { setCart(c => c.filter(f => f.id !== id)); setQuote(null); }} onClear={() => { setCart([]); setQuote(null); }} onQuote={getQuote} busy={busy.quote || busy.favorite || busy.claim} onSave={saveFavorite} />
          </div>
          <footer className="page-footer"><span>MAI PICK <span>·</span> 给选择做减法，给生活加点味。</span><span>营养：麦当劳 MCP{weather ? ' · 天气：Open-Meteo' : ''}</span></footer>
        </>}
        {page === 'menu' && <>
          <div className="page-intro"><span className="eyebrow">FRESH FROM THE REAL MENU</span><div className="section-row"><h1>喜欢的美味，都在这里。</h1><button className="button outline small" onClick={() => setPicker(true)}><MapPin size={15} />{selection ? '更换餐厅' : '选择餐厅'}</button></div><p>{selection?.store.storeName ?? '选择餐厅后查看它的实时菜单。'} · 商品以门店当前可售为准</p></div>
          <div className="workspace-grid"><div className="workspace-main">
            <div className="menu-toolbar"><div className="menu-tabs">{[['all', '全部'], ['bundle', '套餐'], ['main', '主食'], ['side', '小食'], ['drink', '饮品']].map(([id, name]) => <button className={category === id ? 'active' : ''} key={id} onClick={() => setCategory(id)}>{name}</button>)}</div><input aria-label="搜索餐品" placeholder="搜索喜欢的餐品" value={search} onChange={e => setSearch(e.target.value)} /></div>
            {busy.meals ? <Loading text="正在读取真实门店菜单…" /> : <div className="menu-grid">{visibleFoods.map(food => <article className="menu-food" key={food.id}><div className="menu-food-art" aria-hidden="true">{foodEmoji(food.name)}</div><span className="menu-food-category">{food.category}</span><h3>{food.name}</h3>
              {!!food.parts?.length && <p className="menu-components">{food.parts.join(' + ')}</p>}
              {food.coupon && <span className="offer-badge">可用优惠券</span>}
              <p className={food.nutrition ? '' : 'nutrition-unknown'}>{food.nutrition ? `${food.nutrition.kcal} kcal · 蛋白质 ${food.nutrition.protein} g` : '暂无匹配营养，加入后总营养不可计算'}</p>
              <div className="menu-food-bottom"><strong>¥{food.price !== null ? money(food.price) : '待结算'}</strong><button className="add-round" disabled={food.price === null} onClick={() => addFoods([food])} aria-label={`加入${food.name}`}><Plus size={18} /></button></div></article>)}</div>}
            {!busy.meals && !visibleFoods.length && <div className="empty-state"><Utensils size={32} /><h3>{selection ? '没有匹配的餐品' : '先选择一家餐厅'}</h3><p>{selection ? '试试其他名称，或换一家门店。' : '菜单和价格会因餐厅而不同。'}</p>{!selection && <button className="button primary small" onClick={() => setPicker(true)}>选择餐厅</button>}</div>}
          </div><Cart cart={cart} preferences={preferences} selection={selection} onQuantity={(id, d) => { setCart(c => c.map(f => f.id === id ? { ...f, quantity: f.quantity + d } : f)); setQuote(null); }} onRemove={id => { setCart(c => c.filter(f => f.id !== id)); setQuote(null); }} onClear={() => { setCart([]); setQuote(null); }} onQuote={getQuote} busy={busy.quote || busy.favorite || busy.claim} onSave={saveFavorite} /></div>
        </>}
        {page === 'offers' && <OffersPage offers={offers} busy={busy.offers || busy.claim || busy.meals || busy.order} hasStore={Boolean(selection)}
          onRefresh={() => refreshOffers(true)} onClaim={claimCoupons} onReset={resetClaim}
          onRecommend={() => { setPage('home'); loadMeals(); }} onStore={() => setPicker(true)} />}
        {page === 'journal' && <JournalPage summary={journal} favorites={favorites} busy={busy.favorite || busy.sync}
          onSync={syncHistory} onReuse={reuseFavorite} onRemove={removeFavorite} onPreferences={() => setPage('preferences')} />}
        {page === 'preferences' && <Preferences value={preferences} onSave={savePreferences} busy={busy.preferences} />}
        {page === 'history' && <div className="history-page"><div className="page-intro"><span className="eyebrow">YOUR LITTLE FOOD JOURNAL</span><div className="section-row"><h1>每一顿喜欢，都有记录。</h1><button className="button outline small" disabled={busy.sync} onClick={syncHistory}><RefreshCw size={15} />同步官方状态</button></div><p>这里记录通过麦搭提交的订单，同步支付状态后才计入支出。</p></div>
          {history.length ? <div className="history-list">{history.map(item => <article className="history-card" key={item.id}><div className="section-row"><strong>{new Date(item.createdAt).toLocaleString('zh-CN')}</strong><span className="subtle-pill">{({ '1': '待支付', '2': '已支付 · 配餐中', '4': '配送中', '6': '已完成', '7': '已取消', '8': '已评价', '10': '餐厅配餐中' })[item.payment?.status] ?? (item.status === 'submitted' ? '已创建 · 支付待核实' : '提交结果待核实 · 请勿重复下单')}</span></div><h3>{item.foods.map(f => `${f.name} ×${f.quantity}`).join(' + ')}</h3><div className="section-row"><span>{item.order?.orderDetail?.storeName} {item.order?.orderId && `· 订单 ${item.order.orderId}`}</span><strong>{item.payment?.paid !== null && item.payment?.paid !== undefined ? '已付 ' : '核价 '}¥{money((item.payment?.paid ?? item.price) / 100)}</strong></div>{item.nutrition && <NutritionGrid value={item.nutrition} compact />}</article>)}</div> : <div className="empty-state history-empty"><History size={38} /><h3>还没有点餐记录</h3><p>从今天的一顿刚刚好开始。</p><button className="button primary small" onClick={() => setPage('home')}>去搭配一餐 <ArrowRight size={15} /></button></div>}
        </div>}
      </main>
    </div>
    {toast && <div className={`toast ${toast.type}`} role="status">{toast.type === 'error' ? <AlertCircle size={18} /> : toast.type === 'success' ? <CheckCircle2 size={18} /> : <CircleHelp size={18} />}<span>{toast.text}</span><button onClick={() => setToast(null)} aria-label="关闭提示"><X size={16} /></button></div>}
    {picker && <StorePicker preferences={preferences} onSelect={chooseStore} onClose={() => setPicker(false)} />}
    {settings && <Modal title="连接麦当劳" subtitle="更新连接会清空门店、购物袋和报价；验证失败时保留当前连接。" onClose={busy.connection || busy.order ? () => {} : () => { setSettings(false); setToken(''); setConnectionError(''); }}>
      <ConnectionGuide connection={connection} nutritionCount={nutritionCount} token={token} onToken={setToken}
        onConnect={saveToken} busy={busy.connection || busy.order} error={connectionError} onDisconnect={disconnectAccount} />
    </Modal>}
    {quote && <Checkout quote={quote} selection={{ ...selection, budget: preferences.budget }} cart={cart} busy={busy.order} onSubmit={submitOrder} onClose={() => setQuote(null)} />}
    {order && <PaymentResult order={order} onClose={() => setOrder(null)} />}
  </div>;
}
