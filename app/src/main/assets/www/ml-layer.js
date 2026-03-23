/* ═══════════════════════════════════════════════════════════════════
   ml-layer.js  —  ML Katmanı Koordinatörü

   Dışa açılan tek API:
     await MLLayer.refine(candidates, canvas, scale, pageIdx)
     → DetectionResult[]  (script.js region formatıyla uyumlu)

   Strateji:
     1. ONNX Worker (DocLayNet/YOLOv8) — offline
     2. Claude Vision API — internet fallback

   KISIT: Hiçbir global değişkene (S, D, G) dokunulmaz.
═══════════════════════════════════════════════════════════════════ */

const MLLayer = (() => {

  /* ── Yapılandırma ───────────────────────────────────────────────── */
  const CFG = {
    // DocLayNet YOLOv8-nano ONNX model URL
    // Hugging Face'deki halka açık model (CDN uyumlu)
    MODEL_URL : 'https://huggingface.co/nickmuchi/yolos-small-finetuned-DocLayNet/resolve/main/model.onnx',

    // Alternatif: kendi sunucundan servis et
    // MODEL_URL : '/models/doclaynet-nano.onnx',

    // Confidence eşikleri
    CONF_HIGH     : 0.60,  // bu üstü → direkt kabul
    CONF_MERGE    : 0.35,  // bu üstü → mevcut bbox ile merge

    // Claude Vision API
    CLAUDE_MODEL  : 'claude-sonnet-4-20250514',
    CLAUDE_TOKENS : 1024,

    // Görüntü kalitesi (canvas → JPEG)
    JPEG_QUALITY  : 0.85,

    // Mevcut candidate'ların confidence eşiği
    // Bu altındaysa ML'e gönder
    CANDIDATE_CONF_THRESHOLD : 55,

    // ONNX hata toleransı: kaç başarısız denemeden sonra devre dışı kalır
    ONNX_MAX_ERRORS : 3,

    // Padding
    PAD : 6,
  };

  /* ── State ──────────────────────────────────────────────────────── */
  let _worker        = null;
  let _workerReady   = false;
  let _workerError   = null;
  let _reqCounter    = 0;
  let _pendingReqs   = new Map();  // reqId → { resolve, reject }
  let _onnxEnabled   = true;
  let _onnxErrorCount = 0;         // FIX: kalıcı disable yerine sayaç
  let _claudeEnabled = true;

  /* ── Worker başlatma ────────────────────────────────────────────── */
  function initWorker() {
    if (_worker) return;
    try {
      _worker = new Worker('ml-worker.js');
      _worker.onmessage = onWorkerMessage;
      _worker.onerror   = (e) => {
        _workerError  = e.message;
        _workerReady  = false;
        _onnxEnabled  = false;
        console.warn('[MLLayer] Worker hatası:', e.message);
        // Bekleyen tüm istekleri reddet
        for (const [, { reject }] of _pendingReqs) {
          reject(new Error('Worker hatası: ' + e.message));
        }
        _pendingReqs.clear();
      };
      // Modeli yükle
      _worker.postMessage({ type: 'init', modelUrl: CFG.MODEL_URL });
    } catch(e) {
      _onnxEnabled = false;
      console.warn('[MLLayer] Worker başlatılamadı:', e.message);
    }
  }

  function onWorkerMessage(e) {
    const { type, boxes, message, reqId } = e.data;
    if (type === 'ready') {
      _workerReady = true;
      return;
    }
    if (type === 'result') {
      const req = _pendingReqs.get(reqId);
      if (req) { req.resolve(boxes); _pendingReqs.delete(reqId); }
      return;
    }
    if (type === 'error') {
      const req = _pendingReqs.get(reqId);
      if (req) { req.reject(new Error(message)); _pendingReqs.delete(reqId); }
      return;
    }
  }

  /* ── ONNX ile detection ─────────────────────────────────────────── */
  async function detectWithONNX(canvas) {
    if (!_onnxEnabled || !_workerReady) return null;

    const ctx     = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const reqId   = ++_reqCounter;

    return new Promise((resolve, reject) => {
      _pendingReqs.set(reqId, { resolve, reject });
      // Timeout: 8 saniye
      setTimeout(() => {
        if (_pendingReqs.has(reqId)) {
          _pendingReqs.delete(reqId);
          reject(new Error('ONNX timeout'));
        }
      }, 8000);
      _worker.postMessage({
        type      : 'detect',
        imageData : imgData.data,
        w         : canvas.width,
        h         : canvas.height,
        reqId,
      }, [imgData.data.buffer]);  // transferable
    });
  }

  /* ── Claude Vision API ile detection ───────────────────────────── */
  async function detectWithClaude(canvas, pageIdx) {
    if (!_claudeEnabled) return null;

    // Canvas → base64 JPEG
    const base64 = canvas.toDataURL('image/jpeg', CFG.JPEG_QUALITY).split(',')[1];
    const vpW = canvas.width;
    const vpH = canvas.height;

    const systemPrompt = `Sen bir matematik test sayfası analiz uzmanısın.
Görevin: Verilen PDF sayfasındaki her soruyu tespit et ve her sorunun tam bounding box koordinatlarını JSON formatında döndür.

Kurallar:
- Her soru bloğu: soru numarası + soru metni + formüller + şıklar (A/B/C/D/E) birlikte tek blok
- Sayfa başlığını (TEST-1, PARABOL vb.) soru sayma
- Cevap anahtarını (1-A 2-B gibi alt kısım) soru sayma
- Koordinatlar piksel cinsinden, sayfanın sol üst köşesi (0,0)
- Her soru için güven skoru (0-100) ver

Yalnızca JSON döndür, başka hiçbir şey yazma:
{
  "questions": [
    { "num": 1, "x": 45, "y": 120, "w": 380, "h": 210, "confidence": 85 },
    ...
  ]
}`;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method  : 'POST',
        headers : { 'Content-Type': 'application/json' },
        body    : JSON.stringify({
          model      : CFG.CLAUDE_MODEL,
          max_tokens : CFG.CLAUDE_TOKENS,
          system     : systemPrompt,
          messages   : [{
            role    : 'user',
            content : [{
              type   : 'image',
              source : { type: 'base64', media_type: 'image/jpeg', data: base64 },
            }, {
              type : 'text',
              text : `Bu sayfa ${vpW}×${vpH} piksel. Sayfadaki soruları tespit et ve JSON formatında döndür.`,
            }],
          }],
        }),
      });

      if (!response.ok) throw new Error('Claude API: ' + response.status);
      const data = await response.json();
      const text = data.content?.find(b => b.type === 'text')?.text || '';

      // JSON parse — markdown fence'leri temizle
      const clean  = text.replace(/```json?|```/g, '').trim();
      const parsed = JSON.parse(clean);
      return parsed.questions || [];

    } catch(e) {
      console.warn('[MLLayer] Claude Vision hatası:', e.message);
      _claudeEnabled = false;  // bu oturumda bir daha deneme
      return null;
    }
  }

  /* ── ONNX bbox'larını mevcut candidate'larla merge et ──────────── */
  function mergeONNXBoxes(candidates, onnxBoxes, scale, vpW, vpH) {
    if (!onnxBoxes || !onnxBoxes.length) return candidates;

    const PAD    = CFG.PAD;
    const result = [...candidates];

    for (const ob of onnxBoxes) {
      if (!ob.isQuestion) continue;  // sadece soru sınıfları
      const obBox = { x: ob.x, y: ob.y, w: ob.w, h: ob.h };

      // Mevcut candidate'larla örtüşüyor mu?
      let matched = false;
      for (const cand of result) {
        const ov = overlapRatio(cand, obBox);
        if (ov > 0.3) {
          // FIX: cand.x değişmeden önce tüm köşeleri hesapla
          const x1 = Math.min(cand.x, obBox.x - PAD);
          const y1 = Math.min(cand.y, obBox.y - PAD);
          const x2 = Math.max(cand.x + cand.w, obBox.x + obBox.w + PAD);
          const y2 = Math.max(cand.y + cand.h, obBox.y + obBox.h + PAD);
          // Sınır kontrolü yapılarak ata
          cand.x = Math.max(0, x1);
          cand.y = Math.max(0, y1);
          cand.w = Math.min(vpW - cand.x, x2 - x1);
          cand.h = Math.min(vpH - cand.y, y2 - y1);
          // Skoru güncelle
          cand.score = Math.max(cand.score || 0, Math.round(ob.confidence * 100));
          cand._meta = cand._meta || {};
          cand._meta.onnxConfidence = ob.confidence;
          cand._meta.anchorType     = 'hybrid';
          matched = true;
          break;
        }
      }

      // Eşleşme yoksa ve confidence yüksekse yeni region ekle
      if (!matched && ob.confidence >= CFG.CONF_HIGH) {
        result.push({
          id            : 'ml_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          page          : result[0]?.page || 1,
          x             : Math.max(0, ob.x - PAD),
          y             : Math.max(0, ob.y - PAD),
          w             : Math.min(vpW - ob.x, ob.w + PAD * 2),
          h             : Math.min(vpH - ob.y, ob.h + PAD * 2),
          text          : '(ML tespiti)',
          fullText      : '',
          confirmed     : false,
          manual        : false,
          score         : Math.round(ob.confidence * 100),
          detectedScale : scale,
          _meta         : {
            confidence   : Math.round(ob.confidence * 100),
            anchorType   : 'onnx',
            colIndex     : ob.x < vpW / 2 ? 0 : 1,
            onnxClassIdx : ob.classIdx,
            mergedFrom   : [],
          },
        });
      }
    }

    return result;
  }

  /* ── Claude Vision bbox'larını region'a çevir ───────────────────── */
  function claudeBoxesToRegions(claudeBoxes, candidates, scale, pageIdx, vpW, vpH) {
    if (!claudeBoxes || !claudeBoxes.length) return candidates;

    const PAD    = CFG.PAD;
    const result = [...candidates];

    for (const cb of claudeBoxes) {
      const cbBox = { x: cb.x, y: cb.y, w: cb.w, h: cb.h };

      // Mevcut candidate ile örtüşüyor mu?
      let matched = false;
      for (const cand of result) {
        if (overlapRatio(cand, cbBox) > 0.25) {
          // Claude daha büyük görüyorsa bbox'ı genişlet
          const x1 = Math.min(cand.x, cbBox.x - PAD);
          const y1 = Math.min(cand.y, cbBox.y - PAD);
          const x2 = Math.max(cand.x + cand.w, cbBox.x + cbBox.w + PAD);
          const y2 = Math.max(cand.y + cand.h, cbBox.y + cbBox.h + PAD);
          cand.x = Math.max(0, x1);
          cand.y = Math.max(0, y1);
          cand.w = Math.min(vpW - cand.x, x2 - cand.x);
          cand.h = Math.min(vpH - cand.y, y2 - cand.y);
          cand.score = Math.max(cand.score || 0, cb.confidence || 70);
          cand._meta = cand._meta || {};
          cand._meta.claudeConfidence = cb.confidence;
          cand._meta.anchorType       = 'hybrid';
          matched = true;
          break;
        }
      }

      // Eşleşme yoksa Claude'un tespit ettiği yeni bir soru
      if (!matched) {
        result.push({
          id            : 'cl_' + Date.now() + '_' + (cb.num || Math.random().toString(36).slice(2, 5)),
          page          : pageIdx,
          x             : Math.max(0, cb.x - PAD),
          y             : Math.max(0, cb.y - PAD),
          w             : Math.min(vpW - cb.x, cb.w + PAD * 2),
          h             : Math.min(vpH - cb.y, cb.h + PAD * 2),
          text          : cb.num ? `${cb.num}. (Claude tespiti)` : '(Claude tespiti)',
          fullText      : '',
          confirmed     : false,
          manual        : false,
          score         : cb.confidence || 70,
          detectedScale : scale,
          _meta         : {
            confidence  : cb.confidence || 70,
            anchorType  : 'claude-vision',
            colIndex    : cb.x < vpW / 2 ? 0 : 1,
            mergedFrom  : [],
          },
        });
      }
    }

    return result;
  }

  /* ── Overlap yardımcısı ─────────────────────────────────────────── */
  function overlapRatio(a, b) {
    const ix    = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const iy    = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const inter = ix * iy;
    const minArea = Math.min(a.w * a.h, b.w * b.h);
    return minArea > 0 ? inter / minArea : 0;
  }

  /* ── Düşük confidence candidate'ları tespit et ─────────────────── */
  function needsMLRefinement(candidates) {
    if (!candidates.length) return true;
    const lowConf = candidates.filter(c => (c.score || 0) < CFG.CANDIDATE_CONF_THRESHOLD);
    return lowConf.length > candidates.length * 0.4;  // %40'tan fazlası düşükse
  }

  /* ── Ana API ────────────────────────────────────────────────────── */

  /**
   * Mevcut detector.js çıktısını ML ile iyileştir.
   * @param {Array}              candidates  — SFDetector.detect() çıktısı
   * @param {HTMLCanvasElement}  canvas      — render edilmiş sayfa
   * @param {number}             scale       — S.scale
   * @param {number}             pageIdx     — sayfa numarası
   * @returns {Promise<Array>}               — iyileştirilmiş region[]
   */
  async function refine(candidates, canvas, scale, pageIdx) {
    const vpW = canvas.width;
    const vpH = canvas.height;

    // ML gerekli mi?
    if (!needsMLRefinement(candidates)) {
      return candidates;  // zaten yeterince iyi
    }

    let result = candidates;

    // 1. ONNX dene
    if (_onnxEnabled) {
      try {
        const onnxBoxes = await detectWithONNX(canvas);
        if (onnxBoxes && onnxBoxes.length) {
          result = mergeONNXBoxes(result, onnxBoxes, scale, vpW, vpH);
        }
        // Başarılıysa hata sayacını sıfırla
        _onnxErrorCount = 0;
      } catch(e) {
        _onnxErrorCount++;
        console.warn(`[MLLayer] ONNX başarısız (${_onnxErrorCount}/${CFG.ONNX_MAX_ERRORS}):`, e.message);
        // FIX: kalıcı disable yerine eşik kontrolü
        if (_onnxErrorCount >= CFG.ONNX_MAX_ERRORS) {
          _onnxEnabled = false;
          console.warn('[MLLayer] ONNX bu oturum için devre dışı bırakıldı.');
        }
      }
    }

    // 2. Hâlâ yetersizse Claude Vision dene
    if (needsMLRefinement(result) && _claudeEnabled) {
      try {
        const claudeBoxes = await detectWithClaude(canvas, pageIdx);
        if (claudeBoxes && claudeBoxes.length) {
          result = claudeBoxesToRegions(claudeBoxes, result, scale, pageIdx, vpW, vpH);
        }
      } catch(e) {
        console.warn('[MLLayer] Claude Vision başarısız:', e.message);
      }
    }

    return result;
  }

  /* ── Ayarlar ────────────────────────────────────────────────────── */
  function setONNXEnabled(v)   { _onnxEnabled = v; if (v) _onnxErrorCount = 0; }
  function setClaudeEnabled(v) { _claudeEnabled = v; }
  function getStatus() {
    return {
      workerReady    : _workerReady,
      workerError    : _workerError,
      onnxEnabled    : _onnxEnabled,
      onnxErrorCount : _onnxErrorCount,
      claudeEnabled  : _claudeEnabled,
    };
  }

  /* ── Başlatıcı: sayfa yüklenince worker'ı ön ısıt ──────────────── */
  function init() {
    initWorker();
  }

  return { refine, init, setONNXEnabled, setClaudeEnabled, getStatus };

})();

// Sayfa yüklenince worker'ı başlat (model indirme başlasın)
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => MLLayer.init());
}
