"""Deterministic, closed-candle technical analysis. No network or order access."""
import math

VERSION = '4.5.0'
FRAME_SPECS = {
    'daily': ('Günlük', 'D', 86400),
    'four_hour': ('4 Saat', '240', 14400),
    'one_hour': ('1 Saat', '60', 3600),
    'fifteen_minute': ('15 Dakika', '15', 900),
    'five_minute': ('5 Dakika', '5', 300),
}
MAX_STOP_PCT = 5.0
MIN_REWARD_RISK = 2.0


def ema(values, period):
    result, current = [], values[0]
    alpha = 2 / (period + 1)
    for value in values:
        current += alpha * (value - current)
        result.append(current)
    return result


def rsi_series(values, period=10):
    """Wilder RSI: SMA seed followed by RMA; flat data is neutral."""
    result = [None] * len(values)
    if len(values) <= period:
        return result
    changes = [b - a for a, b in zip(values, values[1:])]
    gain = sum(max(d, 0) for d in changes[:period]) / period
    loss = sum(max(-d, 0) for d in changes[:period]) / period
    for i in range(period, len(values)):
        if i > period:
            change = changes[i - 1]
            gain = (gain * (period - 1) + max(change, 0)) / period
            loss = (loss * (period - 1) + max(-change, 0)) / period
        result[i] = 50.0 if gain == loss == 0 else 100.0 if loss == 0 else 100 - 100 / (1 + gain / loss)
    return result


def crosses(line, trigger):
    """Only the latest crossing counts. A reversed older cross cannot pass."""
    return (line[-2] <= trigger[-2] and line[-1] > trigger[-1],
            line[-2] >= trigger[-2] and line[-1] < trigger[-1])


def fisher_series(candles, period=30):
    mids = [(h + l) / 2 for h, l in zip(candles['h'], candles['l'])]
    value = transformed = 0.0
    out = []
    for i, mid in enumerate(mids):
        window = mids[max(0, i - period + 1):i + 1]
        low, high = min(window), max(window)
        normalized = 0 if high == low else 2 * ((mid - low) / (high - low) - .5)
        value = max(-.999, min(.999, .33 * normalized + .67 * value))
        transformed = .5 * math.log((1 + value) / (1 - value)) + .5 * transformed
        out.append(transformed)
    return out


def validate_candles(data, duration, now, minimum=210):
    keys = ('t', 'o', 'h', 'l', 'c', 'v')
    if any(k not in data for k in keys) or len({len(data[k]) for k in keys}) != 1:
        raise ValueError('Mum alanları eksik veya uzunlukları uyumsuz.')
    rows = {}
    for values in zip(*(data[k] for k in keys)):
        t, o, h, l, c, v = map(float, values)
        if not all(math.isfinite(x) for x in (t, o, h, l, c, v)):
            raise ValueError('Geçersiz mum değeri.')
        if min(o, h, l, c) <= 0 or v < 0 or h < max(o, c, l) or l > min(o, c):
            raise ValueError('Mum fiyat aralığı geçersiz.')
        if t + duration <= now:
            rows[int(t)] = (int(t), o, h, l, c, v)
    ordered = [rows[t] for t in sorted(rows)]
    if len(ordered) < minimum:
        raise ValueError(f'EMA200 için en az {minimum} kapanmış mum gerekli ({len(ordered)} mevcut).')
    if now - (ordered[-1][0] + duration) > duration * 2:
        raise ValueError('Mum verisi güncel değil.')
    return {k: [r[i] for r in ordered] for i, k in enumerate(keys)}


def trend_info(c):
    # Confirmed pivot highs; no claim about a retest before the breakout.
    highs, closes, lows = c['h'], c['c'], c['l']
    pivots = [i for i in range(max(2, len(highs)-65), len(highs)-3)
              if highs[i] > max(highs[i-2:i]) and highs[i] >= max(highs[i+1:i+3])]
    if len(pivots) < 2:
        return False, False
    a, b = pivots[-2:]
    if highs[b] >= highs[a]:
        return False, False
    slope = (highs[b] - highs[a]) / (b-a)
    level = lambda i: highs[b] + slope * (i-b)
    breaks = [i for i in range(b+1, len(closes)) if closes[i-1] <= level(i-1) and closes[i] > level(i)]
    if not breaks or closes[-1] <= level(len(closes)-1):
        return False, False
    first = breaks[-1]
    retest = any(level(i) * .988 <= lows[i] <= level(i) * 1.012 and closes[i] >= level(i)
                 for i in range(first+1, len(closes)))
    return True, retest


def exit_conditions(closes, ema8, rsis, macd, trigger, fish, fish_trigger):
    """Heuristic long-position exit warnings, not probabilities or automatic orders."""
    falling = lambda a: a[-1] < a[-2] <= a[-3]
    macd_down = crosses(macd, trigger)[1]
    fish_down = crosses(fish, fish_trigger)[1]
    rsi_down = rsis[-2] >= 50 > rsis[-1]
    m_ok = macd[-1] < trigger[-1] and (macd_down or falling(macd))
    f_ok = fish[-1] < fish_trigger[-1] and (fish_down or falling(fish))
    r_ok = rsis[-1] < 50 and (rsi_down or falling(rsis))
    e_ok = closes[-1] < ema8[-1]
    checks = [
        dict(label='EMA8',ok=e_ok,value=ema8[-1],reason='Kapanış EMA8 altında.' if e_ok else 'Kapanış EMA8 altında değil.'),
        dict(label='MACD',ok=m_ok,value=macd[-1],reason=('Yeni aşağı kesişim: mavi kırmızının altına indi.' if macd_down else 'Mavi kırmızının altında ve düşüş sürüyor.' if m_ok else 'Aşağı kesişim / düşüş teyidi yok.') + (' MACD sıfır üstünde; sıfır altı beklenmez.' if macd[-1]>=0 else ' MACD sıfır altında.')),
        dict(label='Fisher(30)',ok=f_ok,value=fish[-1],reason='Yeni aşağı kesişim: mavi kırmızının altına indi.' if fish_down else 'Mavi kırmızının altında ve düşüş sürüyor.' if f_ok else 'Aşağı kesişim / düşüş teyidi yok.'),
        dict(label='RSI(10)',ok=r_ok,value=rsis[-1],reason='50 altına yeni iniş.' if rsi_down else '50 altında düşüş sürüyor.' if r_ok else '50 altı düşüş teyidi yok.'),
    ]
    count=sum(c['ok'] for c in checks)
    stage='SATIŞ UYARISI' if count>=3 else 'ZAYIFLAMA' if count==2 else 'ERKEN UYARI' if count==1 else 'ÇIKIŞ TEYİDİ YOK'
    return dict(checks=checks,count=count,stage=stage,macd_cross_down=macd_down,fisher_cross_down=fish_down,
                note='Deneysel 4 koşullu çıkış takibi; olasılık değildir. Sıfır altı MACD zorunlu değildir. Otomatik satış yapılmaz.')


def analyse_frame(key, c):
    closes = c['c']
    rsis, emas = rsi_series(closes), ema(closes, 200)
    ema8 = ema(closes, 8)
    fast, slow = ema(closes, 12), ema(closes, 26)
    line = [a-b for a,b in zip(fast,slow)]
    trigger = ema(line,9)
    fish = fisher_series(c)
    fish_trigger = [fish[0], *fish[:-1]]
    up, down = crosses(line, trigger)
    fup, fdown = crosses(fish, fish_trigger)
    rup = rsis[-2] <= 50 < rsis[-1]
    rising = lambda arr: arr[-1] > arr[-2] >= arr[-3]
    r_ok = rsis[-1] > 50 and (rup or rising(rsis))
    m_rise = rising(line)
    m_bull = line[-1] > trigger[-1] and (up or m_rise)
    m_near = abs(line[-1]) <= closes[-1] * .0025
    m_ok = (line[-1] > 0 or m_near) and m_bull
    f_bull = fish[-1] > fish_trigger[-1] and (fup or rising(fish))
    f_ok = fish[-1] >= -.15 and f_bull
    avg_volume = sum(c['v'][-21:-1]) / 20
    ratio = c['v'][-1] / avg_volume if avg_volume > 0 else 0
    v_ok = avg_volume > 0 and ratio > 1
    e_ok = closes[-1] > emas[-1]
    breakout, retest = trend_info(c)
    checks = [
        {'label':'EMA200', 'ok':e_ok, 'value':emas[-1], 'reason':'Kapanış EMA200 üstünde.' if e_ok else 'Kapanış EMA200 altında.'},
        {'label':'RSI(10)', 'ok':r_ok, 'value':rsis[-1], 'reason':'50 üstünde yukarı kesişim / yükseliş.' if r_ok else '50 üstü ve yukarı yön teyidi eksik.'},
        {'label':'MACD', 'ok':m_ok, 'value':line[-1], 'reason':'Sıfır üstü/yakını; mavi kırmızının üstünde ve yukarı yönlü.' if m_ok else 'Seviye, çizgi sıralaması veya yükseliş teyidi eksik.'},
        {'label':'Fisher(30)', 'ok':f_ok, 'value':fish[-1], 'reason':'Sıfır üstü/yakını; mavi kırmızının üstünde ve yukarı yönlü.' if f_ok else 'Seviye, çizgi sıralaması veya yükseliş teyidi eksik.'},
        {'label':'Hacim', 'ok':v_ok, 'value':ratio, 'reason':'Son kapanmış mum / önceki 20 mum ortalaması.'},
    ]
    total = sum(x['ok'] for x in checks)
    chart = []
    for i in range(max(0,len(closes)-120),len(closes)):
        chart.append(dict(time=c['t'][i],open=c['o'][i],high=c['h'][i],low=c['l'][i],close=closes[i],volume=c['v'][i],
                          ema=emas[i],ema8=ema8[i],rsi=rsis[i],macd=line[i],macd_signal=trigger[i],fisher=fish[i],fisher_signal=fish_trigger[i]))
    return dict(name=FRAME_SPECS[key][0],checks=checks,checks_passed=total,core_pass=total==5,
                rsi=rsis[-1],rsi_condition=r_ok,rsi_cross_up=rup,rsi_rising=rising(rsis),
                fisher=fish[-1],fisher_condition=f_ok,fisher_cross_up=fup,fisher_cross_down=fdown,
                fisher_rising=rising(fish),fisher_bullish=f_bull,fisher_near_zero=abs(fish[-1])<=.15,
                ema200=emas[-1],above_ema200=e_ok,ema_cross_up=crosses(closes,emas)[0],
                macd_cross_up=up,macd_cross_down=down,macd_above_zero=line[-1]>0,macd_near_zero=m_near,
                macd_rising=m_rise,macd_bullish=m_bull,macd_condition=m_ok,
                volume_ratio=ratio,above_average_volume=v_ok,closed_volume=c['v'][-1],average_volume=avg_volume,
                trend_break=breakout,retest=retest,chart=chart,closed_at=c['t'][-1]+FRAME_SPECS[key][2],
                exit=exit_conditions(closes,ema8,rsis,line,trigger,fish,fish_trigger),
                highs=c['h'],lows=c['l'],closes=closes)


def levels(frame, price):
    highs,lows=frame['highs'][-120:],frame['lows'][-120:]
    peak=max(range(1,len(highs)), key=lambda i:highs[i])
    low=min(lows[:peak+1]); high=highs[peak]; span=high-low
    if span<=0:
        raise ValueError('Hedef/stop için fiyat aralığı yetersiz.')
    fib=dict(low=low,high=high,**{'618':high-span*.618,'786':high-span*.786,'1272':high+span*.272},
             support=min(lows[-30:]),resistance=max(highs[-30:]))
    above=sorted(x for x in (fib['resistance'],high,fib['1272']) if x>price)
    target=above[0] if above else None
    reward=(target-price)/price*100 if target else None
    technical_stop=min(fib['786']*.992,fib['support']*.99)
    if not 0<technical_stop<price:
        technical_stop=None
    # Capital-risk cap: never accept more than 5%, or more than half the
    # available target reward. A closer technical stop is kept unchanged.
    risk_cap=min(MAX_STOP_PCT,reward/MIN_REWARD_RISK) if reward and reward>0 else MAX_STOP_PCT
    risk_floor=price*(1-risk_cap/100)
    stop=max(technical_stop or 0,risk_floor) if technical_stop or target else None
    risk=(price-stop)/price*100 if stop else None
    return dict(fib=fib,target=target,extended_target=above[-1] if above else None,stop=stop,
                technical_stop=technical_stop,stop_adjusted=bool(stop and (technical_stop is None or stop>technical_stop)),
                stop_pct=risk,target_pct=reward,risk_reward=reward/risk if risk and reward else None,
                risk_cap_pct=risk_cap,risk_ok=risk is not None and risk<=risk_cap+1e-9 and target is not None)


def build_signal(coin, frames):
    chosen=list(frames.values()); all_ok=all(f['core_pass'] for f in chosen)
    fib_key=next((k for k in ('four_hour','one_hour','fifteen_minute','five_minute','daily') if k in frames))
    plan=levels(frames[fib_key],coin['price'])
    trend=any(f['trend_break'] and f['retest'] for f in chosen)
    sell=any(f['fisher']<0 and f['macd_cross_down'] for f in chosen)
    zone=plan['fib']['786']<=coin['price']<=plan['fib']['618']
    minimum=any(f['checks_passed']>=3 for f in chosen)
    action='SAT' if sell else 'RİSKLİ BEKLE' if all_ok and not plan['risk_ok'] else 'GÜÇLÜ AL' if all_ok and trend and zone else 'AL İZLE' if all_ok else 'İZLE' if minimum else 'BEKLE'
    score=sum(f['checks_passed'] for f in chosen)/(5*len(chosen))*76+14*trend+10*zone
    chart_key='one_hour' if 'one_hour' in frames else list(frames)[-1]
    summary=[]
    for f in chosen:
        missing=', '.join(x['label'] for x in f['checks'] if not x['ok'])
        summary.append(f"{f['name']} {f['checks_passed']}/5: " + (f"{missing} teyidi eksik." if missing else 'Tüm koşullar sağlandı.'))
    return dict(coin=coin,frames=frames,frame_keys=list(frames),passed_frames=sum(f['core_pass'] for f in chosen),
                selected_frame_count=len(chosen),minimum_checks=3,meets_minimum=minimum,all_frames_passed=all_ok,
                action=action,score=round(min(score,28) if sell else score),sell_setup=sell,trend_confirmed=trend,
                in_fib_zone=zone,can_open_trade=all_ok and plan['risk_ok'] and not sell,max_stop_pct=MAX_STOP_PCT,
                chart=frames[chart_key]['closes'][-90:],chart_frame=chart_key,levels_frame=fib_key,summary=summary,
                radar=[*[f['checks_passed']/5 for f in chosen],float(trend),float(zone)],**plan)


def backtest(key,c,fee=.001,slippage=.001):
    """Single-frame, next-open entry; fees both ways; stop first if ambiguous."""
    if len(c['c']) <= 210:
        raise ValueError('Geçmiş test için 210 ısınma mumundan sonra test mumu gerekli.')
    equity=peak=10000.0; drawdown=0; position=None; trades=[]
    for i in range(210,len(c['c'])):
        if position:
            exit_price=None; reason=None
            if c['o'][i]<=position['stop']:
                exit_price=c['o'][i]; reason='Stop / açılış boşluğu'
            elif c['l'][i]<=position['stop']:
                exit_price=position['stop']; reason='Stop'
            elif c['h'][i]>=position['target']:
                exit_price=max(c['o'][i],position['target']); reason='Hedef'
            if exit_price:
                equity=position['quantity']*exit_price*(1-slippage)*(1-fee)
                trades.append(dict(entry_at=position['time'],exit_at=c['t'][i],reason=reason,pnl=equity-position['cost']))
                position=None
        else:
            past={k:v[:i] for k,v in c.items()}
            frame=analyse_frame(key,past)
            plan=levels(frame,c['o'][i]*(1+slippage))
            if frame['core_pass'] and plan['risk_ok']:
                entry=c['o'][i]*(1+slippage)
                position=dict(quantity=equity/(entry*(1+fee)),cost=equity,stop=plan['stop'],target=plan['target'],time=c['t'][i])
                # The entry bar is also exposed to stop and target; stop wins ambiguity.
                exit_at=c['o'][i] if c['o'][i]<=plan['stop'] else plan['stop'] if c['l'][i]<=plan['stop'] else plan['target'] if c['h'][i]>=plan['target'] else None
                if exit_at:
                    equity=position['quantity']*exit_at*(1-slippage)*(1-fee)
                    trades.append(dict(entry_at=c['t'][i],exit_at=c['t'][i],reason='Stop' if c['l'][i]<=plan['stop'] else 'Hedef',pnl=equity-position['cost']))
                    position=None
        marked=position['quantity']*c['c'][i]*(1-slippage)*(1-fee) if position else equity
        peak=max(peak,marked);drawdown=max(drawdown,(peak-marked)/peak*100)
    if position:
        equity=position['quantity']*c['c'][-1]*(1-slippage)*(1-fee)
        trades.append(dict(entry_at=position['time'],exit_at=c['t'][-1],reason='Test sonu',pnl=equity-position['cost']))
    profit=sum(max(t['pnl'],0) for t in trades);loss=sum(max(-t['pnl'],0) for t in trades)
    return dict(trades=trades,trade_count=len(trades),net_return_pct=(equity/10000-1)*100,
                win_rate=sum(t['pnl']>0 for t in trades)/len(trades)*100 if trades else None,
                max_drawdown_pct=drawdown,profit_factor=profit/loss if loss else None,
                from_time=c['t'][210],to_time=c['t'][-1],bars=len(c['c'])-210,fee_pct=fee*100,slippage_pct=slippage*100,
                note='Tek periyot; 5/5 kapanış teyidi, sonraki mum açılışı. Stop en fazla %5 ve hedef getirisinin yarısıdır. Aynı mumda hedef/stop varsa stop önce. Son pozisyon test sonunda kapatılır. Optimizasyon yapılmaz; geçmiş sonuç geleceği garanti etmez.')
