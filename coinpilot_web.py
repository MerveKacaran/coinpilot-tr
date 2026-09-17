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
RSI_PERIOD = 10
VOLUME_PERIOD = 20
MAX_STOP_PCT = 8.0
MACD_NEAR_ZERO_RATIO = 0.0025
FISHER_NEAR_ZERO = -0.15
FRAME_SPECS = {
    "daily": ("Günlük", "D", 390 * 86400),
    "four_hour": ("4 Saat", "240", 300 * 4 * 3600),
    "one_hour": ("1 Saat", "60", 300 * 3600),
    "fifteen_minute": ("15 Dakika", "15", 300 * 15 * 60),
    "five_minute": ("5 Dakika", "5", 300 * 5 * 60),
}
DEFAULT_FRAME_KEYS = ("daily", "four_hour", "one_hour", "fifteen_minute")
market_lock = threading.RLock()
scan_lock = threading.Lock()
markets: dict[str, dict] = {}
rest_at = 0.0
ws_connected = False
ws_last = 0.0
ws_started = False
radar_cache: dict[str, dict] = {}


def price_text(price: float) -> str:
    decimals = 0 if price >= 1000 else 2 if price >= 10 else 4
    return f"{price:,.{decimals}f} ₺"


def public_market(item: dict) -> dict:
    return {key: value for key, value in item.items() if not key.startswith("_")}


def canonical_symbol(raw: object) -> str | None:
    raw = (
        str(raw or "")
        .upper()
        .replace("_", "")
        .replace("/", "")
        .replace("-", "")
        .replace(" ", "")
    )
    if raw.endswith("TRY") and len(raw) > 3:
        return f"{raw[:-3]}/TRY"
    return None


def selected_frame_keys(raw: str | None) -> tuple[str, ...]:
    """Return valid user-selected timeframes in the product's display order."""
    if raw is None or not raw.strip():
        return DEFAULT_FRAME_KEYS
    requested = {item.strip() for item in raw.split(",") if item.strip()}
    keys = tuple(key for key in FRAME_SPECS if key in requested)
    if not keys:
        raise ValueError("En az bir zaman dilimi seçmelisin.")
    return keys


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


def rsi(values: list[float], period: int = RSI_PERIOD) -> float:
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


def rsi_series(values: list[float], period: int = RSI_PERIOD) -> list[float]:
    """Return an RSI series so the radar can distinguish momentum from level."""
    output = [50.0] * len(values)
    for index in range(period, len(values)):
        output[index] = rsi(values[: index + 1], period)
    return output


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


def recent_level_cross_up(values: list[float], level: float) -> bool:
    return recent_cross_up(values, [level] * len(values))


def volume_status(volumes: list[float], period: int = VOLUME_PERIOD) -> tuple[float, float, float, bool]:
    """Compare the last *closed* candle volume with its trailing average.

    The newest kline can still be forming.  Looking at the prior completed
    candle prevents an intrabar volume spike (or an almost-empty new candle)
    from changing the radar result every few seconds.
    """
    if len(volumes) < period + 2:
        return 0.0, 0.0, 0.0, False
    closed_volume = float(volumes[-2])
    average = sum(float(value) for value in volumes[-(period + 2) : -2]) / period
    ratio = closed_volume / average if average else 0.0
    return closed_volume, average, ratio, closed_volume >= average


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
    ema_values = ema(closes, 200)
    ema_200 = ema_values[-1]
    rsi_values = rsi_series(closes, RSI_PERIOD)
    rsi_value = rsi_values[-1]
    fisher_value = fisher_values[-1]
    fisher_signal = [fisher_values[0], *fisher_values[:-1]]
    up_cross = recent_cross_up(line, signal)
    down_cross = recent_cross_down(line, signal)
    fisher_cross_up = recent_cross_up(fisher_values, fisher_signal)
    fisher_cross_down = recent_cross_down(fisher_values, fisher_signal)
    rsi_cross_up = recent_level_cross_up(rsi_values, 50)
    rsi_rising = rsi_values[-1] > rsi_values[-2] >= rsi_values[-3]
    rsi_condition = rsi_value > 50 and (rsi_cross_up or rsi_rising)
    fisher_rising = (
        fisher_values[-1] > fisher_values[-2] >= fisher_values[-3]
    )
    macd_above_zero = line[-1] > 0
    macd_near_zero = abs(line[-1]) <= abs(live_price) * MACD_NEAR_ZERO_RATIO
    macd_rising = line[-1] > line[-2] >= line[-3]
    macd_bullish = up_cross or (line[-1] > signal[-1] and macd_rising)
    macd_condition = (macd_above_zero or macd_near_zero) and macd_bullish
    fisher_near_zero = fisher_value >= FISHER_NEAR_ZERO
    fisher_bullish = fisher_cross_up or (
        fisher_values[-1] > fisher_signal[-1] and fisher_rising
    )
    fisher_condition = fisher_near_zero and fisher_bullish
    ema_cross_up = recent_cross_up(closes, ema_values)
    closed_volume, average_volume, volume_ratio, above_average_volume = volume_status(
        candles["v"]
    )
    core_pass = (
        rsi_condition
        and fisher_condition
        and macd_condition
        and live_price > ema_200
        and above_average_volume
    )
    checks_passed = sum(
        (
            rsi_condition,
            fisher_condition,
            macd_condition,
            live_price > ema_200,
            above_average_volume,
        )
    )
    return {
        "name": name,
        "rsi": round(rsi_value, 2),
        "rsi_cross_up": rsi_cross_up,
        "rsi_rising": rsi_rising,
        "rsi_condition": rsi_condition,
        "fisher": round(fisher_value, 4),
        "fisher_rising": fisher_rising,
        "fisher_cross_up": fisher_cross_up,
        "fisher_cross_down": fisher_cross_down,
        "fisher_near_zero": fisher_near_zero,
        "fisher_bullish": fisher_bullish,
        "fisher_condition": fisher_condition,
        "ema200": ema_200,
        "above_ema200": live_price > ema_200,
        "ema_cross_up": ema_cross_up,
        "macd_cross_up": up_cross,
        "macd_cross_down": down_cross,
        "macd_above_zero": macd_above_zero,
        "macd_near_zero": macd_near_zero,
        "macd_rising": macd_rising,
        "macd_bullish": macd_bullish,
        "macd_condition": macd_condition,
        "closed_volume": closed_volume,
        "average_volume": average_volume,
        "volume_ratio": round(volume_ratio, 2),
        "above_average_volume": above_average_volume,
        "checks_passed": checks_passed,
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


def exit_levels(price: float, fib: dict) -> tuple[float, float]:
    """Return a conservative first take-profit and an extension target.

    0.618 and 0.786 are displayed as a retracement/retest zone.  For an
    existing long position, resistance and the 1.272 extension are more
    meaningful sell references than presenting retracement levels as a
    guaranteed exit.
    """
    resistance = max(float(fib["resistance"]), float(fib["high"]))
    extension = float(fib["1272"])
    first_target = resistance if resistance > price * 1.003 else extension
    first_target = max(first_target, price * 1.03)
    extension_target = max(extension, first_target)
    return first_target, extension_target


def scan_coin(coin: dict, frame_keys: tuple[str, ...]) -> dict | None:
    """Analyse a coin only on the timeframes the user has enabled."""
    try:
        frames: dict[str, dict] = {}
        for key in frame_keys:
            name, resolution, seconds = FRAME_SPECS[key]
            frames[key] = analyse_frame(
                name,
                get_candles(coin["pair"], resolution, seconds),
                coin["price"],
            )

        selected_frames = list(frames.values())
        passed = sum(frame["core_pass"] for frame in selected_frames)
        all_frames_passed = all(frame["core_pass"] for frame in selected_frames)
        trend_frames = [
            frames[key]
            for key in ("four_hour", "one_hour")
            if key in frames
        ]
        trend_confirmed = any(
            frame["trend_break"] and frame["retest"] for frame in trend_frames
        )
        sell_setup = any(
            frame["fisher"] < 0 and frame["macd_cross_down"]
            for frame in selected_frames
        )

        fib_frame = next(
            (
                frames[key]
                for key in ("four_hour", "one_hour", "fifteen_minute", "five_minute", "daily")
                if key in frames
            ),
            selected_frames[0],
        )
        fib = fib_levels(fib_frame)
        critical_low, critical_high = sorted((fib["618"], fib["786"]))
        in_fib_zone = critical_low <= coin["price"] <= critical_high
        target, extended_target = exit_levels(coin["price"], fib)
        stop_candidate = min(fib["786"] * 0.992, fib["support"] * 0.99)
        stop = stop_candidate if 0 < stop_candidate < coin["price"] else coin["price"] * 0.97
        stop_pct = (coin["price"] - stop) / coin["price"] * 100
        risk_ok = stop_pct <= MAX_STOP_PCT
        check_score = sum(frame["checks_passed"] for frame in selected_frames)
        score = check_score / (len(selected_frames) * 5) * 76
        score += 14 if trend_confirmed else 0
        score += 10 if in_fib_zone else 0
        if sell_setup:
            score = min(score, 28)

        if sell_setup:
            action = "SAT"
        elif all_frames_passed and not risk_ok:
            action = "RİSKLİ BEKLE"
        elif all_frames_passed and trend_confirmed and in_fib_zone:
            action = "GÜÇLÜ AL"
        elif all_frames_passed:
            action = "AL İZLE"
        else:
            action = "BEKLE"
        chart_frame = frames.get("one_hour") or selected_frames[-1]
        return {
            "coin": public_market(coin),
            "action": action,
            "score": int(max(0, min(100, score))),
            "passed_frames": passed,
            "selected_frame_count": len(selected_frames),
            "all_frames_passed": all_frames_passed,
            "frame_keys": frame_keys,
            "trend_confirmed": trend_confirmed,
            "in_fib_zone": in_fib_zone,
            "sell_setup": sell_setup,
            "risk_ok": risk_ok,
            "max_stop_pct": MAX_STOP_PCT,
            "can_open_trade": not sell_setup and risk_ok and all_frames_passed,
            "target": target,
            "extended_target": extended_target,
            "stop": stop,
            "target_pct": (target - coin["price"]) / coin["price"] * 100,
            "stop_pct": stop_pct,
            "fib": fib,
            "frames": frames,
            "chart": chart_frame["closes"][-90:],
            "radar": [
                *[1 if frame["core_pass"] else 0.28 for frame in selected_frames],
                1 if trend_confirmed else 0.28,
                1 if in_fib_zone else 0.28,
            ],
        }
    except Exception:
        app.logger.info("Could not scan %s", coin.get("pair"), exc_info=True)
        return None


def get_radar(
    force: bool = False, frame_keys: tuple[str, ...] = DEFAULT_FRAME_KEYS
) -> tuple[list[dict], bool]:
    now = time.monotonic()
    cache_key = ",".join(frame_keys)
    cached = radar_cache.get(cache_key, {"at": 0.0, "items": []})
    if not force and cached["items"] and now - cached["at"] < 300:
        return cached["items"], False
    if not scan_lock.acquire(blocking=False):
        return cached["items"], True
    try:
        values = current_markets()
        candidates = sorted(
            values, key=lambda item: item.get("volume_try", 0), reverse=True
        )[:8]
        with ThreadPoolExecutor(max_workers=4) as executor:
            scanned = list(
                executor.map(lambda coin: scan_coin(coin, frame_keys), candidates)
            )
        items = [
            item for item in scanned if item and item["all_frames_passed"]
        ]
        items.sort(key=lambda item: item["score"], reverse=True)
        radar_cache[cache_key] = {"at": time.monotonic(), "items": items}
        return items, False
    finally:
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
    try:
        frame_keys = selected_frame_keys(request.args.get("frames"))
    except ValueError as error:
        return jsonify({"status": "error", "message": str(error)}), 400
    items, scanning = get_radar(request.args.get("force") == "1", frame_keys)
    return jsonify(
        {
            "status": "success",
            "items": items,
            "scanning": scanning,
            "frame_keys": frame_keys,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    )


@app.get("/api/analyze")
def analyze_symbol():
    """Run the complete technical checklist for one BtcTurk TRY pair."""
    pair = canonical_symbol(request.args.get("symbol"))
    if not pair:
        return jsonify(
            {
                "status": "error",
                "message": "Örnek kullanım: WIF/TRY veya WIFTRY.",
            }
        ), 400
    try:
        frame_keys = selected_frame_keys(request.args.get("frames"))
    except ValueError as error:
        return jsonify({"status": "error", "message": str(error)}), 400
    try:
        coin = next(
            (item for item in current_markets() if item["symbol"] == pair), None
        )
    except ccxt.BaseError:
        return jsonify(
            {"status": "error", "message": "BtcTurk piyasa verisine ulaşılamıyor."}
        ), 503
    if not coin:
        return jsonify(
            {
                "status": "error",
                "message": f"{pair}, BtcTurk TRY paritelerinde bulunamadı.",
            }
        ), 404
    item = scan_coin(coin, frame_keys)
    if not item:
        return jsonify(
            {
                "status": "error",
                "message": f"{pair} için mum verisi şu an hazırlanamadı.",
            }
        ), 503
    return jsonify(
        {
            "status": "success",
            "item": item,
            "frame_keys": frame_keys,
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
