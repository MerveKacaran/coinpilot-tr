# CoinPilot TR 4.1.0

## Kullanım

- Piyasa Hareketi altında bir TRY paritesi seç. Son fiyat, fiyatın alındığı zaman ve kaynak kartta ve detayda görünür; ekran açıkken fiyatlar 3 saniyede bir istenir. Bu, borsanın her işlem tick'inin aynı gecikmeyle iletileceği garantisi değildir.
- Teknik Radar'da istenen periyotları ve kapsamı seçip Filtreyi Uygula'ya bas. En az bir seçili periyotta 3/5 aday listeye girer. Sanal giriş için tüm seçili periyotların 5/5 olması, hedefin girişten yukarıda, stopun aşağıda ve stop mesafesinin en fazla %8 olması gerekir.
- Karttaki periyot butonundan koşul gerekçelerine ve mum grafiğine ulaş. Koşul puanı kazanma olasılığı değildir. Göstergeler henüz kapanmamış mumdan hesaplanmaz.
- Alış ve satışta güncel kotasyon yeniden doğrulanır. Komisyon ve kayma kullanıcı varsayımıdır; borsanın kişisel komisyon tarifesi değildir. Varsayılan her yön için %0,10 komisyon ve %0,10 kaymadır. Varsa alış/satış kotasyonu kullanılır. Portföyde değerler tahmini çıkış maliyetleri düşülmüş olarak gösterilir.
- Pozisyonlarım → Yedeği İndir; başka cihazda Yedek Yükle. Bu, otomatik bulut senkronizasyonu değildir. Birleştirmede aynı kimlikte mevcut kayıt önceliklidir; kapanış kaydı mevcutsa eski açık kayıt tekrar açılmaz. Eski sürümün kimliksiz satış kayıtları, eski bir açık kaydın kapandığını kanıtlayamaz. İçe aktarma etkin periyot ayarını değiştirmez.
- Uyarılar yalnızca sayfa açık ve veri bağlantısı varken çalışır; otomatik emir veya arka plan push bildirimi yoktur.

## Analiz ve test sınırları

RSI10 Wilder RMA ile hesaplanır. MACD yakın-sıfır toleransı kapanışın %0,25'i, Fisher toleransı -0,15'tir. Bu toleranslar seçilmiş kurallardır; doğrulanmış kazanç olasılığı değildir. Hacim son kapanmış mumun önceki 20 mum ortalamasına oranıdır. Düşen trend ve retest, son 65 mumdaki doğrulanmış yerel zirvelerden türetilen ek ipuçlarıdır.

Geçmiş test sadece seçilen tek periyodun 5/5 kuralını inceler; çoklu-periyot stratejisinin ortak testini yapmaz. En fazla istenen son yaklaşık 650 mumdan 210 ısınma mumu ayrılır. Sonraki mum açılışı, iki yönlü komisyon/kayma, aynı mumda stop önceliği ve test sonu kapanışı kullanılır. Tarihsel bid/ask spreadi, likidite/kısmi gerçekleşme ve kesintisiz uzun dönem veri modellenmez. Az işlemli sonuçlar güvenilir başarı kanıtı değildir.

## Geliştirici doğrulaması

`python -m unittest discover -v` saf gösterge, kapanmış/gecikmiş veri, hedef/stop, gelecek veriyi kullanmama ve API testlerini çalıştırır.

Yerel uygulamayı 10001 portunda açıp, Playwright bulunan ortamda `node tests/ui.spec.cjs` çalıştırılabilir. Bu test kontrollü API verisi kullanır: beş tek-periyot seçimi, canlı fiyat değişimi, detay grafiği, güncel sanal giriş/çıkış, maliyetler, başarısız satışta pozisyon korunması, yedek birleştirme ve mobil alt boşluk kontrol edilir. Gerçek veri kontrolü bundan ayrı yapılmalıdır.

Render başlangıcı `gunicorn app:app`; `gunicorn.conf.py` tek paylaşılan veri akışı/önbellek ve 8 istek iş parçacığı ayarlar. Ücretsiz sunucunun uyku ve kaynak sınırları devam eder. Borsa bağlantısı koparsa son fiyatın zamanı korunur; doğrulanamayan fiyatla sanal işlem açılmaz.
