package com.sinavforge.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private ValueCallback<Uri[]> fileChooserCallback;

    private static final int REQUEST_FILE_CHOOSER  = 1001;
    private static final int REQUEST_PERMISSIONS   = 1002;

    // ─────────────────────────────────────────────
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Tam ekran + durum çubuğunu gizle
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        );
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY |
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE |
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
            View.SYSTEM_UI_FLAG_FULLSCREEN
        );

        setContentView(R.layout.activity_main);
        webView = findViewById(R.id.webview);

        setupWebView();
        requestStoragePermissions();
        loadApp();

        // Dışarıdan PDF açıldıysa (intent ile)
        handleIncomingIntent(getIntent());
    }

    // ─────────────────────────────────────────────
    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    private void setupWebView() {
        WebSettings s = webView.getSettings();

        // JavaScript — zorunlu
        s.setJavaScriptEnabled(true);

        // DOM Storage (localStorage için — oturum kaydetme)
        s.setDomStorageEnabled(true);

        // Veritabanı desteği
        s.setDatabaseEnabled(true);

        // Önbellek — assets offline çalışsın
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        // Dosya erişimi
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);

        // assets içindeki dosyalar arası erişim
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);

        // Zoom desteği (PDF görüntülemek için)
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);

        // Viewport
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);

        // Medya
        s.setMediaPlaybackRequiresUserGesture(false);

        // Render önceliği
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);

        // Android → JavaScript köprüsü
        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");

        // WebViewClient
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                // CDN URL'lerini normal yükle, harici linkleri tarayıcıya gönder
                if (url.startsWith("https://cdnjs.cloudflare.com") ||
                    url.startsWith("https://unpkg.com") ||
                    url.startsWith("file://") ||
                    url.startsWith("blob:")) {
                    return false;
                }
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    return true;
                }
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                // Yükleme tamamlandığında loading overlay'i gizle
                view.evaluateJavascript(
                    "(function(){ var el=document.getElementById('loading-overlay'); if(el) el.style.display='none'; })();",
                    null
                );
            }
        });

        // WebChromeClient — dosya seçici + console
        webView.setWebChromeClient(new WebChromeClient() {

            @Override
            public boolean onConsoleMessage(ConsoleMessage msg) {
                // Debug build'de logcat'e yaz
                android.util.Log.d("SinavForge",
                    "[JS] " + msg.message() + " (" + msg.sourceId() + ":" + msg.lineNumber() + ")");
                return true;
            }

            // Dosya seçici (PDF yükleme)
            @Override
            public boolean onShowFileChooser(WebView view,
                                              ValueCallback<Uri[]> callback,
                                              FileChooserParams params) {
                fileChooserCallback = callback;

                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/pdf");
                intent.putExtra(Intent.EXTRA_MIME_TYPES,
                    new String[]{"application/pdf", "application/json"});
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);

                startActivityForResult(
                    Intent.createChooser(intent, "PDF veya JSON Seç"),
                    REQUEST_FILE_CHOOSER
                );
                return true;
            }

            // Kamera/mikrofon izinleri (gelecekte gerekirse)
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.grant(request.getResources());
            }
        });
    }

    // ─────────────────────────────────────────────
    private void loadApp() {
        webView.loadUrl("file:///android_asset/www/index.html");
    }

    // ─────────────────────────────────────────────
    @Override
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == REQUEST_FILE_CHOOSER) {
            if (fileChooserCallback == null) return;

            if (resultCode == Activity.RESULT_OK && data != null) {
                Uri[] results = null;

                if (data.getClipData() != null) {
                    // Çoklu dosya
                    int count = data.getClipData().getItemCount();
                    results = new Uri[count];
                    for (int i = 0; i < count; i++) {
                        results[i] = data.getClipData().getItemAt(i).getUri();
                        // Kalıcı izin al
                        getContentResolver().takePersistableUriPermission(
                            results[i],
                            Intent.FLAG_GRANT_READ_URI_PERMISSION
                        );
                    }
                } else if (data.getData() != null) {
                    results = new Uri[]{data.getData()};
                    try {
                        getContentResolver().takePersistableUriPermission(
                            data.getData(),
                            Intent.FLAG_GRANT_READ_URI_PERMISSION
                        );
                    } catch (Exception ignored) {}
                }

                fileChooserCallback.onReceiveValue(results);
            } else {
                fileChooserCallback.onReceiveValue(new Uri[]{});
            }
            fileChooserCallback = null;
        }
    }

    // ─────────────────────────────────────────────
    private void requestStoragePermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Android 13+
            return; // READ_MEDIA_DOCUMENTS ile ACTION_OPEN_DOCUMENT yeterli
        }
        if (ContextCompat.checkSelfPermission(this,
            Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this,
                new String[]{Manifest.permission.READ_EXTERNAL_STORAGE},
                REQUEST_PERMISSIONS);
        }
    }

    // ─────────────────────────────────────────────
    private void handleIncomingIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        Uri data = intent.getData();
        if (Intent.ACTION_VIEW.equals(action) && data != null) {
            // PDF dışarıdan açıldı — JS'e gönder
            webView.post(() -> loadPdfFromUri(data));
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleIncomingIntent(intent);
    }

    // ─────────────────────────────────────────────
    // URI'den PDF'i base64 olarak JS'e aktar
    private void loadPdfFromUri(Uri uri) {
        try {
            InputStream is = getContentResolver().openInputStream(uri);
            if (is == null) return;

            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int read;
            while ((read = is.read(chunk)) != -1) buffer.write(chunk, 0, read);
            is.close();

            String b64 = Base64.encodeToString(buffer.toByteArray(), Base64.NO_WRAP);
            String fname = getFileNameFromUri(uri);

            // JS fonksiyonunu çağır
            String js = String.format(
                "window.AndroidPdfLoad && window.AndroidPdfLoad('%s','%s');",
                fname.replace("'", "\\'"), b64
            );
            webView.evaluateJavascript(js, null);

        } catch (Exception e) {
            Toast.makeText(this, "PDF yüklenemedi: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private String getFileNameFromUri(Uri uri) {
        String path = uri.getLastPathSegment();
        return (path != null) ? path : "dosya.pdf";
    }

    // ─────────────────────────────────────────────
    // JavaScript → Android köprüsü
    public class AndroidBridge {

        @JavascriptInterface
        public String getAppVersion() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) { return "1.0"; }
        }

        @JavascriptInterface
        public void showToast(String msg) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show());
        }

        @JavascriptInterface
        public void openFilePicker() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/pdf");
                startActivityForResult(
                    Intent.createChooser(intent, "PDF Seç"),
                    REQUEST_FILE_CHOOSER
                );
            });
        }

        // PDF'i dosyaya kaydet (download simülasyonu)
        @JavascriptInterface
        public void savePdfBlob(String base64Data, String fileName) {
            runOnUiThread(() -> Toast.makeText(
                MainActivity.this,
                fileName + " kaydedildi",
                Toast.LENGTH_SHORT
            ).show());
        }

        @JavascriptInterface
        public boolean isAndroid() { return true; }

        @JavascriptInterface
        public int getApiLevel() { return Build.VERSION.SDK_INT; }
    }

    // ─────────────────────────────────────────────
    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override
    protected void onPause() {
        super.onPause();
        webView.onPause();
    }

    @Override
    protected void onDestroy() {
        webView.destroy();
        super.onDestroy();
    }
}
