"""CoinPilot TR public-data web service. Paper trading only."""
import json
import math
import os
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import ccxt
import websocket
from flask import Flask, jsonify, render_template, request
from coinpilot_engine import VERSION, FRAME_SPECS, validate_candles, analyse_frame, build_signal, backtest

app=Flask(__name__)
app.json.ensure_ascii=False
exchange=ccxt.btcturk({'enableRateLimit':True,'timeout':12000})
market_lock=threading.RLock()
rest_lock=threading.Lock()
cache_lock=threading.RLock()
markets={}; candle_cache={}; radar_cache={}
graph_requests=deque()
rest_at=0.0; ws_last=0.0; ws_connected=False; ws_started=False
STABLE_ASSETS={'USDT','USDC','FDUSD','TUSD','DAI'}
DEFAULT_FRAME_KEYS=('one_hour',)


def iso(stamp=None):
    return datetime.fromtimestamp(stamp or time.time(),timezone.utc).isoformat()


def canonical_symbol(raw):
    raw=str(raw or '').upper()
    for separator in ('/','_','-',' '):raw=raw.replace(separator,'')
    if raw.endswith('TRY') and 3<len(raw)<=20 and raw.isalnum():return raw[:-3]+'/TRY'
    return None


def selected_frame_keys(raw):
    if raw is None:return DEFAULT_FRAME_KEYS
    requested=set(raw.split(','))
    if not requested or not requested.issubset(FRAME_SPECS):raise ValueError('Geçerli en az bir zaman dilimi seç.')
    return tuple(k for k in FRAME_SPECS if k in requested)


def public_market(item):
    return {k:v for k,v in item.items() if not k.startswith('_')}


def make_ticker(pair,ticker):
    price=float(ticker['last'])
    if not math.isfinite(price) or price<=0:raise ValueError('Geçersiz fiyat')
    return dict(symbol=pair,pair=pair.replace('/',''),price=price,change=float(ticker.get('percentage') or 0),
                formatted_price=f'{price:,.4f} ₺',volume_try=float(ticker.get('quoteVolume') or 0) or float(ticker.get('baseVolume') or 0)*price,
                bid=ticker.get('bid'),ask=ticker.get('ask'),price_updated_at=iso(),price_source='REST',_at=time.time())


def rest_seed():
    global rest_at
    with rest_lock:
        # Another request may have refreshed while this one waited for the lock.
        with market_lock:
            if markets and time.monotonic()-rest_at<5:return
        started=time.time()
        tickers=exchange.fetch_tickers()
        seeded={}
        for pair,ticker in tickers.items():
            if pair.endswith('/TRY') and pair.split('/')[0] not in STABLE_ASSETS and ticker.get('last'):
                seeded[pair]=make_ticker(pair,ticker)
        with market_lock:
            for pair,value in seeded.items():
                prev=markets.get(pair,{})
                if prev.get('_at',0)>started:
                    value.update({k:v for k,v in prev.items() if k not in ('volume_try','bid','ask')})
                markets[pair]=value
            rest_at=time.monotonic()


def apply_ticker(data):
    pair=canonical_symbol(data.get('PS') or data.get('pair') or data.get('pairSymbol'))
    if not pair or pair.split('/')[0] in STABLE_ASSETS:return False
    try:
        # Production feed uses LA; older documentation uses La.
        price=float(data.get('LA',data.get('La',data.get('last'))))
        if not math.isfinite(price) or price<=0:return False
        with market_lock:
            previous=markets.get(pair,{})
            markets[pair]={**previous,'symbol':pair,'pair':pair.replace('/',''),'price':price,
                           'change':float(data.get('DP',data.get('dailyPercent',previous.get('change',0))) or 0),
                           'formatted_price':f'{price:,.4f} ₺','volume_try':previous.get('volume_try',0),
                           'price_updated_at':iso(),'price_source':'WebSocket','_at':time.time()}
            for field,short in (('bid','B'),('ask','A')):
                value=float(data.get(short,previous.get(field)) or 0)
                if math.isfinite(value) and value>0:markets[pair][field]=value
            volume=float(data.get('V') or 0)
            if math.isfinite(volume) and volume>0:markets[pair]['volume_try']=volume*price
        return True
    except (TypeError,ValueError):return False


def ws_open(ws):
    global ws_connected
    ws_connected=True
    ws.send(json.dumps([151,{'type':151,'channel':'ticker','event':'all','join':True}]))


def ws_message(ws,message):
    global ws_last
    try:
        packet=json.loads(message)
        if packet[0]==401:
            applied=[apply_ticker(item) for item in packet[1].get('items',[])]
            if any(applied):ws_last=time.monotonic()
        elif packet[0]==402:
            if apply_ticker(packet[1]):ws_last=time.monotonic()
    except (ValueError,TypeError,IndexError,KeyError,AttributeError):return


def ws_close(*args):
    global ws_connected
    ws_connected=False


def feed_worker():
    while True:
        try:
            websocket.WebSocketApp('wss://ws-feed-pro.btcturk.com/',on_open=ws_open,on_message=ws_message,
                                   on_error=ws_close,on_close=ws_close).run_forever(ping_interval=20,ping_timeout=10)
        except Exception:app.logger.exception('WebSocket bağlantısı kesildi')
        time.sleep(5)


def current_markets():
    global ws_started
    with market_lock:
        if not ws_started:
            ws_started=True
            threading.Thread(target=feed_worker,daemon=True).start()
        due=not markets or time.monotonic()-rest_at>(300 if ws_connected and time.monotonic()-ws_last<30 else 10)
    if due:
        try:rest_seed()
        except Exception:
            with market_lock:
                if not markets:raise
            app.logger.warning('REST yenilenemedi; son fiyatların zamanı korunuyor.')
    with market_lock:return [dict(v) for v in markets.values()]


def get_coin(symbol,fresh=False):
    coin=next((x for x in current_markets() if x['symbol']==symbol),None)
    if not coin:raise ValueError('Bu BtcTurk TRY paritesi bulunamadı.')
    if fresh:
        with rest_lock:coin=make_ticker(symbol,exchange.fetch_ticker(symbol))
        with market_lock:markets[symbol]={**markets.get(symbol,{}),**coin}
    return public_market(coin)


def get_candles(pair,key,count=450):
    name,resolution,duration=FRAME_SPECS[key]
    now=int(time.time()); cache_key=(pair,key,count,now//duration)
    with cache_lock:
        cached=candle_cache.get(cache_key)
        # Analysis only uses closed candles, so a result is stable until the next close.
        if cached:return cached[1]
        moment=time.monotonic()
        while graph_requests and moment-graph_requests[0]>=600:graph_requests.popleft()
        # Leave headroom below the provider's 600 requests / 10 minute limit.
        if len(graph_requests)>=500:raise ValueError('Mum veri istek sınırına yaklaşıldı; kapsamı daralt veya birkaç dakika sonra dene.')
        graph_requests.append(moment)
    query=urlencode(dict(symbol=pair,resolution=resolution,**{'from':now-(count+10)*duration,'to':now}))
    req=Request('https://graph-api.btcturk.com/v1/klines/history?'+query,headers={'User-Agent':'CoinPilotTR/'+VERSION})
    with urlopen(req,timeout=12) as response:data=json.loads(response.read())
    if data.get('s')!='ok':raise ValueError('Mum geçmişi bulunamadı.')
    candles=validate_candles(data,duration,now)
    with cache_lock:
        if len(candle_cache)>1000:
            for old in list(candle_cache):
                if old[3]!=now//FRAME_SPECS[old[1]][2]:candle_cache.pop(old)
        candle_cache[cache_key]=(time.monotonic(),candles)
    return candles


def scan_coin(coin,keys):
    frames={k:analyse_frame(k,get_candles(coin['pair'],k)) for k in keys}
    result=build_signal(public_market(coin),frames)
    result['analyzed_at']=iso()
    result['signal_basis']='Kapanmış mum'
    result['rules_version']=VERSION
    for f in frames.values():
        for field in ('highs','lows','closes'):f.pop(field,None)
    return result


def run_radar(cache_key,keys,limit,symbols):
    try:
        values=current_markets()
        if symbols:values=[v for v in values if v['symbol'] in symbols]
        ranked=sorted(values,key=lambda x:x.get('volume_try',0),reverse=True)
        candidates=ranked if limit==250 else ranked[:limit]
        with cache_lock:radar_cache[cache_key].update(total=len(candidates),market_count=len(values))
        with ThreadPoolExecutor(max_workers=3) as pool:
            jobs={pool.submit(scan_coin,coin,keys):coin['symbol'] for coin in candidates}
            for future in as_completed(jobs):
                try:
                    item=future.result()
                    with cache_lock:
                        state=radar_cache[cache_key]
                        state['scanned']+=1
                        if item['meets_minimum']:state['items'].append(item)
                except Exception as exc:
                    with cache_lock:
                        state=radar_cache[cache_key];state['scanned']+=1
                        state['errors'].append(dict(symbol=jobs[future],message=str(exc)[:160]))
        with cache_lock:radar_cache[cache_key].update(scanning=False,updated_at=iso(),at=time.monotonic())
    except Exception as exc:
        with cache_lock:radar_cache[cache_key].update(scanning=False,error=str(exc)[:160],at=time.monotonic())


@app.after_request
def no_stale_api(response):
    if request.path.startswith('/api/'):response.headers['Cache-Control']='no-store'
    return response


@app.get('/')
def home():return render_template('pro.html',version=VERSION)


@app.get('/api/dashboard')
def dashboard():
    try:
        values=current_markets()
        live=bool(ws_connected and ws_last and time.monotonic()-ws_last<30)
        return jsonify(status='success',version=VERSION,source='BtcTurk WebSocket' if live else 'BtcTurk REST',live=live,
                       updated_at=iso(),market_count=len(values),
                       prices={v['symbol']:v['price'] for v in values},quotes={v['symbol']:public_market(v) for v in values},
                       gainers=[public_market(v) for v in sorted(values,key=lambda x:x['change'],reverse=True)[:5]],
                       losers=[public_market(v) for v in sorted(values,key=lambda x:x['change'])[:5]])
    except Exception:return jsonify(status='error',message='BtcTurk fiyatlarına ulaşılamadı.'),503


@app.get('/api/quote')
def quote():
    symbol=canonical_symbol(request.args.get('symbol'))
    if not symbol:return jsonify(status='error',message='Geçerli TRY paritesi seç.'),400
    try:return jsonify(status='success',coin=get_coin(symbol,True),updated_at=iso())
    except ValueError as exc:return jsonify(status='error',message=str(exc)),400
    except Exception:return jsonify(status='error',message='Güncel fiyat doğrulanamadı; işlem açılmadı.'),503


@app.get('/api/analyze')
def analyze_symbol():
    try:
        keys=selected_frame_keys(request.args.get('frames'))
        symbol=canonical_symbol(request.args.get('symbol'))
        if not symbol:raise ValueError('Örnek: WIF/TRY')
        result=scan_coin(get_coin(symbol,request.args.get('fresh')=='1'),keys)
        return jsonify(status='success',item=result,frame_keys=keys,updated_at=result['analyzed_at'],version=VERSION)
    except ValueError as exc:return jsonify(status='error',message=str(exc)),400
    except Exception as exc:
        app.logger.warning('Analiz başarısız: %s',exc)
        return jsonify(status='error',message='Analiz için güncel ve yeterli mum verisi alınamadı.'),503


@app.get('/api/radar')
def radar():
    try:
        keys=selected_frame_keys(request.args.get('frames'))
        limit=int(request.args.get('limit','25'))
        if limit not in (8,25,50,250):raise ValueError('Tarama kapsamı geçersiz.')
        symbols=tuple(sorted({canonical_symbol(s) for s in request.args.get('symbols','').split(',') if canonical_symbol(s)}))
        key=(keys,limit,symbols)
        with cache_lock:
            cached=radar_cache.get(key)
            if not cached or (not cached['scanning'] and (request.args.get('force')=='1' or time.monotonic()-cached['at']>60)):
                if sum(x['scanning'] for x in radar_cache.values())>=2:
                    return jsonify(status='busy',message='Bir tarama sürüyor; kısa süre sonra yeniden denenecek.'),429
                if len(radar_cache)>64:
                    for old in list(radar_cache):
                        if not radar_cache[old]['scanning']:radar_cache.pop(old)
                cached=dict(items=[],scanning=True,scanned=0,total=0,errors=[],updated_at=None,at=time.monotonic(),market_count=0)
                radar_cache[key]=cached
                threading.Thread(target=run_radar,args=(key,keys,limit,symbols),daemon=True).start()
            data={**cached,'items':sorted(cached['items'],key=lambda x:x['score'],reverse=True),'errors':list(cached['errors'])}
        return jsonify(status='success',frame_keys=keys,version=VERSION,**data)
    except ValueError as exc:return jsonify(status='error',message=str(exc)),400


@app.get('/api/backtest')
def test_strategy():
    try:
        key=request.args.get('frame','one_hour')
        if key not in FRAME_SPECS:raise ValueError('Bir test periyodu seç.')
        fee=float(request.args.get('fee','0.1'))/100;slip=float(request.args.get('slippage','0.1'))/100
        if not 0<=fee<=.05 or not 0<=slip<=.05:raise ValueError('Maliyet %0–5 arasında olmalı.')
        symbol=canonical_symbol(request.args.get('symbol'))
        if not symbol:raise ValueError('Bir coin seç.')
        coin=get_coin(symbol)
        result=backtest(key,get_candles(coin['pair'],key,650),fee,slip)
        return jsonify(status='success',result=result,symbol=symbol,frame=key,version=VERSION)
    except ValueError as exc:return jsonify(status='error',message=str(exc)),400
    except Exception as exc:
        app.logger.warning('Test başarısız: %s',exc)
        return jsonify(status='error',message='Geçmiş test verisi alınamadı.'),503


@app.get('/api/live-status')
def live_status():
    return jsonify(status='online',version=VERSION,websocket_connected=ws_connected,
                   last_message_seconds=round(time.monotonic()-ws_last,1) if ws_last else None,tracked_pairs=len(markets))


if __name__=='__main__':app.run(host='0.0.0.0',port=int(os.environ.get('PORT','10000')),threaded=True)
