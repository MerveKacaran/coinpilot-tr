# CoinPilot TR 4.7.0 — piyasa seçimi ve BIST ilk aşama

- Bilinen çalışan kripto sürümü `crypto-stable-4.6.3` etiketiyle d75ab42 commit'inde sabitlendi. Kripto uygulaması `/crypto` adresine taşındı; kodu, teknik kuralları ve tarayıcıdaki `coinpilot-pro-*` portföy anahtarları korunur. `/` yalnızca piyasa seçimi sunar.
- `/bist` ayrı arayüzdür. Kullanıcının sağladığı tarihli OHLCV CSV'den mevcut beş kuralla teknik analiz yapar; grafik, koşul gerekçeleri, hedef/stop ve kaynak zamanı gösterir. Dosya kalıcı kaydedilmez.
- BIST tarafında otomatik canlı veri, otomatik tarama, sanal portföy veya gerçek emir yoktur. Dosya analizi güncel borsa kotasyonu gibi sunulmaz. CSV tarihinin, kurumsal işlemlerin ve veri kullanma hakkının doğruluğu kullanıcı/veri sağlayıcısına bağlıdır.
- Gerçek zamanlı BIST verisini üçüncü kişilere dağıtmak için Borsa İstanbul lisansı gerekir; bundan sonraki veri sağlayıcı aşaması ayrıca değerlendirilecek.

Kaynaklar: https://www.borsaistanbul.com/veriler/veri-yayini ve https://www.borsaistanbul.com/en/data/data-dissemination/borsa-istanbul-data-distribution-agreement
