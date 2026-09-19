# 4.3.3 — Teknik Radar veri kurtarma

- Aynı parite/periyot/mum için eşzamanlı istekler tek ağ isteğini paylaşır.
- En fazla üç eşzamanlı analiz mum isteği; meşgul kanallar uzun HTTP kuyruğu yaratmaz.
- Geçici ağ hataları tarama sonunda bir kez daha denenir. Başarılı sonuçlar korunur,
  iyileşen paritenin hata kaydı kaldırılır; yinelenen aday üretilmez.
- Geçersiz veya yetersiz mum veri hatası ağ hatası gibi yeniden denenmez. Eski
  periyot önbelleği yeni mum yerine kullanılamaz; indikatör kuralları değişmedi.
- Başarılı analiz sayısı, kısmi tarama ve tüm verinin alınamadığı durum ayrıdır.
  Veri kesintisi, uygun coin olmadığı şeklinde gösterilmez.
- BtcTurk mum servisine erişim kesintisini uygulama ortadan kaldıramaz; başka borsa
  verisi sessizce yerine konulmaz. Al/sat muhasebesi ve emir kuralları değiştirilmedi.

Testler: tests/test_radar_recovery.py ve tests/radar_ui.cjs, mevcut regresyon testleri.
