import json
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
import coinpilot_web as web


class RadarRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.key=('recovery-test',)
        web.radar_cache[self.key]=dict(items=[],errors=[],scanned=0,scanning=True)
        self.coins=[dict(symbol=s+'/TRY',pair=s+'TRY',volume_try=10) for s in ('A','B')]

    def tearDown(self):
        web.radar_cache.pop(self.key,None)

    def test_transport_failures_retry_once_without_duplicate_success(self):
        calls={}
        def scan(coin,keys):
            s=coin['symbol'];calls[s]=calls.get(s,0)+1
            if s=='B/TRY' and calls[s]==1:raise web.CandleTemporaryError('timeout')
            return dict(meets_minimum=True,coin=coin)
        with patch.object(web,'current_markets',return_value=self.coins),patch.object(web,'scan_coin',side_effect=scan),patch.object(web.time,'sleep'):
            web.run_radar(self.key,('one_hour',),8,())
        d=web.radar_cache[self.key]
        self.assertEqual(calls,{'A/TRY':1,'B/TRY':2});self.assertEqual(d['successful'],2)
        self.assertEqual(len(d['items']),2);self.assertEqual(d['errors'],[]);self.assertEqual(d['coverage'],'complete')

    def test_total_outage_is_not_no_candidates(self):
        with patch.object(web,'current_markets',return_value=self.coins),patch.object(web,'scan_coin',side_effect=web.CandleTemporaryError('timeout')) as scan,patch.object(web.time,'sleep'):
            web.run_radar(self.key,('one_hour',),8,())
        d=web.radar_cache[self.key]
        self.assertEqual(scan.call_count,4);self.assertEqual(d['successful'],0)
        self.assertEqual(d['coverage'],'unavailable');self.assertEqual(d['scanned'],2)

    def test_invalid_candles_not_retried_as_transport_failure(self):
        def scan(coin,keys):
            if coin['symbol']=='B/TRY':raise ValueError('EMA200 için yeterli mum yok')
            return dict(meets_minimum=False,coin=coin)
        with patch.object(web,'current_markets',return_value=self.coins),patch.object(web,'scan_coin',side_effect=scan) as mocked:
            web.run_radar(self.key,('one_hour',),8,())
        d=web.radar_cache[self.key]
        self.assertEqual(mocked.call_count,2);self.assertEqual(d['coverage'],'partial');self.assertEqual(d['successful'],1)
        self.assertFalse(d['errors'][0]['retryable'])

    def test_duplicate_candle_requests_share_one_network_read(self):
        entered=threading.Event();release=threading.Event()
        class Response:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self):entered.set();release.wait(3);return json.dumps({'s':'ok'}).encode()
        with patch.dict(web.candle_cache,{},clear=True),patch.dict(web.candle_inflight,{},clear=True),patch.object(web,'urlopen',return_value=Response()) as fetch,patch.object(web,'validate_candles',return_value={'t':[1]}),patch.object(web,'graph_requests',web.deque()):
            with ThreadPoolExecutor(max_workers=2) as pool:
                a=pool.submit(web.get_candles,'TESTTRY','one_hour');self.assertTrue(entered.wait(1))
                b=pool.submit(web.get_candles,'TESTTRY','one_hour');release.set()
                self.assertEqual(a.result(),b.result())
            self.assertEqual(fetch.call_count,1);self.assertFalse(web.candle_inflight)

    def test_transport_failure_does_not_poison_cache(self):
        with patch.dict(web.candle_cache,{},clear=True),patch.dict(web.candle_inflight,{},clear=True),patch.object(web,'urlopen',side_effect=TimeoutError),patch.object(web,'graph_requests',web.deque()):
            with self.assertRaises(web.CandleTemporaryError):web.get_candles('TESTTRY','one_hour')
            self.assertFalse(web.candle_cache);self.assertFalse(web.candle_inflight)

    def test_stale_cached_bucket_not_reused(self):
        old=('TESTTRY','one_hour',450,int(time.time())//3600-1)
        with patch.dict(web.candle_cache,{old:(0,{'t':[1]})},clear=True),patch.object(web,'urlopen',side_effect=TimeoutError) as fetch,patch.object(web,'graph_requests',web.deque()):
            with self.assertRaises(web.CandleTemporaryError):web.get_candles('TESTTRY','one_hour')
            fetch.assert_called_once()


if __name__=='__main__':unittest.main()
