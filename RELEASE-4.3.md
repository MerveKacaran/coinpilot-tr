# CoinPilot arayüzü 4.3.1 — periyot hedefleri, hedef geçmişi ve parçalı sanal satış

Teknik analiz kuralları 4.2.3 olarak kalır; araştırma deneyinin eşikleri değiştirilmedi.
Arayüz sürümü ve statik dosya önbellek anahtarı 4.3.1'dir. Gerçek hesap bağlantısı yoktur.

## Periyot hedefleri ve parçalı satış

- Açık pozisyonlarda 15 dakika, 1 saat ve günlük hedefler ayrı analizle gösterilir.
  Güncel analiz hedefi, pozisyon açılırken kaydedilen sabit hedefi değiştirmez.
  Yüzdeler pozisyonun giriş fiyatına göredir; veri eksikse fiyat uydurulmaz.
- Manuel satış ve fiyatlı limit emrinde kalan miktarın yüzdesi veya coin adedi
  seçilir. Manuel satışta %25/%50/%75/tamamı kısayolları vardır.
- Satışa düşen giriş maliyeti orantılı ayrılır. Kalan adet ve maliyet açık pozisyonda,
  satılan parçanın net sonucu bağımsız satış kimliğiyle geçmişte tutulur.
- Manuel satış mevcut bekleyen limiti iptal eder; kullanıcı kalan için yeni emir
  oluşturabilir. Parçalı limit dolumu sonrası kalan açık kalır; dolan emir tekrarlanmaz.
- Yedek birleştirme satış sürümlerini kullanır; eski yedek satılmış miktarı geri
  getirmez. İki cihazda aynı pozisyona bağımsız çelişen satışlar yapılmışsa otomatik
  birleştirme güvenli biçimde reddedilir.

## Pozisyon geçmişi

- Açık pozisyonun hedef/stop teması ve gözlenen en yüksek/en düşük fiyatı yerel
  portföy kaydına eklenir; sayfa yenilense de silinmez, JSON yedeğine dahil edilir.
- `/api/price-path` yalnızca halka açık fiyatları okur; kullanıcı portföyünü sunucuya
  yazmaz. Son 30 gün, istek başına en fazla 600 adet 1 dakikalık mum; paylaşılan
  istek sınırı ve kısa süreli, boyutu sınırlı önbellek kullanılır.
- Kaynak: [BtcTurk Kline API](https://docs.btcturk.com/docs/public-endpoints/get-kline-data/).
- İşlem açılış dakikasının girişten önceki kısmı ayrıştırılamadığı için o dakika
  tamamen dışarıda tutulur. Kapanmamış, sıfır hacimli veya eksik mum hedefin hiç
  görülmediğini kanıtlamaz. Bilinen temas kalıcı pozitif kanıttır; yokluğu garanti değildir.
- Her pozisyonda elle tam yeniden kontrol yapılabilir. Normal kontroller son
  işlenen noktadan ilerler. Eksik aralıklar açıkça gösterilir.

## Sanal limit satış

- Pozisyon kartından TL fiyatı ve satılacak miktar girilir. Girişe göre yüzde ve
  komisyon sonrası tahmini net sonuç gösterilir. Stop-loss emri değildir.
- Canlı modda taze alış kotasyonu (bid), yoksa açıkça etiketlenen son işlem fiyatı
  limite ulaşınca seçilen adedin limit fiyatından dolduğu varsayılır. Limitin altında kayma
  uygulanmaz; komisyon düşülür. Gerçek sıra, likidite ve kısmi dolum yoktur.
- Varsayılan olarak geçmişten emir yürütme kapalıdır. Emir formundaki açık onayla
  geriye dönük mum simülasyonu seçilebilir. Emir oluşturulduktan sonraki tam mumda
  limit görülürse yeniden açılışta sanal satış hesaplanır. Mum dakikası ve kayda
  alınma zamanı ayrıdır; bu işlem gerçek zamanlı sunucu emri olarak sunulmaz.
- Değiştirme yeni emir kimliği ve başlangıç zamanı oluşturur; eski fiyat hareketleri
  yeni emri dolduramaz. İptal veya manuel satış bekleyen emri sonlandırır.
- Tarayıcı Web Locks ile iki sekmenin aynı pozisyonu iki kez satması önlenir. Aynı
  cihazın sekmeleri kayıt değişikliklerini alır. Bulut/cihazlar arası senkronizasyon yoktur.
- Eski bir yedek başka cihazda bağımsız simülasyondur. Sayfa kapalıyken bildirim veya
  emir çalıştıran sunucu altyapısı eklenmedi. Araştırma toplayıcısı bundan bağımsızdır.

## Doğrulama

Python birim testleri: `python -m unittest discover -s tests`

Saf sanal işlem testleri: `node --test tests/test_paper.cjs`

İzole tarayıcı testi: `tests/positions_ui.cjs` (yerel 10001 portundaki uygulama,
Playwright ve Chrome gerekir). Test portföyü ve API yanıtları taklittir; gerçek
kullanıcı portföyüne veya borsa hesabına erişmez.
