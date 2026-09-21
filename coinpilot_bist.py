"""Offline BIST candle analysis; uploaded data is never treated as a live quote."""
import csv
import io
import math
import re
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from coinpilot_engine import FRAME_SPECS, VERSION, analyse_frame, build_signal, validate_candles

try:
    ISTANBUL = ZoneInfo('Europe/Istanbul')
except ZoneInfoNotFoundError:
    # Windows Python installations without tzdata still support recent BIST files.
    ISTANBUL = timezone(timedelta(hours=3))
FIELDS = ('date', 'open', 'high', 'low', 'close', 'volume')


def _timestamp(value):
    value = value.strip()
    for pattern in ('%Y-%m-%d', '%Y-%m-%d %H:%M', '%Y-%m-%d %H:%M:%S',
                    '%d.%m.%Y', '%d.%m.%Y %H:%M', '%d.%m.%Y %H:%M:%S'):
        try:
            parsed = datetime.strptime(value, pattern)
            return int(parsed.replace(tzinfo=ISTANBUL).timestamp())
        except ValueError:
            pass
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return int((parsed if parsed.tzinfo else parsed.replace(tzinfo=ISTANBUL)).timestamp())
    except ValueError as exc:
        raise ValueError('Tarih biçimi geçersiz; örnek: 2026-09-18 veya 2026-09-18 14:00.') from exc


def _number(value):
    value = value.strip().replace(' ', '')
    if ',' in value and '.' in value:
        value = value.replace('.', '').replace(',', '.') if value.rfind(',') > value.rfind('.') else value.replace(',', '')
    elif ',' in value:
        value = value.replace(',', '.')
    try:
        number = float(value)
    except ValueError as exc:
        raise ValueError('Fiyat veya hacim sütununda sayı olmayan değer var.') from exc
    if not math.isfinite(number):
        raise ValueError('Fiyat veya hacim sütununda geçersiz sayı var.')
    return number


def analyze_uploaded_bist(raw, symbol, key, now=None):
    symbol = str(symbol or '').strip().upper().removesuffix('.IS')
    if not re.fullmatch(r'[A-Z0-9]{3,8}', symbol):
        raise ValueError('Geçerli bir BIST pay kodu gir; örnek: THYAO.')
    if key not in FRAME_SPECS:
        raise ValueError('Geçerli bir analiz periyodu seç.')
    if not raw or len(raw) > 2_000_000:
        raise ValueError('CSV dosyası boş veya 2 MB sınırını aşıyor.')
    content = raw.decode('utf-8-sig')
    first = content.splitlines()[0] if content.splitlines() else ''
    delimiter = ';' if first.count(';') > first.count(',') else ','
    reader = csv.DictReader(io.StringIO(content), delimiter=delimiter)
    if not reader.fieldnames or tuple(x.strip().lower() for x in reader.fieldnames) != FIELDS:
        raise ValueError('CSV başlığı date,open,high,low,close,volume olmalı; noktalı virgül de kabul edilir.')
    rows = []
    for row in reader:
        if len(rows) >= 10000:
            raise ValueError('En fazla 10.000 mum yüklenebilir.')
        try:
            values = {k.strip().lower(): v for k, v in row.items() if k is not None}
            rows.append((_timestamp(values['date']), *(_number(values[k]) for k in FIELDS[1:])))
        except (KeyError, AttributeError, TypeError) as exc:
            raise ValueError('CSV satırındaki sütun sayısı veya değerler eksik.') from exc
    if len(rows) < 210:
        raise ValueError(f'EMA200 için en az 210 kapanmış mum gerekli ({len(rows)} satır var).')
    duration = FRAME_SPECS[key][2]
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    latest = max(row[0] for row in rows)
    if latest > now.timestamp():
        raise ValueError('Dosyada geleceğe ait mum var.')
    latest_local = datetime.fromtimestamp(latest, ISTANBUL)
    local_now = now.astimezone(ISTANBUL)
    if key == 'daily':
        if latest_local.date() == local_now.date() and local_now.time() < time(19, 0):
            raise ValueError('Bugünkü günlük mum kapanmış sayılmaz; seans sonrası dosyayı yeniden yükle.')
    elif latest + duration > now.timestamp():
        raise ValueError('Son mum henüz kapanmamış görünüyor.')
    data = {k: [r[i] for r in rows] for i, k in enumerate(('t', 'o', 'h', 'l', 'c', 'v'))}
    candles = validate_candles(data, duration, latest + duration)
    frame = analyse_frame(key, candles)
    coin = {'symbol': symbol, 'pair': symbol, 'price': candles['c'][-1],
            'price_source': 'Kullanıcı CSV dosyası', 'price_updated_at': latest_local.isoformat()}
    signal = build_signal(coin, {key: frame})
    for field in ('highs', 'lows', 'closes'):
        frame.pop(field, None)
    age_hours = round((now.timestamp() - latest) / 3600, 1)
    signal.update(data_source='Yüklenen CSV · canlı fiyat değil',
                  source_time=latest_local.isoformat(), data_age_hours=age_hours,
                  rules_version=VERSION, frame=key,
                  caveat='Bedelsiz, temettü ve bölünme düzeltmeleri dosyanın kaynağına bağlıdır. Sinyal ve hedefler doğrulanmış canlı fiyat değildir.')
    return signal
