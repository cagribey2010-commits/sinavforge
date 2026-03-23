/* ═══════════════════════════════════════════════════════════════════
   ml-worker.js  —  ONNX Runtime Web Worker
   DocLayNet / YOLOv8-nano document layout detection
   
   Ana thread'den mesajlar:
     { type:'init', modelUrl }           → modeli yükle
     { type:'detect', imageData, w, h }  → bbox tespit et
   
   Worker'dan mesajlar:
     { type:'ready' }
     { type:'result', boxes:[] }
     { type:'error', message }
═══════════════════════════════════════════════════════════════════ */

// ONNX Runtime Web — CDN'den yükle
importScripts('https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.17.1/ort.min.js');

let session = null;

/* ── Model yapılandırması ───────────────────────────────────────── */
const MODEL_CFG = {
  // DocLayNet sınıf indeksleri — "figure" ve "text" bize lazım
  // Sınıflar: 0=Caption, 1=Footnote, 2=Formula, 3=List-item,
  //           4=Page-footer, 5=Page-header, 6=Picture,
  //           7=Section-header, 8=Table, 9=Text, 10=Title
  QUESTION_CLASSES : new Set([2, 3, 7, 8, 9, 10]), // formula, list, header, table, text, title
  FIGURE_CLASSES   : new Set([6]),                   // picture
  REJECT_CLASSES   : new Set([4, 5]),                // footer, header → prune
  CONF_THRESHOLD   : 0.35,
  IOU_THRESHOLD    : 0.45,
  INPUT_SIZE       : 640,  // YOLOv8 standart input
};

/* ── Mesaj dinleyici ────────────────────────────────────────────── */
self.onmessage = async (e) => {
  const { type, modelUrl, imageData, w, h, reqId } = e.data;

  if (type === 'init') {
    try {
      ort.env.wasm.wasmPaths = 'https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.17.1/';
      session = await ort.InferenceSession.create(modelUrl, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      self.postMessage({ type: 'ready' });
    } catch(err) {
      self.postMessage({ type: 'error', message: err.message });
    }
    return;
  }

  if (type === 'detect') {
    if (!session) {
      self.postMessage({ type: 'error', message: 'Model yüklenmedi', reqId });
      return;
    }
    try {
      const boxes = await runDetection(imageData, w, h);
      self.postMessage({ type: 'result', boxes, reqId });
    } catch(err) {
      self.postMessage({ type: 'error', message: err.message, reqId });
    }
    return;
  }
};

/* ── Ana detection fonksiyonu ───────────────────────────────────── */
async function runDetection(imageData, origW, origH) {
  const SIZE = MODEL_CFG.INPUT_SIZE;

  // 1. Görüntüyü 640×640'a ölçekle + letterbox
  const { tensor, scaleX, scaleY, padX, padY } =
    preprocessImage(imageData, origW, origH, SIZE);

  // 2. Model çalıştır
  const inputName  = session.inputNames[0];
  const outputName = session.outputNames[0];
  const feeds = { [inputName]: tensor };
  const results = await session.run(feeds);
  const output = results[outputName];

  // 3. YOLOv8 çıktısını parse et
  const boxes = parseYoloOutput(output, SIZE, origW, origH,
                                scaleX, scaleY, padX, padY);

  // 4. NMS uygula
  return nonMaxSuppression(boxes, MODEL_CFG.IOU_THRESHOLD);
}

/* ── Görüntü ön işleme ─────────────────────────────────────────── */
function preprocessImage(imageData, origW, origH, targetSize) {
  // Letterbox: oranı koru, pad ekle
  const scale = Math.min(targetSize / origW, targetSize / origH);
  const newW  = Math.round(origW * scale);
  const newH  = Math.round(origH * scale);
  const padX  = Math.round((targetSize - newW) / 2);
  const padY  = Math.round((targetSize - newH) / 2);

  // OffscreenCanvas ile resize (worker'da kullanılabilir)
  // Not: OffscreenCanvas bazı ortamlarda yok — Uint8Array manuel işle
  const srcData = imageData; // RGBA Uint8ClampedArray
  const dst = new Float32Array(3 * targetSize * targetSize);

  // dst: [R plane][G plane][B plane] — CHW format
  const planeSize = targetSize * targetSize;

  for (let dy = 0; dy < newH; dy++) {
    const sy = Math.floor(dy / scale);
    for (let dx = 0; dx < newW; dx++) {
      const sx = Math.floor(dx / scale);
      const srcIdx = (sy * origW + sx) * 4;
      const dstY   = dy + padY;
      const dstX   = dx + padX;
      if (dstY >= targetSize || dstX >= targetSize) continue;
      const dstIdx = dstY * targetSize + dstX;
      dst[dstIdx]               = srcData[srcIdx]     / 255.0; // R
      dst[planeSize + dstIdx]   = srcData[srcIdx + 1] / 255.0; // G
      dst[planeSize*2 + dstIdx] = srcData[srcIdx + 2] / 255.0; // B
    }
  }

  const tensor = new ort.Tensor('float32', dst, [1, 3, targetSize, targetSize]);
  return { tensor, scaleX: scale, scaleY: scale, padX, padY };
}

/* ── YOLOv8 çıktı parser ────────────────────────────────────────── */
// YOLOv8 output shape: [1, 4+num_classes, num_anchors]
// veya [1, num_anchors, 4+num_classes] — modele göre değişir
function parseYoloOutput(output, inputSize, origW, origH,
                          scaleX, scaleY, padX, padY) {
  const data  = output.data;
  const shape = output.dims; // [1, 84, 8400] veya [1, 8400, 84]

  const boxes   = [];
  const CONF_T  = MODEL_CFG.CONF_THRESHOLD;

  let numAnchors, numAttrs, isTransposed;
  if (shape[1] > shape[2]) {
    // [1, 84, 8400] → transposed
    numAttrs   = shape[1];
    numAnchors = shape[2];
    isTransposed = true;
  } else {
    // [1, 8400, 84]
    numAnchors = shape[1];
    numAttrs   = shape[2];
    isTransposed = false;
  }

  const numClasses = numAttrs - 4;

  for (let i = 0; i < numAnchors; i++) {
    let cx, cy, bw, bh, classScores;

    if (isTransposed) {
      cx = data[0 * numAnchors + i];
      cy = data[1 * numAnchors + i];
      bw = data[2 * numAnchors + i];
      bh = data[3 * numAnchors + i];
      classScores = [];
      for (let c = 0; c < numClasses; c++) {
        classScores.push(data[(4 + c) * numAnchors + i]);
      }
    } else {
      const base = i * numAttrs;
      cx = data[base];
      cy = data[base + 1];
      bw = data[base + 2];
      bh = data[base + 3];
      classScores = Array.from(data.slice(base + 4, base + 4 + numClasses));
    }

    // En yüksek sınıf skoru
    let maxScore = -Infinity, maxClass = 0;
    for (let c = 0; c < classScores.length; c++) {
      if (classScores[c] > maxScore) { maxScore = classScores[c]; maxClass = c; }
    }
    if (maxScore < CONF_T) continue;

    // Sadece ilgili sınıflar
    if (MODEL_CFG.REJECT_CLASSES.has(maxClass)) continue;

    // Koordinatları orijinal görüntüye geri dönüştür
    const x1 = ((cx - bw/2) - padX) / scaleX;
    const y1 = ((cy - bh/2) - padY) / scaleY;
    const x2 = ((cx + bw/2) - padX) / scaleX;
    const y2 = ((cy + bh/2) - padY) / scaleY;

    boxes.push({
      x : Math.max(0, x1),
      y : Math.max(0, y1),
      w : Math.min(origW, x2) - Math.max(0, x1),
      h : Math.min(origH, y2) - Math.max(0, y1),
      confidence : maxScore,
      classIdx   : maxClass,
      isFigure   : MODEL_CFG.FIGURE_CLASSES.has(maxClass),
      isQuestion : MODEL_CFG.QUESTION_CLASSES.has(maxClass),
    });
  }

  return boxes;
}

/* ── Non-Maximum Suppression ────────────────────────────────────── */
function nonMaxSuppression(boxes, iouThreshold) {
  if (!boxes.length) return [];
  const sorted = [...boxes].sort((a, b) => b.confidence - a.confidence);
  const kept   = [];

  for (const box of sorted) {
    const overlap = kept.some(k => iou(k, box) > iouThreshold);
    if (!overlap) kept.push(box);
  }
  return kept;
}

function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x+a.w, b.x+b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y+a.h, b.y+b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w*a.h + b.w*b.h - inter;
  return union > 0 ? inter/union : 0;
}
