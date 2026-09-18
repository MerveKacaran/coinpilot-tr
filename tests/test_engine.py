import math
import unittest
from unittest.mock import patch

import coinpilot_engine as engine


def candles(count=260, now=1800000000, duration=300):
    closes=[100+i*.025+math.sin(i/8)*.6 for i in range(count)]
    return dict(t=[now-(count-i)*duration for i in range(count)],o=[v-.03 for v in closes],
                h=[v+.25 for v in closes],l=[v-.25 for v in closes],c=closes,v=[100.0]*count)


class IndicatorTests(unittest.TestCase):
    def test_wilder_seed_and_smoothing(self):
        result=engine.rsi_series([1,2,3,2,4,3],3)
        self.assertEqual(result[:3],[None]*3)
        self.assertAlmostEqual(result[3],100*2/3)
        self.assertAlmostEqual(result[4],100*10/12)
        self.assertAlmostEqual(result[5],100*20/33)

    def test_flat_and_unidirectional_rsi(self):
        self.assertEqual(engine.rsi_series([5]*20)[-1],50)
        self.assertEqual(engine.rsi_series(list(range(20)))[-1],100)
        self.assertEqual(engine.rsi_series(list(range(20,0,-1)))[-1],0)

    def test_reversed_cross_is_not_buy(self):
        self.assertEqual(engine.crosses([-1,1,-1],[0,0,0]),(False,True))
        self.assertEqual(engine.crosses([-1,0,1],[0,0,0]),(True,False))

    def test_all_frame_combinations_are_self_contained(self):
        for key in engine.FRAME_SPECS:
            frame=engine.analyse_frame(key,candles())
            signal=engine.build_signal({'price':106,'symbol':'TEST/TRY'}, {key:frame})
            self.assertEqual(signal['chart_frame'],key)
            self.assertEqual(len(frame['checks']),5)
            self.assertEqual(signal['meets_minimum'],frame['checks_passed']>=3)

    def test_zero_volume_never_confirms(self):
        c=candles();c['v']=[0]*len(c['v'])
        f=engine.analyse_frame('five_minute',c)
        self.assertFalse(f['above_average_volume'])
        self.assertEqual(f['volume_ratio'],0)

    def test_closed_candles_only(self):
        c=candles();now=1800000000
        for k,v in dict(t=now,o=100,h=1000,l=99,c=999,v=500).items():c[k].append(v)
        result=engine.validate_candles(c,300,now)
        self.assertEqual(len(result['c']),260)
        self.assertLess(result['c'][-1],200)

    def test_bad_stale_and_short_candles_fail(self):
        for change in ['length','nan','stale','short']:
            c=candles()
            if change=='length':c['v'].pop()
            if change=='nan':c['h'][-1]=float('nan')
            if change=='stale':c['t']=[v-10000 for v in c['t']]
            if change=='short':c={k:v[:20] for k,v in c.items()}
            with self.subTest(change=change),self.assertRaises(ValueError):engine.validate_candles(c,300,1800000000)

    def test_missing_target_is_not_fabricated(self):
        f=engine.analyse_frame('one_hour',candles())
        plan=engine.levels(f,10000)
        self.assertIsNone(plan['target'])
        self.assertFalse(plan['risk_ok'])

    def test_strict_entry_versus_three_of_five_candidate(self):
        f=engine.analyse_frame('one_hour',candles());f['core_pass']=False;f['checks_passed']=3
        s=engine.build_signal({'price':106},{'one_hour':f})
        self.assertTrue(s['meets_minimum']);self.assertFalse(s['can_open_trade'])


class ExitTests(unittest.TestCase):
    def assess(self,**kwargs):
        args=dict(closes=[100,101,102],ema8=[99,100,101],rsis=[55,56,57],
                  macd=[1,2,3],trigger=[.5,1,2],fish=[1,2,3],fish_trigger=[0,1,2])
        args.update(kwargs)
        return engine.exit_conditions(**args)

    def test_positive_macd_down_cross_warns_without_zero_cross(self):
        result=self.assess(macd=[3,4,3],trigger=[2,3,3.5])
        self.assertTrue(result['macd_cross_down'])
        self.assertTrue(result['checks'][1]['ok'])
        self.assertGreater(result['checks'][1]['value'],0)
        self.assertEqual(result['count'],1)
        self.assertEqual(result['stage'],'ERKEN UYARI')

    def test_recovered_macd_is_not_stale_sell_cross(self):
        self.assertFalse(self.assess(macd=[5,3,4],trigger=[4,4,3.5])['checks'][1]['ok'])

    def test_all_four_bearish_conditions(self):
        result=self.assess(closes=[104,102,99],ema8=[103,102,100],rsis=[52,51,49],
                           macd=[3,2,1],trigger=[2,2,1.5],fish=[1,.5,.2],fish_trigger=[1,.8,.5])
        self.assertEqual(result['count'],4)
        self.assertEqual(result['stage'],'SATIŞ UYARISI')

    def test_no_conditions_does_not_claim_sell(self):
        self.assertEqual(self.assess()['count'],0)
        self.assertEqual(self.assess()['stage'],'ÇIKIŞ TEYİDİ YOK')

    def test_ema8_not_ema200_is_exit_reference(self):
        result=self.assess(closes=[100,100,99],ema8=[100,100,100])
        self.assertTrue(result['checks'][0]['ok'])
        self.assertEqual(result['checks'][0]['label'],'EMA8')

    def test_two_conditions_report_weakening(self):
        result=self.assess(closes=[100,100,99],ema8=[100,100,100],rsis=[51,50,49])
        self.assertEqual(result['stage'],'ZAYIFLAMA')


class BacktestTests(unittest.TestCase):
    def test_stop_first_and_costs(self):
        c=candles(211);c['o'][-1]=100;c['h'][-1]=110;c['l'][-1]=90;c['c'][-1]=105
        with patch.object(engine,'analyse_frame',return_value={'core_pass':True}),patch.object(engine,'levels',return_value={'risk_ok':True,'stop':95,'target':105}):
            r=engine.backtest('one_hour',c,fee=.001,slippage=.001)
        self.assertEqual(r['trade_count'],1);self.assertEqual(r['trades'][0]['reason'],'Stop')
        expected=(95*.999*.999/(100*1.001*1.001)-1)*100
        self.assertAlmostEqual(r['net_return_pct'],expected)

    def test_no_future_data_enters_signal(self):
        c=candles(214);seen=[]
        def analyze(key,history):
            seen.append(history['t'][-1]);return {'core_pass':False}
        with patch.object(engine,'analyse_frame',side_effect=analyze),patch.object(engine,'levels',return_value={'risk_ok':False}):
            r=engine.backtest('five_minute',c)
        self.assertEqual(seen,c['t'][209:213]);self.assertEqual(r['trade_count'],0)
        self.assertIsNone(r['win_rate'])

    def test_just_warmup_not_enough(self):
        with self.assertRaises(ValueError):engine.backtest('one_hour',candles(210))


if __name__=='__main__':unittest.main()
