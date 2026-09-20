# CoinPilot TR 4.4.0

- Periyot hedeflerinin yanında, pozisyon açıldıktan sonra gözlenen en yüksek fiyata göre hedef durumu gösterilir: yeşil `✓` veya kırmızı `✕`.
- Kayıtlı hedefe ve stopa ilk temasta birbirinden farklı, yaklaşık 10 saniyelik sesli uyarılar verilir. Aynı türde eşzamanlı uyarılar sesi üst üste bindirmez; yazılı bildirimler ayrı kalır.
- Her pozisyon için varsayılanı kapalı olan **Otomatik sanal satış** seçeneği eklendi.
- Otomatik sanal satış yalnızca sayfa açıkken ve fiyat tazeyken çalışır. Kayıtlı stop, kayıtlı hedef veya seçilen periyotlardan birinde en az 3/4 teknik SAT teyidi oluşursa kalan miktarın tamamını taze alış kotasyonu üzerinden, kayıtlı komisyon ve kayma varsayımlarıyla kapatır.
- Satış nedeni ve kullanılan varsayımlar işlem geçmişine kaydedilir. Hiçbir özellik gerçek borsa emri göndermez.
