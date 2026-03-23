# SınavForge — Android APK Hazırlama Kılavuzu

## Gereksinimler
- Android Studio Hedgehog (2023.1) veya üstü
- JDK 17
- Android SDK 34

---

## 1. Projeyi Android Studio'ya Aç

1. Android Studio'yu aç
2. **File → Open** → `SinavForge-Android` klasörünü seç
3. Gradle sync otomatik başlar — bekle (~1-2 dk)

---

## 2. Gradle Sync Sorunu Çıkarsa

`File → Invalidate Caches → Invalidate and Restart` yap.

---

## 3. Debug APK Oluştur (Test için)

```
Build → Build Bundle(s) / APK(s) → Build APK(s)
```

APK çıktısı: `app/build/outputs/apk/debug/app-debug.apk`

Tablete aktarmak için:
- USB kablosuyla bağla
- `app-debug.apk` dosyasını cihaza kopyala
- Cihazda "Bilinmeyen kaynaklardan yükle" iznini ver
- APK'ya dokunarak kur

---

## 4. Release APK Oluştur (Dağıtım için)

### 4a. Keystore Oluştur (ilk seferinde)

```
Build → Generate Signed Bundle / APK
→ APK seç → Create new keystore
```

Bilgileri doldur:
- Key store path: `SinavForge-Android/app/sinavforge.keystore`
- Password: güçlü bir şifre
- Alias: `sinavforge`

### 4b. app/build.gradle'a İmza Ekle

```groovy
android {
    signingConfigs {
        release {
            storeFile file('sinavforge.keystore')
            storePassword 'SIFRENIZ'
            keyAlias 'sinavforge'
            keyPassword 'SIFRENIZ'
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
        }
    }
}
```

### 4c. İmzalı APK Oluştur

```
Build → Generate Signed Bundle / APK → APK → release
```

Çıktı: `app/build/outputs/apk/release/app-release.apk`

---

## 5. Web Dosyalarını Güncelleme

Web uygulamasını güncelledikten sonra:

1. Yeni dosyaları `app/src/main/assets/www/` klasörüne kopyala:
   - `index.html`
   - `script.js`
   - `style.css`
   - `ml-layer.js` (varsa)
   - `ml-worker.js` (varsa)

2. APK'yı yeniden build et

---

## 6. Önemli Notlar

### CDN Bağlantısı
Uygulama şu CDN'lerden yükleme yapar (internet gerektirir):
- `cdnjs.cloudflare.com` — PDF.js, jsPDF, SortableJS
- `api.anthropic.com` — YZ Sınıflandırma (opsiyonel)

### Offline Çalışma (Opsiyonel)
CDN dosyalarını da assets/www içine koyup `index.html`'deki CDN URL'lerini
`./pdfjs/pdf.min.js` gibi yerel yollarla değiştirerek tam offline çalışma sağlanabilir.

İndirilecek dosyalar:
- https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js
- https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js
- https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
- https://cdnjs.cloudflare.com/ajax/libs/Sortable/1.15.2/Sortable.min.js

### S-Pen Desteği
S-Pen uyumlu Samsung cihazlarda otomatik çalışır.
Uygulama içinden S-Pen modunu etkinleştir.

### Minimum Android Sürümü
Android 7.0 (API 24) — WebView ile tam uyumlu.

---

## 7. Proje Yapısı

```
SinavForge-Android/
├── app/
│   ├── src/main/
│   │   ├── assets/www/          ← Web uygulaması buraya
│   │   │   ├── index.html
│   │   │   ├── script.js
│   │   │   ├── style.css
│   │   │   ├── ml-layer.js
│   │   │   └── ml-worker.js
│   │   ├── java/com/sinavforge/app/
│   │   │   └── MainActivity.java
│   │   ├── res/
│   │   │   ├── layout/activity_main.xml
│   │   │   ├── values/themes.xml
│   │   │   └── xml/network_security_config.xml
│   │   └── AndroidManifest.xml
│   └── build.gradle
├── build.gradle
├── settings.gradle
└── gradle.properties
```
