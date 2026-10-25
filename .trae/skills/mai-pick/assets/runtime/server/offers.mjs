import { randomUUID } from 'node:crypto';
import { ServiceError, safeError } from './mcp.mjs';
import { shanghaiDate } from './savings.mjs';

const list = data => Array.isArray(data) ? data : data?.coupons ?? [];
export async function getOffers(data, context) {
  const errors = {};
  const read = async (key, loader) => {
    try { return await loader(); }
    catch (error) { errors[key] = safeError(error); return null; }
  };
  const [available, calendar, wallet, usable] = await Promise.all([
    read('available', () => data.cached('available-coupons', 60000, () => data.callMcd('available-coupons'))),
    read('calendar', () => data.cached('campaign-calendar', 300000, () => data.callMcd('campaign-calendar'))),
    read('wallet', () => data.cached('coupon-wallet', 60000, async () => {
      const coupons = [];
      let complete = true;
      for (let page = 1; page <= 5; page++) {
        const result = await data.callMcd('query-my-coupons', { page: String(page), pageSize: '200' });
        coupons.push(...list(result));
        if (page >= (result.totalPages ?? 1)) break;
        if (page === 5) complete = false;
      }
      return { coupons, complete };
    })),
    context ? read('usable', () => data.getCoupons(context)) : null,
  ]);
  const today = shanghaiDate(Date.now());
  const storeCoupons = list(usable);
  const claimable = list(available).map((c, index) => ({
    id: String(index), title: c.couponName ?? c.title ?? '麦麦省优惠券',
    status: c.couponStatus, label: c.label ?? '', canClaim: c.couponStatus === 'CAN_GET',
  }));
  const coupons = list(wallet).map(c => ({
    id: c.id, title: c.title, subtitle: c.subtitle,
    expiry: c.tradeEndDate, time: c.datetimeText ?? '',
    expiresToday: c.tradeEndDate?.slice(0, 10) === today,
    availableHere: storeCoupons.some(s => s.couponId === c.id && s.couponCode === c.code),
    channelNote: c.toastText ?? (c.currentChannelCanRedeem === false ? '此券需在官方 App 核实使用渠道' : ''),
    tags: (c.tags ?? []).map(t => t.label).filter(Boolean),
  })).sort((a, b) => Number(b.expiresToday) - Number(a.expiresToday) || (a.expiry ?? '').localeCompare(b.expiry ?? ''));
  const seen = new Set();
  const activities = (calendar?.dailyList ?? []).filter(day => day.date >= today).flatMap(day =>
    (day.events ?? []).flatMap((event, index) => {
      const title = event.activityTitle || event.articleDto?.title || '';
      const description = event.activitySubTitle || event.articleDto?.content || '';
      if (!title || /丝巾|徽章|棒球帽|派对|亲子|读书会|品鉴会/.test(`${title} ${description}`)) return [];
      const key = event.activityCode ?? `${title}:${index}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ id: key, date: day.date, title, description,
        priceLabel: Number(event.price) > 0 ? event.price : null,
        requiresMembership: /开卡|学期卡|麦金卡|会员卡/.test(`${title} ${description}`) }];
    })).slice(0, 12);
  let claimId = null, claimState = (await data.readState('claim', {})).status ?? null;
  if (claimable.some(c => c.canClaim)) {
    const claim = await data.updateState('claim', previous => {
      // A network timeout is not proof that binding failed; require refresh and never retry that request.
      if (previous.status === 'claiming' || previous.status === 'uncertain') return previous;
      if (previous.status === 'prepared' && previous.expiresAt > Date.now()) return previous;
      return { id: randomUUID(), status: 'prepared', expiresAt: Date.now() + 180000 };
    });
    claimState = claim.status;
    if (claim.status === 'prepared') claimId = claim.id;
  }
  return { claimable, activities, coupons, storeCoupons: storeCoupons.map(c => ({
    title: c.title, time: c.tradeDateTime, products: (c.products ?? []).map(p => p.productName),
  })), claimId, claimState, errors, walletComplete: wallet?.complete ?? false, updatedAt: new Date().toISOString(),
    note: '活动文案和券包不代表当前订单可用；门店筛选及最终核价为准。麦麦省接口一次领取所有当前可领券，不支持指定某一张。' };
}

export async function claimOffers(data, claimId) {
  let previous;
  await data.updateState('claim', state => {
    previous = state;
    if (state.id !== claimId) throw new ServiceError('领券页面已变化，请刷新优惠。', 409);
    if (state.status === 'claimed') return state;
    if (state.status !== 'prepared') throw new ServiceError('领券结果待核实，请先在官方 App 查看券包，避免重复操作。', 409);
    if (state.expiresAt <= Date.now()) throw new ServiceError('领券请求已过期，请刷新优惠。', 409);
    return { ...state, status: 'claiming' };
  });
  if (previous.status === 'claimed') return { existing: true };
  try {
    await data.callMcd('auto-bind-coupons');
    await data.updateState('claim', state => ({ ...state, status: 'claimed', completedAt: Date.now() }));
  } catch (error) {
    await data.updateState('claim', state => ({ ...state, status: 'uncertain' }));
    throw new ServiceError('未能确认领券结果，请在官方 App 查看券包后再刷新；不会自动重试领取。', 502);
  } finally {
    data.clearCache();
    await data.updateState('quotes', quotes => Object.fromEntries(Object.entries(quotes).map(([id, quote]) =>
      [id, quote.status === 'prepared' ? { ...quote, status: 'offers_changed' } : quote])));
  }
  return { existing: false };
}
