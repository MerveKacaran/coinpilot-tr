"""Optional public BtcTurk integration smoke test; no accounts or orders."""
import json
import time
import coinpilot_web as web

with web.app.test_client() as client:
    start=time.monotonic()
    first=client.get('/api/radar?frames=five_minute&limit=8').get_json()
    print('Async radar response seconds:',round(time.monotonic()-start,3),flush=True)
    deadline=time.monotonic()+55
    while time.monotonic()<deadline:
        time.sleep(2)
        response=client.get('/api/radar?frames=five_minute&limit=8').get_json()
        if not response.get('scanning'):break
    print(json.dumps({k:v for k,v in response.items() if k not in ('items','at')},ensure_ascii=False),flush=True)
    start=time.monotonic();dashboard=client.get('/api/dashboard').get_json()
    print('Dashboard seconds:',round(time.monotonic()-start,3),'pairs:',dashboard.get('market_count'),'source:',dashboard.get('source'),flush=True)
    assert response.get('scanned')==8 and not response.get('scanning'),response
    assert dashboard.get('quotes',{}).get('BTC/TRY',{}).get('price',0)>0
    assert dashboard['quotes']['BTC/TRY']['price_source']=='WebSocket',dashboard['quotes']['BTC/TRY']
    print('PASS live public-data smoke')
