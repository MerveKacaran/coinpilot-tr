# CoinPilot TR 4.5.0

- Yeni işlem planlarında stop riski hedef kazancının en fazla yarısıdır; hedef/stop oranı en az 2:1 tutulur.
- Stop mesafesi ayrıca giriş fiyatının %5'ini aşamaz. Teknik stop daha yakınsa değiştirilmez; daha uzaktaysa risk sınırına yaklaştırılır.
- Mevcut açık pozisyonların kayıtlı hedef/stop seviyeleri geriye dönük değiştirilmez.
- Periyot analizlerinde hedef durumunun yanında stop durumu da gösterilir. Hedefte yeşil `✓` ulaşmayı, kırmızı `✕` henüz ulaşılmadığını; stopta kırmızı `✓` stop temasını, yeşil `✕` stop görülmediğini ifade eder.
- Sol menüye ayrı **Takip Ettiklerim** sayfası eklendi. Canlı fiyat, analize geçiş ve listeden çıkarma işlemleri burada bulunur.
- Pozisyonlarım sayfasındaki kartlar geniş, tek sütun halinde alt alta gösterilir.
- AL ve SAT sinyalleri birbirinden farklı 10 saniyelik seslere sahiptir. Hedef/stop sesleri ayrı; diğer bildirim sesi kısa ve nötrdür.
- Teknik kural sürümü 4.5.0'a yükseltildi. Eski forward-v1 gözlem verileri yeni kurallarla sessizce birleştirilmez.
