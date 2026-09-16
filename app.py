"""CoinPilot TR: BtcTurk public live-market server; never sends orders."""
from __future__ import annotations
import json, os, threading, time
from datetime import datetime, timezone
import ccxt, websocket
from flask import Flask, jsonify, render_template

app=Flask(__name__); app.json.ensure_ascii=False
exchange=ccxt.btcturk({"enableRateLimit":True,"timeout":15000})
lock=threading.RLock(); markets={}; rest_at=0.0; ws_connected=False; ws_last=0.0; ws_started=False

def price_text(p:float)->str:
    return f"{p:,.{2 if p>=100 else 4 if p>=1 else 8}f} ₺"
def symbol(raw:object)->str|None:
    raw=str(raw or '').upper().replace('_','')
    return f"{raw[:-3]}/TRY" if raw.endswith('TRY') and len(raw)>3 else None

def rest_seed():
    global rest_at
    seeded={}
    for name,t in exchange.fetch_tickers().items():
        if not name.endswith('/TRY') or t.get('last') is None: continue
        p=float(t['last']); seeded[name]={"symbol":name,"price":p,"change":round(float(t.get('percentage') or 0),2),"formatted_price":price_text(p)}
    with lock:
        for name,item in markets.items():
            if name in seeded and item.get('_at',0)>rest_at: seeded[name].update(item)
        markets.clear(); markets.update(seeded); rest_at=time.monotonic()

def apply_ticker(data:dict):
    name=symbol(data.get('PS') or data.get('pair') or data.get('pairSymbol'))
    last=data.get('La',data.get('last'))
    if not name or last is None:return
    try:p=float(last); change=float(data.get('DP',data.get('dailyPercent',0)) or 0)
    except (ValueError,TypeError):return
    with lock: markets[name]={"symbol":name,"price":p,"change":round(change,2),"formatted_price":price_text(p),"_at":time.monotonic()}

def ws_message(_ws,message:str):
    global ws_last
    try:
        packet=json.loads(message)
        if not isinstance(packet,list) or len(packet)<2:return
        if packet[0]==401:
            for item in packet[1].get('items',[]):apply_ticker(item)
        elif packet[0]==402:apply_ticker(packet[1])
        ws_last=time.monotonic()
    except (ValueError,TypeError,AttributeError):pass
def ws_open(ws):
    global ws_connected
    ws_connected=True; ws.send(json.dumps([151,{"type":151,"channel":"ticker","event":"all","join":True}]))
def ws_close(_ws,_code,_reason):
    global ws_connected
    ws_connected=False
def ws_error(_ws,error):
    global ws_connected
    ws_connected=False; app.logger.warning('WebSocket error: %s',error)
def worker():
    while True:
        try:websocket.WebSocketApp('wss://ws-feed-pro.btcturk.com/',on_open=ws_open,on_message=ws_message,on_error=ws_error,on_close=ws_close).run_forever(ping_interval=20,ping_timeout=10)
        except Exception:app.logger.exception('WebSocket worker error')
        time.sleep(5)
def ensure_feed():
    global ws_started
    with lock:
        if ws_started:return
        ws_started=True; threading.Thread(target=worker,daemon=True,name='btcturk-live').start()

@app.get('/')
def home():return render_template('index.html')
@app.get('/api/dashboard')
def dashboard():
    ensure_feed()
    global rest_at
    try:
        with lock: refresh=not markets or time.monotonic()-rest_at>300
        if refresh:rest_seed()
        with lock:
            values=list(markets.values()); live=ws_connected and ws_last and time.monotonic()-ws_last<30
        return jsonify({"status":"success","source":"BtcTurk WebSocket" if live else "BtcTurk REST fallback","live":bool(live),"updated_at":datetime.now(timezone.utc).isoformat(),"market_count":len(values),"gainers":sorted(values,key=lambda x:x['change'],reverse=True)[:5],"losers":sorted(values,key=lambda x:x['change'])[:5],"prices":{x['symbol']:x['price'] for x in values}})
    except ccxt.BaseError:return jsonify({"status":"error","message":"BtcTurk verisine şu an ulaşılamıyor."}),503
    except Exception:
        app.logger.exception('Dashboard error');return jsonify({"status":"error","message":"Piyasa verisi hazırlanamadı."}),500
@app.get('/api/live-status')
def live_status():
    with lock:return jsonify({"status":"online","websocket_connected":ws_connected,"last_message_seconds":round(time.monotonic()-ws_last,1) if ws_last else None,"tracked_pairs":len(markets)})

# CoinPilot Pro web dashboard lives in its own module so the data/scanner
# engine and the interface can grow independently.
from coinpilot_web import app as app

if __name__=='__main__':app.run(host='0.0.0.0',port=int(os.environ.get('PORT','10000')),threaded=True)
