import time
import unittest
from unittest.mock import patch
import coinpilot_web as web
from tests.test_engine import candles


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client=web.app.test_client()
        self.coin=dict(symbol='TEST/TRY',pair='TESTTRY',price=106,change=2,price_source='REST',price_updated_at=web.iso(),volume_try=1000)

    def test_template_and_version(self):
        response=self.client.get('/')
        self.assertEqual(response.status_code,200)
        self.assertIn(web.VERSION.encode(),response.data)

    def test_each_single_frame(self):
        for key in web.FRAME_SPECS:
            with patch.object(web,'get_coin',return_value=self.coin),patch.object(web,'get_candles',return_value=candles()):
                r=self.client.get('/api/analyze?symbol=TESTTRY&frames='+key)
                self.assertEqual(r.status_code,200)
                data=r.get_json()['item'];self.assertEqual(list(data['frames']),[key])
                self.assertIn('chart',data['frames'][key]);self.assertNotIn('highs',data['frames'][key])
                self.assertEqual(r.headers['Cache-Control'],'no-store')

    def test_invalid_frames_rejected(self):
        self.assertEqual(self.client.get('/api/analyze?symbol=TESTTRY&frames=wrong').status_code,400)
        self.assertEqual(self.client.get('/api/analyze?symbol=TESTTRY&frames=').status_code,400)

    def test_quote_forces_refresh(self):
        with patch.object(web,'get_coin',return_value=self.coin) as get:
            self.assertEqual(self.client.get('/api/quote?symbol=TESTTRY').status_code,200)
            get.assert_called_once_with('TEST/TRY',True)

    def test_slow_rest_refresh_is_not_run_in_http_worker(self):
        with patch.dict(web.markets,{'TEST/TRY':self.coin},clear=True),patch.object(web,'ws_started',True),patch.object(web,'rest_at',0),patch.object(web,'rest_attempt_at',0),patch.object(web,'rest_refreshing',False),patch.object(web.threading,'Thread') as thread,patch.object(web,'rest_seed') as seed:
            for _ in range(12):self.assertEqual(web.current_markets()[0]['symbol'],'TEST/TRY')
            seed.assert_not_called();self.assertEqual(thread.call_count,1)
            self.assertTrue(web.rest_refreshing)

    def test_empty_market_warms_in_background_without_request_queue(self):
        with patch.dict(web.markets,{},clear=True),patch.object(web,'ws_started',True),patch.object(web,'rest_attempt_at',0),patch.object(web,'rest_refreshing',False),patch.object(web.threading,'Thread') as thread:
            for _ in range(8):
                with self.assertRaises(RuntimeError):web.current_markets()
            self.assertEqual(thread.call_count,1)

    def test_failed_refresh_preserves_quote_timestamp(self):
        with patch.dict(web.markets,{'TEST/TRY':self.coin},clear=True),patch.object(web,'rest_seed',side_effect=TimeoutError),patch.object(web,'rest_refreshing',True),patch.object(web,'rest_error',None),patch.object(web,'rest_completed_at',None):
            web.refresh_market_snapshot()
            self.assertFalse(web.rest_refreshing);self.assertEqual(web.rest_error,'TimeoutError')
            self.assertEqual(web.markets['TEST/TRY']['price_updated_at'],self.coin['price_updated_at'])

    def test_trade_price_lock_is_bounded(self):
        with patch.object(web,'current_markets',return_value=[self.coin]),patch.object(web,'rest_lock') as lock:
            lock.acquire.return_value=False
            with self.assertRaises(RuntimeError):web.get_coin('TEST/TRY',True)
            lock.acquire.assert_called_once_with(timeout=1);lock.release.assert_not_called()

    def test_liveness_reports_feed_errors_without_contacting_exchange(self):
        with patch.object(web,'rest_error','TimeoutError'),patch.object(web,'current_markets') as current:
            d=self.client.get('/api/live-status').get_json()
            self.assertEqual(d['rest_last_error'],'TimeoutError');current.assert_not_called()

    def test_position_targets_are_independent_frames(self):
        def scan(coin,keys):
            key=keys[0]
            self.assertEqual(len(keys),1)
            return dict(target={'fifteen_minute':110,'one_hour':120,'daily':150}[key],stop=90,
                        frames={key:{'closed_at':100}},analyzed_at=web.iso())
        with patch.object(web,'get_coin',return_value=self.coin),patch.object(web,'scan_coin',side_effect=scan):
            response=self.client.get('/api/targets?symbol=TEST/TRY')
            self.assertEqual(response.status_code,200)
            d=response.get_json();self.assertEqual(d['frames']['daily']['target'],150)
            self.assertEqual(d['frames']['fifteen_minute']['target'],110)

    def test_position_targets_partial_failure_is_visible(self):
        def scan(coin,keys):
            if keys[0]=='daily':raise ValueError('Missing')
            return dict(target=None,stop=None,frames={keys[0]:{'closed_at':100}},analyzed_at=web.iso())
        with patch.object(web,'get_coin',return_value=self.coin),patch.object(web,'scan_coin',side_effect=scan):
            d=self.client.get('/api/targets?symbol=TEST/TRY').get_json()
            self.assertEqual(d['errors'][0]['frame'],'daily');self.assertIsNone(d['frames']['one_hour']['target'])

    def test_exit_endpoint_tracks_saved_frames(self):
        with patch.object(web,'get_coin',return_value=self.coin),patch.object(web,'get_candles',return_value=candles()):
            response=self.client.get('/api/exit?symbol=TESTTRY&frames=five_minute,four_hour')
            self.assertEqual(response.status_code,200)
            data=response.get_json()
            self.assertEqual(set(data['frames']),{'five_minute','four_hour'})
            self.assertEqual(len(data['frames']['five_minute']['checks']),4)
            self.assertEqual(data['frames']['five_minute']['checks'][0]['label'],'EMA8')

    def test_exit_partial_data_is_explicit(self):
        def get(pair,key):
            if key=='four_hour':raise ValueError('Unavailable')
            return candles()
        with patch.object(web,'get_coin',return_value=self.coin),patch.object(web,'get_candles',side_effect=get):
            data=self.client.get('/api/exit?symbol=TESTTRY&frames=five_minute,four_hour').get_json()
            self.assertEqual(set(data['frames']),{'five_minute'})
            self.assertEqual(data['errors'][0]['frame'],'four_hour')

    def test_exit_missing_data_is_not_safe_signal(self):
        with patch.object(web,'get_coin',return_value=self.coin),patch.object(web,'get_candles',side_effect=ValueError('Unavailable')):
            self.assertEqual(self.client.get('/api/exit?symbol=TESTTRY&frames=one_hour').status_code,503)

    def test_dashboard_per_symbol_timestamps(self):
        with patch.object(web,'current_markets',return_value=[self.coin]):
            data=self.client.get('/api/dashboard').get_json()
            self.assertEqual(data['quotes']['TEST/TRY']['price_updated_at'],self.coin['price_updated_at'])

    def test_radar_background_progress_and_coverage(self):
        web.radar_cache.clear()
        with patch.object(web,'current_markets',return_value=[self.coin]),patch.object(web,'get_candles',return_value=candles()):
            self.assertEqual(self.client.get('/api/radar?frames=five_minute').status_code,200)
            deadline=time.monotonic()+3
            while time.monotonic()<deadline:
                data=self.client.get('/api/radar?frames=five_minute').get_json()
                if not data['scanning']:break
                time.sleep(.02)
            self.assertFalse(data['scanning']);self.assertEqual(data['scanned'],1)
            self.assertEqual(data['total'],1);self.assertEqual(data['errors'],[])

    def test_invalid_backtest_costs(self):
        self.assertEqual(self.client.get('/api/backtest?symbol=TESTTRY&fee=NaN').status_code,400)

    def test_real_websocket_uppercase_la_updates_quote(self):
        with patch.dict(web.markets,{},clear=True):
            self.assertTrue(web.apply_ticker({'PS':'BTCTRY','LA':'100','DP':'2','B':'99','A':'101','V':'8'}))
            q=web.markets['BTC/TRY']
            self.assertEqual(q['price'],100);self.assertEqual(q['price_source'],'WebSocket')
            self.assertEqual(q['bid'],99);self.assertEqual(q['ask'],101)
            self.assertEqual(q['volume_try'],800)
            self.assertTrue(web.apply_ticker({'PS':'BTCTRY','La':'102','DP':'3'}))
            self.assertEqual(web.markets['BTC/TRY']['price'],102)

    def test_invalid_socket_payload_does_not_claim_live_data(self):
        with patch.object(web,'ws_last',0):
            web.ws_message(None,'[401,{"items":[{"PS":"BTCTRY","LA":"bad"}]}]')
            self.assertEqual(web.ws_last,0)
            web.ws_message(None,'[401,{"items":[{"PS":"BTCTRY","LA":"103"}]}]')
            self.assertGreater(web.ws_last,0)


if __name__=='__main__':unittest.main()
