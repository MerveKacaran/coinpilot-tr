"""CoinPilot TR web dashboard and multi-timeframe technical scanner.

This app uses only BtcTurk public market data.  It never creates real orders.
"""
from __future__ import annotations

import json
import math
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import ccxt
import websocket
from flask import Flask, jsonify, render_template, request


app = Flask(__name__)
app.json.ensure_ascii = False
exchange = ccxt.btcturk({"enableRateLimit": True, "timeout": 15000})

STABLE_ASSETS = {"USDT", "USDC", "FDUSD", "TUSD", "DAI"}
market_lock = threading.RLock()
scan_lock = threading.Lock()
markets: dict[str, dict] = {}
rest_at = 0.0
ws_connected = False
ws_last = 0.0
ws_started = False
radar_cache: dict = {"at": 0.0, "items": [], "scanning": False}


def price_text(price: float) -> str:
    decimals = 0 if price >= 1000 else 2 if price >= 10 else 4
    return f"{price:,.{decimals}f} ₺"


def public_market(item: dict) -> dict:
    return {key: value for key, value in item.items() if not key.startswith("_")}


def canonical_symbol(raw: object) -> str | None:
    raw = str(raw or "").upper().replace("_", "")
    if raw.endswith("TRY") and len(raw) > 3:
        return f"{raw[:-3]}/TRY"
    return None


def rest_seed() -> None:
    """Seed each TRY market and its 24 hour fields through public REST."""
    global rest_at
    seeded: dict[str, dict] = {}
    for pair, ticker in exchange.fetch_tickers().items():
        if not pair.endswith("/TRY") or ticker.get("last") is None:
            continue
        asset = pair.split("/")[0]
        if asset in STABLE_ASSETS:
            continue
        price = float(ticker["last"])
        base_volume = float(ticker.get("baseVolume") or 0)
        quote_volume = float(ticker.get("quoteVolume") or 0)
        seeded[pair] = {
            "symbol": pair,
            "pair": pair.replace("/", ""),
            "price": price,
            "change": round(float(ticker.get("percentage") or 0), 2),
            "formatted_price": price_text(price),
            "volume_try": quote_volume or base_volume * price,
        }
    with market_lock:
        for pair, previous in markets.items():
            if pair in seeded and previous.get("_at", 0) > rest_at:
                seeded[pair].update(previous)
        markets.clear()
        markets.update(seeded)
        rest_at = time.monotonic()


def apply_ticker(data: dict) -> None:
    pair = canonical_symbol(
        data.get("PS") or data.get("pair") or data.get("pairSymbol")
    )
    last = data.get("La", data.get("last"))
    if not pair or last is None:
        return
    try:
        price = float(last)
        change = float(data.get("DP", data.get("dailyPercent", 0)) or 0)
    except (TypeError, ValueError):
        return
    with market_lock:
        previous = markets.get(pair, {})
        markets[pair] = {
            "symbol": pair,
            "pair": pair.replace("/", ""),
            "price": price,
            "change": round(change, 2),
            "formatted_price": price_text(price),
            "volume_try": previous.get("volume_try", 0),
            "_at": time.monotonic(),
        }


def ws_open(ws) -> None:
    global ws_connected
    ws_connected = True
    ws.send(
        json.dumps(
            [151, {"type": 151, "channel": "ticker", "event": "all", "join": True}]
        )
    )


def ws_message(_ws, message: str) -> None:
    global ws_last
    try:
        packet = json.loads(message)
        if not isinstance(packet, list) or len(packet) < 2:
            return
        if packet[0] == 401:
            for item in packet[1].get("items", []):
                apply_ticker(item)
        elif packet[0] == 402:
            apply_ticker(packet[1])
        ws_last = time.monotonic()
    except (ValueError, TypeError, AttributeError):
        return


def ws_close(_ws, _code, _reason) -> None:
    global ws_connected
    ws_connected = False


def ws_error(_ws, error) -> None:
    global ws_connected
    ws_connected = False
    app.logger.warning("BtcTurk WebSocket error: %s", error)


def websocket_worker() -> None:
    while True:
        try:
            websocket.WebSocketApp(
                "wss://ws-feed-pro.btcturk.com/",
                on_open=ws_open,
                on_message=ws_message,
                on_error=ws_error,
                on_close=ws_close,
            ).run_forever(ping_interval=20, ping_timeout=10)
        except Exception:
            app.logger.exception("BtcTurk WebSocket worker error")
        time.sleep(5)


def ensure_feed() -> None:
    global ws_started
    with market_lock:
        if ws_started:
            return
        ws_started = True
        threading.Thread(
            target=websocket_worker, daemon=True, name="btcturk-websocket"
        ).start()


def current_markets() -> list[dict]:
    ensure_feed()
    with market_lock:
        needs_seed = not markets or time.monotonic() - rest_at > 300
    if needs_seed:
        rest_seed()
    with market_lock:
        return [dict(item) for item in markets.values()]


def get_candles(pair: str, resolution: str, seconds: int) -> dict[str, list[float]]:
    now = int(time.time())
    query = urlencode(
        {
            "symbol": pair,
            "resolution": resolution,
            "from": now - seconds,
            "to": now,
        }
    )
    request_object = Request(
        "https://graph-api.btcturk.com/v1/klines/history?" + query,
        headers={"User-Agent": "CoinPilotTR/4.0"},
    )
    with urlopen(request_object, timeout=18) as response:
        data = json.loads(response.read().decode("utf-8"))
    if data.get("s") != "ok":
        raise ValueError("Kline data unavailable")
    return {
        key: [float(value) for value in data[key]]
        for key in ("c", "h", "l", "v")
    }


def ema(values: list[float], period: int) -> list[float]:
    multiplier = 2 / (period + 1)
    current = values[0]
    output: list[float] = []
    for value in values:
        current = value * multiplier + current * (1 - multiplier)
        output.append(current)
    return output


def rsi(values: list[float], period: int = 14) -> float:
    gains = losses = 0.0
    for index in range(len(values) - period, len(values)):
        change = values[index] - values[index - 1]
        if change >= 0:
            gains += change
        else:
            losses -= change
    if losses == 0:
        return 100.0
    return 100 - 100 / (1 + gains / losses)


def macd(values: list[float]) -> tuple[list[float], list[float]]:
    fast = ema(values, 12)
    slow = ema(values, 26)
    line = [fast[index] - slow[index] for index in range(len(values))]
    return line, ema(line, 9)


def fisher(candles: dict[str, list[float]], period: int = 30) -> list[float]:
    output: list[float] = []
    prior_value = prior_fisher = 0.0
    for index, close in enumerate(candles["c"]):
        start = max(0, index - period + 1)
        high = max(candles["h"][start : index + 1])
        low = min(candles["l"][start : index + 1])
        span = max(high - low, 0.0000001)
        value = 0.33 * 2 * ((close - low) / span - 0.5) + 0.67 * prior_value
        value = max(-0.999, min(0.999, value))
        transformed = 0.5 * math.log((1 + value) / (1 - value)) + 0.5 * prior_fisher
        output.append(transformed)
        prior_value, prior_fisher = value, transformed
    return output


def recent_cross_up(line: list[float], signal: list[float]) -> bool:
    for index in range(max(1, len(line) - 4), len(line)):
        if line[index - 1] <= signal[index - 1] and line[index] > signal[index]:
            return True
    return False


def recent_cross_down(line: list[float], signal: list[float]) -> bool:
    for index in range(max(1, len(line) - 4), len(line)):
        if line[index - 1] >= signal[index - 1] and line[index] < signal[index]:
            return True
    return False


def trend_info(candles: dict[str, list[float]]) -> tuple[bool, bool]:
    size = len(candles["c"])
    old_start = max(0, size - 65)
    old_end = max(old_start + 1, size - 25)
    recent_start = max(0, size - 22)
    old_high = max(candles["h"][old_start:old_end])
    recent_high = max(candles["h"][recent_start : size - 2])
    current = candles["c"][-1]
    falling_trend = current > candles["c"][old_end - 1] and recent_high < old_high
    breakout = falling_trend and current > recent_high
    recent_low = min(candles["l"][max(0, size - 5) :])
    retest = breakout and recent_low <= recent_high * 1.012 and current >= recent_high
    return breakout, retest


def analyse_frame(name: str, candles: dict[str, list[float]], live_price: float) -> dict:
    closes = list(candles["c"])
    closes[-1] = live_price
    adjusted = {**candles, "c": closes}
    line, signal = macd(closes)
    fisher_values = fisher(adjusted, 30)
    breakout, retest = trend_info(adjusted)
    ema_200 = ema(closes, 200)[-1]
    rsi_value = rsi(closes, 14)
    fisher_value = fisher_values[-1]
    up_cross = recent_cross_up(line, signal)
    down_cross = recent_cross_down(line, signal)
    core_pass = (
        rsi_value > 50
        and fisher_value > 0
        and up_cross
        and live_price > ema_200
    )
    return {
        "name": name,
        "rsi": round(rsi_value, 2),
        "fisher": round(fisher_value, 4),
        "ema200": ema_200,
        "above_ema200": live_price > ema_200,
        "macd_cross_up": up_cross,
        "macd_cross_down": down_cross,
        "trend_break": breakout,
        "retest": retest,
        "core_pass": core_pass,
        "closes": closes,
        "highs": candles["h"],
        "lows": candles["l"],
    }


def fib_levels(frame: dict) -> dict:
    highs = frame["highs"][-120:]
    lows = frame["lows"][-120:]
    high = max(highs)
    low = min(lows)
    span = max(high - low, high * 0.001)
    return {
        "low": low,
        "high": high,
        "618": high - span * 0.618,
        "786": high - span * 0.786,
        "1272": high + span * 0.272,
        "support": min(frame["lows"][-30:]),
        "resistance": max(frame["highs"][-30:]),
    }


def scan_coin(coin: dict) -> dict | None:
    try:
        daily = analyse_frame(
            "Günlük", get_candles(coin["pair"], "D", 390 * 86400), coin["price"]
        )
        four_hour = analyse_frame(
            "4 Saat",
            get_candles(coin["pair"], "240", 300 * 4 * 3600),
            coin["price"],
        )
        one_hour = analyse_frame(
            "1 Saat",
            get_candles(coin["pair"], "60", 300 * 3600),
            coin["price"],
        )
        frames = [daily, four_hour, one_hour]
        passed = sum(frame["core_pass"] for frame in frames)
        trend_confirmed = (
            one_hour["trend_break"]
            and one_hour["retest"]
            or four_hour["trend_break"]
            and four_hour["retest"]
        )
        sell_setup = one_hour["fisher"] < 0 and one_hour["macd_cross_down"]
        sell_setup = sell_setup or (
            four_hour["fisher"] < 0 and four_hour["macd_cross_down"]
        )
        fib = fib_levels(four_hour)
        critical_low, critical_high = sorted((fib["618"], fib["786"]))
        in_fib_zone = critical_low <= coin["price"] <= critical_high
        score = passed * 24 + (14 if trend_confirmed else 0) + (10 if in_fib_zone else 0)
        if sell_setup:
            score = min(score, 28)
        if sell_setup:
            action = "SAT"
        elif passed == 3 and trend_confirmed and in_fib_zone:
            action = "GÜÇLÜ AL"
        elif passed == 3:
            action = "AL İZLE"
        else:
            action = "BEKLE"
        target = max(coin["price"] * 1.03, fib["1272"])
        stop_candidate = min(fib["786"] * 0.992, fib["support"] * 0.99)
        stop = stop_candidate if 0 < stop_candidate < coin["price"] else coin["price"] * 0.97
        return {
            "coin": public_market(coin),
            "action": action,
            "score": int(max(0, min(100, score))),
            "passed_frames": passed,
            "trend_confirmed": trend_confirmed,
            "in_fib_zone": in_fib_zone,
            "sell_setup": sell_setup,
            "target": target,
            "stop": stop,
            "target_pct": (target - coin["price"]) / coin["price"] * 100,
            "stop_pct": (coin["price"] - stop) / coin["price"] * 100,
            "fib": fib,
            "frames": {
                "daily": daily,
                "four_hour": four_hour,
                "one_hour": one_hour,
            },
            "chart": one_hour["closes"][-90:],
            "radar": [
                1 if daily["rsi"] > 50 else 0.28,
                1 if four_hour["above_ema200"] else 0.28,
                1 if one_hour["fisher"] > 0 else 0.28,
                1 if one_hour["macd_cross_up"] else 0.28,
                1 if trend_confirmed else 0.28,
                1 if in_fib_zone else 0.28,
            ],
        }
    except Exception:
        app.logger.info("Could not scan %s", coin.get("pair"), exc_info=True)
        return None


def get_radar(force: bool = False) -> tuple[list[dict], bool]:
    now = time.monotonic()
    if not force and radar_cache["items"] and now - radar_cache["at"] < 300:
        return radar_cache["items"], False
    if not scan_lock.acquire(blocking=False):
        return radar_cache["items"], True
    radar_cache["scanning"] = True
    try:
        values = current_markets()
        candidates = sorted(values, key=lambda item: item.get("volume_try", 0), reverse=True)[:8]
        with ThreadPoolExecutor(max_workers=4) as executor:
            scanned = list(executor.map(scan_coin, candidates))
        items = [item for item in scanned if item]
        items.sort(key=lambda item: item["score"], reverse=True)
        radar_cache.update({"at": time.monotonic(), "items": items, "scanning": False})
        return items, False
    finally:
        radar_cache["scanning"] = False
        scan_lock.release()


@app.get("/")
def home():
    return render_template("pro.html")


@app.get("/api/dashboard")
def dashboard():
    try:
        values = current_markets()
        live = bool(ws_connected and ws_last and time.monotonic() - ws_last < 30)
        return jsonify(
            {
                "status": "success",
                "source": "BtcTurk WebSocket" if live else "BtcTurk REST",
                "live": live,
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "market_count": len(values),
                "gainers": [public_market(item) for item in sorted(values, key=lambda item: item["change"], reverse=True)[:5]],
                "losers": [public_market(item) for item in sorted(values, key=lambda item: item["change"])[:5]],
                "prices": {item["symbol"]: item["price"] for item in values},
            }
        )
    except ccxt.BaseError:
        return jsonify({"status": "error", "message": "BtcTurk verisine ulaşılamıyor."}), 503


@app.get("/api/radar")
def radar():
    items, scanning = get_radar(request.args.get("force") == "1")
    return jsonify(
        {
            "status": "success",
            "items": items,
            "scanning": scanning,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    )


@app.get("/api/live-status")
def live_status():
    with market_lock:
        return jsonify(
            {
                "status": "online",
                "websocket_connected": ws_connected,
                "last_message_seconds": round(time.monotonic() - ws_last, 1)
                if ws_last
                else None,
                "tracked_pairs": len(markets),
            }
        )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "10000")), threaded=True)
