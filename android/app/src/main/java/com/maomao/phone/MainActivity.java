package com.maomao.phone;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;

import androidx.annotation.Nullable;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

import java.util.ArrayList;
import java.util.List;

public final class MainActivity extends Activity {
    private static final int REQUEST_MICROPHONE = 4201;
    private static final int REQUEST_FILE_PICKER = 4202;
    private static final String APP_URL = "https://appassets.androidplatform.net/assets/www/index.html";

    private WebView webView;
    private PermissionRequest pendingWebPermission;
    private ValueCallback<Uri[]> pendingFileCallback;
    private WebViewAssetLoader assetLoader;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureSystemBars();

        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView = new WebView(this);
        // 透明 WebView + edge-to-edge：网页底色/壁纸可以自然延伸到系统状态栏下方。
        webView.setBackgroundColor(Color.TRANSPARENT);
        webView.addJavascriptInterface(new NativeSystemBarController(), "MAOMAOSystemBars");
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        webView.setWebViewClient(new WebViewClientCompat() {
            @Override
            public android.webkit.WebResourceResponse shouldInterceptRequest(
                    WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                applyEdgeToEdgeInsets(view);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost();
                if ("appassets.androidplatform.net".equalsIgnoreCase(host)) {
                    return false;
                }
                // Keep the app's local pages inside MAOMAO; open external links in the browser.
                if ("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme())) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (Exception ignored) {
                    }
                    return true;
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams fileChooserParams) {
                if (pendingFileCallback != null) {
                    pendingFileCallback.onReceiveValue(null);
                }
                pendingFileCallback = filePathCallback;
                Intent intent = fileChooserParams.createIntent();
                try {
                    startActivityForResult(intent, REQUEST_FILE_PICKER);
                    return true;
                } catch (Exception e) {
                    pendingFileCallback = null;
                    return false;
                }
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> handleWebPermission(request));
            }
        });

        setContentView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        if (savedInstanceState == null) {
            webView.loadUrl(APP_URL);
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    private void configureSystemBars() {
        Window window = getWindow();
        // 系统状态栏透明化，网页直接绘制在状态图标后方，而不是露出一条固定灰色底。
        window.setStatusBarColor(Color.TRANSPARENT);
        // 暂时保留底部导航栏的传统布局，避免误触/遮挡聊天输入框。
        window.setNavigationBarColor(0xFFF7F7F9);

        int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        }
        window.getDecorView().setSystemUiVisibility(flags);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setNavigationBarContrastEnforced(false);
            window.setStatusBarContrastEnforced(false);
        }
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
    }

    private int getStatusBarInsetCssPx() {
        int resourceId = getResources().getIdentifier("status_bar_height", "dimen", "android");
        if (resourceId <= 0) return 24;
        float density = getResources().getDisplayMetrics().density;
        return Math.max(1, Math.round(getResources().getDimensionPixelSize(resourceId) / density));
    }

    /** 让网页背景延伸到透明状态栏下方，同时为正文和顶部悬浮控件保留安全距离。 */
    private void applyEdgeToEdgeInsets(WebView view) {
        final int inset = getStatusBarInsetCssPx();
        String script =
                "(function(){" +
                "var root=document.documentElement, body=document.body;" +
                "if(!root||!body)return;" +
                "var inset=" + inset + ";" +
                "root.style.setProperty('--maomao-native-statusbar-inset',inset+'px');" +

                "function parseColor(s){var m=String(s||'').match(/rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)(?:\\s*[,/]\\s*([\\d.]+))?\\s*\\)/i);return m?{r:+m[1],g:+m[2],b:+m[3],a:m[4]===undefined?1:+m[4]}:null;}" +
                "function colorAt(x,y){var els=[];try{els=document.elementsFromPoint(x,y);}catch(e){}" +
                "var c={r:255,g:255,b:255};" +
                "for(var i=els.length-1;i>=0;i--){var p=parseColor(getComputedStyle(els[i]).backgroundColor);if(!p||p.a<=0)continue;" +
                "c={r:p.r*p.a+c.r*(1-p.a),g:p.g*p.a+c.g*(1-p.a),b:p.b*p.a+c.b*(1-p.a)};}" +
                "return c;}" +
                "function updateIconTone(){var y=Math.max(1,Math.min(inset/2,innerHeight-1)),w=Math.max(1,innerWidth);" +
                "var xs=[w*.12,w*.5,w*.88],sum=0;" +
                "for(var i=0;i<xs.length;i++){var c=colorAt(xs[i],y);sum+=(.2126*c.r+.7152*c.g+.0722*c.b)/255;}" +
                "if(window.MAOMAOSystemBars&&window.MAOMAOSystemBars.setDarkStatusBarIcons)window.MAOMAOSystemBars.setDarkStatusBarIcons(sum/3>.52);}" +
                "updateIconTone();" +
                "if(!root.dataset.maomaoNativeBarObserver){root.dataset.maomaoNativeBarObserver='1';" +
                "var queued=false;function schedule(){if(queued)return;queued=true;requestAnimationFrame(function(){queued=false;updateIconTone();});}" +
                "addEventListener('resize',schedule);addEventListener('scroll',schedule,true);addEventListener('pageshow',schedule);" +
                "if(window.MutationObserver){new MutationObserver(schedule).observe(root,{attributes:true,subtree:true,attributeFilter:['class','style','data-theme','data-wallpaper-tone']});}}" +
                "})();";
        view.evaluateJavascript(script, null);
    }

    private final class NativeSystemBarController {
        @JavascriptInterface
        public void setDarkStatusBarIcons(final boolean darkIcons) {
            runOnUiThread(() -> {
                int flags = getWindow().getDecorView().getSystemUiVisibility();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    if (darkIcons) flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                    else flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                }
                getWindow().getDecorView().setSystemUiVisibility(flags);
            });
        }
    }

    private void handleWebPermission(PermissionRequest request) {
        boolean asksForAudio = false;
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                asksForAudio = true;
                break;
            }
        }
        if (!asksForAudio) {
            request.deny();
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
                checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pendingWebPermission = request;
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQUEST_MICROPHONE);
            return;
        }
        grantAudioOnly(request);
    }

    private void grantAudioOnly(PermissionRequest request) {
        List<String> allowed = new ArrayList<>();
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                allowed.add(resource);
            }
        }
        if (allowed.isEmpty()) {
            request.deny();
        } else {
            request.grant(allowed.toArray(new String[0]));
        }
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_MICROPHONE && pendingWebPermission != null) {
            PermissionRequest request = pendingWebPermission;
            pendingWebPermission = null;
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                grantAudioOnly(request);
            } else {
                request.deny();
            }
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_FILE_PICKER && pendingFileCallback != null) {
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    results = new Uri[count];
                    for (int i = 0; i < count; i++) {
                        results[i] = data.getClipData().getItemAt(i).getUri();
                    }
                } else if (data.getData() != null) {
                    results = new Uri[]{data.getData()};
                }
            }
            pendingFileCallback.onReceiveValue(results);
            pendingFileCallback = null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) {
            webView.saveState(outState);
        }
        super.onSaveInstanceState(outState);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (pendingFileCallback != null) {
            pendingFileCallback.onReceiveValue(null);
            pendingFileCallback = null;
        }
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
