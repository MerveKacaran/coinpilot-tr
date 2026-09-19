"""Bounded public candle history for paper-position evidence, never exchange orders."""
import math


def path_window(since, now):
    if not math.isfinite(since) or since <= 0 or since > now:
        raise ValueError('Geçerli geçmiş başlangıç zamanı gerekli.')
    # Exclude the partially elapsed opening minute: its high may predate entry.
    start = math.ceil(since / 60) * 60
    earliest = math.ceil((now - 30 * 86400) / 60) * 60
    clipped = start < earliest
    start = max(start, earliest)
    # Stay below the provider's observed ~1100-candle response cap.
    end = min(start + 600 * 60, int(now // 60) * 60)
    return start, end, clipped


def parse_path(data, start, end, clipped=False):
    if data.get('s') not in ('ok', 'no_data'):
        raise ValueError('Geçmiş fiyat yanıtı doğrulanamadı.')
    rows = {}
    if data['s'] == 'ok':
        fields = ('t', 'o', 'h', 'l', 'c', 'v')
        if not all(isinstance(data.get(k), list) for k in fields):
            raise ValueError('Eksik mum alanı.')
        if len({len(data[k]) for k in fields}) != 1:
            raise ValueError('Mum alanları eşleşmiyor.')
        for raw in zip(*(data[k] for k in fields)):
            if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in raw):
                raise ValueError('Geçersiz mum değeri.')
            t, o, h, l, c, v = raw
            if t != int(t) or t % 60 or min(o, h, l, c) <= 0 or v < 0 or not l <= min(o, c) <= max(o, c) <= h:
                raise ValueError('Geçersiz mum sınırları.')
            if start <= t < end:
                if t in rows:raise ValueError('Yinelenen mum zamanı.')
                rows[t] = dict(time=int(t), high=h, low=l, volume=v)
    candles = sorted(rows.values(), key=lambda r:r['time'])
    expected = max(0, (end - start) // 60)
    # Zero-volume candles cannot prove that an actual trade touched a level.
    unknown = expected - sum(c['volume'] > 0 for c in candles)
    return dict(candles=candles, start=start, through=end, clipped=clipped,
                missing_minutes=unknown, complete=not clipped and unknown == 0,
                resolution_seconds=60)
