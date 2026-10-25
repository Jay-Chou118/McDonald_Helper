import { useState } from 'react';
import { Ticket, CalendarDays, Heart, Wallet, RefreshCw, ArrowRight, Trash2, LoaderCircle } from 'lucide-react';

const money = cents => (cents / 100).toFixed(2).replace(/\.00$/, '');
export function BudgetChallenge({ budget, result, busy, error, hasStore, preferences, onChange, onOffers, onPreferences }) {
  const [custom, setCustom] = useState('18');
  const active = budget !== null;
  return <section className="budget-challenge" aria-label="预算挑战">
    <div className="section-row"><div><span className="eyebrow">SMALL BUDGET, GOOD MEAL</span><h2>这点预算，能吃到什么？</h2></div>
      {active && <button className="text-button" disabled={busy} onClick={() => onChange(null)}>退出挑战</button>}</div>
    <p className="challenge-description">选一个金额，找营养达标的一餐。日常预算 ¥{preferences.budget} 单独保留。</p>
    <div className="challenge-controls">
      <div className="challenge-presets" role="group" aria-label="挑战预算">{[15, 20, 25].map(value =>
        <button key={value} className={budget === value ? 'selected' : ''} aria-pressed={budget === value} disabled={busy}
          onClick={() => onChange(value)}>¥{value}<small>{value === 15 ? '精打细算' : value === 20 ? '刚刚好' : '多点选择'}</small></button>)}</div>
      <form className="challenge-custom" onSubmit={e => { e.preventDefault(); onChange(Number(custom)); }}>
        <label htmlFor="challenge-budget">自定金额（元）</label><div><input id="challenge-budget" type="number" min="1" max="500" step="0.01" required
          value={custom} onChange={e => setCustom(e.target.value)} disabled={busy} />
          <button className="button outline small" disabled={busy}>挑战</button></div>
      </form>
    </div>
    <div className="challenge-status" role="status" aria-live="polite">
      {busy && active ? <p><LoaderCircle size={16} className="spin" />正在寻找 ¥{budget} 内的达标组合…</p>
        : !active ? <p>选择预算开始挑战，推荐结果显示在下方。</p>
          : !hasStore ? <p>已选择 ¥{budget} 挑战，请先选择餐厅。</p>
            : error ? <p>本次查询未完成：{error}</p>
              : result?.status === 'matched' ? <><strong>找到预算内的一餐</strong><p>已核价最低 ¥{money(result.lowestVerified)} · 预算还剩 ¥{money(result.budget - result.lowestVerified)}。查看下方搭配。</p></>
                : result?.status === 'over_budget' ? <><strong>这次预算内暂未找到</strong><p>已核价达标候选最低 ¥{money(result.lowestVerified)}，超出 ¥{money(result.gap)}。可以查看可领券，或手动换个预算。</p></>
                  : result?.status === 'no_match' ? <><strong>暂时没有符合营养和忌口的组合</strong><p>提高预算不一定能解决；可以换餐厅或检查偏好，条件不会自动放宽。</p></>
                    : result?.status === 'unverified' ? <p>候选暂未成功核价，尚无法判断是否达标，请重试或换餐厅。</p>
                      : <p>选择预算后重新查询当前门店。</p>}
    </div>
    {active && <div className="challenge-links"><button className="text-button" onClick={onOffers}>看看可领券 <ArrowRight size={13} /></button>
      <button className="text-button" onClick={onPreferences}>查看营养与忌口</button></div>}
    <p className="fine-print">沿用热量 {preferences.calorieMin}–{preferences.calorieMax} kcal、蛋白质 ≥{preferences.proteinMin} g、钠 ≤{preferences.sodiumMax} mg 和全部忌口。推荐含接口返回的配送及打包费，不含餐具；结算再次核验。预算余额不代表优惠金额，最低价仅指已核价候选。</p>
  </section>;
}

export function PriceSavings({ savings, comparison }) {
  if (!savings) return null;
  return <div className="savings-box">
    {savings.officialSavings !== null && <p><span>较官方原价 ¥{money(savings.original)}</span><strong>优惠 ¥{money(savings.officialSavings)}</strong></p>}
    {comparison && <p><span>相同份量单点 ¥{money(comparison.price)}</span><strong>{comparison.saving >= 0 ? `组合省 ¥${money(comparison.saving)}` : `单点低 ¥${money(-comparison.saving)}`}</strong></p>}
    <p><span>本餐预算余额</span><strong>{savings.budgetRemaining < 0 ? '超出 ' : ''}¥{money(Math.abs(savings.budgetRemaining))}</strong></p>
    {savings.threshold && <small>距优惠门槛还差 ¥{money(savings.threshold.gap)}。加购后须重新核价，券面优惠不能直接抵扣。</small>}
    {savings.officialSavings === null && !comparison && <small>官方未提供可比原价，暂不计算节省金额。</small>}
    {comparison && <small>{comparison.source}；组合优惠与官方优惠不相加。</small>}
  </div>;
}

export function OffersPage({ offers, busy, hasStore, onRefresh, onClaim, onReset, onRecommend, onStore }) {
  const [verified, setVerified] = useState(false);
  return <div className="economy-page">
    <div className="page-intro"><span className="eyebrow">A SMALLER BILL, A BETTER MEAL</span><div className="section-row"><h1>先看看优惠，再决定这一餐。</h1>
      <button className="button outline small" disabled={busy} onClick={onRefresh}><RefreshCw size={15} />刷新优惠</button></div><p>活动和券包来自你的官方账号，领券后重新比较实际应付金额。</p></div>
    {!offers ? <div className="loading"><LoaderCircle className="spin" size={20} />正在查询优惠…</div> : <>
      {Object.entries(offers.errors).map(([key, error]) => <p className="inline-error" key={key}>{({ available: '可领券', calendar: '活动日历', wallet: '本人券包', usable: '门店可用券' })[key]}查询失败：{error}</p>)}
      <section className="settings-card"><div className="section-title"><Ticket size={22} /><div><h2>麦麦省 · 当前可领</h2><p>官方接口一次领取全部当前可领券，领取后以券包和门店核价为准。</p></div></div>
        <div className="offer-grid">{offers.claimable.map(c => <article className="coupon-tile" key={c.id}><span className="subtle-pill">{c.canClaim ? '可领取' : c.label || '当前不可领取'}</span><h3>{c.title}</h3></article>)}</div>
        {!offers.claimable.length && <p className="empty-message">暂无可领取优惠券。</p>}
        <div className="economy-actions"><button className="button primary" disabled={busy || !offers.claimId} onClick={onClaim}><Ticket size={16} />一键领取所有当前可领券</button>
          <button className="button outline" disabled={busy} onClick={hasStore ? onRecommend : onStore}>{hasStore ? '用最新优惠重新搭餐' : '选择门店核对可用券'}<ArrowRight size={16} /></button></div>
        {['uncertain', 'claiming'].includes(offers.claimState) && <div className="claim-recovery"><p>上次领取结果待核实，请先在官方 App 查看券包。</p>
          <label className="checkbox-line"><input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} />我已在官方 App 核实领取结果</label>
          <button className="button outline small" disabled={busy || !verified} onClick={() => { onReset(); setVerified(false); }}>核实后重新检查可领券</button></div>}
      </section>
      <section className="settings-card"><div className="section-title"><Ticket size={22} /><div><h2>本次门店可用券</h2><p>换门店或改为麦乐送后重新查询，是否能用于所选组合还需核价。</p></div></div>
        {!hasStore ? <button className="text-button" onClick={onStore}>选择餐厅 <ArrowRight size={15} /></button>
          : offers.storeCoupons.length ? <div className="offer-grid">{offers.storeCoupons.map((c, i) => <article className="coupon-tile" key={i}><span className="offer-badge">门店筛选通过</span><h3>{c.title}</h3><p>{c.products.join(' / ')}</p><small>{c.time}</small></article>)}</div>
            : <p className="empty-message">当前门店没有返回可用券；仍会比较套餐和随心配。</p>}
      </section>
      <section className="settings-card"><div className="section-title"><CalendarDays size={22} /><div><h2>本人券包 · 到期提醒</h2><p>已拥有的券不一定能在本工具使用；到期提醒只帮助你规划已有需求。</p></div></div>
        <div className="offer-grid">{offers.coupons.map((c, i) => <article className={`coupon-tile ${c.expiresToday ? 'expiring' : ''}`} key={c.id ?? i}>
          <span className="subtle-pill">{c.expiresToday ? '今日到期' : c.expiry ? `${c.expiry} 到期` : '期限请查官方 App'}</span>
          <h3>{c.title}</h3><p>{c.time}</p><small>{c.availableHere ? '本次门店筛选通过，最终核价确认' : c.channelNote || '尚未验证当前门店可用'}</small>
        </article>)}</div>
        {!offers.coupons.length && <p className="empty-message">券包没有返回优惠券。</p>}
        {!offers.walletComplete && <p className="fine-print">券包未完整加载，到期提醒可能不全。</p>}
      </section>
      <section className="settings-card"><div className="section-title"><CalendarDays size={22} /><div><h2>近期活动</h2><p>活动价格是宣传信息；会员活动需要相应资格，不计入可用优惠或自动开卡。</p></div></div>
        <div className="activity-list">{offers.activities.map(a => <article key={a.id}><div className="section-row"><strong>{a.title}</strong><span className="subtle-pill">{a.date}</span></div>
          {a.requiresMembership && <span className="offer-badge">需要会员资格 / 购卡，先核对成本</span>}<p>{a.description}</p></article>)}</div>
        {!offers.activities.length && <p className="empty-message">暂未查询到近期餐品活动。</p>}
      </section><p className="fine-print">{offers.note}</p>
    </>}
  </div>;
}

export function JournalPage({ summary, favorites, busy, onSync, onReuse, onRemove, onPreferences }) {
  return <div className="economy-page"><div className="page-intro"><span className="eyebrow">MAKE GOOD CHOICES EASIER</span><div className="section-row"><h1>记住喜欢，也记清花费。</h1>
    <button className="button outline small" disabled={busy} onClick={onSync}><RefreshCw size={15} />同步官方支付状态</button></div><p>只汇总本工具订单中，官方确认已支付的金额；取消订单不计入，退款流水需在官方 App 核对。</p></div>
    {summary && <section className="settings-card"><div className="section-title"><Wallet size={22} /><div><h2>{summary.month} · 麦当劳预算</h2><p>预算是支出上限，不是需要花完的目标。<button className="text-button" onClick={onPreferences}>调整月预算</button></p></div></div>
      <div className="journal-metrics">{[['已确认支出', summary.spent], ['官方确认优惠', summary.saved], ['本月预算余额', summary.remaining], ['平均每餐', summary.average]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value === null ? '—' : `${value < 0 ? '−' : ''}¥${money(Math.abs(value))}`}</strong></div>)}</div>
      <div className="calorie-bar"><div className={summary.remaining < 0 ? 'over' : ''} style={{ width: `${summary.monthlyBudget ? Math.min(100, summary.spent / summary.monthlyBudget * 100) : 0}%` }} /></div>
      <p className="fine-print">已确认 {summary.paidOrders} 笔支付 · {summary.savingsKnown} 笔有优惠数据 · {summary.pendingOrders} 笔待核实。月预算 ¥{money(summary.monthlyBudget)}。未支付订单、未知状态和报价不算消费。</p>
    </section>}
    <section className="settings-card"><div className="section-title"><Heart size={22} /><div><h2>我的常点搭配</h2><p>保存喜欢的一餐；再点时按当前菜单、优惠券、营养条件和预算重新核价。</p></div></div>
      {favorites.length ? <div className="favorite-meals">{favorites.map(f => <article key={f.id}><h3>{f.foods.map(food => `${food.name}${food.quantity > 1 ? ` ×${food.quantity}` : ''}`).join(' + ')}</h3>
        <p>{f.foods.flatMap(food => food.parts ?? []).join(' + ')}</p>
        <div className="economy-actions"><button className="button primary small" disabled={busy} onClick={() => onReuse(f.id)}>按今日价格再搭一餐 <ArrowRight size={15} /></button>
          <button className="icon-button" aria-label="移除常点搭配" disabled={busy} onClick={() => onRemove(f.id)}><Trash2 size={16} /></button></div>
      </article>)}</div> : <p className="empty-message">在推荐卡片或购物袋中点击「存为常点」，下次少做一次选择。</p>}
    </section>
  </div>;
}
