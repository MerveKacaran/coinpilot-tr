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
