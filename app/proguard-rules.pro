# SınavForge proguard rules
# AndroidBridge'i koru — JS arayüzü
-keepclassmembers class com.sinavforge.app.MainActivity$AndroidBridge {
    public *;
}
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
# AppCompat
-keep class androidx.appcompat.** { *; }
