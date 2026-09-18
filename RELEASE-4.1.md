# CoinPilot TR 4.2.3

4.2.3: Sanal işlem açarken 5 dakika, 15 dakika, 1 saat, 4 saat veya günlük hedef/stop planı seçilir. Seçim yalnızca yeni işlemin seviyelerini ve otomatik satış takibinin periyodunu belirler; radar filtresini veya eski pozisyonları değiştirmez. Hızlı periyot değişimlerinde geciken eski yanıtlar yok sayılır. Onayda aynı periyotta güncel fiyat ve plan tekrar doğrulanır. İşlem penceresinde ve pozisyon kartlarında hedef/stop hem TL hem girişe göre fiyat değişimi yüzdesiyle gösterilir; maliyet sonrası net sonuç ayrıca belirtilir. Eksik seviyeler sıfır olarak gösterilmez.

AL alarmı puan/5-of-5 işlem uygunluğu yerine seçilen periyotlardan herhangi birinde en az 4/5 koşula bakar; her alarmda periyot ve koşul sayısı belirtilir. Kullanıcı onayıyla satış koşulları dört adet olarak korunmuştur: en az 3/4 satış alarmı, 1/4 ve 2/4 yalnızca ekran uyarısıdır. AL yeşil, SAT kırmızı kutu, yazı ve sekme işareti kullanır. Eşiğin üzerinde kalan aynı olay tekrar ses üretmez. Manuel sanal işlemler risk uyarısıyla serbesttir; hiçbir alarm otomatik emir göndermez.

4.2.2: Daha belirgin, yaklaşık bir saniyelik dört tonlu bildirim sesi ve %10–100 ses ayarı eklendi. Ses açık/kapalı tercihi ve düzeyi localStorage ile yenilemede korunur. Autoplay engeli tercihi kapatmaz; kullanıcıya etkinleştirme düğmesi sunulur ve sonraki kullanıcı etkileşiminde ses yeniden denenir. Bu, tarayıcı/işletim sistemi ses izinlerini atlatmaz.

Kullanıcının renk tercihiyle AL kırmızı, SAT yeşil kutucuk ve bildirim olarak gösterilir; risk uyarıları sarıdır, kâr/zarar renkleri değişmez. Coin içeren bildirimlere ve oturum bildirim geçmişine tıklamak doğrudan o coinin piyasa analizini açar; herhangi bir işlem gerçekleştirmez. Gizli sekmede bildirim türüne göre favicon işareti ve başlık sayacı gösterilir, geri dönünce temizlenir. Gizli sekmede fiyat kontrolü yaklaşık 15 saniyede, satış analiz kontrolü 15 saniyede (analiz önbelleği 60 saniye) sürer. Tarayıcı arka plan kısıtlamaları nedeniyle uyutulan/kapalı sekmede çalışma garantisi yoktur; sistem push bildirimi değildir.

4.2.1: Menü sayfaları açıldığında kaydırma konumu başa alınır; tarayıcının önceki alt konumu yükleme/yenilemede geri getirmesi kapatılır. Detay ve işlem pencereleri tekrar açıldığında da baştan gösterilir. Periyodik fiyat/analiz yenilemeleri kullanıcının kaydırma konumunu sıfırlamaz.

Sesli/yazılı bildirimler: 90/100 üzeri (90 dahil) uygun AL adayları, açık pozisyonun net zarara geçişi, %2/%5 net zarar eşikleri ve mevcut hedef/stop/satış uyarıları ekranda geçici bildirim ve kalıcı oturum listesiyle gösterilir. Aynı olayın tekrarı 90 saniye, toplu uyarı sesleri 8 saniye arayla sınırlandırılır. İlk maliyet kaynaklı eksi değer tek başına “zarara geçti” bildirimi üretmez. Ses için kullanıcı her sayfa açılışında düğmeye basar; Web Audio ile kısa deneme sesi çalar. İşletim sistemi bildirimi veya kapalı sayfada arka plan servisi eklenmedi. Genel bildirim kapatma ve ayrı ses kapatma desteklenir.

4.2.0: Ayrı Satış Takibi sayfası eklendi. Açık pozisyonlar, kaydedilmiş giriş periyotlarıyla otomatik izlenir; eski pozisyonlarda 1 saat kullanılır. Kapanmış mumlarda EMA8 altı fiyat, MACD'nin sinyal çizgisi altına kesişimi veya altındayken süren düşüşü (sıfır altı zorunlu değil), Fisher30'un benzer aşağı yönü ve RSI10'un 50 altında yeni kesişimi veya süren düşüşü kontrol edilir. 1/4 erken uyarı, 2/4 zayıflama, 3–4/4 satış uyarısıdır. Bu eşikler deneysel tasarım tercihidir; doğrulanmış kârlılık/olasılık değildir. Hacim çıkışın zorunlu koşulu yapılmadı. EMA200 alış filtresinde kalır, EMA8 grafiklere mor çizgiyle eklendi.

Satış takibi yalnızca sayfa açıkken yaklaşık dakikada bir çalışır; pozisyon kapanınca izleme biter. Kapanmış mumlar önbellekten kullanılır. Periyot sonuçları toplanıp sahte ortak puan oluşturulmaz; en yüksek uyarının hangi periyotta olduğu gösterilir. Veri hatası veya gecikmesinde sonuç belirsiz olarak işaretlenir. Stop/hedef seviyeleri ayrıca güncel fiyatla izlenir. Hiçbir uyarı otomatik satış yapmaz; 4.1.2'de serbest bırakılan sanal alışlar serbest kalır. Mevcut geçmiş testi, bu yeni çıkış takibi kurallarını test etmez.

MACD sinyal çizgisi kesişimi ile sıfır çizgisi kesişimi farklıdır; yatay piyasada yanıltıcı kesişimler olabilir. Referans: https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/macd

4.1.2: Kullanıcının talebiyle manuel sanal işlemde teknik teyit, SAT sinyali ve %8 stop mesafesi engelleri kaldırıldı. Bunlar uyarı olarak gösterilir; aşağıdaki 5/5 ve %8 kuralları yalnızca teknik uygunluk değerlendirmesi ve geçmiş test için geçerlidir. Geçerli hedef/stop yoksa seviye uydurulmaz; pozisyon bu seviyeler olmadan izlenebilir. Güncel fiyat ve geçerli tutar kontrolü korunur.

Canlı akış düzeltmesi: BtcTurk üretim akışındaki `LA` (ve eski `La`) alanları desteklenir; alınan alış/satış kotasyonları da güncellenir. Yalnızca geçerli fiyat mesajı işlendiğinde canlı veri durumu gösterilir. Kapanmış mum önbelleği sonraki mum kapanışına kadar korunur; istek sınırına yaklaşılırsa kapsamı daraltma uyarısı verilir. Akış alanları gerçek bir genel piyasa mesajıyla doğrulandı; resmi referans: https://docs.btcturk.com/docs/websocket-feed/models/

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
