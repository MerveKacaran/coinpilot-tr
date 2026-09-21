import io
import math
import unittest
from datetime import datetime, timedelta, timezone

from coinpilot_bist import analyze_uploaded_bist
from coinpilot_web import app


def sample_csv(count=230, latest=datetime(2026, 9, 18, tzinfo=timezone.utc)):
    lines = ['date,open,high,low,close,volume']
    for i in range(count):
        day = (latest - timedelta(days=count - 1 - i)).date().isoformat()
        price = 100 + i * .08 + math.sin(i / 9) * .4
        lines.append(f'{day},{price:.4f},{price+.5:.4f},{price-.5:.4f},{price:.4f},{1000+i}')
    return ('\n'.join(lines) + '\n').encode()


class BistTests(unittest.TestCase):
    def test_separate_routes_and_crypto_home(self):
        client = app.test_client()
        self.assertIn(b'/crypto', client.get('/').data)
        self.assertIn(b'CoinPilot', client.get('/crypto').data)
        self.assertIn(b'analyze-form', client.get('/bist').data)

    def test_uploaded_daily_data_uses_existing_five_checks(self):
        now = datetime(2026, 9, 21, 12, tzinfo=timezone.utc)
        result = analyze_uploaded_bist(sample_csv(), 'THYAO', 'daily', now)
        self.assertEqual(result['coin']['symbol'], 'THYAO')
        self.assertEqual(len(result['frames']['daily']['checks']), 5)
        self.assertEqual(result['data_source'], 'Yüklenen CSV · canlı fiyat değil')
        self.assertEqual(len(result['frames']['daily']['chart']), 120)
        self.assertNotIn('highs', result['frames']['daily'])

    def test_no_false_live_quote_or_automatic_trade(self):
        response = app.test_client().post('/api/bist/analyze', data={
            'symbol': 'THYAO', 'frame': 'daily', 'file': (io.BytesIO(sample_csv()), 'THYAO.csv')
        })
        self.assertEqual(response.status_code, 200)
        result = response.get_json()['result']
        self.assertIn('canlı fiyat değil', result['data_source'])
        self.assertNotIn('order_id', result)

    def test_rejects_short_or_bad_data(self):
        now = datetime(2026, 9, 21, 12, tzinfo=timezone.utc)
        with self.assertRaisesRegex(ValueError, '210'):
            analyze_uploaded_bist(sample_csv(30), 'THYAO', 'daily', now)
        with self.assertRaisesRegex(ValueError, 'başlığı'):
            analyze_uploaded_bist(b'bad,data\n1,2', 'THYAO', 'daily', now)
        with self.assertRaisesRegex(ValueError, 'pay kodu'):
            analyze_uploaded_bist(sample_csv(), '../', 'daily', now)


if __name__ == '__main__':
    unittest.main()
