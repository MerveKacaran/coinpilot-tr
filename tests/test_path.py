import unittest
from unittest.mock import patch
from coinpilot_path import path_window, parse_path
import coinpilot_web as web


def raw(times=(120,180), highs=(110,105), volume=(1,1)):
    return dict(s='ok',t=list(times),o=[100]*len(times),h=list(highs),l=[95]*len(times),c=[100]*len(times),v=list(volume))


class PricePathTests(unittest.TestCase):
    def test_partial_open_minute_excluded(self):
        self.assertEqual(path_window(121,300),(180,300,False))

    def test_no_future_coverage_for_new_position(self):
        self.assertEqual(path_window(121,125),(180,120,False))

    def test_bounded_pages_and_retention(self):
        start,end,clipped=path_window(60,4000000)
        self.assertTrue(clipped);self.assertLessEqual(end-start,86400)

    def test_invalid_time(self):
        for value in (float('nan'),float('inf'),-1,301):
            with self.assertRaises(ValueError):path_window(value,300)

    def test_complete_closed_candles(self):
        d=parse_path(raw(),120,240)
        self.assertTrue(d['complete']);self.assertEqual(d['missing_minutes'],0)

    def test_gaps_and_zero_volume_are_unknown(self):
        d=parse_path(raw(volume=(0,1)),120,300)
        self.assertFalse(d['complete']);self.assertEqual(d['missing_minutes'],2)

    def test_no_data_is_not_negative_evidence(self):
        d=parse_path({'s':'no_data'},120,240)
        self.assertFalse(d['complete']);self.assertEqual(d['missing_minutes'],2)

    def test_partial_and_outside_candles_removed(self):
        d=parse_path(raw(times=(120,180)),180,240)
        self.assertEqual([r['time'] for r in d['candles']],[180])

    def test_bad_provider_data_rejected(self):
        cases=[raw(times=(120,120)),raw(highs=(99,105)),raw(highs=(float('nan'),105)),{'s':'error'},dict(raw(),c=[])]
        for data in cases:
            with self.assertRaises(ValueError):parse_path(data,120,240)

    def test_endpoint_validation_and_no_private_data(self):
        client=web.app.test_client()
        self.assertEqual(client.get('/api/price-path?symbol=BTC/TRY&from=nan').status_code,400)
        self.assertEqual(client.get('/api/price-path?symbol=invalid&from=1').status_code,400)
        with patch.object(web,'urlopen',side_effect=TimeoutError),patch.object(web.time,'time',return_value=600):
            self.assertEqual(client.get('/api/price-path?symbol=TEST/TRY&from=120').status_code,503)


if __name__=='__main__':unittest.main()
