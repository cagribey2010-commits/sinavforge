/* ═══════════════════════════════════════════════════════════════
   SınavForge v5.1
   ✓ Öneri A — Şık-soru birleştirme (cevap bloğu geri takibi)
   ✓ Öneri B — Güven skoru filtresi (yanlış pozitif azaltma)
   ✓ Öneri C — Belge format öğrenme (çok sayfalı bağlam)
   ✓ Öneri D — Adaptif boşluk eşiği (bi-modal gap analizi)
   ✓ Öneri E — Kullanıcı geri bildirimi ile oturum içi öğrenme
   ✓ PDF çıktısında sorular arası boşluk (spacing) düzeltmesi
   ✓ Tablet/telefon touch desteği
   — — — v5.1 Düzeltmeleri — — —
   FIX-1  buildPreviewA6 ↔ generateA6 tam uyum (başlıksız, doğru availH)
   FIX-2  addAnswerKeyPage çok sayfalı destek (30+ soru taşmaz)
   FIX-3  classifyQuestions — Artifact API, API anahtarsız çalışır
   FIX-4  Soru kartı: büyük thumbnail önizleme
   FIX-5  Scan review: her satırda görsel thumbnail
   FIX-6  PDF havuzu: × ile PDF silme
   FIX-7  Soru bazlı not/yorum alanı (sınav kağıdında gizli)
   FIX-8  İstatistik paneli (konu / puan / tip dağılımı)
   FIX-9  Soru kopyalama (⧉ buton ile)
   FIX-10 Sayfa aralığı tarama dialog
═══════════════════════════════════════════════════════════════ */


/* ═══ SF DEBUG PANEL (Android uyumlu) ══════════════════════
   console.log yerine sfLog() kullan — ekranda görünür panel açar.
   Tarama bittikten sonra "📋 Log" butonu toast olarak görünür.
════════════════════════════════════════════════════════════ */
const _sfLogs=[];
function sfLog(...args){
  const msg=args.map(a=>(typeof a==='object'?JSON.stringify(a):String(a))).join(' ');
  _sfLogs.push(msg);
}
function sfShowLog(){
  if(!_sfLogs.length){toast('Log boş','info');return;}
  // Overlay panel oluştur
  let panel=document.getElementById('sf-debug-panel');
  if(panel) panel.remove();
  panel=document.createElement('div');
  panel.id='sf-debug-panel';
  panel.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.92);color:#0f0;font:12px/1.5 monospace;overflow-y:auto;padding:12px;';
  panel.innerHTML='<div style="display:flex;justify-content:space-between;margin-bottom:8px"><b style="color:#fff">🔍 SF Debug Log</b><button onclick="this.parentElement.parentElement.remove()" style="background:#e44;color:#fff;border:none;padding:4px 10px;border-radius:4px;font-size:13px">✕ Kapat</button></div>'+
    _sfLogs.map(l=>`<div style="border-bottom:1px solid #222;padding:2px 0">${l.replace(/</g,'&lt;')}</div>`).join('');
  document.body.appendChild(panel);
}

/* ═══════════════════════════════════════════════════════════════════════
   SınavForge  —  detector.js  v1.0
   Hibrit PDF soru algılama pipeline'ı.

   Dışa açılan tek API:
     const results = await SFDetector.detect(pdfPage, canvas, scale)

   results[] → mevcut region formatıyla birebir uyumlu:
     { id, page, x, y, w, h, text, fullText,
       confirmed:false, manual:false, score, detectedScale,
       _meta: { confidence, anchorType, colIndex,
                optionPatternDetected, mergedFrom[], rejectedReason } }

   KISIT: Bu dosya hiçbir global değişkene (S, D, G vb.) DOKUNMAZ.
          Tüm girdi argüman olarak alınır, tüm çıktı return edilir.
═══════════════════════════════════════════════════════════════════════ */

const SFDetector = (() => {

  const CFG = {
    HEADER_RATIO : 0.15, FOOTER_RATIO : 0.06,
    COL_BINS:100, COL_MIN_CONTRAST:1.1, COL_YSPAN_RATIO:0.10,
    LINE_MID_THRESH:0.60, LINE_COL_GAP_MULT:0.75,
    BLOCK_GAP_MULT:1.6,
    VIS_BRIGHT_THRESH:232, VIS_EMPTY_AVG_MULT:0.30,
    VIS_EMPTY_MIN:0.006, VIS_EMPTY_MAX:0.05,
    VIS_MIN_GAP_RATIO:0.030, VIS_MIN_BLOCK_RATIO:0.18,
    VIS_SMOOTH_WIN:4, VIS_STRIP_X_RATIO:0.02, VIS_STRIP_W_RATIO:0.14,
    VIS_PEAK_MIN_DIST:0.015, VIS_PEAK_THRESH_P:0.65, VIS_PEAK_THRESH_M:1.6,
    VIS_MAX_PEAKS:16,
    CONF_HIGH:55, CONF_MED:10,
    MERGE_GAP_RATIO:0.30, MERGE_MATH_MULT:5,
    SPLIT_MAX_H_RATIO:0.65, PRUNE_MIN_AREA:150, NORM_PAD:2,
  };

  const PATS={
    Q:[
      /^\s*(\d{1,3})\s*[.)]\s+\S.{2,}/,
      /^\s*\((\d{1,3})\)\s+\S.{2,}/,
      /^\s*[Ss]oru\s*[:\-.]?\s*\d+/,
      /^\s*\d+\s*[-\u2013]\s+\S.{2,}/,
      /^\s*\d{1,3}[\.:]?\s+[A-Za-z\u00C0-\u024F].{4,}/,
      /^\s*\d{1,3}\s*[.)]\s*$/,
    ],
    ANS:[/^\s*[A-Ea-e]\s*[.)]\s*/,/^\s*[A-Ea-e]\s*\)\s*/],
    NOISE:[
      /^@[A-Za-z]/,/^www\./i,
      /^\s*(KAZANIM|BECERİ|UYGULAMA|KAVRAMA)\s+(DÜZEYİNDE|SORULARI)/i,
      /^\s*ÖSYM\s+Bakış/i,/^\s*Test\s*[-–]\s*\d+/i,
      /^\s*(Kolay|Orta|Zor)\s*([-–]\s*(Kolay|Orta|Zor))*/i,
      /^\s*\d+\s*\/\s*\d+\s*$/,
      /^\s*(Barış|Fulya|Rumeysa|Akif|Bolat|Cesur)\s*$/i,
      /^\s*(Barış|Baris)\s+YAYINLARI\s*$/i,
      /^\s*Kazanım\s+Bakış\s*$/i,
      /^\s*[A-Z]{2,}\s+YAYINLARI\s*$/i,
      /^\s*(Sınav kodu|Diğer sayfaya|II\. OTURUM)/i,
      /premierdeneme|krakedemi|MajestyPdf/i,
    ],
    NUM_ONLY:/^\s*\d{1,3}\s*[.)]\s*$/,
  }

  let _rid=Date.now();
  function newId(){return 'sd'+(++_rid);}
  function mergeRects(a,b){const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),x2=Math.max(a.x+a.w,b.x+b.w),y2=Math.max(a.y+a.h,b.y+b.h);return{x,y,w:x2-x,h:y2-y};}
  function rectFromLines(lines){if(!lines.length)return{x:0,y:0,w:0,h:0};let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;for(const l of lines){x1=Math.min(x1,l.x);y1=Math.min(y1,l.y);x2=Math.max(x2,l.x+l.w);y2=Math.max(y2,l.y+l.h);}return{x:x1,y:y1,w:x2-x1,h:y2-y1};}
  function overlapRatio(a,b){const ix=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)),iy=Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)),inter=ix*iy,minA=Math.min(a.w*a.h,b.w*b.h);return minA>0?inter/minA:0;}

  function buildWatermarkSet(items){
    const cnt={};
    for(const it of items){if(it.str&&it.str.trim().length>3){const k=it.str.trim();cnt[k]=(cnt[k]||0)+1;}}
    const wm=new Set();
    for(const[k,v]of Object.entries(cnt)){if(v>=4&&/[a-zA-Z\u00C0-\u024F@]/.test(k)&&!/^\s*\d/.test(k)&&PATS.NOISE.some(p=>p.test(k)))wm.add(k);}
    return wm;
  }

  async function extractTextItems(pdfPage,scale){
    const vp=pdfPage.getViewport({scale});
    const cont=await pdfPage.getTextContent({includeMarkedContent:false});
    const wm=buildWatermarkSet(cont.items);
    const items=[];
    const process=(list)=>{
      for(const it of list){
        if(!it.str||!it.str.trim()||wm.has(it.str.trim()))continue;
        const[,,c,d,tx,ty]=it.transform;
        const scaleY=Math.sqrt(c*c+d*d);
        const fontSize=Math.round(scaleY*10)/10;
        const bold=!!(it.fontName&&/bold|Black|Heavy/i.test(it.fontName));
        const h=Math.max(fontSize*scale,8),w=Math.max(it.width*scale,4);
        const x=tx*scale,y=vp.height-(ty*scale)-h;
        if(y<-h||y>vp.height+h)continue;
        items.push({str:it.str,x,y,w,h,fontSize,bold,raw:it});
      }
    };
    process(cont.items);
    if(!items.length&&cont.items.length>0)process(cont.items);
    return{items,vp};
  }

  function buildLines(items,vpW){
    if(!items.length)return[];
    const sorted=[...items].sort((a,b)=>a.y!==b.y?a.y-b.y:a.x-b.x);
    const lines=[];let cur=null;
    for(const it of sorted){
      if(!cur){cur=_lineFrom(it);continue;}
      const midA=cur.y+cur.h/2,midB=it.y+it.h/2;
      const thr=Math.max(cur.h,it.h)*CFG.LINE_MID_THRESH;
      const xGap=it.x-(cur.x+cur.w);
      const curIsNum=PATS.NUM_ONLY.test(cur.str);
      const sameRow=Math.abs(midA-midB)<thr;
      const forceJoin=curIsNum&&sameRow&&xGap>-10&&xGap<vpW*0.15;
      const isColGap=!forceJoin&&xGap>Math.max(cur.w,it.w)*CFG.LINE_COL_GAP_MULT;
      if(sameRow&&!isColGap)_lineAppend(cur,it);
      else{lines.push(cur);cur=_lineFrom(it);}
    }
    if(cur)lines.push(cur);
    return lines;
  }
  function _lineFrom(it){return{str:it.str,x:it.x,y:it.y,w:it.w,h:it.h,fontSize:it.fontSize,bold:it.bold,items:[it]};}
  function _lineAppend(cur,it){cur.str+=' '+it.str;cur.x=Math.min(cur.x,it.x);cur.w=Math.max(cur.x+cur.w,it.x+it.w)-cur.x;cur.h=Math.max(cur.h,it.h);cur.bold=cur.bold||it.bold;cur.fontSize=Math.max(cur.fontSize,it.fontSize);cur.items.push(it);}

  function detectLayout(lines,vpW,vpH){
    const headerH=vpH*CFG.HEADER_RATIO,footerH=vpH*CFG.FOOTER_RATIO;
    const bodyLines=lines.filter(l=>l.y>=headerH&&l.y+l.h<=vpH-footerH);
    const cols=splitColumns(bodyLines,vpW,vpH);
    return{columns:cols,headerRegion:{x:0,y:0,w:vpW,h:headerH},footerRegion:{x:0,y:vpH-footerH,w:vpW,h:footerH}};
  }

  function splitColumns(lines,vpW,vpH){
    if(!lines.length)return[{index:0,x:0,w:vpW,lines}];
    const minX=Math.min(...lines.map(l=>l.x)),maxX=Math.max(...lines.map(l=>l.x+l.w));
    const pageW=maxX-minX||vpW;
    const hist=new Array(CFG.COL_BINS).fill(0);
    for(const l of lines){const bi=Math.floor(((l.x+l.w/2-minX)/pageW)*CFG.COL_BINS);hist[Math.min(CFG.COL_BINS-1,Math.max(0,bi))]++;}
    const sm=hist.map((_,i)=>{const s=hist.slice(Math.max(0,i-2),i+3);return s.reduce((a,b)=>a+b,0)/s.length;});
    let bestSplit=null,bestScore=-Infinity;
    const lo=Math.floor(CFG.COL_BINS*0.28),hi=Math.floor(CFG.COL_BINS*0.72);
    for(let i=lo;i<hi;i++){const lv=sm[Math.max(0,i-1)],rv=sm[Math.min(CFG.COL_BINS-1,i+1)],cv=sm[i],c=(lv+rv)/2-cv;if(c>bestScore){bestScore=c;bestSplit=minX+((i+0.5)/CFG.COL_BINS)*pageW;}}
    const avg=lines.length/CFG.COL_BINS;
    if(bestSplit===null||bestScore<avg*CFG.COL_MIN_CONTRAST)return[{index:0,x:0,w:vpW,lines}];
    const left=lines.filter(l=>l.x+l.w/2<bestSplit),right=lines.filter(l=>l.x+l.w/2>=bestSplit);
    const lySpan=left.length?(Math.max(...left.map(l=>l.y+l.h))-Math.min(...left.map(l=>l.y))):0;
    const rySpan=right.length?(Math.max(...right.map(l=>l.y+l.h))-Math.min(...right.map(l=>l.y))):0;
    if(Math.min(lySpan,rySpan)<Math.max(lySpan,rySpan)*CFG.COL_YSPAN_RATIO)return[{index:0,x:0,w:vpW,lines}];
    const lx=Math.min(...left.map(l=>l.x),0),rx=Math.min(...right.map(l=>l.x),bestSplit);
    return[{index:0,x:lx,w:bestSplit-lx,lines:left},{index:1,x:rx,w:vpW-rx,lines:right}];
  }

  function buildTextBlocks(colLines,colIndex,vpH){
    if(!colLines.length)return[];
    const sorted=[...colLines].sort((a,b)=>a.y!==b.y?a.y-b.y:a.x-b.x);
    const clean=sorted.filter(l=>!PATS.NOISE.some(p=>p.test(l.str.trim())));
    if(!clean.length)return[];
    const gaps=[];
    for(let i=1;i<clean.length;i++){const g=clean[i].y-(clean[i-1].y+clean[i-1].h);if(g>0)gaps.push(g);}
    const thr=adaptiveGapThreshold(gaps);
    const raw=[];let cur=[clean[0]];
    for(let i=1;i<clean.length;i++){const gap=clean[i].y-(clean[i-1].y+clean[i-1].h);if(gap>thr){raw.push(cur);cur=[clean[i]];}else cur.push(clean[i]);}
    if(cur.length)raw.push(cur);
    return raw.map(lns=>_makeTextBlock(lns,colIndex));
  }

  function _makeTextBlock(lines,colIndex){
    const rect=rectFromLines(lines);
    const sizes=lines.map(l=>l.fontSize).sort((a,b)=>a-b);
    const domFS=sizes[Math.floor(sizes.length/2)]||10;
    const allStr=lines.map(l=>l.str).join(' ');
    return{id:newId(),colIndex,lines,...rect,dominantFS:domFS,hasBold:lines.some(l=>l.bold),hasQPat:lines.some(l=>isQLine(l.str)),hasAnsPat:_hasAnswerPattern(lines),isMath:/[x-zα-ωπ√∫∑²³⁴⁰¹]|P\(|f\(|Q\(|\^|\|/.test(allStr),text:lines[0].str.trim().slice(0,80),fullText:allStr};
  }

  function _hasAnswerPattern(lines){
    if(lines.filter(l=>PATS.ANS.some(p=>p.test(l.str.trim()))).length>=3)return true;
    for(const l of lines){const letters=new Set([...l.str.matchAll(/\b([A-Ea-e])\s*[.)]/g)].map(m=>m[1].toUpperCase()));if(letters.size>=3)return true;}
    return false;
  }

  function adaptiveGapThreshold(gaps){
    if(!gaps.length)return 18;
    const s=[...gaps].sort((a,b)=>a-b);
    const q25=s[Math.floor(s.length*0.25)],q75=s[Math.floor(s.length*0.75)],iqr=q75-q25;
    const big=s.filter(g=>g>q75+iqr*0.5);
    if(big.length>0&&big[0]>q75*1.6)return big[0]*0.85;
    return(s[Math.floor(s.length/2)]||10)*CFG.BLOCK_GAP_MULT;
  }

  /* ═══ İYİLEŞTİRME 1: Ardışık numara analizi ile anchor doğrulama ═══ */
  function findAnchorsInPage(blocks,layout){
    const candidates=[];
    for(const block of blocks){
      for(const line of block.lines){
        // Header'a yakın soru satırlarına izin ver (TEST bandı altındaki sorular için)
        if(line.y<layout.headerRegion.h*0.5||line.y>layout.footerRegion.y)continue;
        if(!isQLine(line.str))continue;
        const m=line.str.match(/^\s*(\d{1,3})/);
        const num=m?parseInt(m[1]):null;
        candidates.push({line,block,num,colIndex:block.colIndex});
      }
    }
    candidates.sort((a,b)=>a.line.y-b.line.y);

    // Sütun bazında ardışık numara analizi
    const byCol={};
    for(const c of candidates){if(!byCol[c.colIndex])byCol[c.colIndex]=[];byCol[c.colIndex].push(c);}

    const validAnchors=[];
    for(const colCands of Object.values(byCol)){
      if(!colCands.length)continue;
      const numbered=colCands.filter(c=>c.num!==null);
      if(numbered.length>=2){
        const bestSeq=_findBestSequence(numbered);
        const seqSet=new Set(bestSeq.map(c=>c.line.y));
        for(const c of colCands){if(c.num===null||seqSet.has(c.line.y))validAnchors.push(c);}
      } else {
        validAnchors.push(...colCands);
      }
    }

    const seen=new Map();
    const deduped=[];
    for(const a of validAnchors.sort((a,b)=>a.line.y-b.line.y)){
      const key=`${a.colIndex}:${a.num}`;
      if(a.num!==null&&seen.has(key))continue;
      if(a.num!==null)seen.set(key,a);
      deduped.push(a);
    }
    return deduped;
  }

  function _findBestSequence(numbered){
    if(numbered.length<=2)return numbered;
    let bestStart=0,bestLen=1,curLen=1;
    for(let i=1;i<numbered.length;i++){
      const diff=numbered[i].num-numbered[i-1].num;
      if(diff>=1&&diff<=3){curLen++;if(curLen>bestLen){bestLen=curLen;bestStart=i-curLen+1;}}
      else curLen=1;
    }
    if(bestLen>=2)return numbered.slice(bestStart,bestStart+bestLen);
    return numbered;
  }

  /* ═══ İYİLEŞTİRME 2: Anchor-first + grafik uzatma ═════════════════ */
  function assembleTextCandidates(blocks,layout,vpW,vpH){
    const anchors=findAnchorsInPage(blocks,layout);
    if(!anchors.length)return fallbackCandidates(blocks,layout,vpW,vpH);
    const candidates=[];
    for(let i=0;i<anchors.length;i++){
      const anchor=anchors[i];
      const col=layout.columns.find(c=>c.index===anchor.colIndex)||{x:0,w:vpW,index:0};
      const colX2=col.x+col.w;
      const nextSameCol=anchors.slice(i+1).find(a=>a.colIndex===anchor.colIndex);
      const yBottom=nextSameCol?nextSameCol.line.y-1:layout.footerRegion.y;
      const regionLines=[];
      for(const block of blocks){
        if(block.colIndex!==anchor.colIndex)continue;
        for(const line of block.lines){
          if(line.y<anchor.line.y-4||line.y>=yBottom)continue; // anchor y'sinden başla
          regionLines.push(line);
        }
      }
      if(!regionLines.length)continue;
      const bbox=rectFromLines(regionLines);
      // X: numara satırının bitişinden başla (numarayı bölgeden çıkar)
      const _anchorLine = anchor.line;
      const _numEndX = _anchorLine.x + (_anchorLine.w || _anchorLine.h || 20);
      bbox.x = Math.max(_numEndX, bbox.x);
      // Y: tam metin üst sınırı, boşluk yok
      bbox.y = Math.max(0, bbox.y);
      // Genişlik: sütun sonuna kadar
      bbox.w = Math.max(10, colX2 - bbox.x);
      // Yükseklik: sadece içerik yüksekliği, sonraki soruya uzatma
      bbox.h = Math.min(vpH - bbox.y, bbox.h);
      const bodyBlocks=blocks.filter(b=>b.colIndex===anchor.colIndex&&b.y>=anchor.line.y-4&&b.y<yBottom&&!b.hasAnsPat);
      const optionBlocks=blocks.filter(b=>b.colIndex===anchor.colIndex&&b.y>=anchor.line.y-4&&b.y<yBottom&&b.hasAnsPat);
      candidates.push({id:newId(),colIndex:anchor.colIndex,anchorType:'number',questionNum:anchor.num,bodyBlocks,optionBlocks,bbox,text:anchor.line.str.trim().slice(0,80),fullText:regionLines.map(l=>l.str).join(' '),optionPatternDetected:optionBlocks.length>0,mergedFrom:[]});
    }
    return candidates.length?candidates:fallbackCandidates(blocks,layout,vpW,vpH);
  }

  function fallbackCandidates(blocks,layout,vpW,vpH){
    const medianFS=(()=>{const fs=blocks.map(b=>b.dominantFS).sort((a,b)=>a-b);return fs[Math.floor(fs.length/2)]||12;})();
    return blocks.filter(b=>{
      if(b.hasAnsPat||b.y<layout.headerRegion.h||b.y>layout.footerRegion.y||b.w*b.h<CFG.PRUNE_MIN_AREA)return false;
      return b.hasBold||b.dominantFS>medianFS*1.10||b.lines.some(l=>l.str.trim().endsWith('?'))||(b.lines.length>=2&&b.lines[0].str.trim().length>8);
    }).map(b=>({id:newId(),colIndex:b.colIndex,anchorType:'text',questionNum:null,bodyBlocks:[b],optionBlocks:[],bbox:{x:b.x-CFG.NORM_PAD,y:b.y-CFG.NORM_PAD,w:b.w+CFG.NORM_PAD*2,h:b.h+CFG.NORM_PAD*2},text:b.text,fullText:b.fullText,optionPatternDetected:false,mergedFrom:[]}));
  }

  /* ═══ İYİLEŞTİRME 3: Gelişmiş güven skoru ═════════════════════════ */
  function scoreCandidate(cand,layout,medianFS,vpW){
    const{bbox,anchorType,optionPatternDetected,bodyBlocks,fullText,questionNum}=cand;
    let s=0;
    if(anchorType==='number')s+=55;
    if(fullText.length>10)s+=15;
    if(bodyBlocks.length>=2)s+=10;
    if(optionPatternDetected)s+=25;
    if(/\?/.test(fullText))s+=10;
    if(bodyBlocks.some(b=>b.isMath))s+=8;
    if(questionNum!==null)s+=8;
    if(bbox.y>layout.headerRegion.h&&bbox.y<layout.footerRegion.y)s+=5;
    if(bbox.y<layout.headerRegion.h)s-=60;
    if(bbox.y>layout.footerRegion.y)s-=70;
    if(bbox.w*bbox.h<CFG.PRUNE_MIN_AREA)s-=35;
    if(fullText.length<5&&!PATS.Q.some(p=>p.test(fullText)))s-=30;
    if(/^\d+$/.test(fullText.trim()))s-=40;
    if(/^[\-\u2013\u2014=]{3,}$/.test(fullText.trim()))s-=45;
    if(fullText.length>0&&!/[a-zA-Z\u00C0-\u024F]/.test(fullText))s-=25;
    if(typeof S!=='undefined'&&S.userFeedback){
      if(S.userFeedback.confirmed.length>0)s+=Math.round(_feedbackSim(cand,medianFS,'confirmed')*35);
      if(S.userFeedback.rejected.length>0)s-=Math.round(_feedbackSim(cand,medianFS,'rejected')*40);
    }
    return s;
  }

  function _feedbackSim(cand,medianSize,type){
    if(typeof S==='undefined'||!S.userFeedback)return 0;
    const sigs=S.userFeedback[type];
    if(!sigs||!sigs.length)return 0;
    const fl=cand.bodyBlocks[0]?.lines[0];
    if(!fl)return 0;
    let best=0;
    for(const sig of sigs){
      let score=0;
      const fsDiff=Math.abs(fl.fontSize-sig.fontSize)/(medianSize||10);
      if(fsDiff<0.15)score+=0.4;
      if(fl.bold===sig.bold)score+=0.2;
      if(sig.patternIdx>=0&&PATS.Q[sig.patternIdx]&&PATS.Q[sig.patternIdx].test(fl.str))score+=0.4;
      best=Math.max(best,score);
    }
    return best;
  }

  function mergeOrphanOptions(candidates,blocks,layout,vpH){
    const orphanOpt=blocks.filter(b=>b.hasAnsPat&&b.y>=layout.headerRegion.h&&b.y<=layout.footerRegion.y&&!candidates.some(c=>c.optionBlocks.includes(b)||c.bodyBlocks.includes(b)));
    for(const ob of orphanOpt){
      let best=null,bestDist=Infinity;
      for(const c of candidates){if(c.colIndex!==ob.colIndex)continue;const dist=ob.y-(c.bbox.y+c.bbox.h);if(dist>=0&&dist<bestDist){bestDist=dist;best=c;}}
      if(best&&bestDist<best.bbox.w*CFG.MERGE_GAP_RATIO){best.optionBlocks.push(ob);best.optionPatternDetected=true;best.bbox=mergeRects(best.bbox,ob);best.fullText+=' '+ob.fullText;best.mergedFrom.push(ob.id);}
    }
    const mathOrphans=blocks.filter(b=>!b.hasAnsPat&&!b.hasQPat&&b.isMath&&!candidates.some(c=>c.bodyBlocks.includes(b)));
    for(const mb of mathOrphans){
      let best=null,bestDist=Infinity;
      for(const c of candidates){if(c.colIndex!==mb.colIndex)continue;const medFS=c.bodyBlocks[0]?.dominantFS||10,dist=mb.y-(c.bbox.y+c.bbox.h);if(dist>=0&&dist<medFS*CFG.MERGE_MATH_MULT&&dist<bestDist){bestDist=dist;best=c;}}
      if(best){best.bodyBlocks.push(mb);best.bbox=mergeRects(best.bbox,mb);best.fullText+=' '+mb.fullText;best.mergedFrom.push(mb.id);}
    }
    return candidates;
  }

  /* ═══ İYİLEŞTİRME 4: Akıllı büyük kutu bölme ══════════════════════ */
  function splitOversized(candidates,layout){
    const result=[];
    for(const c of candidates){
      const maxH=layout.footerRegion.y*CFG.SPLIT_MAX_H_RATIO;
      if(c.bbox.h<=maxH){result.push(c);continue;}
      const realAnchors=c.bodyBlocks.filter(b=>b.lines.some(l=>isQLine(l.str)&&/^\s*\d{1,3}\s*[.)]\s+\S/.test(l.str.trim())));
      if(realAnchors.length<2){result.push(c);continue;}
      const nums=realAnchors.map(b=>b.lines.find(l=>isQLine(l.str))?.str.match(/^\s*(\d{1,3})/)).filter(Boolean).map(m=>parseInt(m[1])).sort((a,b)=>a-b);
      const isSeq=nums.every((n,i)=>i===0||(n-nums[i-1])<=3);
      if(!isSeq){result.push(c);continue;}
      const splitY=realAnchors[1].y-2;
      const c1={...c,id:newId(),mergedFrom:[c.id]},c2={...c,id:newId(),mergedFrom:[c.id]};
      c1.bodyBlocks=c.bodyBlocks.filter(b=>b.y<splitY);c1.optionBlocks=c.optionBlocks.filter(b=>b.y<splitY);
      c2.bodyBlocks=c.bodyBlocks.filter(b=>b.y>=splitY);c2.optionBlocks=c.optionBlocks.filter(b=>b.y>=splitY);
      const l1=[...c1.bodyBlocks,...c1.optionBlocks].flatMap(b=>b.lines),l2=[...c2.bodyBlocks,...c2.optionBlocks].flatMap(b=>b.lines);
      if(l1.length)c1.bbox=rectFromLines(l1);if(l2.length)c2.bbox=rectFromLines(l2);
      if(l1.length)result.push(c1);if(l2.length)result.push(c2);
    }
    return result;
  }

  function pruneCandidates(candidates,layout,scores){
    return candidates.filter((c,i)=>{
      if(scores[i]<CFG.CONF_MED) return false;
      if(c.bbox.w*c.bbox.h<CFG.PRUNE_MIN_AREA) return false;
      if(!c.fullText.trim()) return false;
      // Anchor tipinde soru ise header'a girmiş olsa bile geçir
      if(c.anchorType==='number') return c.bbox.y<=layout.footerRegion.y;
      return c.bbox.y>=layout.headerRegion.h && c.bbox.y<=layout.footerRegion.y;
    });
  }

  function deduplicateCandidates(candidates,scores){
    const sorted=candidates.map((c,i)=>({c,s:scores[i]})).sort((a,b)=>b.s-a.s);
    const kept=[];
    for(const{c}of sorted){
      const blocked=kept.some(k=>{const sameCol=Math.abs((k.bbox.x+k.bbox.w/2)-(c.bbox.x+c.bbox.w/2))<Math.min(k.bbox.w,c.bbox.w)*0.6;return sameCol&&overlapRatio(k.bbox,c.bbox)>0.60;});
      if(!blocked)kept.push(c);
    }
    return kept;
  }

  /* ═══ İYİLEŞTİRME 5: Gelişmiş görsel mod ══════════════════════════ */
  function visualDetect(canvas,vpW,vpH){
    const midX=Math.round(vpW/2),headerH=Math.round(vpH*CFG.HEADER_RATIO),footerY=Math.round(vpH*(1-CFG.FOOTER_RATIO));
    const leftB=_visualBands(canvas,vpW,vpH,0,midX,headerH,footerY),rightB=_visualBands(canvas,vpW,vpH,midX,vpW,headerH,footerY);
    const peaks=_stripPeaks(canvas,vpW,vpH);
    function pruneVis(regions){return regions.filter(r=>r.bbox.y>=headerH&&r.bbox.y+r.bbox.h<=footerY&&r.bbox.h>20);}
    if(leftB.length>=2&&rightB.length>=2)return pruneVis([..._blocksToRegions(leftB,0,midX,vpH,'L'),..._blocksToRegions(rightB,midX,vpW,vpH,'R')]);
    if(peaks.length>=2){
      const dividers=[0,...peaks.map(g=>Math.round((g.y1+g.y2)/2)),vpH];
      const regs=[];
      for(let i=0;i<dividers.length-1;i++){const y1=dividers[i],y2=dividers[i+1];if(y2-y1<vpH*CFG.VIS_MIN_BLOCK_RATIO||y1<headerH||y2>footerY)continue;regs.push(_mkVR(0,y1,midX,y2,vpH,'P-L'));regs.push(_mkVR(midX,y1,vpW-midX,y2,vpH,'P-R'));}
      if(regs.length)return regs;
    }
    const allB=_visualBands(canvas,vpW,vpH,0,vpW,headerH,footerY);
    if(allB.length>=2)return pruneVis(_blocksToRegions(allB,0,vpW,vpH,'S'));
    if(allB.length===1)return[_mkVR(0,headerH,vpW,footerY,vpH,'F')];
    const n=_grid(footerY-headerH,4,headerH);
    return n.flatMap(g=>[_mkVR(0,g.y1,midX,g.y2,vpH,'GL'),_mkVR(midX,g.y1,vpW-midX,g.y2,vpH,'GR')]);
  }

  function _visualBands(canvas,vpW,vpH,xFrom,xTo,yFrom,yTo){
    xFrom=xFrom||0;xTo=xTo||vpW;const colW=xTo-xFrom;if(colW<20)return[];
    const ctx=canvas.getContext('2d');let imgData;
    try{imgData=ctx.getImageData(xFrom,0,colW,vpH);}catch(e){return[];}
    const data=imgData.data,W=colW,H=vpH;
    const rowDark=new Float32Array(H);
    for(let y=0;y<H;y++){let dark=0;for(let x=0;x<W;x++){const i=(y*W+x)*4;if((data[i]+data[i+1]+data[i+2])/3<CFG.VIS_BRIGHT_THRESH)dark++;}rowDark[y]=dark/W;}
    let total=0;for(let y=0;y<H;y++)total+=rowDark[y];const avg=total/H;
    const EMPTY_T=Math.min(CFG.VIS_EMPTY_MAX,Math.max(CFG.VIS_EMPTY_MIN,avg*CFG.VIS_EMPTY_AVG_MULT));
    const MIN_GAP_PX=Math.max(14,H*CFG.VIS_MIN_GAP_RATIO);
    const sm=new Float32Array(H);const WIN=CFG.VIS_SMOOTH_WIN;
    for(let y=0;y<H;y++){let s=0,c=0;for(let dy=-WIN;dy<=WIN;dy++){const yy=y+dy;if(yy>=0&&yy<H){s+=rowDark[yy];c++;}}sm[y]=s/c;}
    const gaps=[];let inGap=false,gapStart=0;
    for(let y=0;y<H;y++){if(sm[y]<EMPTY_T){if(!inGap){inGap=true;gapStart=y;}}else{if(inGap){if(y-gapStart>=MIN_GAP_PX)gaps.push({y1:gapStart,y2:y});inGap=false;}}}
    if(inGap&&H-gapStart>=MIN_GAP_PX)gaps.push({y1:gapStart,y2:H});
    const blocks=[];const MIN_BH=H*CFG.VIS_MIN_BLOCK_RATIO;
    const dividers=[yFrom,...gaps.map(g=>Math.round((g.y1+g.y2)/2)).filter(y=>y>=yFrom&&y<=yTo),yTo];
    for(let i=0;i<dividers.length-1;i++){const y1=dividers[i],y2=dividers[i+1];if(y2-y1>=MIN_BH)blocks.push({y1,y2});}
    return blocks;
  }

  function _stripPeaks(canvas,vpW,vpH){
    const sx=Math.round(vpW*CFG.VIS_STRIP_X_RATIO),sw=Math.round(vpW*CFG.VIS_STRIP_W_RATIO);
    const headerH=Math.round(vpH*CFG.HEADER_RATIO),footerY=Math.round(vpH*(1-CFG.FOOTER_RATIO));
    const ctx=canvas.getContext('2d');let imgData;
    try{imgData=ctx.getImageData(sx,0,sw,vpH);}catch(e){return[];}
    const data=imgData.data,W=sw,H=vpH;
    const rowDark=new Float32Array(H);
    for(let y=0;y<H;y++){let d=0;for(let x=0;x<W;x++){const i=(y*W+x)*4;if((data[i]+data[i+1]+data[i+2])/3<CFG.VIS_BRIGHT_THRESH)d++;}rowDark[y]=d/W;}
    const sorted=[...rowDark].sort((a,b)=>a-b);
    const p=sorted[Math.floor(H*CFG.VIS_PEAK_THRESH_P)];
    const thresh=Math.max(p*CFG.VIS_PEAK_THRESH_M,2);
    const MD=Math.round(H*CFG.VIS_PEAK_MIN_DIST);
    const peaks=[];
    for(let y=headerH;y<footerY;y++){
      if(rowDark[y]<thresh)continue;
      if(peaks.length&&y-peaks[peaks.length-1].y1<MD)continue;
      let ey=y;while(ey<footerY&&rowDark[ey]>=thresh)ey++;
      peaks.push({y1:y,y2:ey});y=ey;
    }
    if(peaks.length>CFG.VIS_MAX_PEAKS){peaks.sort((a,b)=>(rowDark[b.y1]||0)-(rowDark[a.y1]||0));peaks.splice(CFG.VIS_MAX_PEAKS);}
    return peaks;
  }

  function _grid(bodyH,count,yOffset){const step=Math.floor(bodyH/count);return Array.from({length:count},(_,i)=>({y1:yOffset+i*step,y2:yOffset+(i+1)*step}));}
  function _blocksToRegions(blocks,xFrom,xTo,vpH,label){const PAD=CFG.NORM_PAD;return blocks.map(b=>({id:newId(),_vis:true,text:`(${label})`,fullText:'',colIndex:xFrom===0?0:1,bbox:{x:xFrom+PAD,y:b.y1+PAD,w:(xTo-xFrom)-PAD*2,h:(b.y2-b.y1)-PAD*2},anchorType:'visual',optionPatternDetected:false,mergedFrom:[],questionNum:null}));}
  function _mkVR(x,y1,w,y2,vpH,label){const PAD=CFG.NORM_PAD;return{id:newId(),_vis:true,text:`(${label})`,fullText:'',colIndex:x===0?0:1,bbox:{x:x+PAD,y:y1+PAD,w:w-PAD*2,h:(y2-y1)-PAD*2},anchorType:'visual',optionPatternDetected:false,mergedFrom:[],questionNum:null};}
;

  function isQLine(str){
    const s=str.trim();
    if(PATS.NOISE.some(p=>p.test(s)))return false;
    if(PATS.ANS.some(p=>p.test(s)))return false;
    if(/^\s*\d{1,3}\s*$/.test(s))return false;
    if(s.length<3)return false;
    return PATS.Q.some(p=>p.test(s));
  }

  function toRegion(cand,pageIdx,scale,confidence){
    const b=cand.bbox;
    return{
      id:cand.id,page:pageIdx,
      x:Math.max(0,Math.round(b.x)),y:Math.max(0,Math.round(b.y)),
      w:Math.round(b.w),h:Math.round(b.h),
      text:cand.text||'',fullText:cand.fullText||'',
      confirmed:false,manual:false,
      score:Math.min(100,Math.max(0,confidence)),
      detectedScale:scale,
      _meta:{confidence,anchorType:cand.anchorType,colIndex:cand.colIndex,optionPatternDetected:cand.optionPatternDetected,mergedFrom:cand.mergedFrom},
    };
  }

  async function detect(pdfPage,canvas,scale,pageIdx){
    const vpW=canvas.width,vpH=canvas.height;
    const{items}=await extractTextItems(pdfPage,scale);
    if(items.length===0){const visCands=visualDetect(canvas,vpW,vpH);return visCands.map(c=>toRegion(c,pageIdx,scale,45));}
    const lines=buildLines(items,vpW);
    const layout=detectLayout(lines,vpW,vpH);
    let allCands=[];
    for(const col of layout.columns){
      const blocks=buildTextBlocks(col.lines,col.index,vpH);
      const cands=assembleTextCandidates(blocks,layout,vpW,vpH);
      allCands.push(...cands);col._blocks=blocks;
    }
    const allBlocks=layout.columns.flatMap(c=>c._blocks||[]);
    allCands=mergeOrphanOptions(allCands,allBlocks,layout,vpH);
    allCands=splitOversized(allCands,layout);
    const medianFS=(()=>{const fs=allBlocks.map(b=>b.dominantFS).sort((a,b)=>a-b);return fs[Math.floor(fs.length/2)]||12;})();
    const scores=allCands.map(c=>scoreCandidate(c,layout,medianFS,vpW));
    const pruned=pruneCandidates(allCands,layout,scores);
    const pScores=pruned.map(c=>scores[allCands.indexOf(c)]);
    const final=deduplicateCandidates(pruned,pScores);
    if(final.length===0){const visCands=visualDetect(canvas,vpW,vpH);return visCands.map(c=>toRegion(c,pageIdx,scale,35));}
    return final.map((c,i)=>toRegion(c,pageIdx,scale,pScores[i]??50));
  }

  return{detect};

})();




pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

/* ═══ STATE ════════════════════════════════════════════════ */
const S = {
  pdf:null, pages:0, curPage:1, scale:1.4, fname:'',
  rawItems:{},
  regions:[], rid:0,
  questions:[], qnum:1,
  drawMode:false, drawing:false, p0:null, dRect:null,
  hovered:null, active:null,
  outMode:'a4', spacing:6,
  smartLayout:null,
  smartOrder:null,
  /* Yeni özellikler */
  scoreBox: false,
  answerKey: false,
  colMode: 'a4',
  thumbCache: {},
  previewPages:[], previewIdx:0,
  pointers:{},
  dominantPattern: null,
  userFeedback:{ confirmed:[], rejected:[] },
  resizing: null,
  hdr:{
    text:'SınavForge — Sınav Kağıdı',
    bg:'#0f1e3c',
    color:'#ffffff',
    fontSize:8.5,
    font:'helvetica',
    studentInfo: false,   // öğrenci bilgi satırı
  },
  mrg:{ left:14, right:14, top:6, bottom:8, col:8 },
  qNumOffset: 0,
  viewMode: 'grid',
  colDivider: {
    style: 'solid',   // 'solid' | 'dashed' | 'dotted' | 'none'
    color: '#000000', // renk
    width: 0.4,       // mm
    centerText: '',   // sütun ortası metin (sadece 2 sütunda)
    centerTextSize: 7, // pt
    centerTextColor: '#888888',
    centerGap: 2,     // metin öncesi/sonrası boşluk (karakter sayısı)
  },
  /* Çoklu PDF havuzu: [{id, fname, pdf, pages, rawItems, regions}] */
  pdfPool: [],
  activePdfId: null,
  spenMode: false,      // S-Pen desteği açık/kapalı
  /* Undo/redo yığını */
  undoStack: [],
  redoStack: [],
  /* Tarama önizleme bekleyen bölgeler */
  pendingRegions: [],
  /* Şablonlar */
  templates: [],
  /* Watermark */
  watermark: { enabled:false, text:'', imageDataUrl:null, opacity:0.15, position:'center' },
  /* Sınav başlık alanları */
  examInfo: { lesson:'', className:'', date:'' },
  /* PDF çıktı kalitesi: low/mid/high/ultra */
  exportQuality: 'mid',
  /* Soru bankası */
  questionBank: [],
  /* Paylaşım */
  shareToken: null,
};

/* ═══ DOM ══════════════════════════════════════════════════ */
const G = id => document.getElementById(id);
const D = {
  upload:G('pdf-upload'),
  dropZone:null, // artık yok, home-empty kullanılıyor
  ctrlBar:null,  // artık pdf-modal içinde
  wrapper:G('canvas-wrapper'),
  container:G('canvas-container'),
  pdfCvs:G('pdf-canvas'), ovCvs:G('overlay-canvas'),
  floatPanel:G('region-controls'), floatLabel:G('region-label'),
  btnOk:G('btn-confirm-region'), btnDel:G('btn-remove-region'),
  btnRedraw:G('btn-redraw-region'),
  btnDetect:G('btn-detect'),
  btnDetectModal:G('btn-detect-modal'), // PDF modal içindeki tara butonu
  btnClear:G('btn-clear'),
  btnExport:G('btn-export'), btnSmartLayout:G('btn-smart-layout'),
  btnPrev:G('btn-prev'), btnNext:G('btn-next'),
  btnZI:G('btn-zoom-in'), btnZO:G('btn-zoom-out'),
  btnSel:G('btn-mode-select'), btnDraw:G('btn-mode-draw'),
  pageCur:G('page-current'), pageTotal:G('page-total'),
  fileLabel:G('file-name-label'), zoomLabel:G('zoom-label'),
  statusTxt:G('status-text'), modeTag:G('mode-indicator'),
  qCount:G('question-count'),
  qList:G('questions-list'),
  qEmpty:null, // artık questions-grid/home-empty ile yönetiliyor
  expPanel:null,
  spacingIn:G('question-spacing'),
  loadOverlay:G('loading-overlay'), loadTxt:G('loading-text'),
  toasts:G('toast-container'),
  previewModal:G('preview-modal'), previewCvs:G('preview-canvas'),
  btnPrevPrev:G('prev-preview-page'), btnNextPrev:G('next-preview-page'),
  btnClosePreview:G('close-preview'), btnClosePreview2:G('close-preview-2'),
  btnDownload:G('btn-download-pdf'), modalInfo:G('modal-info'),
  hdrText:G('hdr-text'), hdrBg:G('hdr-bg'), hdrColor:G('hdr-color'),
  hdrSize:G('hdr-size'), hdrFont:G('hdr-font'),
  mrgLeft:G('mrg-left'), mrgRight:G('mrg-right'),
  mrgTop:G('mrg-top'), mrgBottom:G('mrg-bottom'), mrgCol:G('mrg-col'),
  btnPrint:G('btn-print'),
  btnClassify:G('btn-classify'),
  toggleScoreBox:G('toggle-score-box'),
  toggleAnswerKey:G('toggle-answer-key'),
  thumbTooltip:G('thumb-tooltip'), thumbCanvas:G('thumb-canvas'),
  sessionBanner:G('session-banner'),
  // Yeni UI öğeleri
  homeEmpty:G('home-empty'),
  questionsGrid:G('questions-grid'),
  pdfModal:G('pdf-modal'),
  pmtQCount:G('pmt-q-count'),
  settingsDrawer:G('settings-drawer'),
  settingsOverlay:G('settings-overlay'),
};

/* ═══ UTILS ════════════════════════════════════════════════ */
const setLoading=(on,msg='Isleniyor...')=>{D.loadTxt.textContent=msg;D.loadOverlay.classList.toggle('hidden',!on);};
const toast=(msg,type='info',ms=3200)=>{
  const el=document.createElement('div'); el.className=`toast ${type}`; el.textContent=msg;
  D.toasts.appendChild(el);
  setTimeout(()=>{el.classList.add('leaving');setTimeout(()=>el.remove(),230);},ms);
};
const setStatus=msg=>D.statusTxt.textContent=msg;
const newRid=()=>`r${++S.rid}`;
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

/* ═══ PDF LOAD ═════════════════════════════════════════════ */
async function loadPDF(file){
  // Çoklu PDF desteği: havuza ekle
  await addToPdfPool(file);
}

/* ═══ RENDER PAGE ══════════════════════════════════════════ */
let _currentRenderTask = null;
async function renderPage(num){
  if(!S.pdf)return;
  if(_currentRenderTask){
    try{ _currentRenderTask.cancel(); }catch(e){}
    _currentRenderTask=null;
  }
  try{
    const page=await S.pdf.getPage(num);
    const vp=page.getViewport({scale:S.scale});
    // Canvas boyutunu ayarla
    const w=Math.round(vp.width), h=Math.round(vp.height);
    D.pdfCvs.width=w; D.pdfCvs.height=h;
    D.ovCvs.width=w; D.ovCvs.height=h;
    // Canvas görünür olduğundan emin ol
    D.pdfCvs.style.display='block';
    D.ovCvs.style.display='block';
    const ctx=D.pdfCvs.getContext('2d');
    ctx.fillStyle='#ffffff';
    ctx.fillRect(0,0,w,h);
    _currentRenderTask=page.render({canvasContext:ctx,viewport:vp});
    try{
      await _currentRenderTask.promise;
    }catch(e){
      if(e && e.name==='RenderingCancelledException') return;
      throw e;
    }
    _currentRenderTask=null;
    if(!S.rawItems[num])await extractRaw(page,num,vp);
    S.curPage=num;
    updatePageStripActive(); // FIX #5: aktif sayfayı işaretle
    D.pageCur.textContent=num;
    D.pageTotal.textContent=S.pages;
    D.btnPrev.disabled=num<=1;
    D.btnNext.disabled=num>=S.pages;
    redraw();
  }catch(e){
    console.error('renderPage hatası:', e);
    toast('Sayfa render hatası: '+e.message,'error');
  }
}

/* ═══ TEXT EXTRACTION ══════════════════════════════════════ */
async function extractRaw(page,num,vp){
  const content=await page.getTextContent({includeMarkedContent:false});

  // Watermark tespiti: yalnızca NOISE_PATTERNS'a uyan VE sayfada 4+ kez
  // tekrar eden string'ler watermark sayılır.
  // Matematiksel token'lar (x, +, sayılar vb.) kesinlikle silinmez.
  const strCount={};
  for(const item of content.items){
    if(item.str&&item.str.trim().length>3){
      const k=item.str.trim();
      strCount[k]=(strCount[k]||0)+1;
    }
  }
  // Güvenli watermark: NOISE_PATTERNS'a uyan + 4+ tekrar + saf alfa (rakam/sembol içermiyor)
  const watermarkStrings=new Set(
    Object.entries(strCount)
      .filter(([k,v])=>{
        if(v<4) return false;                      // en az 4 tekrar
        if(!/[a-zA-Z\u00C0-\u024F@]/.test(k)) return false; // en az bir harf içermeli
        if(/^\s*\d/.test(k)) return false;         // rakamla başlıyorsa koru (soru numarası olabilir)
        return NOISE_PATTERNS.some(p=>p.test(k));  // NOISE_PATTERNS ile eşleşmeli
      })
      .map(([k])=>k)
  );

  const items=[];
  for(const item of content.items){
    if(!item.str||!item.str.trim())continue;
    // Sadece doğrulanmış watermark string'lerini atla
    if(watermarkStrings.has(item.str.trim()))continue;
    const [a,b,c,d,tx,ty]=item.transform;
    const scaleY=Math.sqrt(c*c+d*d);
    const fontSize=Math.round(scaleY*10)/10;
    const isBold=item.fontName&&/bold|Black|Heavy/i.test(item.fontName);
    const h=Math.max(fontSize*S.scale, 8);
    const w=Math.max(item.width*S.scale, 4);
    const x=tx*S.scale;
    const y=vp.height-(ty*S.scale)-h;
    if(y<-h||y>vp.height+h)continue;
    items.push({str:item.str, x, y, w, h, fontSize, bold:isBold, raw:item});
  }
  S.rawItems[num]=items;
  // G+D — Debug: rawItems üretimini logla
  sfLog(` extractRaw p${num}: ham=${content.items.length} filtreli=${items.length} watermark=${watermarkStrings.size}`);
  if(items.length===0){
    sfLog('[WARN] rawItems BOŞ — watermark filtresi çok agresif, filtresiz fallback deneniyor');
    sfLog(' Silinen stringler:',[...watermarkStrings].slice(0,10));
    const fb=[];
    for(const item of content.items){
      if(!item.str||!item.str.trim())continue;
      const [a,b,c,d,tx,ty]=item.transform;
      const scaleY=Math.sqrt(c*c+d*d);
      const fontSize=Math.round(scaleY*10)/10;
      const isBold=item.fontName&&/bold|Black|Heavy/i.test(item.fontName);
      const h=Math.max(fontSize*S.scale,8), w=Math.max(item.width*S.scale,4);
      const x=tx*S.scale, y=vp.height-(ty*S.scale)-h;
      if(y<-h||y>vp.height+h)continue;
      fb.push({str:item.str,x,y,w,h,fontSize,bold:isBold,raw:item});
    }
    sfLog(` Filtresiz fallback: ${fb.length} öğe`);
    S.rawItems[num]=fb;
  }
}

/* ═══ PATTERN TANIMLARI ════════════════════════════════════ */
const Q_PATTERNS=[
  // "5." veya "5)" ardından boşluk + içerik (en yaygın Türkçe format)
  /^\s*(\d{1,3})\s*[.)]\s+\S.{2,}/,
  // (5) formatı
  /^\s*\((\d{1,3})\)\s+\S.{2,}/,
  // "Soru 5" veya "Soru: 5"
  /^\s*[Ss]oru\s*[:\-.]?\s*\d+/,
  /^\s*[Ss]\s*[.\-:]?\s*\d+\s*[.):\-\s]/,
  /^\s*[Mm]adde\s*\d+/,
  /^\s*[Qq][Uu][Ee][Ss][Tt][Ii][Oo][Nn]\s*\d+/,
  /^\s*[Pp][Rr][Oo][Bb][Ll][Ee][Mm]\s*\d+/,
  /^\s*[Ss][Oo][Rr][Uu]\s*\d+/,
  // "5 – içerik" tire formatı
  /^\s*\d+\s*[-\u2013]\s+\S.{2,}/,
  /^\s*[Ss]oru\s*[Nn]o\s*[.:\-]?\s*\d+/,
  /^\s*[Ee]gzersiz\s*\d+/,
  /^\s*[Gg]orev\s*\d+/,
  /^\s*[Tt]ask\s*\d+/,
  /^\s*[Ee]xercise\s*\d+/,
  /^\s*\d{1,3}[\.:]\s+[A-Za-z\u00C0-\u024F].{4,}/,
  // Soru numarası ayrı text item olarak geldiğinde (örn. "1." veya "1)")
  /^\s*\d{1,3}\s*[.)]\s*$/,
];

// Şık satırları — A) B) C) D) E) veya A. B. C. veya boşluklu A ) B )
const ANSWER_PATTERNS=[
  /^\s*[A-Ea-e]\s*[.)]\s*/,          // A) veya A. ile başlayan
  /^\s*[A-Ea-e]\s*\)\s*/,            // A ) boşluklu
];

// Dekoratif / watermark / header metin kalıpları — bunlar soru DEĞİL
const NOISE_PATTERNS=[
  /^@[A-Za-z]/,                       // @MajestyPdf, @premierdeneme vb.
  /^www\./i,                           // www.site.com
  /^\s*(KAZANIM|BECERİ|UYGULAMA|KAVRAMA)\s+(DÜZEYİNDE|SORULARI)/i,
  /^\s*ÖSYM\s+Bakış/i,
  /^\s*Test\s*[-–]\s*\d+/i,           // Test-1, Test – 2
  /^\s*(Kolay|Orta|Zor)\s*([-–]\s*(Kolay|Orta|Zor))*/i,
  /^\s*\d+\s*\/\s*\d+\s*$/,           // "98 / 337" sayfa gösterimi
  /^\s*(Barış|Fulya|Rumeysa|Akif|Bolat|Cesur)\s*$/i, // baskı filigranları
  /^\s*(Barış|Baris)\s+YAYINLARI\s*$/i,  // "Barış YAYINLARI" tam string
  /^\s*Kazanım\s+Bakış\s*$/i,             // "Kazanım Bakış" başlık
  /^\s*[A-Z]{2,}\s+YAYINLARI\s*$/i,  // ERGİ YAYINLARI vb.
  /^\s*(Sınav kodu|Diğer sayfaya|II\. OTURUM)/i,
  /premierdeneme|krakedemi|MajestyPdf/i,
];

/* ═══ ONERI E: KULLANICI GERI BILDIRIMI ════════════════════ */
function recordFeedback(region, action){
  // FIX #3: buildLines(region.page) yanlış — buildLines items[] bekler, sayfa no değil
  // S.rawItems[page] üzerinden doğru çağrı yapılıyor
  try{
    const rawItems=S.rawItems[region.page];
    if(!rawItems||!rawItems.length) return;
    // buildLines global SFDetector içinde private — rawItems üzerinden satır bul
    // Bölgeyle örtüşen ham item'ları al
    const overlapping=rawItems.filter(it=>
      it.y >= region.y-10 && it.y <= region.y+region.h+10 &&
      it.x >= region.x-20 && it.x <= region.x+region.w+20
    );
    if(!overlapping.length) return;
    // En yakın satırı bul (y koordinatı region.y'ye en yakın)
    const bl=overlapping.reduce((best,it)=>
      Math.abs(it.y-region.y) < Math.abs((best?best.y:9999)-region.y) ? it : best
    , null);
    if(!bl) return;
    const sig={
      fontSize: bl.fontSize||12,
      bold: bl.bold||false,
      patternIdx: Q_PATTERNS.findIndex(p=>p.test((bl.str||'').trim())),
      xNorm: bl.x / (D.ovCvs.width||800),
    };
    S.userFeedback[action==='confirm'?'confirmed':'rejected'].push(sig);
  }catch(e){ console.warn('[recordFeedback]', e.message); }
}

function feedbackSimilarity(bl, medianSize, type){
  const sigs=S.userFeedback[type];
  if(!sigs.length)return 0;
  const fl=bl.lines[0];
  const str=fl.str.trim();
  let maxSim=0;
  for(const sig of sigs){
    let sim=0;
    const fRatio=sig.fontSize>0?Math.min(fl.fontSize,sig.fontSize)/Math.max(fl.fontSize,sig.fontSize):0;
    sim+=fRatio*0.3;
    if(fl.bold===sig.bold) sim+=0.2;
    if(sig.patternIdx>=0 && Q_PATTERNS[sig.patternIdx] && Q_PATTERNS[sig.patternIdx].test(str)) sim+=0.3;
    const xNorm=fl.x/(D.ovCvs.width||800);
    if(Math.abs(xNorm-sig.xNorm)<0.08) sim+=0.2;
    maxSim=Math.max(maxSim,sim);
  }
  return maxSim;
}

/* ═══ DETECT ALL + ONERI C ENTEGRASYONU ════════════════════ */
async function detectAll(){
  if(!S.pdf)return;
  const p=S.curPage;
  setLoading(true,`Sayfa ${p} taranıyor...`);
  try{
    // Mevcut sayfadaki TÜM bölge ve soruları temizle (tekrar tarama desteği)
    const removedRids=new Set(S.regions.filter(r=>r.page===p).map(r=>r.id));
    S.regions=S.regions.filter(r=>r.page!==p);
    S.questions=S.questions.filter(q=>!removedRids.has(q.rid));
    S.questions.forEach((q,i)=>{q.num=i+1;});
    S.qnum=S.questions.length+1;

    if(!S.rawItems[p]){
      const page=await S.pdf.getPage(p);
      const vp=page.getViewport({scale:S.scale});
      await extractRaw(page,p,vp);
    }

    const page=await S.pdf.getPage(p);
    const vp=page.getViewport({scale:S.scale});

    // Piksel analizi için sayfayı canvas'a render et (zaten render edilmemişse)
    if(D.pdfCvs.width!==Math.round(vp.width)||D.pdfCvs.height!==Math.round(vp.height)){
      D.pdfCvs.width=D.ovCvs.width=Math.round(vp.width);
      D.pdfCvs.height=D.ovCvs.height=Math.round(vp.height);
      await page.render({canvasContext:D.pdfCvs.getContext('2d'),viewport:vp}).promise;
    }

    /* ── SFDetector v1: hibrit pipeline ────────────────────────── */
    const rawCount = (S.rawItems[p]||[]).length;
    sfLog(` detectAll p${p}: rawItems=${rawCount}`);

    // Canvas zaten render edilmiş — SFDetector direkt kullanır
    // SFDetector: hibrit metin+görsel pipeline
    const sfCandidates = await SFDetector.detect(page, D.pdfCvs, S.scale, p);

    const allFound = sfCandidates;
    const patternMsg = allFound.length > 0
      ? ` (${allFound.some(r=>r._meta?.anchorType==='visual')?'görsel mod':'metin modu'})`
      : '';

    // allFound bölgelerini henüz S.regions'a EKLEME — önce kullanıcı onaylasın
    allFound.forEach(r=>{ r.pdfId=S.activePdfId||null; });

    // Sayfayı render et (bölgeler henüz eklenmedi, overlay temiz)
    await renderPage(p);
    setStatus(`Sayfa ${p}: ${allFound.length} soru algılandı${patternMsg}`);

    if(allFound.length>0){
      // Onay modalını aç — modal kapanana kadar bölgeler eklenmez
      openScanReview(allFound);
    } else {
      toast('Soru bulunamadı — çizim modu ile elle seçin','info',4000);
      setTimeout(()=>{
        const t=document.createElement('div');
        t.className='toast info';
        t.style.cssText='display:flex;align-items:center;gap:10px;pointer-events:all';
        t.innerHTML='<span>🔍 Debug logu gör</span><button onclick="sfShowLog()" style="background:#3d7eff;color:#fff;border:none;padding:4px 12px;border-radius:6px;font-size:12px;cursor:pointer">📋 Log</button>';
        D.toasts.appendChild(t);
        setTimeout(()=>{t.classList.add('leaving');setTimeout(()=>t.remove(),230);},15000);
      },500);
    }
  }catch(e){console.error(e);toast('Algılama hatası: '+e.message,'error');}
  finally{setLoading(false);}
}

/* ═══ SAYFA ARALIĞI TARAMA (Madde 10) ═══════════════════════ */
function openRangeScanDialog(){
  if(!S.pdf){ toast('Önce PDF yükleyin','error'); return; }
  let dlg=G('range-scan-dlg');
  if(dlg){ dlg.remove(); }
  dlg=document.createElement('div');
  dlg.id='range-scan-dlg';
  dlg.style.cssText='position:fixed;inset:0;z-index:9990;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5)';
  dlg.innerHTML=
    `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:24px 28px;min-width:300px;box-shadow:0 8px 40px rgba(0,0,0,.22);">`+
      `<div style="font-weight:700;font-size:15px;margin-bottom:14px">📄 Sayfa Aralığı Tara</div>`+
      `<div style="display:flex;align-items:center;gap:10px;margin-bottom:18px">`+
        `<label style="font-size:13px;color:var(--text-muted)">Başlangıç</label>`+
        `<input id="range-from" type="number" min="1" max="${S.pages}" value="1" style="width:64px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-warm);color:var(--text);font-size:14px;text-align:center"/>`+
        `<label style="font-size:13px;color:var(--text-muted)">Bitiş</label>`+
        `<input id="range-to" type="number" min="1" max="${S.pages}" value="${S.pages}" style="width:64px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-warm);color:var(--text);font-size:14px;text-align:center"/>`+
        `<span style="font-size:12px;color:var(--text-muted)">/ ${S.pages}</span>`+
      `</div>`+
      `<div style="display:flex;gap:10px;justify-content:flex-end">`+
        `<button id="range-cancel" style="padding:7px 18px;border:1px solid var(--border);border-radius:8px;background:none;color:var(--text);cursor:pointer;font-size:13px">İptal</button>`+
        `<button id="range-start" style="padding:7px 18px;border:none;border-radius:8px;background:#3d7eff;color:#fff;cursor:pointer;font-size:13px;font-weight:600">Tara</button>`+
      `</div>`+
    `</div>`;
  document.body.appendChild(dlg);
  G('range-cancel').addEventListener('click',()=>dlg.remove());
  dlg.addEventListener('click',function(e){ if(e.target===dlg) dlg.remove(); });
  G('range-start').addEventListener('click',async function(){
    const from=Math.max(1,parseInt(G('range-from').value)||1);
    const to=Math.min(S.pages,parseInt(G('range-to').value)||S.pages);
    if(from>to){ toast('Geçersiz sayfa aralığı','error'); return; }
    dlg.remove();
    await detectRange(from, to);
  });
}

async function detectRange(fromPage, toPage){
  if(!S.pdf) return;
  const allFound=[];
  for(let p=fromPage; p<=toPage; p++){
    setLoading(true,`Taranıyor: Sayfa ${p} / ${toPage}...`);
    try{
      if(!S.rawItems[p]){
        const page=await S.pdf.getPage(p);
        const vp=page.getViewport({scale:S.scale});
        await extractRaw(page,p,vp);
      }
      const page=await S.pdf.getPage(p);
      const vp=page.getViewport({scale:S.scale});
      // Geçici canvas
      const tmp=document.createElement('canvas');
      tmp.width=Math.round(vp.width); tmp.height=Math.round(vp.height);
      await page.render({canvasContext:tmp.getContext('2d'),viewport:vp}).promise;
      const candidates=await SFDetector.detect(page, tmp, S.scale, p);
      candidates.forEach(r=>{ r.pdfId=S.activePdfId||null; });
      allFound.push(...candidates);
    }catch(e){ sfLog(`detectRange p${p} hata: `+e.message); }
  }
  setLoading(false);
  if(allFound.length===0){
    toast(`${fromPage}–${toPage}. sayfalar tarandı: soru bulunamadı`,'info',4000);
    return;
  }
  setStatus(`${fromPage}–${toPage}. sayfalar: ${allFound.length} soru algılandı`);
  openScanReview(allFound);
}


function redraw(){
  const cvs=D.ovCvs,ctx=cvs.getContext('2d');
  ctx.clearRect(0,0,cvs.width,cvs.height);
  const pageR=S.regions.filter(r=>r.page===S.curPage);
  for(const r of pageR){
    const isH=S.hovered&&S.hovered.id===r.id, isC=r.confirmed;
    ctx.fillStyle=isC?'rgba(61,126,255,0.11)':isH?'rgba(245,158,11,0.14)':'rgba(61,126,255,0.06)';
    ctx.fillRect(r.x,r.y,r.w,r.h);
    ctx.strokeStyle=isC?'#3d7eff':isH?'#f59e0b':'rgba(61,126,255,0.5)';
    ctx.lineWidth=(isC||isH)?2.5:1.5;
    ctx.setLineDash(isC?[]:[5,3]);
    ctx.strokeRect(r.x+.5,r.y+.5,r.w,r.h);
    ctx.setLineDash([]);
    if(isC){
      const qi=S.questions.findIndex(q=>q.rid===r.id);
      if(qi>=0){
        const lbl=String(qi+1);
        ctx.font='bold 11px Outfit,sans-serif';
        ctx.textAlign='left'; ctx.textBaseline='bottom';
        // subtle white shadow for readability
        ctx.fillStyle='rgba(255,255,255,0.85)';
        ctx.fillText(lbl, r.x+3, r.y-1);
        ctx.fillStyle='rgba(255,255,255,0.85)';
        ctx.fillText(lbl, r.x+5, r.y-1);
        ctx.fillStyle='rgba(255,255,255,0.85)';
        ctx.fillText(lbl, r.x+4, r.y);
        ctx.fillStyle='#111';
        ctx.fillText(lbl, r.x+4, r.y-2);
      }
    }
    // Resize handles for active region
    if(S.active&&S.active.id===r.id&&r.confirmed){
      const handles=getHandlePositions(r);
      for(const h of handles){
        ctx.fillStyle='rgba(255,255,255,0.95)';
        ctx.beginPath(); ctx.arc(h.x,h.y,6,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle='#3d7eff'; ctx.lineWidth=2;
        ctx.beginPath(); ctx.arc(h.x,h.y,5,0,Math.PI*2); ctx.stroke();
        ctx.fillStyle='#3d7eff';
        ctx.beginPath(); ctx.arc(h.x,h.y,2.5,0,Math.PI*2); ctx.fill();
      }
    }
  }
  if(S.drawing&&S.dRect){
    const dr=S.dRect;
    ctx.strokeStyle='#22c55e'; ctx.lineWidth=2.5; ctx.setLineDash([7,3]);
    ctx.strokeRect(dr.x+.5,dr.y+.5,dr.w,dr.h);
    ctx.fillStyle='rgba(34,197,94,0.08)';
    ctx.fillRect(dr.x,dr.y,dr.w,dr.h);
    ctx.setLineDash([]);
  }
}

/* ═══ COORD HELPER ═════════════════════════════════════════ */
function clientToCanvas(clientX,clientY){
  const rect=D.ovCvs.getBoundingClientRect();
  return{
    x:(clientX-rect.left)*(D.ovCvs.width/rect.width),
    y:(clientY-rect.top)*(D.ovCvs.height/rect.height),
  };
}
function regionAt(x,y){
  return[...S.regions].filter(r=>r.page===S.curPage).reverse()
    .find(r=>x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h)||null;
}

/* ═══ RESIZE HANDLES ════════════════════════════════════════ */
const HANDLE_NAMES=['tl','t','tr','l','r','bl','b','br'];
function getHandlePositions(r){
  return[
    {name:'tl',x:r.x,        y:r.y        },
    {name:'t', x:r.x+r.w/2,  y:r.y        },
    {name:'tr',x:r.x+r.w,    y:r.y        },
    {name:'l', x:r.x,        y:r.y+r.h/2  },
    {name:'r', x:r.x+r.w,    y:r.y+r.h/2  },
    {name:'bl',x:r.x,        y:r.y+r.h    },
    {name:'b', x:r.x+r.w/2,  y:r.y+r.h    },
    {name:'br',x:r.x+r.w,    y:r.y+r.h    },
  ];
}
const HANDLE_CURSOR={tl:'nwse-resize',t:'ns-resize',tr:'nesw-resize',
  l:'ew-resize',r:'ew-resize',bl:'nesw-resize',b:'ns-resize',br:'nwse-resize'};

function hitHandle(x,y,r){
  const rect=D.ovCvs.getBoundingClientRect();
  const cssScale=rect.width/D.ovCvs.width;
  // Tablet/parmak için geniş hit area — canvas koordinatında 44px minimum
  const hitR=Math.max(44, 52/cssScale);
  for(const h of getHandlePositions(r)){
    if(Math.abs(x-h.x)<hitR&&Math.abs(y-h.y)<hitR) return h.name;
  }
  return null;
}

// Bölge içinde mi? (taşıma için) — kenar PAD artırıldı
function insideRegion(x,y,r){
  // Bölgenin iç alanı: handle alanı hariç
  // Küçük bölgelerde PAD orantılı küçülür
  const PAD=Math.min(20, Math.min(r.w,r.h)*0.15);
  return x>r.x+PAD && x<r.x+r.w-PAD && y>r.y+PAD && y<r.y+r.h-PAD;
}

function applyResize(r,handle,dx,dy){
  let {origX:x,origY:y,origW:w,origH:h}=S.resizing;
  if(handle==='move'){
    // Taşıma: tüm bölgeyi kaydır
    r.x=Math.max(0,x+dx); r.y=Math.max(0,y+dy);
    r.detectedScale=S.scale; S.smartLayout=null; return;
  }
  if(handle.includes('l')){ x+=dx; w-=dx; }
  if(handle.includes('r')){ w+=dx; }
  if(handle.includes('t')){ y+=dy; h-=dy; }
  if(handle.includes('b')){ h+=dy; }
  if(w<15) w=15;
  if(h<10) h=10;
  r.x=x; r.y=y; r.w=w; r.h=h;
  r.detectedScale=S.scale;
  S.smartLayout=null;
}

/* ═══ FLOAT PANEL ══════════════════════════════════════════ */
function showFloat(r){
  if(!r){hideFloat();return;}
  S.active=r;
  const cr=D.container.getBoundingClientRect();
  const wr=D.wrapper.getBoundingClientRect();
  const sx=cr.width/D.ovCvs.width, sy=cr.height/D.ovCvs.height;
  const px=cr.left-wr.left+r.x*sx;
  const py=Math.max(4,cr.top-wr.top+r.y*sy-38);
  D.floatPanel.style.left=px+'px';
  D.floatPanel.style.top=py+'px';
  D.floatPanel.classList.remove('hidden');
  const qi=S.questions.findIndex(q=>q.rid===r.id);
  D.floatLabel.textContent=qi>=0?'S'+(qi+1):'?';
  // #3: Düzenle butonunu güncelle
  const editBtn=D.floatPanel.querySelector('.btn-region-edit');
  if(editBtn) editBtn.onclick=()=>openRegionEditor(r);
  // FIX #6: Bölgeyi görünür alana scroll et
  const regionTopPx=cr.top-wr.top+r.y*sy;
  const regionBotPx=cr.top-wr.top+(r.y+r.h)*sy;
  const wrapperH=D.wrapper.clientHeight;
  const scrollTop=D.wrapper.scrollTop;
  const margin=40;
  if(regionTopPx-scrollTop < margin){
    D.wrapper.scrollTo({top:scrollTop+(regionTopPx-margin), behavior:'smooth'});
  } else if(regionBotPx-scrollTop > wrapperH-margin){
    D.wrapper.scrollTo({top:scrollTop+(regionBotPx-wrapperH+margin), behavior:'smooth'});
  }
}
function hideFloat(){S.active=null;D.floatPanel.classList.add('hidden');}

/* ═══ QUESTION MANAGEMENT + ONERI E ════════════════════════ */
function confirmRegion(r){
  if(!r)return;
  if(r.confirmed){showFloat(r);return;}
  snapshotState();
  r.confirmed=true;
  r.pdfId=S.activePdfId||null;
  recordFeedback(r,'confirm');
  S.questions.push({id:'q'+Date.now(),rid:r.id,page:r.page,
    text:r.text,full:r.fullText,num:S.qnum++});
  // Aktif PDF entry'sini güncelle
  const _ce=S.pdfPool.find(p=>p.id===S.activePdfId);
  if(_ce) _ce.regions=[...S.regions];
  D.btnExport.disabled=false; D.btnSmartLayout.disabled=false;
  updatePanel(); redraw(); showFloat(r);
  setStatus('Soru '+S.questions.length+' eklendi');
  buildThumbCache().then(()=>{ updatePanel(); showDuplicateWarning(); });
  saveSession();
}
function removeRegion(r){
  if(!r)return;
  snapshotState();
  if(!r.manual && !r.confirmed) recordFeedback(r,'reject');
  delete S.thumbCache[r.id];
  S.regions=S.regions.filter(x=>x.id!==r.id);
  S.questions=S.questions.filter(q=>q.rid!==r.id);
  S.questions.forEach((q,i)=>{q.num=i+1;});
  // Aktif PDF entry'sini güncelle
  const _re=S.pdfPool.find(p=>p.id===S.activePdfId);
  if(_re) _re.regions=[...S.regions];
  hideFloat(); updatePanel(); redraw();
  if(!S.questions.length){D.btnExport.disabled=true; D.btnSmartLayout.disabled=true;}
  saveSession();
}
function clearAll(){
  S.regions=[]; S.questions=[]; S.rid=0; S.qnum=1; S.smartLayout=null; S.smartOrder=null;
  S.thumbCache={};
  S.userFeedback={confirmed:[],rejected:[]}; S.dominantPattern=null;
  hideFloat(); updatePanel(); redraw();
  D.btnExport.disabled=true; D.btnSmartLayout.disabled=true;
  localStorage.removeItem(SESSION_KEY);
  toast('Tum secimler temizlendi');
}

/* ═══ PANEL UPDATE ═════════════════════════════════════════ */
function updatePanel(){
  const n=S.questions.length;
  if(D.qCount) D.qCount.textContent=n;
  if(D.pmtQCount) D.pmtQCount.textContent=n;

  // Ana ekran görünürlüğü
  const hasPdf=!!S.pdf;
  if(D.homeEmpty) D.homeEmpty.classList.toggle('hidden', hasPdf || n>0);
  if(D.questionsGrid) D.questionsGrid.classList.toggle('hidden', n===0);

  // Buton durumları
  const hasQ=n>0;
  if(D.btnClear) D.btnClear.disabled=!hasQ;
  if(D.btnPrint) D.btnPrint.disabled=!hasQ;
  if(D.btnClassify) D.btnClassify.disabled=!hasQ;
  const btnShuffle=G('btn-shuffle');
  const btnDualForm=G('btn-dual-form');
  const btnExportJson=G('btn-export-json');
  const btnUndo=G('btn-undo');
  if(btnShuffle) btnShuffle.disabled=!hasQ;
  if(btnDualForm) btnDualForm.disabled=!hasQ;
  if(btnExportJson) btnExportJson.disabled=!hasQ;
  if(btnUndo) btnUndo.disabled=S.undoStack.length===0;

  renderStatsPanel();

  if(!D.qList) return;
  D.qList.innerHTML='';
  D.qList.dataset.vm = S.viewMode||'grid';

  // #7: Filtre uygula
  const filterVal=(G('q-search-input')?.value||'').trim().toLowerCase();
  const visibleQuestions=filterVal
    ? S.questions.filter(q=>
        (q.text||'').toLowerCase().includes(filterVal)||
        (q.tag||'').toLowerCase().includes(filterVal)||
        (q.note||'').toLowerCase().includes(filterVal)||
        String(q.page).includes(filterVal)
      )
    : S.questions;

  visibleQuestions.forEach((q,i)=>{
    const li=document.createElement('li');
    li.className='question-item'; li.dataset.qid=q.id;
    const thumbSrc=S.thumbCache[q.rid]||'';
    const aiTag=q.aiType?`<span class="q-ai-tag ${q.aiType==='Çoktan Seçmeli'?'coktan':q.aiType==='Klasik'?'klasik':'karma'}">${q.aiType}</span>`:'';

    const tagLabel=q.tag||'Konu';
    const hasTag=!!q.tag;
    const noteVal=q.note||'';
    const hasNote=!!noteVal;
    li.innerHTML=
      `<button class="q-del-btn" title="Kaldır">✕</button>`+
      `<div class="q-card-thumb q-card-thumb--lg">`+
        (thumbSrc?`<img src="${thumbSrc}" alt="soru önizleme"/>`:`<span class="q-no-thumb">📄</span>`)+
      `</div>`+
      `<div class="q-card-body">`+
        `<div class="q-card-top"><span class="q-num">${i+1}</span><span class="q-drag">⠿</span></div>`+
        `<div class="q-preview-text">${esc(q.text)}${aiTag}</div>`+
        `<div class="q-note-row">`+
          `<input class="q-note-input" type="text" maxlength="120" placeholder="Not ekle… (sınav kağıdında gizli)" value="${esc(noteVal)}" data-qid="${q.id}"/>`+
          (hasNote?`<span class="q-note-icon" title="Not var">🗒</span>`:'')+
        `</div>`+
        `<div class="q-meta-row">`+
          `<select class="q-diff-sel" data-qid="${q.id}" title="Zorluk">`+
            `<option value="">Zorluk</option>`+
            [['easy','⭐ Kolay'],['medium','⭐⭐ Orta'],['hard','⭐⭐⭐ Zor']].map(([v,l])=>`<option value="${v}"${q.difficulty===v?' selected':''}>${l}</option>`).join('')+
          `</select>`+
          `<input class="q-dur-input" type="number" min="0" max="60" step="0.5" value="${q.duration||''}" placeholder="dk" data-qid="${q.id}" title="Tahmini süre (dakika)"/>`+
          `<span class="q-dur-unit">dk</span>`+
        `</div>`+
        `<div class="q-card-footer">`+
          `<span class="q-page">Sayfa ${q.page}</span>`+
          `<button class="q-tag-btn${hasTag?' has-tag':''}" data-qid="${q.id}">${esc(tagLabel)}</button>`+
          `<button class="q-copy-btn" data-qid="${q.id}" title="Soruyu kopyala">⧉</button>`+
          `<select class="q-answer-sel" data-qid="${q.id}" title="Doğru cevap">`+
            `<option value="">—</option>`+
            ['A','B','C','D','E'].map(l=>`<option value="${l}"${q.answer===l?' selected':''}>${l}</option>`).join('')+
          `</select>`+
          `${S.scoreBox?`<input class="q-score-input" type="number" min="0" max="100" value="${q.score||0}" placeholder="puan" data-qid="${q.id}"/>`:''}` +
        `</div>`+
        `<div class="q-size-row">`+
          `<button class="q-size-btn" data-qid="${q.id}" data-dir="-1">−</button>`+
          `<input class="q-size-slider" type="range" min="30" max="200" step="5" value="${q.sizePercent||100}" data-qid="${q.id}"/>`+
          `<button class="q-size-btn" data-qid="${q.id}" data-dir="1">+</button>`+
          `<span class="q-size-val" data-qid="${q.id}">${q.sizePercent||100}%</span>`+
        `</div>`+
      `</div>`;

    li.addEventListener('click',function(e){
      if(e.target.closest('.q-del-btn')) return;
      document.querySelectorAll('.question-item').forEach(x=>x.classList.remove('active'));
      li.classList.add('active');
      const r=findRegionById(q.rid);
      if(!r) return;
      openPdfModal();
      if(r.page!==S.curPage) renderPage(r.page).then(()=>showFloat(r));
      else showFloat(r);
    });
    li.querySelector('.q-del-btn').addEventListener('click',function(e){
      e.stopPropagation();
      const r=findRegionById(q.rid);
      if(r) removeRegion(r);
    });
    // Konu etiketi butonu
    const tagBtn=li.querySelector('.q-tag-btn');
    if(tagBtn) tagBtn.addEventListener('click',function(e){
      e.stopPropagation();
      openTagDropdown(q.id, tagBtn);
    });
    // Puan input
    const scoreInp=li.querySelector('.q-score-input');
    if(scoreInp){
      scoreInp.addEventListener('click',e=>e.stopPropagation());
      scoreInp.addEventListener('change',function(){ setQuestionScore(q.id, parseInt(this.value)||0); });
    }
    const diffSel=li.querySelector('.q-diff-sel');
    if(diffSel){
      diffSel.addEventListener('click',e=>e.stopPropagation());
      diffSel.addEventListener('change',function(){
        const qq=S.questions.find(x=>x.id===this.dataset.qid);
        if(qq){qq.difficulty=this.value;renderStatsPanel();saveSession();}
      });
    }
    const durInp=li.querySelector('.q-dur-input');
    if(durInp){
      durInp.addEventListener('click',e=>e.stopPropagation());
      durInp.addEventListener('change',function(){
        const qq=S.questions.find(x=>x.id===this.dataset.qid);
        if(qq){qq.duration=parseFloat(this.value)||0;renderStatsPanel();saveSession();}
      });
    }
    // #5: Cevap seçici
    const answerSel=li.querySelector('.q-answer-sel');
    if(answerSel){
      answerSel.addEventListener('click',e=>e.stopPropagation());
      answerSel.addEventListener('change',function(){
        const q2=S.questions.find(x=>x.id===this.dataset.qid);
        if(q2){ q2.answer=this.value; saveSession(); }
      });
    }
    // Not input
    const noteInp=li.querySelector('.q-note-input');
    if(noteInp){
      noteInp.addEventListener('click',e=>e.stopPropagation());
      noteInp.addEventListener('change',function(){
        const qq=S.questions.find(x=>x.id===q.id);
        if(qq){ qq.note=this.value.trim(); saveSession(); }
      });
    }
    // Kopyala butonu (Madde 9)
    const copyBtn=li.querySelector('.q-copy-btn');
    if(copyBtn) copyBtn.addEventListener('click',function(e){
      e.stopPropagation();
      duplicateQuestion(q.id);
    });
    // Boyut ±5% butonları
    li.querySelectorAll('.q-size-btn').forEach(function(btn){
      btn.addEventListener('click',function(e){
        e.stopPropagation();
        const qTarget=S.questions.find(x=>x.id===this.dataset.qid);
        if(!qTarget) return;
        const dir=parseInt(this.dataset.dir);
        const cur=qTarget.sizePercent||100;
        const next=Math.min(200, Math.max(30, cur+dir*5));
        if(next===cur) return;
        qTarget.sizePercent=next;
        S.smartLayout=null;
        const valEl=li.querySelector('.q-size-val[data-qid="'+qTarget.id+'"]');
        if(valEl) valEl.textContent=next+'%';
        const slEl=li.querySelector('.q-size-slider[data-qid="'+qTarget.id+'"]');
        if(slEl) slEl.value=next;
        saveSession();
      });
    });
    // Slider
    const sizeSlider=li.querySelector('.q-size-slider');
    if(sizeSlider){
      sizeSlider.addEventListener('click',e=>e.stopPropagation());
      sizeSlider.addEventListener('input',function(e){
        e.stopPropagation();
        const qTarget=S.questions.find(x=>x.id===this.dataset.qid);
        if(!qTarget) return;
        const next=parseInt(this.value)||100;
        qTarget.sizePercent=next;
        S.smartLayout=null;
        const valEl=li.querySelector('.q-size-val[data-qid="'+qTarget.id+'"]');
        if(valEl) valEl.textContent=next+'%';
      });
      sizeSlider.addEventListener('change',function(e){
        e.stopPropagation();
        saveSession();
      });
    }

    D.qList.appendChild(li);
  });

  if(typeof Sortable!=='undefined'&&n>0){
    Sortable.create(D.qList,{
      handle:'.q-drag',animation:130,ghostClass:'sortable-ghost',
      onEnd:function(e){
        const moved=S.questions.splice(e.oldIndex,1)[0];
        S.questions.splice(e.newIndex,0,moved);
        S.questions.forEach((q,i)=>{q.num=i+1;});
        S.smartLayout=null; S.smartOrder=null;
        updatePanel(); saveSession();
      },
    });
  }
}

/* ═══ PDF MODAL OPEN/CLOSE ══════════════════════════════════ */
function openPdfModal(){
  if(!S.pdf) return;
  if(D.pdfModal) D.pdfModal.classList.remove('hidden');
  if(D.homeEmpty) D.homeEmpty.classList.add('hidden');
  // Thumbnail şeridi: renderPage tamamlandıktan SONRA, ana thread boşken yükle
  // Daha uzun gecikme — PDF.js render pipeline'ı ile çakışmayı önler
  setTimeout(() => {
    if(S.pdf && S.pages > 1) buildPageStrip();
  }, 600);
}
function closePdfModal(){
  if(D.pdfModal) D.pdfModal.classList.add('hidden');
  hideFloat();
  // Ana ekran görünürlüğünü güncelle
  if(D.questionsGrid) D.questionsGrid.classList.toggle('hidden', S.questions.length===0);
  if(D.homeEmpty) D.homeEmpty.classList.toggle('hidden', !!S.pdf || S.questions.length>0);
}

/* ═══ SETTINGS DRAWER ══════════════════════════════════════ */
function openSettings(){
  if(D.settingsDrawer) D.settingsDrawer.classList.remove('hidden');
  if(D.settingsOverlay) D.settingsOverlay.classList.remove('hidden');
}
function closeSettings(){
  if(D.settingsDrawer) D.settingsDrawer.classList.add('hidden');
  if(D.settingsOverlay) D.settingsOverlay.classList.add('hidden');
}
G('btn-settings').addEventListener('click', openSettings);
G('btn-close-settings').addEventListener('click', closeSettings);
if(D.settingsOverlay) D.settingsOverlay.addEventListener('click', closeSettings);
G('btn-open-pdf').addEventListener('click', openPdfModal);
G('btn-close-pdf-modal').addEventListener('click', closePdfModal);

/* detectAll'ı modal tara butonuna da bağla */
if(D.btnDetectModal){
  D.btnDetectModal.addEventListener('click', detectAll);
}

/* ═══ DRAW MODE ════════════════════════════════════════════ */
function updateTouchAction(){
  // Her zaman none — pointer event'lerinin tarayıcıya geçmesini engelle
  // Kaydırma gerekirse JS ile yönetilir
  D.ovCvs.style.touchAction = 'none';
}
function enterDraw(){
  S.drawMode=true;
  D.ovCvs.style.cursor='crosshair';
  updateTouchAction();
  D.btnDraw.classList.add('active');
  D.btnSel.classList.remove('active');
  D.modeTag.textContent='CIZIM MODU';
  setStatus('Parmakla veya fareyle surukleyerek soru alani cizin -- ESC cik');
  hideFloat();
}
function enterSel(){
  S.drawMode=false; S.drawing=false; S.dRect=null;
  D.ovCvs.style.cursor='default';
  updateTouchAction();
  D.btnSel.classList.add('active');
  D.btnDraw.classList.remove('active');
  D.modeTag.textContent='SECIM MODU';
  setStatus('Secim modu -- bolgeye tiklayin/dokunun');
  redraw();
}
function finishDraw(){
  S.drawing=false;
  const dr=S.dRect;
  if(dr&&dr.w>10&&dr.h>8){
    // FIX #2: Çizilen bölgedeki gerçek PDF metnini çıkar
    const rawItems=S.rawItems[S.curPage]||[];
    const overlapping=rawItems.filter(it=>{
      return it.x+it.w > dr.x && it.x < dr.x+dr.w &&
             it.y+it.h > dr.y && it.y < dr.y+dr.h;
    });
    // Yukarıdan aşağıya, soldan sağa sırala
    overlapping.sort((a,b)=> a.y!==b.y ? a.y-b.y : a.x-b.x);
    const extractedText=overlapping.map(it=>it.str).join(' ').trim();
    const displayText=extractedText||('Manuel alan (S.'+S.curPage+')');
    const fullText=extractedText||displayText;

    const r={id:newRid(),page:S.curPage,x:dr.x,y:dr.y,w:dr.w,h:dr.h,
      text:displayText.slice(0,120),
      fullText:fullText,
      confirmed:false,manual:true,score:100,detectedScale:S.scale};
    S.regions.push(r); enterSel(); confirmRegion(r);
    toast('Manuel soru alanı eklendi'+(extractedText?' — metin tespit edildi':''),'success');
  }else{S.dRect=null;redraw();}
}

/* ═══ POINTER EVENTS ═══════════════════════════════════════ */
updateTouchAction();

D.ovCvs.addEventListener('pointermove',function(e){
  e.preventDefault();
  const p=clientToCanvas(e.clientX,e.clientY);

  if(S.resizing){
    const dx=p.x-S.resizing.ox, dy=p.y-S.resizing.oy;
    // incremental: her frame delta uygula, origin güncelle
    S.resizing.ox=p.x; S.resizing.oy=p.y;
    const r=S.resizing.r;
    if(S.resizing.handle==='move'){
      r.x=Math.max(0, r.x+dx);
      r.y=Math.max(0, r.y+dy);
    } else {
      const h=S.resizing.handle;
      if(h.includes('l')){ r.x+=dx; r.w=Math.max(20,r.w-dx); }
      if(h.includes('r')){ r.w=Math.max(20,r.w+dx); }
      if(h.includes('t')){ r.y+=dy; r.h=Math.max(20,r.h-dy); }
      if(h.includes('b')){ r.h=Math.max(20,r.h+dy); }
    }
    r.detectedScale=S.scale;
    S.smartLayout=null;
    redraw(); return;
  }

  if(S.drawing){
    S.dRect={x:Math.min(p.x,S.p0.x),y:Math.min(p.y,S.p0.y),
             w:Math.abs(p.x-S.p0.x),h:Math.abs(p.y-S.p0.y)};
    redraw(); return;
  }

  if(!S.drawMode&&S.active&&S.active.confirmed){
    const hn=hitHandle(p.x,p.y,S.active);
    if(hn) D.ovCvs.style.cursor=HANDLE_CURSOR[hn];
    else if(regionAt(p.x,p.y)) D.ovCvs.style.cursor='grab';
    else D.ovCvs.style.cursor='default';
  }
},{passive:false});

D.ovCvs.addEventListener('pointerdown',function(e){
  e.preventDefault();
  D.ovCvs.setPointerCapture(e.pointerId);
  const p=clientToCanvas(e.clientX,e.clientY);
  const hit=regionAt(p.x,p.y);

  /* S-Pen üst buton */
  if(e.pointerType==='pen'&&(e.buttons===2||e.buttons===3)&&S.spenMode){
    if(hit&&hit.confirmed){
      S.active=hit;
      const hn=hitHandle(p.x,p.y,hit);
      S.resizing={r:hit, handle:hn||'move', ox:p.x, oy:p.y};
      D.floatPanel.classList.add('hidden');
      if(navigator.vibrate) navigator.vibrate(20);
    } else {
      _pencilAutoMode=true; enterDraw();
      S.drawing=true; S.p0=p; S.dRect=null; hideFloat();
      if(navigator.vibrate) navigator.vibrate([15,10,15]);
    }
    return;
  }

  if(S.drawMode){
    S.drawing=true; S.p0=p; S.dRect=null; hideFloat(); return;
  }

  /* Seçim modu */
  if(hit&&hit.confirmed){
    // Her dokunuşta aktif yap ve hemen resize/move başlat
    S.active=hit;
    redraw(); // handle'ları göster
    const hn=hitHandle(p.x,p.y,hit);
    if(hn){
      // Kenar/köşe → resize
      S.resizing={r:hit, handle:hn, ox:p.x, oy:p.y};
      D.floatPanel.classList.add('hidden');
      if(navigator.vibrate) navigator.vibrate(15);
    } else {
      // İç alan → taşı (her zaman, PAD kontrolü yok)
      S.resizing={r:hit, handle:'move', ox:p.x, oy:p.y};
      D.floatPanel.classList.add('hidden');
      D.ovCvs.style.cursor='grabbing';
      if(navigator.vibrate) navigator.vibrate(15);
    }
    return;
  }

  hideFloat(); S.active=null; redraw();
},{passive:false});

D.ovCvs.addEventListener('pointerup',function(e){
  e.preventDefault();
  const p=clientToCanvas(e.clientX,e.clientY);

  if(S.resizing){
    // Son delta uygula
    const dx=p.x-S.resizing.ox, dy=p.y-S.resizing.oy;
    const r=S.resizing.r;
    if(Math.abs(dx)>1||Math.abs(dy)>1){
      if(S.resizing.handle==='move'){
        r.x=Math.max(0,r.x+dx); r.y=Math.max(0,r.y+dy);
      } else {
        const h=S.resizing.handle;
        if(h.includes('l')){ r.x+=dx; r.w=Math.max(20,r.w-dx); }
        if(h.includes('r')){ r.w=Math.max(20,r.w+dx); }
        if(h.includes('t')){ r.y+=dy; r.h=Math.max(20,r.h-dy); }
        if(h.includes('b')){ r.h=Math.max(20,r.h+dy); }
      }
      r.detectedScale=S.scale; S.smartLayout=null;
    }
    const fin=S.resizing.r;
    S.resizing=null;
    D.ovCvs.style.cursor='default';
    // dx/dy çok küçükse tap → float panel göster
    if(Math.abs(dx)<5&&Math.abs(dy)<5) showFloat(fin);
    saveSession(); redraw(); return;
  }

  if(S.drawing){finishDraw();return;}

  const r=regionAt(p.x,p.y);
  if(r) showFloat(r); else hideFloat();
},{passive:false});

D.ovCvs.addEventListener('pointercancel',function(e){
  e.preventDefault();
  if(S.resizing){
    saveSession();
    S.resizing=null; redraw();
  }
  if(S.drawing){S.drawing=false;S.dRect=null;redraw();}
},{passive:false});


D.btnOk.addEventListener('click',function(){confirmRegion(S.active);});
D.btnDel.addEventListener('click',function(){removeRegion(S.active);});
const btnEditRegion=G('btn-edit-region');
if(btnEditRegion) btnEditRegion.addEventListener('click',function(){
  if(S.active) openRegionEditor(S.active);
});
if(D.btnRedraw) D.btnRedraw.addEventListener('click',function(){
  const r=S.active;
  if(!r) return;
  // Bölgeyi kaldır, çizim moduna geç — kullanıcı yeniden çizebilir
  const wasConfirmed=r.confirmed;
  removeRegion(r);
  toast('Yeniden çizmek için S-Pen ile sürükle','info',2500);
  enterDraw();
  if(navigator.vibrate) navigator.vibrate([20,10,20]);
});

/* ═══ REGION TO IMAGE ══════════════════════════════════════ */
/* ═══ REGION TO IMAGE — YÜksek Kalite ════════════════════
   exportScale: PDF.js render ölçeği
   - Varsayılan: 5.0 → ~300 DPI @ A4 (72 dpi * 5 / 1.2 ≈ 300)
   - Layout hesabı için düşük ölçek kullanılır, PDF'e yüksek ölçek
   autoCrop: beyaz/boş kenarları otomatik kırp
════════════════════════════════════════════════════════════ */
/* ═══ regionImg SAYFA ÖNBELLEĞİ ════════════════════════════
   Aynı sayfa + ölçek kombinasyonu tekrar render edilmeyecek.
   generateA4'te 2 sütunlu sayfada 4 soru aynı sayfadan geliyorsa
   page.render() sadece 1 kez çağrılır → 4x hız artışı.
   Önbellek her PDF/scale değişiminde temizlenir.
══════════════════════════════════════════════════════════ */
const _renderPageCache = new Map(); // 'pageNum:scale' → canvas

function clearRenderPageCache(){ _renderPageCache.clear(); }

async function _getRenderedPage(pageNum, exportScale, pdfId){
  const key = `${pdfId||'active'}:${pageNum}:${exportScale}`;
  if(_renderPageCache.has(key)) return _renderPageCache.get(key);
  // Doğru PDF nesnesini bul (çoklu havuz desteği)
  let pdfDoc = S.pdf;
  if(pdfId && pdfId !== S.activePdfId){
    const entry = S.pdfPool.find(p=>p.id===pdfId);
    if(entry && entry.pdf) pdfDoc = entry.pdf;
  }
  const page = await pdfDoc.getPage(pageNum);
  const vp = page.getViewport({scale: exportScale});
  const tmp = document.createElement('canvas');
  tmp.width = Math.round(vp.width); tmp.height = Math.round(vp.height);
  const ctx = tmp.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, tmp.width, tmp.height);
  await page.render({canvasContext: ctx, viewport: vp}).promise;
  _renderPageCache.set(key, {canvas: tmp, ctx, vp});
  return _renderPageCache.get(key);
}

async function regionImg(region, exportScale, autoCrop){
  if(exportScale===undefined) exportScale=5.0;
  if(autoCrop===undefined) autoCrop=true;

  const srcScale = region.detectedScale || S.scale;
  const {canvas: tmp, ctx: tmpCtx, vp} = await _getRenderedPage(region.page, exportScale, region.pdfId);

  const f=exportScale/srcScale;
  let sx=Math.max(0, Math.round(region.x*f));
  let sy=Math.max(0, Math.round(region.y*f));
  let sw=Math.min(Math.round(region.w*f), tmp.width-sx);
  let sh=Math.min(Math.round(region.h*f), tmp.height-sy);
  if(sw<1||sh<1) return null;

  // Auto-crop: piksel bazlı içerik bbox bul, beyaz/boş kenarları kırp
  if(autoCrop && sw>4 && sh>4){
    const imgData=tmpCtx.getImageData(sx, sy, sw, sh);
    const d=imgData.data;
    const W=sw, H=sh;
    const THRESH=230; // bu değerin altı "içerik" sayılır (agresif kırpma)
    let top=H, bottom=0, left=W, right=0;
    for(let y=0;y<H;y++){
      for(let x=0;x<W;x++){
        const i=(y*W+x)*4;
        const bright=(d[i]+d[i+1]+d[i+2])/3;
        if(bright<THRESH||d[i+3]<200){
          if(y<top) top=y;
          if(y>bottom) bottom=y;
          if(x<left) left=x;
          if(x>right) right=x;
        }
      }
    }
    if(top<bottom && left<right){
      const PAD=Math.round(exportScale*1); // 1mm padding (minimal kenar boşluğu)
      top=Math.max(0, top-PAD);
      bottom=Math.min(H-1, bottom+PAD);
      left=Math.max(0, left-PAD);
      right=Math.min(W-1, right+PAD);
      sx+=left; sy+=top;
      sw=right-left+1; sh=bottom-top+1;
    }
  }

  const crop=document.createElement('canvas');
  crop.width=Math.round(sw); crop.height=Math.round(sh);
  const cropCtx=crop.getContext('2d');
  cropCtx.fillStyle='#ffffff';
  cropCtx.fillRect(0,0,crop.width,crop.height);
  cropCtx.drawImage(tmp, sx, sy, sw, sh, 0, 0, crop.width, crop.height);

  // mm hesabı: jsPDF 72dpi baz alır, exportScale kadar büyütülmüş
  const pxPerMm=(72*exportScale)/25.4;
  return{
    dataUrl: crop.toDataURL('image/png', 1.0), // maksimum PNG kalitesi
    mmW: sw/pxPerMm,
    mmH: sh/pxPerMm,
  };
}


/* ═══ PDF ÇIKTI KALİTESİ — ÖLÇEK SEÇİCİ ══════════════════
   low  ≈ 150 DPI  (scale 2.2) — hızlı, küçük dosya
   mid  ≈ 200 DPI  (scale 2.8) — varsayılan
   high ≈ 300 DPI  (scale 4.2) — kaliteli baskı
   ultra≈ 400 DPI  (scale 5.6) — maksimum
   A6 kartlar için 1 adım düşük kullanılır.
════════════════════════════════════════════════════════════ */
function getExportScale(forA6){
  const q = S.exportQuality||'mid';
  const map = { low:2.2, mid:2.8, high:4.2, ultra:5.6 };
  let sc = map[q] || 2.8;
  if(forA6) sc = Math.max(2.0, sc * 0.85); // A6 için biraz düşür
  return sc;
}

/* ═══ LAYOUT ENGINE — BOSLUK DUZELTMESI ════════════════════
  BADGE_H (rozet yuksekligi) layout hesabina dahil edildi.
  sp degeri gercek mm boslugunu temsil eder.
════════════════════════════════════════════════════════════ */
const A4W=210,A4H=297,HDRH=20,FTRH=6,BADGE_H=5;

/* ═══ TÜRKÇE KARAKTER DESTEĞİ ══════════════════════════════
   jsPDF'in built-in helvetica/times fontları Latin-1 encoding
   kullanır; Türkçe özgü harfleri desteklemez. Bu nedenle PDF
   oluşturulmadan önce Noto Sans fontunu base64 olarak yükleyip
   tüm pdf.text() çağrılarında bu fontu kullanıyoruz.
   Font yükleme başarısız olursa güvenli ASCII transliterasyon
   yedek olarak devreye girer.
════════════════════════════════════════════════════════════ */
// Türkçe → ASCII güvenli transliterasyon (font yüklenemezse yedek)
function trSafe(str){
  if(typeof str!=='string') return String(str);
  return str
    .replace(/İ/g,'I').replace(/ı/g,'i')
    .replace(/Ğ/g,'G').replace(/ğ/g,'g')
    .replace(/Ü/g,'U').replace(/ü/g,'u')
    .replace(/Ş/g,'S').replace(/ş/g,'s')
    .replace(/Ö/g,'O').replace(/ö/g,'o')
    .replace(/Ç/g,'C').replace(/ç/g,'c');
}

/* ═══ TÜRKÇE KARAKTER — CANVAS-BASED PDF METİN RENDER ══════
   KÖK NEDEN: woff formatı TTF olarak jsPDF'e verilince bozuk
   okunoyor; jsPDF binary format ayrımı yapamıyor.
   
   ÇÖZÜM: Başlık bandı, sınav bilgisi ve cevap anahtarı başlığı
   artık canvas'a çizilip PNG olarak PDF'e ekleniyor.
   Browser'ın kendi font motoru Türkçe karakterleri mükemmel render eder.
   Soru görselleri zaten bu yöntemle ekleniyordu.
   
   pdfText() ve ensurePdfFont() sadece soru numarası gibi ASCII-only
   kısa metinler için kalıyor — bunlar zaten Türkçe karakter içermiyor.
════════════════════════════════════════════════════════════ */
const _pdfFontState={ name:'helvetica', loaded:true, loading:false };
async function ensurePdfFont(pdf){
  pdf.setFont('helvetica','normal');
}
function pdfText(str){ return String(str); }

/* PDF başlık bandını canvas olarak render et → PNG → addImage
   W, H: mm cinsinden boyut; SC: px/mm dpi çarpanı            */
async function renderTextBandToPng(textLeft, textRight, bgHex, fgHex, fontSizePt, widthMm, heightMm){
  // DPI=6 → ~152 DPI net görüntü (eskiden 3.5 → 89 DPI bulanıktı)
  const DPI = 6;
  const W = Math.round(widthMm * DPI);
  const H = Math.round(heightMm * DPI);
  const cvs = document.createElement('canvas');
  cvs.width = W; cvs.height = H;
  const ctx = cvs.getContext('2d');

  // Arka plan
  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, W, H);

  // DÜZELTME: pt → px doğru dönüşüm
  // 1pt = 1/72 inch, 1mm = 1/25.4 inch → 1pt = 25.4/72 mm
  // canvas px = fontPt * (25.4/72) * DPI
  const fsPx = fontSizePt * (25.4 / 72) * DPI;
  ctx.fillStyle = fgHex;
  ctx.font = `bold ${fsPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textBaseline = 'middle';

  if(textLeft){
    ctx.textAlign = 'left';
    ctx.fillText(textLeft, 14 * DPI, H / 2);
  }
  if(textRight){
    ctx.textAlign = 'right';
    ctx.fillText(textRight, W - 14 * DPI, H / 2);
  }

  return cvs.toDataURL('image/png');
}

/* Sınav bilgi bandını canvas ile çiz (Ders | Sınıf | Tarih) */
async function renderExamInfoBandToPng(widthMm, heightMm){
  const info=S.examInfo;
  if(!info.lesson&&!info.className&&!info.date) return null;
  const parts=[];
  if(info.lesson)     parts.push('Ders: '+info.lesson);
  if(info.className)  parts.push('Sınıf: '+info.className);
  if(info.date)       parts.push('Tarih: '+info.date);
  const text=parts.join('   |   ');

  const DPI = 6;
  const W = Math.round(widthMm * DPI);
  const H = Math.round(heightMm * DPI);
  const cvs = document.createElement('canvas');
  cvs.width = W; cvs.height = H;
  const ctx = cvs.getContext('2d');

  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, H-0.5); ctx.lineTo(W, H-0.5); ctx.stroke();

  // 8pt → doğru px
  const fsPx = 8 * (25.4 / 72) * DPI;
  ctx.fillStyle = '#555';
  ctx.font = `${fsPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(text, 14 * DPI, H / 2);

  return cvs.toDataURL('image/png');
}
function getMRG(){ return S.mrg; }

/* ═══ TÜM PDF HAVUZUNDA BÖLGE BUL ══════════════════════════
   S.regions sadece aktif PDF'in bölgelerini içerir.
   Çoklu PDF'ten seçilen sorularda diğer PDF'lerin bölgelerine
   bu fonksiyon üzerinden erişilir.
════════════════════════════════════════════════════════════ */
function findRegionById(rid){
  // Önce aktif PDF'te ara
  let r = S.regions.find(x=>x.id===rid);
  if(r) return r;
  // Bulunamazsa tüm havuzda ara
  for(const entry of S.pdfPool){
    r = entry.regions && entry.regions.find(x=>x.id===rid);
    if(r) return r;
  }
  return null;
}

function getLAY(){
  const m=S.mrg;
  const colW=(A4W-m.left-m.right-m.col)/2;
  // Kullanılabilir yükseklik: başlangıç y'si (MRG_T+HDRH) ile alt sınır (A4H-MRG_B-FTRH) arası
  // usableH, curY ile karşılaştırılacak mutlak alt sınır olarak kullanılıyor
  const contentStart=m.top+HDRH;           // örn. 6+20 = 26mm
  const contentEnd=A4H-m.bottom-FTRH;      // örn. 297-8-6 = 283mm
  const usableH=contentEnd-contentStart;   // örn. 283-26 = 257mm (net alan)
  return{colW,usableH,contentStart,contentEnd,MRG_L:m.left,MRG_R:m.right,MRG_T:m.top,MRG_B:m.bottom,CGAP:m.col};
}

async function buildLayoutN(questions, spacing, colCount, extraTopOffset){
  colCount=colCount||2;
  extraTopOffset=extraTopOffset||0;
  const lay=getLAY();
  const totalColW=(A4W-lay.MRG_L-lay.MRG_R-(colCount-1)*lay.CGAP)/colCount;
  const effectiveStart=lay.contentStart+extraTopOffset;
  const items=[];
  for(const q of questions){
    const r=findRegionById(q.rid);
    if(!r)continue;
    // autoCrop=true ile boyut hesapla — PDF basımıyla tutarlı olsun
    const img=await regionImg(r, 2.0, true);
    if(!img)continue;
    const sp100=(q.sizePercent||100)/100;
    // Sütun genişliğini tam doldur, sizePercent ile ölçekle
    const _baseW = totalColW * sp100;
    const _baseH = img.mmH * (_baseW / img.mmW);
    let dW = Math.min(_baseW, totalColW);
    let dH = _baseH * (dW / _baseW);
    const maxH = lay.usableH * 0.92;
    if(dH > maxH){ dH = maxH; dW = img.mmW * (dH / img.mmH); dW = Math.min(dW, totalColW); }
    items.push({q, r, img, dW, dH});
  }
  const sp=Math.max(2,spacing||6);
  const pages=[];
  const newPage=function(){
    const cols=[];
    for(let c=0;c<colCount;c++) cols.push({items:[],curY:effectiveStart});
    return{cols};
  };
  let cur=newPage(); pages.push(cur);
  for(const item of items){
    const blockH=BADGE_H+item.dH+sp;
    let placed=false;
    for(let c=0;c<colCount;c++){
      if(cur.cols[c].curY+blockH<=lay.contentEnd){
        cur.cols[c].items.push({item,y:cur.cols[c].curY,col:c});
        cur.cols[c].curY+=blockH;
        placed=true; break;
      }
    }
    if(!placed){
      cur=newPage(); pages.push(cur);
      cur.cols[0].items.push({item,y:cur.cols[0].curY,col:0});
      cur.cols[0].curY+=blockH;
    }
  }
  return pages;
}

async function buildLayout(questions,spacing){
  return buildLayoutN(questions,spacing,2);
}

async function buildSmartLayout(){
  const sorted=[...S.questions].sort(function(a,b){
    const ra=S.regions.find(x=>x.id===a.rid);
    const rb=S.regions.find(x=>x.id===b.rid);
    return(rb?rb.h:0)-(ra?ra.h:0);
  });
  setLoading(true,'Akilli duzen hesaplaniyor...');
  const sp=parseInt(D.spacingIn.value)||6;
  const pages=await buildLayout(sorted,sp);
  S.smartLayout=pages;
  S.smartOrder=sorted; // A6 ve diğer çıktılar için aynı sırayı sakla
  setLoading(false);
  return pages;
}

/* ═══ PREVIEW ══════════════════════════════════════════════ */
async function openPreview(){
  if(!S.questions.length){toast('Once soru secin','error');return;}
  setLoading(true,'Onizleme olusturuluyor...');
  try{
    S.previewPages=[];
    if(S.outMode==='a6'){
      await buildPreviewA6();
    } else {
      await buildPreviewA4(); // a4 / a4-1col / a4-3col hepsini buildPreviewA4 halleder
    }
    S.previewIdx=0;
    showPreviewPage(0);
    D.previewModal.classList.remove('hidden');
  }catch(e){console.error(e);toast('Onizleme hatasi: '+e.message,'error');}
  finally{setLoading(false);}
}

/* A4 onizleme */
async function buildPreviewA4(){
  const sp=Math.max(2,parseInt(D.spacingIn.value)||6);
  const colCount=S.outMode==='a4-1col'?1:S.outMode==='a4-3col'?3:2;
  const lay=getLAY();
  const totalColW=(A4W-lay.MRG_L-lay.MRG_R-(colCount-1)*lay.CGAP)/colCount;
  // smartLayout farklı colCount ile oluşturulmuş olabilir — kontrol et
  const _sl = S.smartLayout;
  const _slCols = _sl ? (_sl[0]?.cols?.length||0) : 0;
  const pages = (_sl && _slCols===colCount) ? _sl : await buildLayoutN(S.questions,sp,colCount,getStudentRowOffset());
  // HiDPI önizleme: SC=3.5 → retina/yüksek çözünürlük ekranlar için
  const SC=3.5;
  let qn=0;
  let _previewQn=0; // FIX #1: önizleme ilerleme sayacı
  for(let pi=0;pi<pages.length;pi++){
    const pg=pages[pi];
    const cvs=document.createElement('canvas');
    cvs.width=Math.round(A4W*SC); cvs.height=Math.round(A4H*SC);
    const ctx=cvs.getContext('2d');
    ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,cvs.width,cvs.height);
    ctx.fillStyle=S.hdr.bg; ctx.fillRect(0,0,cvs.width,HDRH*SC);
    ctx.fillStyle=S.hdr.color; ctx.font='bold '+(S.hdr.fontSize*SC)+'px '+S.hdr.font+',sans-serif';
    ctx.textBaseline='middle';
    ctx.fillText(S.hdr.text,lay.MRG_L*SC,HDRH*SC*0.5);
    // Sınav bilgi bandı önizleme
    if(S.examInfo.lesson||S.examInfo.className||S.examInfo.date){
      const eY=HDRH*SC; const eH=10*SC;
      ctx.fillStyle='#f5f5f5'; ctx.fillRect(0,eY,cvs.width,eH);
      ctx.strokeStyle='#ddd'; ctx.lineWidth=0.5; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(0,eY+eH); ctx.lineTo(cvs.width,eY+eH); ctx.stroke();
      const parts=[]; 
      if(S.examInfo.lesson) parts.push('Ders: '+S.examInfo.lesson);
      if(S.examInfo.className) parts.push('Sınıf: '+S.examInfo.className);
      if(S.examInfo.date) parts.push('Tarih: '+S.examInfo.date);
      ctx.fillStyle='#555'; ctx.font=(7*SC)+'px '+S.hdr.font+',sans-serif';
      ctx.textBaseline='middle'; ctx.textAlign='left';
      ctx.fillText(parts.join('   |   '), lay.MRG_L*SC, eY+eH/2);
    }
    // Watermark önizleme (metin)
    if(S.watermark.enabled && S.watermark.text){
      ctx.save();
      ctx.globalAlpha=S.watermark.opacity||0.12;
      ctx.fillStyle='#888';
      ctx.font='bold '+(28*SC)+'px '+S.hdr.font+',sans-serif';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.translate(cvs.width/2, cvs.height/2);
      ctx.rotate(-Math.PI/5);
      ctx.fillText(S.watermark.text,0,0);
      ctx.restore();
    }
    // Öğrenci bilgi satırı önizleme
    if(S.hdr.studentInfo){
      const sY=HDRH*SC+2*SC;
      const sH=STUDENT_ROW_H*SC;
      const sX=lay.MRG_L*SC;
      const sW=(A4W-lay.MRG_L-lay.MRG_R)*SC;
      ctx.strokeStyle='#ccc'; ctx.lineWidth=1; ctx.setLineDash([]);
      ctx.strokeRect(sX, sY, sW, sH);
      const fields=[{label:'Ad Soyad',w:0.45},{label:'Sınıf',w:0.25},{label:'Tarih',w:0.30}];
      let curX=sX;
      ctx.fillStyle='#999'; ctx.font='bold '+(6*SC)+'px '+S.hdr.font+',sans-serif';
      ctx.textBaseline='top'; ctx.textAlign='left';
      fields.forEach((f,i)=>{
        const fw=sW*f.w;
        ctx.fillText(f.label+':', curX+4*SC, sY+4*SC);
        ctx.strokeStyle='#bbb'; ctx.lineWidth=0.5;
        ctx.beginPath(); ctx.moveTo(curX+18*SC, sY+sH-5*SC); ctx.lineTo(curX+fw-4*SC, sY+sH-5*SC); ctx.stroke();
        if(i<fields.length-1){
          ctx.strokeStyle='#ccc'; ctx.lineWidth=1;
          ctx.beginPath(); ctx.moveTo(curX+fw, sY); ctx.lineTo(curX+fw, sY+sH); ctx.stroke();
        }
        curX+=fw;
      });
    }
    // Sütun ayırıcı çizgiler
    const _cd=S.colDivider||{};
    const _cdStyle=_cd.style||'solid';
    if(_cdStyle!=='none'){
      const _rgb=_cd.color||'#000000';
      ctx.strokeStyle=_rgb; ctx.lineWidth=(_cd.width||0.4)*SC;
      if(_cdStyle==='dashed') ctx.setLineDash([4*SC,3*SC]);
      else if(_cdStyle==='dotted') ctx.setLineDash([1*SC,3*SC]);
      else ctx.setLineDash([]);
      for(let c=1;c<colCount;c++){
        // Center text varsa bu sütun çizgisini çizme (center text bloğunda parça çizilir)
        if(colCount===2 && c===1 && _cd.centerText) continue;
        const lx=(lay.MRG_L+c*(totalColW+lay.CGAP)-lay.CGAP/2)*SC;
        ctx.beginPath(); ctx.moveTo(lx,HDRH*SC); ctx.lineTo(lx,cvs.height-FTRH*SC); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    // Orta şerit metni (2 sütun + metin varsa) — çizgi ortada bölünür
    if(colCount===2 && _cd.centerText){
      const lx=(lay.MRG_L+1*(totalColW+lay.CGAP)-lay.CGAP/2)*SC;
      const lineY=HDRH*SC, lineEnd=cvs.height-FTRH*SC;
      const midY=(lineY+lineEnd)/2;
      const fs=_cd.centerTextSize||7;
      const charH=fs*(25.4/72)*SC; // 1 karakter yüksekliği px
      // Dikey metin: görünür yükseklik = karakter genişliği × karakter sayısı
      const txtH=_cd.centerText.length*charH*0.6;
      const charGap=charH*(_cd.centerGap||2)*0.6;
      const txtTop=midY-txtH/2;
      const txtBot=midY+txtH/2;
      const stripW=lay.CGAP*SC;

      // Beyaz arka plan — sadece metin kadar
      ctx.fillStyle='#ffffff';
      ctx.fillRect(lx-stripW/2, txtTop, stripW, txtH);

      // Çizgi üst parça
      if(_cdStyle!=='none' && lineY < txtTop-charGap){
        ctx.beginPath(); ctx.moveTo(lx, lineY); ctx.lineTo(lx, txtTop-charGap); ctx.stroke();
      }
      // Çizgi alt parça
      if(_cdStyle!=='none' && txtBot+charGap < lineEnd){
        ctx.beginPath(); ctx.moveTo(lx, txtBot+charGap); ctx.lineTo(lx, lineEnd); ctx.stroke();
      }

      // Döndürülmüş metin
      ctx.save();
      ctx.translate(lx, midY);
      ctx.rotate(-Math.PI/2);
      const _fsPx=fs*(25.4/72)*SC;
      ctx.font=_fsPx+'px '+(S.hdr.font||'sans-serif')+',sans-serif';
      ctx.fillStyle=_cd.centerTextColor||'#888888';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(_cd.centerText, 0, 0);
      ctx.restore();
    }
    const allItems=[];
    for(let c=0;c<colCount;c++){const col=pg.cols[c];if(col)col.items.forEach(ei=>allItems.push(ei));}
    allItems.sort((a,b)=>a.col!==b.col?a.col-b.col:a.y-b.y);
    for(const entry of allItems){
      const item=entry.item, y=entry.y, col=entry.col;
      const colX=(lay.MRG_L+col*(totalColW+lay.CGAP))*SC;
      const iy=y*SC, bH=BADGE_H*SC;
      const _qnFsPx=(S.hdr.fontSize||7)*(25.4/72)*SC;
      ctx.font='bold '+_qnFsPx+'px '+(S.hdr.font||'sans-serif')+',sans-serif';
      ctx.textAlign='left'; ctx.textBaseline='middle';
      ctx.fillStyle='#111';
      ctx.fillText(''+(++qn)+'.',colX,iy+bH/2);
      // Önizleme için orta kalite (3.0) — HiDPI ekranda net görünür
      setLoading(true, `Önizleme hazırlanıyor... ${++_previewQn}/${S.questions.length} soru`); // FIX #1
      // Preview: sütun genişliğine orantılı ölçek (SC=3.5, totalColW mm → px)
      const _pvScale = Math.min(Math.max((totalColW / 50) * 2.5, 2.0), 5.0);
      const previewImg=await regionImg(item.r, _pvScale, true);
      if(previewImg){
        const imgEl=new Image();
        await new Promise(r=>{imgEl.onload=imgEl.onerror=r; imgEl.src=previewImg.dataUrl;});
        // Gerçek kırpılmış boyutu kullan + sizePercent uygula
        const _sp=(item.q.sizePercent||100)/100;
        // Sütun genişliğini tam doldur + sizePercent ile ölçekle
        const _pvFW=totalColW*_sp;
        const _pvFH=previewImg.mmH*(_pvFW/previewImg.mmW);
        let pvW=Math.min(_pvFW,totalColW);
        let pvH=_pvFH*(pvW/_pvFW);
        const pvMaxH=lay.usableH*0.92;
        if(pvH>pvMaxH){pvH=pvMaxH;pvW=previewImg.mmW*(pvH/previewImg.mmH);pvW=Math.min(pvW,totalColW);}
        ctx.drawImage(imgEl,colX,iy+bH,pvW*SC,pvH*SC);
      }
      // Puan kutusu önizleme
      if(S.scoreBox){
        ctx.strokeStyle='#aaa'; ctx.lineWidth=0.6;
        ctx.strokeRect(colX+totalColW*SC-18*SC, iy+bH+item.dH*SC-7*SC, 16*SC, 6*SC);
        ctx.fillStyle='#bbb'; ctx.font=(2.8*SC)+'px Outfit,sans-serif';
        ctx.textBaseline='middle';
        ctx.fillText('puan', colX+totalColW*SC-17*SC, iy+bH+item.dH*SC-4*SC);
      }
    }
    ctx.fillStyle='#ccc'; ctx.font=(6.5*SC)+'px Outfit,sans-serif';
    ctx.textAlign='center'; ctx.textBaseline='alphabetic';
    ctx.fillText('\u2014 '+(pi+1)+' \u2014',cvs.width/2,(A4H-2.5)*SC);
    S.previewPages.push(cvs.toDataURL('image/png'));
  }
}

/* A6 onizleme: her soru ayri kart — generateA6 ile birebir uyumlu (başlıksız) */
async function buildPreviewA6(){
  const PW=148, PH=105, M=8;
  const SC=3.0;
  // generateA6 ile aynı: availW=PW-M*2, availH=PH-M*2 (başlık yok)
  const availW=PW-M*2, availH=PH-M*2;
  const questions=S.smartOrder||S.questions;
  for(let i=0;i<questions.length;i++){
    const q=questions[i];
    const r=findRegionById(q.rid);
    if(!r)continue;
    const img=await regionImg(r,4.0);
    if(!img)continue;
    const sp6=(q.sizePercent||100)/100;
    const _a6W=img.mmW*sp6, _a6H=img.mmH*sp6;
    const sc=Math.min(availW/_a6W, availH/_a6H, 1);
    const iW=_a6W*sc, iH=_a6H*sc;
    // generateA6 ile aynı: ix=(PW-iW)/2, iy=M+(availH-iH)/2
    const ix=(PW-iW)/2;
    const iy=M+(availH-iH)/2;
    const cvs=document.createElement('canvas');
    cvs.width=Math.round(PW*SC); cvs.height=Math.round(PH*SC);
    const ctx=cvs.getContext('2d');
    ctx.fillStyle='#f8f7f5'; ctx.fillRect(0,0,cvs.width,cvs.height);
    ctx.strokeStyle='#dddbd8'; ctx.lineWidth=1;
    ctx.strokeRect(0.5,0.5,cvs.width-1,cvs.height-1);
    // Başlık bandı YOK — generateA6 ile uyumlu
    // Sol üst: soru no / toplam — seçilen font ve boyutla (generateA6 ile aynı)
    const _fsPx = (S.hdr.fontSize||8.5) * (25.4/72) * SC;
    ctx.fillStyle='rgba(80,80,80,0.9)';
    ctx.font='bold '+_fsPx+'px '+(S.hdr.font||'sans-serif')+',sans-serif';
    ctx.textAlign='left'; ctx.textBaseline='alphabetic';
    ctx.fillText(''+(i+1)+'/'+(questions.length), (M+1)*SC, (M-1.5)*SC);
    // Soru görseli
    const imgEl=new Image();
    await new Promise(function(res){imgEl.onload=imgEl.onerror=res; imgEl.src=img.dataUrl;});
    ctx.drawImage(imgEl,ix*SC,iy*SC,iW*SC,iH*SC);
    // Üst/alt çizgiler — sayfanın üst/alt margin'inde (generateA6 ile aynı)
    ctx.strokeStyle='#b8b5b0'; ctx.lineWidth=0.8; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(M*SC,M*SC); ctx.lineTo((PW-M)*SC,M*SC); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(M*SC,(PH-M)*SC); ctx.lineTo((PW-M)*SC,(PH-M)*SC); ctx.stroke();
    S.previewPages.push(cvs.toDataURL('image/png'));
  }
}


function showPreviewPage(idx){
  if(!S.previewPages.length)return;
  idx=Math.max(0,Math.min(idx,S.previewPages.length-1));
  S.previewIdx=idx;
  const img=new Image();
  img.onload=function(){
    D.previewCvs.width=img.width; D.previewCvs.height=img.height;
    D.previewCvs.getContext('2d').drawImage(img,0,0);
    D.previewCvs.style.maxWidth='100%';
    D.previewCvs.style.maxHeight='65vh';
  };
  img.src=S.previewPages[idx];
  // Numara input + toplam
  const inp=G('preview-page-input'), tot=G('preview-page-total');
  if(inp){ inp.value=idx+1; inp.max=S.previewPages.length; }
  if(tot) tot.textContent='/ '+S.previewPages.length;
  D.btnPrevPrev.disabled=idx<=0;
  D.btnNextPrev.disabled=idx>=S.previewPages.length-1;
  D.modalInfo.textContent=S.questions.length+' soru';
  _updatePreviewSortList();
  // #6: Önizleme sıralama listesini güncelle
  _buildPreviewSortList();
  // #6: Sayfayı PNG olarak indir butonu
  const dlBtn=G('btn-dl-preview-page');
  if(dlBtn) dlBtn.onclick=()=>{
    const src=S.previewPages[S.previewIdx];
    if(!src) return;
    const a=document.createElement('a');
    a.href=src;
    a.download=`sayfa_${S.previewIdx+1}.png`;
    a.click();
  };
}

D.btnPrevPrev.addEventListener('click',function(){showPreviewPage(S.previewIdx-1);});

/* ═══ ÖNIZLEME SIRALAMA PANELI ══════════════════════════ */
function _updatePreviewSortList(){
  const ul = G('preview-sort-list');
  if(!ul) return;
  ul.innerHTML = '';
  S.questions.forEach(function(q, i){
    const li = document.createElement('li');
    li.className = 'psort-item';
    li.dataset.qid = q.id;
    li.innerHTML =
      '<span class="psort-drag">⠿</span>' +
      '<span class="psort-num">' + (i+1) + '.</span>' +
      '<span class="psort-text">' + esc(q.text.slice(0,40)) + '</span>';
    ul.appendChild(li);
  });
  if(typeof Sortable !== 'undefined'){
    if(ul._sortable) ul._sortable.destroy();
    ul._sortable = Sortable.create(ul, {
      handle: '.psort-drag',
      animation: 150,
      ghostClass: 'psort-ghost',
      onEnd: async function(e){
        if(e.oldIndex === e.newIndex) return;
        const moved = S.questions.splice(e.oldIndex, 1)[0];
        S.questions.splice(e.newIndex, 0, moved);
        S.questions.forEach(function(q,i){ q.num = i+1; });
        S.smartLayout = null; S.smartOrder = null;
        saveSession();
        // Önizlemeyi yeniden oluştur
        setLoading(true, 'Sıralama güncelleniyor…');
        try {
          S.previewPages = [];
          if(S.outMode==='a6') await buildPreviewA6();
          else await buildPreviewA4();
          showPreviewPage(0);
        } catch(err){ toast('Güncelleme hatası: '+err.message,'error'); }
        finally { setLoading(false); }
      }
    });
  }
}

(function(){
  const toggleBtn = G('btn-preview-sort-toggle');
  const sidebar = G('preview-sort-sidebar');
  if(toggleBtn && sidebar){
    toggleBtn.addEventListener('click', function(){
      const hidden = sidebar.classList.toggle('hidden');
      toggleBtn.classList.toggle('active', !hidden);
      // Açıldığında listeyi güncelle (hidden'da Sortable çalışmayabilir)
      if(!hidden) _updatePreviewSortList();
    });
  }
})();

/* ─── #6: Önizleme sıralama paneli ─── */
function _buildPreviewSortList(){
  const container=G('preview-sort-list');
  if(!container) return;
  container.innerHTML='';
  S.questions.forEach(function(q,i){
    const item=document.createElement('div');
    item.className='prev-sort-item';
    item.dataset.qid=q.id;
    item.innerHTML=
      '<span class="prev-sort-num">'+(i+1)+'</span>'+
      '<span class="prev-sort-drag">⠿</span>'+
      '<span class="prev-sort-text">'+esc(q.text.slice(0,50))+'</span>';
    container.appendChild(item);
  });
  if(typeof Sortable!=='undefined'){
    Sortable.create(container,{
      handle:'.prev-sort-drag',
      animation:120,
      ghostClass:'sortable-ghost',
      onEnd:function(e){
        const moved=S.questions.splice(e.oldIndex,1)[0];
        S.questions.splice(e.newIndex,0,moved);
        S.questions.forEach(function(q,i){q.num=i+1;});
        S.smartLayout=null; S.smartOrder=null;
        // Önizlemeyi yeniden oluştur
        openPreview();
        saveSession();
      },
    });
  }
}
D.btnNextPrev.addEventListener('click',function(){showPreviewPage(S.previewIdx+1);});
D.btnClosePreview.addEventListener('click',function(){D.previewModal.classList.add('hidden');});
D.btnClosePreview2.addEventListener('click',function(){D.previewModal.classList.add('hidden');});

/* Sayfa numarası input: Enter veya blur ile git */
(function(){
  const inp=G('preview-page-input');
  if(!inp)return;
  function goToInputPage(){
    const v=parseInt(inp.value);
    if(!isNaN(v)) showPreviewPage(v-1);
  }
  inp.addEventListener('keydown',function(e){
    if(e.key==='Enter'){e.preventDefault();goToInputPage();inp.blur();}
    if(e.key==='Escape'){e.preventDefault();inp.value=S.previewIdx+1;inp.blur();}
  });
  inp.addEventListener('blur', goToInputPage);
  inp.addEventListener('pointerup',function(e){
    e.preventDefault();
    inp.focus();
    inp.select();
  });
})();

/* ═══ PDF DOWNLOAD ═════════════════════════════════════════ */
D.btnDownload.addEventListener('click',async function(){
  setLoading(true,'PDF olusturuluyor...');
  D.previewModal.classList.add('hidden');
  try{
    if(S.outMode==='a4')await generateA4();
    else await generateA6();
  }catch(e){console.error(e);toast('PDF hatasi: '+e.message,'error');}
  finally{setLoading(false);}
});

async function generateA4(){
  clearRenderPageCache(); // #2: sayfa önbelleği temizle
  const jsPDFLib=window.jspdf;
  const pdf=new jsPDFLib.jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  await ensurePdfFont(pdf);
  const sp=Math.max(2,parseInt(D.spacingIn.value)||6);
  const colCount=S.outMode==='a4-1col'?1:S.outMode==='a4-3col'?3:2;
  const lay=getLAY();
  const totalColW=(A4W-lay.MRG_L-lay.MRG_R-(colCount-1)*lay.CGAP)/colCount;
  const _sl2=S.smartLayout;
  const _sl2Cols=_sl2?(_sl2[0]?.cols?.length||0):0;
  const pages=(_sl2&&_sl2Cols===colCount)?_sl2:await buildLayoutN(S.questions,sp,colCount,getStudentRowOffset()+getExamInfoOffset());
  let qn=0;
  const _qOff=S.qNumOffset||0;
  const font=_pdfFontState.name;
  async function drawHdr(p){
    // TÜRKÇE FIX: Başlık bandı ve sınav bilgisi canvas PNG olarak render edilir
    const hdrPng=await renderTextBandToPng(
      S.hdr.text, 'Sayfa '+p,
      S.hdr.bg, S.hdr.color, S.hdr.fontSize,
      A4W, HDRH
    );
    if(hdrPng) pdf.addImage(hdrPng,'PNG',0,0,A4W,HDRH);

    // Sınav bilgi bandı
    const examH=getExamInfoOffset();
    if(examH>0){
      const examPng=await renderExamInfoBandToPng(A4W, examH);
      if(examPng) pdf.addImage(examPng,'PNG',0,HDRH,A4W,examH);
    }

    drawStudentInfoRow(pdf, font, lay);
    drawWatermark(pdf, A4W, A4H);
  }
  const studentOffset=getStudentRowOffset()+getExamInfoOffset();
  const effectiveContentStart=lay.contentStart+studentOffset;
  for(let pi=0;pi<pages.length;pi++){
    if(pi>0)pdf.addPage();
    await drawHdr(pi+1);
    // Sütun ayırıcı çizgiler (2+ sütun varsa)
    if(colCount>1){
      const cd=S.colDivider||{};
      const cdStyle=cd.style||'solid';
      const cdColor=cd.color||'#000000';
      const cdW=cd.width||0.4;
      const lineY=lay.contentStart+studentOffset;
      const lineEnd=A4H-lay.MRG_B-FTRH;
      for(let c=1;c<colCount;c++){
        const lx=lay.MRG_L+c*(totalColW+lay.CGAP)-lay.CGAP/2;
        // Çizgi: center text yoksa tam, varsa center text bloğunda parça parça çizilir
        if(cdStyle!=='none' && !(colCount===2 && cd.centerText)){
          const rgb=hexToRgbArr(cdColor);
          pdf.setDrawColor(rgb[0],rgb[1],rgb[2]);
          pdf.setLineWidth(cdW);
          if(cdStyle==='dashed') pdf.setLineDashPattern([3,2],0);
          else if(cdStyle==='dotted') pdf.setLineDashPattern([0.5,2],0);
          else pdf.setLineDashPattern([],0);
          pdf.line(lx, lineY, lx, lineEnd);
          pdf.setLineDashPattern([],0);
        }
        // Orta şerit metni — sadece 2 sütunda ve metin varsa
        if(colCount===2 && cd.centerText){
          const midY=(lineY+lineEnd)/2;
          const fs=cd.centerTextSize||7;
          // Metin yüksekliği (mm): karakter başına ~(fontSize/72*25.4) * char sayısı
          const charH=fs*(25.4/72); // 1 karakter yüksekliği mm
          // Dikey metin: görünür yükseklik = karakter genişliği × karakter sayısı (0.6 oran)
          const txtH=cd.centerText.length*charH*0.6;
          const charGap=charH*(cd.centerGap||2)*0.6; // boşluk: N karakter genişliği
          const txtTop=midY-txtH/2;
          const txtBot=midY+txtH/2;

          // Beyaz arka plan şeridi — sadece metin kadar
          const stripW=lay.CGAP;
          pdf.setFillColor(255,255,255);
          pdf.rect(lx-stripW/2, txtTop, stripW, txtH, 'F');

          // Çizgi: üst kısım (lineY → txtTop-charGap)
          if(cdStyle!=='none' && lineY < txtTop-charGap){
            const rgb=hexToRgbArr(cdColor);
            pdf.setDrawColor(rgb[0],rgb[1],rgb[2]);
            pdf.setLineWidth(cdW);
            if(cdStyle==='dashed') pdf.setLineDashPattern([3,2],0);
            else if(cdStyle==='dotted') pdf.setLineDashPattern([0.5,2],0);
            else pdf.setLineDashPattern([],0);
            pdf.line(lx, lineY, lx, txtTop-charGap);
            pdf.setLineDashPattern([],0);
          }
          // Çizgi: alt kısım (txtBot+charGap → lineEnd)
          if(cdStyle!=='none' && txtBot+charGap < lineEnd){
            const rgb=hexToRgbArr(cdColor);
            pdf.setDrawColor(rgb[0],rgb[1],rgb[2]);
            pdf.setLineWidth(cdW);
            if(cdStyle==='dashed') pdf.setLineDashPattern([3,2],0);
            else if(cdStyle==='dotted') pdf.setLineDashPattern([0.5,2],0);
            else pdf.setLineDashPattern([],0);
            pdf.line(lx, txtBot+charGap, lx, lineEnd);
            pdf.setLineDashPattern([],0);
          }

          // Dikey metin — canvas'a render edip PNG olarak ekle
          const _ctCanvas=document.createElement('canvas');
          const _ctDPI=4;
          const _ctH=Math.round(txtH*_ctDPI*3);
          const _ctW=Math.round(stripW*_ctDPI*3);
          _ctCanvas.width=_ctH; _ctCanvas.height=_ctW; // döndürülecek
          const _ctCtx=_ctCanvas.getContext('2d');
          _ctCtx.fillStyle='#ffffff';
          _ctCtx.fillRect(0,0,_ctCanvas.width,_ctCanvas.height);
          const _ctFsPx=fs*(25.4/72)*_ctDPI*3;
          _ctCtx.font=_ctFsPx+'px '+(S.hdr.font||'Helvetica')+',sans-serif';
          _ctCtx.fillStyle=cd.centerTextColor||'#888888';
          _ctCtx.textAlign='center'; _ctCtx.textBaseline='middle';
          _ctCtx.fillText(cd.centerText, _ctCanvas.width/2, _ctCanvas.height/2);
          // Canvas'ı 90° döndür
          const _rotCanvas=document.createElement('canvas');
          _rotCanvas.width=_ctCanvas.height; _rotCanvas.height=_ctCanvas.width;
          const _rotCtx=_rotCanvas.getContext('2d');
          _rotCtx.translate(_rotCanvas.width/2,_rotCanvas.height/2);
          _rotCtx.rotate(-Math.PI/2);
          _rotCtx.drawImage(_ctCanvas,-_ctCanvas.width/2,-_ctCanvas.height/2);
          const _ctDataUrl=_rotCanvas.toDataURL('image/png');
          pdf.addImage(_ctDataUrl,'PNG',lx-stripW/2,txtTop,stripW,txtH);
          pdf.setTextColor(0);
        }
      }
    }
    const allItems=[];
    for(let c=0;c<colCount;c++){
      const col=pages[pi].cols[c];
      if(col)col.items.forEach(ei=>allItems.push(ei));
    }
    allItems.sort((a,b)=>a.col!==b.col?a.col-b.col:a.y-b.y);
    for(const entry of allItems){
      const item=entry.item,y=entry.y,col=entry.col;
      const cx=lay.MRG_L+col*(totalColW+lay.CGAP);
      pdf.setFontSize(S.hdr.fontSize||7);pdf.setFont(font,'bold');pdf.setTextColor(0,0,0);
      pdf.text(''+(_qOff+(++qn))+'.',cx,y+BADGE_H-1);
      pdf.setFont(font,'normal');
      // FIX #1: İlerleme göstergesi
      setLoading(true, `PDF oluşturuluyor... ${qn}/${S.questions.length} soru`);
      // Yüksek kaliteli render — 5.0 ölçeği ≈ 300 DPI baskı kalitesi
      // Sütun genişliğine göre adaptif ölçek — tam dolgu kalitesini koru
      const _sp4=(item.q.sizePercent||100)/100;
      // Görsel kaç mm basılacak? totalColW * sp4
      // Kaç pixel gerekir? (mm/25.4)*targetDPI; targetDPI = getExportScale*72
      // exportScale = gerekli_px / orijinal_mm_genişlik
      // Ama orijinal mm genişliği bilmeden regionImg çağırıyoruz —
      // önce düşük ölçekle mm boyutunu al, sonra doğru ölçekte render et
      const _preImg = await regionImg(item.r, 1.0, true);
      const _targetW = totalColW * _sp4; // basılacak mm genişliği
      const _neededScale = _preImg
        ? Math.min(Math.max((_targetW / _preImg.mmW) * getExportScale(false), 1.5), 8.0)
        : getExportScale(false);
      const hiImg = _preImg && Math.abs(_neededScale - 1.0) < 0.1
        ? _preImg
        : await regionImg(item.r, _neededScale, true);
      if(hiImg){
        // Gerçek kırpılmış görsel boyutunu kullan (autoCrop boyutu layout'tan farklı olabilir)
        // Sütun genişliğine sığacak şekilde orantılı ölçekle
        const _spA4=(item.q.sizePercent||100)/100;
        // Sütun genişliğini tam doldur, oran koru
        const _fW4 = totalColW * _spA4;
        const _fH4 = hiImg.mmH * (_fW4 / hiImg.mmW);
        let drawW = Math.min(_fW4, totalColW);
        let drawH = _fH4 * (drawW / _fW4);
        const maxDrawH = lay.usableH * 0.92;
        if(drawH > maxDrawH){ drawH = maxDrawH; drawW = hiImg.mmW*(drawH/hiImg.mmH); drawW = Math.min(drawW, totalColW); }
        pdf.addImage(hiImg.dataUrl,'PNG',cx,y+BADGE_H,drawW,drawH,undefined,'FAST');
        drawScoreBox(pdf,cx,y+BADGE_H+drawH-1,totalColW,font);
      } else {
        drawScoreBox(pdf,cx,y+BADGE_H+item.dH-1,totalColW,font);
      }
    }
  }
  if(S.answerKey)await addAnswerKeyPage(pdf,S.questions,font);
  // Blob çıktısı — büyük dosyalarda "invalid string length" hatasını önler
  try{
    const blob = pdf.output('blob');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sinav-kagidi.pdf';
    a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 10000);
  }catch(e){
    pdf.save('sinav-kagidi.pdf');
  }
  toast('PDF indirildi!','success');
}

async function generateA6(){
  clearRenderPageCache();
  const jsPDFLib=window.jspdf;
  const PW=148, PH=105, M=8;
  const pdf=new jsPDFLib.jsPDF({orientation:'landscape',unit:'mm',format:[PW,PH]});
  await ensurePdfFont(pdf);
  const font=_pdfFontState.name;
  const availW=PW-M*2, availH=PH-M*2;
  const questions=S.smartOrder||S.questions;
  // A6 için 3.5 ölçek yeterli (~250 DPI) — 5.0 gereksiz yere büyük veri üretir
  const A6_SCALE = getExportScale(true);

  for(let i=0;i<questions.length;i++){
    if(i>0) pdf.addPage([PW,PH],'landscape');
    const q=questions[i];
    const r=findRegionById(q.rid);
    if(!r)continue;
    setLoading(true, `A6 PDF... ${i+1}/${questions.length}`);
    const _spAdapt=(q.sizePercent||100)/100;
    const _a6Adapt=Math.max(1.8, A6_SCALE*Math.sqrt(_spAdapt));
    const img=await regionImg(r, _a6Adapt);
    if(!img){ clearRenderPageCache(); continue; }
    const sc=Math.min(availW/img.mmW, availH/img.mmH, 1);
    const iW=img.mmW*sc, iH=img.mmH*sc;
    const ix=(PW-iW)/2;
    const iy=M+(availH-iH)/2;
    pdf.addImage(img.dataUrl,'PNG', ix, iy, iW, iH, undefined, 'FAST');
    // Üst çizgi
    pdf.setDrawColor(180,180,180); pdf.setLineWidth(0.25);
    pdf.line(M, M, PW-M, M);
    // Alt çizgi
    pdf.line(M, PH-M, PW-M, PH-M);
    // Sol üst: soru no / toplam
    pdf.setFont(S.hdr.font||'helvetica', 'bold');
    pdf.setFontSize(S.hdr.fontSize||8.5);
    pdf.setTextColor(80,80,80);
    const _qOff6=S.qNumOffset||0;
    pdf.text((_qOff6+i+1)+'/'+(_qOff6+questions.length), M+1, M-1.5);
    pdf.setTextColor(0);
    // Her 10 soruda bir render önbelleğini temizle (bellek birikimini önle)
    if((i+1)%10===0) clearRenderPageCache();
  }

  // Blob olarak kaydet — büyük dosyalarda string dönüşümünden kaynaklanan
  // "invalid string length" hatasını önler
  try{
    const blob = pdf.output('blob');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'soru-kartlari.pdf';
    a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 10000);
  }catch(e){
    // Blob da başarısız olursa klasik yöntem
    pdf.save('soru-kartlari.pdf');
  }
  toast('PDF indirildi! ('+questions.length+' kart)','success');
}
/* ═══ SMART LAYOUT BUTTON ══════════════════════════════════ */
D.btnSmartLayout.addEventListener('click',async function(){
  if(!S.questions.length){toast('Once soru secin','error');return;}
  const pages=await buildSmartLayout();
  toast('Akilli duzen: '+S.questions.length+' soru - '+pages.length+' A4 sayfa','success');
  await openPreview();
});

/* ═══ TOOLBAR ══════════════════════════════════════════════ */
D.upload.addEventListener('change',function(e){if(e.target.files[0])loadPDF(e.target.files[0]);});
D.btnDetect.addEventListener('click',detectAll);
D.btnClear.addEventListener('click',clearAll);
D.btnExport.addEventListener('click',openPreview);
if(D.btnClassify) D.btnClassify.addEventListener('click',classifyQuestions);
D.btnPrev.addEventListener('click',function(){if(S.curPage>1)renderPage(S.curPage-1);});
D.btnNext.addEventListener('click',function(){if(S.curPage<S.pages)renderPage(S.curPage+1);});
// Sayfa aralığı tarama butonu
(function(){
  const btn=G('btn-detect-range');
  if(btn) btn.addEventListener('click', openRangeScanDialog);
})();

/* ═══ SAYFA GİT DIALOG ══════════════════════════════════════ */
(function(){
  const overlay=G('goto-overlay');
  const inp=G('goto-input');
  const hint=G('goto-hint');
  const btnJump=G('btn-page-jump');
  const btnOk=G('goto-confirm');
  const btnCancel=G('goto-cancel');

  function openGoto(){
    if(!S.pdf) return;
    inp.value='';
    hint.textContent='1 – '+S.pages+' arası sayfa girin';
    overlay.classList.remove('hidden');
    setTimeout(function(){ inp.focus(); inp.select(); }, 80);
  }
  function closeGoto(){ overlay.classList.add('hidden'); }
  function confirmGoto(){
    const v=parseInt(inp.value);
    if(!isNaN(v) && v>=1 && v<=S.pages){
      renderPage(v);
      closeGoto();
    } else {
      inp.style.borderColor='#ef4444';
      setTimeout(function(){ inp.style.borderColor=''; },800);
    }
  }

  btnJump.addEventListener('click', openGoto);
  btnOk.addEventListener('click', confirmGoto);
  btnCancel.addEventListener('click', closeGoto);
  overlay.addEventListener('click',function(e){ if(e.target===overlay) closeGoto(); });
  inp.addEventListener('keydown',function(e){
    if(e.key==='Enter') confirmGoto();
    if(e.key==='Escape') closeGoto();
  });
})();
D.btnZI.addEventListener('click',function(){
  const oldScale=S.scale;
  S.scale=Math.min(3,+(S.scale+0.25).toFixed(2));
  S.rawItems={}; clearRenderPageCache();
  D.zoomLabel.textContent=Math.round(S.scale/1.4*100)+'%';
  rescaleRegions(oldScale, S.scale);
  renderPage(S.curPage);
});
D.btnZO.addEventListener('click',function(){
  const oldScale=S.scale;
  S.scale=Math.max(0.6,+(S.scale-0.25).toFixed(2));
  S.rawItems={}; clearRenderPageCache();
  D.zoomLabel.textContent=Math.round(S.scale/1.4*100)+'%';
  rescaleRegions(oldScale, S.scale);
  renderPage(S.curPage);
});

function rescaleRegions(oldScale, newScale){
  if(oldScale===newScale) return;
  const f=newScale/oldScale;
  for(const r of S.regions){
    if(r.page===S.curPage){
      r.x=Math.round(r.x*f); r.y=Math.round(r.y*f);
      r.w=Math.round(r.w*f); r.h=Math.round(r.h*f);
      r.detectedScale=newScale;
    }
  }
}
D.btnDraw.addEventListener('click',function(){if(S.pdf){S.drawMode?enterSel():enterDraw();}});
D.btnSel.addEventListener('click',function(){if(S.pdf)enterSel();});

/* ═══ DRAG & DROP ══════════════════════════════════════════ */
document.addEventListener('dragover',function(e){e.preventDefault();});
document.addEventListener('drop',function(e){
  e.preventDefault();
  const f=e.dataTransfer.files[0];
  if(f&&f.type==='application/pdf')loadPDF(f);
});

/* ═══ KEYBOARD ═════════════════════════════════════════════ */
document.addEventListener('keydown',function(e){
  if(e.target.tagName==='INPUT')return;
  if(!S.pdf)return;
  if(e.key==='ArrowLeft'&&S.curPage>1)renderPage(S.curPage-1);
  if(e.key==='ArrowRight'&&S.curPage<S.pages)renderPage(S.curPage+1);
  if(e.key==='Escape'){hideFloat();if(S.drawMode)enterSel();D.previewModal.classList.add('hidden');}
  if((e.key==='d'||e.key==='D')&&!e.ctrlKey){S.drawMode?enterSel():enterDraw();}
  // FIX #7: Enter → aktif bölgeyi onayla, Delete/Backspace → sil
  if(e.key==='Enter'&&S.active&&!S.active.confirmed){ e.preventDefault(); confirmRegion(S.active); }
  if((e.key==='Delete'||e.key==='Backspace')&&S.active&&S.active.confirmed){ e.preventDefault(); removeRegion(S.active); }
  // FIX #7: ? tuşu kısayol panelini aç/kapat
  if(e.key==='?'&&!e.ctrlKey){ e.preventDefault(); toggleShortcutPanel(); }
});

/* ═══ SETTINGS ═════════════════════════════════════════════ */
document.querySelectorAll('input[name="output-mode"]').forEach(function(inp){
  inp.addEventListener('change',function(e){
    S.outMode=e.target.value;
    S.smartLayout=null;
    document.querySelectorAll('.output-mode-btn').forEach(l=>l.classList.remove('active'));
    e.target.closest('.output-mode-btn').classList.add('active');
    saveSession();
  });
});
G('spacing-dec').addEventListener('click',function(){
  const v=Math.max(2,(parseInt(D.spacingIn.value)||6)-1);
  D.spacingIn.value=v; S.smartLayout=null;
});
G('spacing-inc').addEventListener('click',function(){
  const v=Math.min(30,(parseInt(D.spacingIn.value)||6)+1);
  D.spacingIn.value=v; S.smartLayout=null;
});

/* ═══ INIT ═════════════════════════════════════════════════ */
enterSel();
updateTouchAction();
setStatus('Hazir -- PDF yukleyin veya surukleyin');

/* ═══ BASLIK OZELLESTIRME ═══════════════════════════════════ */
function syncHdr(){
  S.hdr.text   = D.hdrText.value  || 'SınavForge — Sınav Kağıdı';
  S.hdr.bg     = D.hdrBg.value;
  S.hdr.color  = D.hdrColor.value;
  S.hdr.fontSize = parseFloat(D.hdrSize.value) || 8.5;
  S.hdr.font   = D.hdrFont.value;
  S.mrg.left   = Math.max(3, parseFloat(D.mrgLeft.value)  || 14);
  S.mrg.right  = Math.max(3, parseFloat(D.mrgRight.value) || 14);
  S.mrg.top    = Math.max(2, parseFloat(D.mrgTop.value)   || 6);
  S.mrg.bottom = Math.max(2, parseFloat(D.mrgBottom.value)|| 8);
  S.mrg.col    = Math.max(2, parseFloat(D.mrgCol.value)   || 8);
  S.smartLayout = null;
}
['input','change'].forEach(ev=>{
  [D.hdrText,D.hdrBg,D.hdrColor,D.hdrSize,D.hdrFont,
   D.mrgLeft,D.mrgRight,D.mrgTop,D.mrgBottom,D.mrgCol].forEach(el=>{
    if(el) el.addEventListener(ev, syncHdr);
  });
});

/* ═══ THUMBNAIL SİSTEMİ ════════════════════════════════════ */
async function buildThumbCache(){
  for(const q of S.questions){
    if(S.thumbCache[q.rid]) continue;
    const r=findRegionById(q.rid);
    if(!r) continue;
    try{
      const img=await regionImg(r, 1.2); // ~72 DPI kart thumbnail
      if(img) S.thumbCache[q.rid]=img.dataUrl;
    }catch(e){}
  }
}
function showThumbTooltip(rid, e){
  const src=S.thumbCache[rid];
  if(!src){ hideThumbTooltip(); return; }
  const tt=D.thumbTooltip, cv=D.thumbCanvas;
  const im=new Image();
  im.onload=function(){
    const maxW=180, maxH=130;
    const sc=Math.min(maxW/im.width, maxH/im.height, 1);
    cv.width=Math.round(im.width*sc); cv.height=Math.round(im.height*sc);
    cv.getContext('2d').drawImage(im,0,0,cv.width,cv.height);
    tt.classList.remove('hidden');
    moveThumbTooltip(e);
  };
  im.src=src;
}
function moveThumbTooltip(e){
  const tt=D.thumbTooltip;
  if(tt.classList.contains('hidden')) return;
  const x=e.clientX+16, y=e.clientY-20;
  const W=window.innerWidth, H=window.innerHeight;
  tt.style.left=Math.min(x, W-tt.offsetWidth-8)+'px';
  tt.style.top=Math.max(8, Math.min(y, H-tt.offsetHeight-8))+'px';
}
function hideThumbTooltip(){
  D.thumbTooltip.classList.add('hidden');
}

/* ═══ LOCAL STORAGE — OTURUM KAYDET/YÜkLE ═════════════════ */
const SESSION_KEY='sinavforge_session_v1';
const HISTORY_KEY='sinavforge_history_v1';
const HISTORY_MAX=5;
function saveSession(){
  if(!S.pdf) return;
  try{
    // FIX #8: watermark.imageDataUrl dışarıda bırakılıyor (quota koruması)
    const watermarkSafe={
      enabled:S.watermark.enabled, text:S.watermark.text,
      opacity:S.watermark.opacity, position:S.watermark.position,
    };
    const data={
      fname: S.fname,
      questions: S.questions.map(q=>({
        id:q.id, rid:q.rid, page:q.page, text:q.text, full:q.full, num:q.num, aiType:q.aiType||null, note:q.note||'', sizePercent:q.sizePercent||100, answer:q.answer||'', difficulty:q.difficulty||'', duration:q.duration||0, sizePercent:q.sizePercent||100, answer:q.answer||''
      })),
      regions: S.regions.map(r=>({
        id:r.id, page:r.page, x:r.x, y:r.y, w:r.w, h:r.h,
        text:r.text, fullText:r.fullText||'', confirmed:r.confirmed,
        manual:r.manual||false, score:r.score||60, detectedScale:r.detectedScale||S.scale
      })),
      hdr: {...S.hdr}, mrg: {...S.mrg},
      outMode: S.outMode, scoreBox: S.scoreBox, answerKey: S.answerKey, exportQuality: S.exportQuality||'mid', viewMode: S.viewMode||'grid', qNumOffset: S.qNumOffset||0, colDivider:{...S.colDivider},
      watermark: watermarkSafe,
      examInfo: {...S.examInfo},
      // FIX #8: Öğrenme döngüsü kalıcı — sonraki oturumda sıfırlanmıyor
      userFeedback: {
        confirmed: S.userFeedback.confirmed.slice(-50), // son 50 kayıt yeterli
        rejected:  S.userFeedback.rejected.slice(-50),
      },
      savedAt: Date.now()
    };
    try{
      localStorage.setItem(SESSION_KEY, JSON.stringify(data));
      scheduleHistorySave();
    }catch(quotaErr){
      // Quota aşıldı — userFeedback olmadan dene
      const slim={...data, userFeedback:undefined};
      try{ localStorage.setItem(SESSION_KEY, JSON.stringify(slim)); }catch(e){}
    }
  }catch(e){ console.warn('Session save failed:', e); }
}
function loadSessionData(data){
  S.regions=data.regions||[];
  S.questions=data.questions||[];
  S.qnum=S.questions.length+1;
  S.rid=S.regions.length;
  S.scoreBox=data.scoreBox||false;
  S.answerKey=data.answerKey||false;
  if(data.hdr) Object.assign(S.hdr, data.hdr);
  if(data.mrg) Object.assign(S.mrg, data.mrg);
  if(data.outMode) S.outMode=data.outMode;
  if(data.exportQuality) S.exportQuality=data.exportQuality;
  if(data.viewMode) S.viewMode=data.viewMode;
  if(data.qNumOffset!==undefined) S.qNumOffset=data.qNumOffset||0;
  if(data.colDivider) Object.assign(S.colDivider, data.colDivider);
  if(data.exportQuality) S.exportQuality=data.exportQuality;
  if(data.watermark) Object.assign(S.watermark, data.watermark);
  if(data.examInfo) Object.assign(S.examInfo, data.examInfo);
  // FIX #8: Öğrenme döngüsünü oturumdan geri yükle
  if(data.userFeedback){
    if(Array.isArray(data.userFeedback.confirmed))
      S.userFeedback.confirmed=[...data.userFeedback.confirmed];
    if(Array.isArray(data.userFeedback.rejected))
      S.userFeedback.rejected=[...data.userFeedback.rejected];
  }
  if(D.toggleScoreBox) D.toggleScoreBox.checked=S.scoreBox;
  if(D.toggleAnswerKey) D.toggleAnswerKey.checked=S.answerKey;
  syncHdrUI();
  updatePanel();
  if(S.questions.length){ D.btnExport.disabled=false; D.btnSmartLayout.disabled=false; }
  buildThumbCache().then(()=>updatePanel());
  toast('Oturum yüklendi — '+S.questions.length+' soru','success');
}
/* ═══ #10: OTOMATİK YEDEKLEME ═══════════════════════════ */
let _histTimer=null;
function scheduleHistorySave(){
  clearTimeout(_histTimer);
  _histTimer=setTimeout(function(){
    if(!S.pdf||!S.questions.length) return;
    try{
      const hist=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');
      const snap={
        savedAt:Date.now(), fname:S.fname, qCount:S.questions.length,
        questions:S.questions.map(q=>({...q})),
        regions:S.regions.map(r=>({...r})),
        hdr:{...S.hdr}, mrg:{...S.mrg},
        outMode:S.outMode, scoreBox:S.scoreBox, answerKey:S.answerKey,
        qNumOffset:S.qNumOffset||0,
      };
      hist.unshift(snap);
      if(hist.length>HISTORY_MAX) hist.splice(HISTORY_MAX);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
    }catch(e){}
  }, 30000);
}
function loadHistory(){
  try{ return JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]'); }catch(e){ return []; }
}
function openHistoryPanel(){
  const hist=loadHistory();
  if(!hist.length){ toast('Kayıtlı yedek yok','info'); return; }
  const bar=G('history-bar');
  const sel=G('history-select');
  const info=G('history-info');
  if(!bar||!sel) return;
  sel.innerHTML=hist.map(function(h,i){
    const d=new Date(h.savedAt);
    const label=d.toLocaleDateString('tr-TR')+' '+d.toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'})+' — '+h.qCount+' soru';
    return '<option value="'+i+'">'+label+'</option>';
  }).join('');
  if(info) info.textContent=hist.length+' yedek';
  bar.classList.remove('hidden');
}
function restoreFromHistory(idx){
  const hist=loadHistory();
  const snap=hist[parseInt(idx)];
  if(!snap) return;
  if(S.pdf && S.fname!==snap.fname){
    toast('Bu yedek "'+snap.fname+'" dosyasına ait','info',4000); return;
  }
  snapshotState();
  S.regions=snap.regions||[];
  S.questions=snap.questions||[];
  S.qnum=S.questions.length+1;
  if(snap.hdr) Object.assign(S.hdr,snap.hdr);
  if(snap.mrg) Object.assign(S.mrg,snap.mrg);
  if(snap.outMode) S.outMode=snap.outMode;
  S.scoreBox=snap.scoreBox||false;
  S.answerKey=snap.answerKey||false;
  S.qNumOffset=snap.qNumOffset||0;
  S.smartLayout=null; S.smartOrder=null; S.thumbCache={};
  syncHdrUI(); updatePanel(); saveSession();
  buildThumbCache().then(()=>updatePanel());
  G('history-bar')?.classList.add('hidden');
  toast('Yedek yüklendi — '+S.questions.length+' soru','success');
}

function syncHdrUI(){
  if(D.hdrText) D.hdrText.value=S.hdr.text;
  if(D.hdrBg)   D.hdrBg.value=S.hdr.bg;
  if(D.hdrColor) D.hdrColor.value=S.hdr.color;
  if(D.hdrSize)  D.hdrSize.value=S.hdr.fontSize;
  if(D.hdrFont)  D.hdrFont.value=S.hdr.font;
  if(D.mrgLeft)  D.mrgLeft.value=S.mrg.left;
  if(D.mrgRight) D.mrgRight.value=S.mrg.right;
  if(D.mrgTop)   D.mrgTop.value=S.mrg.top;
  if(D.mrgBottom)D.mrgBottom.value=S.mrg.bottom;
  if(D.mrgCol)   D.mrgCol.value=S.mrg.col;
  const el=G('exam-lesson'),ec=G('exam-class'),ed=G('exam-date');
  if(el) el.value=S.examInfo.lesson||'';
  if(ec) ec.value=S.examInfo.className||'';
  if(ed) ed.value=S.examInfo.date||'';
  const stInf=G('toggle-student-info'); if(stInf) stInf.checked=S.hdr.studentInfo||false;
  // colDivider
  const cdColor=G('col-div-color'); if(cdColor) cdColor.value=S.colDivider?.color||'#000000';
  const cdW=G('col-div-width'); if(cdW) cdW.value=S.colDivider?.width||0.4;
  const cdStyle=S.colDivider?.style||'solid';
  document.querySelectorAll('input[name="col-div-style"]').forEach(inp=>{
    inp.checked=inp.value===cdStyle;
    inp.closest?.('.col-div-style-btn')?.classList.toggle('active',inp.value===cdStyle);
  });
  const ctToggle=G('col-center-text-toggle');
  const hasCT=!!(S.colDivider?.centerText);
  if(ctToggle) ctToggle.checked=hasCT;
  const ctRow=G('col-center-text-row'); if(ctRow) ctRow.style.display=hasCT?'':'none';
  const ctOpts=G('col-center-text-opts'); if(ctOpts) ctOpts.style.display=hasCT?'':'none';
  const ctInp=G('col-center-text'); if(ctInp) ctInp.value=S.colDivider?.centerText||'';
  const ctSize=G('col-center-text-size'); if(ctSize) ctSize.value=S.colDivider?.centerTextSize||7;
  const ctColor=G('col-center-text-color'); if(ctColor) ctColor.value=S.colDivider?.centerTextColor||'#888888';
  const ctGap=G('col-center-gap'); if(ctGap) ctGap.value=S.colDivider?.centerGap||2;
  const qOff=G('q-num-offset'); if(qOff) qOff.value=S.qNumOffset||0;
}
// Session banner kontrolü
(function(){
  try{
    const raw=localStorage.getItem(SESSION_KEY);
    if(!raw) return;
    const data=JSON.parse(raw);
    if(!data.questions||!data.questions.length) return;
    const age=(Date.now()-data.savedAt)/1000/60; // dakika
    if(age>60*24) return; // 24 saatten eskiyse gösterme
    D.sessionBanner.classList.remove('hidden');
    G('btn-restore-session').addEventListener('click',function(){
      D.sessionBanner.classList.add('hidden');
      // PDF yüklenmişse direkt uygula
      if(S.pdf && S.fname===data.fname) loadSessionData(data);
      else toast('Önce aynı PDF\'i yükleyin: '+data.fname,'info',5000);
    });
    G('btn-dismiss-session').addEventListener('click',function(){
      D.sessionBanner.classList.add('hidden');
      localStorage.removeItem(SESSION_KEY);
    });
  }catch(e){}
})();

/* ═══ YZ SORU SINIFLANDIRMA — Artifact API ═════════════════ */
async function classifyQuestions(){
  if(!S.questions.length) return;
  setLoading(true,'Sorular sınıflandırılıyor...');
  try{
    const texts=S.questions.map((q,i)=>`${i+1}. ${q.text||q.full||''}`).join('\n');
    const resp=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'x-api-key': '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',
       'anthropic-version': '2023-06-01',
       'anthropic-dangerous-direct-browser-access': 'true'
    },
      body:JSON.stringify({
        model:'claude-sonnet-4-20250514',
        max_tokens:600,
        messages:[{
          role:'user',
          content:`Aşağıdaki sınav sorularını sınıflandır. Her satır için SADECE şu JSON dizisini döndür (başka hiçbir şey yazma, backtick yok):\n[{"i":0,"t":"Çoktan Seçmeli"},{"i":1,"t":"Klasik"},...]\nt değeri yalnızca "Çoktan Seçmeli", "Klasik" veya "Karma" olabilir.\n\nSorular:\n${texts}`
        }]
      })
    });
    if(!resp.ok){
      const err=await resp.json().catch(()=>({}));
      throw new Error(err.error?.message||'API hatası ('+resp.status+')');
    }
    const data=await resp.json();
    const txt=(data.content&&data.content[0]&&data.content[0].text)||'[]';
    const clean=txt.replace(/```json|```/g,'').trim();
    const results=JSON.parse(clean);
    results.forEach(r=>{ if(S.questions[r.i]) S.questions[r.i].aiType=r.t; });
    updatePanel();
    toast('Sınıflandırma tamamlandı','success');
  }catch(e){ toast('Sınıflandırma hatası: '+e.message,'error'); }
  finally{ setLoading(false); }
}

/* ═══ PUAN KUTUSU & CEVAP ANAHTARI TOGGLE ══════════════════ */
if(D.toggleScoreBox){
  D.toggleScoreBox.addEventListener('change',function(){
    S.scoreBox=this.checked; S.smartLayout=null; saveSession();
  });
}
if(D.toggleAnswerKey){
  D.toggleAnswerKey.addEventListener('change',function(){
    S.answerKey=this.checked; S.smartLayout=null; saveSession();
  });
}

/* ═══ YAZDIRMA ══════════════════════════════════════════════ */
if(D.btnPrint){
  D.btnPrint.addEventListener('click',async function(){
    if(!S.questions.length){ toast('Önce soru seçin','error'); return; }
    setLoading(true,'Yazdırma hazırlanıyor...');
    try{
      // Preview sayfalarını oluştur
      S.previewPages=[];
      if(S.outMode==='a6') await buildPreviewA6();
      else await buildPreviewA4();
      // Gizli iframe ile yazdır
      const iframe=document.createElement('iframe');
      iframe.style.cssText='position:fixed;left:-9999px;top:-9999px;width:210mm;height:297mm;border:none;';
      document.body.appendChild(iframe);
      const doc=iframe.contentDocument||iframe.contentWindow.document;
      const imgs=S.previewPages.map(src=>`<img src="${src}" style="width:100%;page-break-after:always;display:block;"/>`).join('');
      doc.open();
      doc.write(`<!DOCTYPE html><html><head><style>*{margin:0;padding:0;box-sizing:border-box;}@media print{@page{margin:0;size:A4;}img{width:100vw;height:100vh;object-fit:contain;}}</style></head><body>${imgs}</body></html>`);
      doc.close();
      iframe.contentWindow.onload=function(){
        setTimeout(function(){
          iframe.contentWindow.print();
          setTimeout(function(){ document.body.removeChild(iframe); },1000);
        },300);
      };
    }catch(e){ toast('Yazdırma hatası: '+e.message,'error'); }
    finally{ setLoading(false); }
  });
}

/* ═══ SÜTUN MODU SEÇICI ════════════════════════════════════ */
document.querySelectorAll('input[name="output-mode"]').forEach(function(inp){
  if(inp.value===S.outMode) inp.checked=true;
});

/* ═══ CEVAP ANAHTARI SAYFASI (PDF'e ekleme) ═══════════════ */
async function addAnswerKeyPage(pdf, questions, font){
  const m=getLAY();
  const cols=3, colW=(A4W-m.MRG_L-m.MRG_R)/cols;
  const ROW_H=10;
  const startY=HDRH+m.MRG_T+8;
  const maxY=A4H-m.MRG_B-10;

  async function drawKeyHeader(){
    pdf.addPage();
    const hdrPng=await renderTextBandToPng(
      'CEVAP ANAHTARI', null,
      S.hdr.bg, S.hdr.color, S.hdr.fontSize,
      A4W, HDRH
    );
    if(hdrPng) pdf.addImage(hdrPng,'PNG',0,0,A4W,HDRH);
  }

  await drawKeyHeader();
  let pageNum=1;
  let pageOffset=0; // Bu sayfada kaçıncı sorudan itibaren

  for(let i=0;i<questions.length;i++){
    const q=questions[i];
    const col=( (i-pageOffset) % cols );
    const row=Math.floor( (i-pageOffset) / cols );
    const cy=startY+row*ROW_H;

    // Taşma: yeni sayfa aç
    if(cy+ROW_H > maxY){
      pageOffset=i;
      await drawKeyHeader();
      pageNum++;
      const col2=( (i-pageOffset) % cols );
      const row2=Math.floor( (i-pageOffset) / cols );
      const cy2=startY+row2*ROW_H;
      const x2=m.MRG_L+col2*colW;
      _drawKeyRow(pdf, font, m, q, i, x2, cy2, colW);
      continue;
    }

    const x=m.MRG_L+col*colW;
    _drawKeyRow(pdf, font, m, q, i, x, cy, colW);
  }
}
function _drawKeyRow(pdf, font, m, q, i, x, cy, colW){
  pdf.setFontSize(9); pdf.setFont(font,'bold'); pdf.setTextColor(0);
  pdf.text(pdfText((i+1)+'.'),x,cy);
  // #5: Doğru cevap varsa göster, yoksa boş çizgi
  const ans=q.answer||'';
  if(ans){
    pdf.setFontSize(9); pdf.setFont(font,'bold');
    pdf.setTextColor(20,80,200); // mavi — öğrenciye görünmez, öğretmen için
    pdf.text(ans, x+10, cy);
    pdf.setTextColor(0);
  } else {
    pdf.setDrawColor(100,100,100); pdf.setLineWidth(0.3);
    pdf.line(x+8, cy, x+colW-4, cy);
  }
  // Puan kutusu
  if(S.scoreBox){
    const score=q.score||0;
    pdf.rect(x+colW-14, cy-5, 12, 7);
    pdf.setFontSize(6); pdf.setFont(font,'normal'); pdf.setTextColor(100,100,100);
    pdf.text(score>0?String(score):'puan', x+colW-13, cy-0.5);
    pdf.setTextColor(0);
  }
}
function hexToRgbArr(hex){
  return[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)];
}

/* ═══ PUAN KUTUSU — PDF RENDER ════════════════════════════ */
function drawScoreBox(pdf, cx, y, colW, font){
  if(!S.scoreBox) return;
  const bx=cx+colW-18, by=y-1, bw=16, bh=7;
  pdf.setDrawColor(160,160,160); pdf.setLineWidth(0.25);
  pdf.rect(bx,by,bw,bh);
  pdf.setFontSize(5); pdf.setFont(font,'normal'); pdf.setTextColor(160,160,160);
  pdf.text('puan',bx+1,by+5);
  pdf.setTextColor(0);
}

/* ═══ UNDO / REDO ═══════════════════════════════════════════
   Her destructive işlem öncesi snapshot al.
   Ctrl+Z → geri al, Ctrl+Y / Ctrl+Shift+Z → ileri al
════════════════════════════════════════════════════════════ */
function snapshotState(){
  const snap={
    regions: JSON.parse(JSON.stringify(S.regions)),
    questions: JSON.parse(JSON.stringify(S.questions)),
    qnum: S.qnum,
    rid: S.rid,
  };
  S.undoStack.push(snap);
  if(S.undoStack.length>40) S.undoStack.shift();
  S.redoStack=[];
}
function applySnapshot(snap){
  S.regions=JSON.parse(JSON.stringify(snap.regions));
  S.questions=JSON.parse(JSON.stringify(snap.questions));
  S.qnum=snap.qnum; S.rid=snap.rid;
  S.smartLayout=null; S.smartOrder=null; S.thumbCache={};
  updatePanel();
  redraw();
  buildThumbCache().then(()=>updatePanel());
  saveSession();
}
function undoAction(){
  if(!S.undoStack.length){ toast('Geri alınacak işlem yok','info'); return; }
  const current={
    regions:JSON.parse(JSON.stringify(S.regions)),
    questions:JSON.parse(JSON.stringify(S.questions)),
    qnum:S.qnum, rid:S.rid,
  };
  S.redoStack.push(current);
  applySnapshot(S.undoStack.pop());
  toast('Geri alındı','info',1800);
}
function redoAction(){
  if(!S.redoStack.length){ toast('İleri alınacak işlem yok','info'); return; }
  const current={
    regions:JSON.parse(JSON.stringify(S.regions)),
    questions:JSON.parse(JSON.stringify(S.questions)),
    qnum:S.qnum, rid:S.rid,
  };
  S.undoStack.push(current);
  applySnapshot(S.redoStack.pop());
  toast('İleri alındı','info',1800);
}
document.addEventListener('keydown',function(e){
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
  if(e.ctrlKey||e.metaKey){
    if(e.key==='z'&&!e.shiftKey){ e.preventDefault(); undoAction(); }
    if((e.key==='y')||(e.key==='z'&&e.shiftKey)){ e.preventDefault(); redoAction(); }
    if(e.key==='s'){ e.preventDefault(); exportSessionJSON(); }
  }
});

/* ═══ JSON EXPORT / IMPORT ══════════════════════════════════ */
function exportSessionJSON(){
  if(!S.questions.length){ toast('Kaydedilecek soru yok','info'); return; }
  const data={
    version:2,
    fname: S.fname,
    exportedAt: new Date().toISOString(),
    questions: S.questions.map(q=>({
      id:q.id, rid:q.rid, page:q.page,
      text:q.text, full:q.full||'', num:q.num,
      tag:q.tag||'', score:q.score||0, aiType:q.aiType||null, note:q.note||'', answer:q.answer||'',
    })),
    regions: S.regions.filter(r=>r.confirmed).map(r=>({
      id:r.id, page:r.page, x:r.x, y:r.y, w:r.w, h:r.h,
      text:r.text, detectedScale:r.detectedScale||S.scale,
    })),
    hdr:{...S.hdr}, mrg:{...S.mrg},
    outMode:S.outMode, scoreBox:S.scoreBox, answerKey:S.answerKey,
  };
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=(S.fname.replace('.pdf','')+'_sorular.json');
  a.click();
  URL.revokeObjectURL(a.href);
  toast('JSON kaydedildi','success');
}
function importSessionJSON(file){
  if(!file) return;
  const reader=new FileReader();
  reader.onload=function(e){
    try{
      const data=JSON.parse(e.target.result);
      if(!data.questions||!data.regions){ toast('Geçersiz dosya formatı','error'); return; }
      snapshotState();
      S.regions=[...S.regions, ...data.regions.map(r=>({...r,confirmed:true,manual:false,score:r.score||60,fullText:r.text}))];
      const existingIds=new Set(S.questions.map(q=>q.id));
      data.questions.filter(q=>!existingIds.has(q.id)).forEach(q=>{
        S.questions.push({...q, num:S.qnum++});
      });
      if(data.hdr) Object.assign(S.hdr,data.hdr);
      if(data.outMode) S.outMode=data.outMode;
      S.smartLayout=null; S.smartOrder=null;
      updatePanel();
      buildThumbCache().then(()=>updatePanel());
      saveSession();
      toast(`${data.questions.length} soru yüklendi`,'success');
    }catch(err){ toast('Dosya okunamadı: '+err.message,'error'); }
  };
  reader.readAsText(file);
}

/* ═══ SORU KOPYALAMA (Madde 9) ══════════════════════════════ */
function duplicateQuestion(qid){
  const q=S.questions.find(x=>x.id===qid);
  if(!q){ toast('Soru bulunamadı','error'); return; }
  snapshotState();
  const newQ={
    ...q,
    id:'q'+Date.now()+'_dup',
    num:S.qnum++,
    note:(q.note?q.note+' (kopya)':''),
    score:q.score||0,
    tag:q.tag||'',
  };
  const origIdx=S.questions.findIndex(x=>x.id===qid);
  S.questions.splice(origIdx+1,0,newQ);
  S.questions.forEach((x,i)=>{x.num=i+1;});
  S.smartLayout=null; S.smartOrder=null;
  updatePanel(); saveSession();
  toast('Soru kopyalandı (S'+(origIdx+2)+')','success',1800);
}

/* ═══ İSTATİSTİK PANELİ (Madde 8) ══════════════════════════ */
function renderStatsPanel(){
  const panel=G('stats-panel');
  if(!panel) return;
  if(!S.questions.length){ panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');

  const tagCounts={};
  let totalScore=0, taggedCount=0, totalDuration=0;
  const diffCounts={easy:0,medium:0,hard:0,unknown:0};
  const typeCounts={};

  for(const q of S.questions){
    const tag=q.tag||'Etiketsiz';
    tagCounts[tag]=(tagCounts[tag]||0)+1;
    totalScore+=q.score||0;
    totalDuration+=q.duration||0;
    if(q.tag) taggedCount++;
    // Zorluk — önce q.difficulty, yoksa puana göre
    if(q.difficulty==='easy') diffCounts.easy++;
    else if(q.difficulty==='medium') diffCounts.medium++;
    else if(q.difficulty==='hard') diffCounts.hard++;
    else diffCounts.unknown++;
    const t=q.aiType||'Belirsiz';
    typeCounts[t]=(typeCounts[t]||0)+1;
  }

  const n=S.questions.length;
  const topTags=Object.entries(tagCounts).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const tagBar=topTags.map(([tag,cnt])=>{
    const pct=Math.round(cnt/n*100);
    const color=tag==='Etiketsiz'?'#8b8fa8':'#4f7ee6';
    return `<div class="stat-bar-row">
      <span class="stat-bar-label">${esc(tag)}</span>
      <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${pct}%;background:${color}"></div></div>
      <span class="stat-bar-val">${cnt}</span>
    </div>`;
  }).join('');

  const typeHtml=Object.entries(typeCounts).map(([t,c])=>
    `<span class="stat-chip ${t==='Çoktan Seçmeli'?'chip-cs':t==='Klasik'?'chip-kl':'chip-km'}">${esc(t)}: ${c}</span>`
  ).join('');

  const diffBar=[
    diffCounts.easy?`<span class="diff-chip easy">⭐ ${diffCounts.easy}</span>`:'',
    diffCounts.medium?`<span class="diff-chip medium">⭐⭐ ${diffCounts.medium}</span>`:'',
    diffCounts.hard?`<span class="diff-chip hard">⭐⭐⭐ ${diffCounts.hard}</span>`:'',
    diffCounts.unknown?`<span class="diff-chip unknown">? ${diffCounts.unknown}</span>`:'',
  ].filter(Boolean).join('');
  const durStr=totalDuration>0?(totalDuration>=60?Math.floor(totalDuration/60)+'s '+(totalDuration%60>0?(totalDuration%60).toFixed(0)+'dk':''):totalDuration.toFixed(0)+'dk'):'—';

  panel.innerHTML=
    `<div class="stats-header"><span>📊 İstatistikler</span><button class="stats-close" onclick="G('stats-panel').classList.add('hidden')">✕</button></div>`+
    `<div class="stats-row">`+
      `<div class="stat-card"><span class="stat-n">${n}</span><span class="stat-lbl">Soru</span></div>`+
      `<div class="stat-card"><span class="stat-n">${totalScore}</span><span class="stat-lbl">Top. Puan</span></div>`+
      `<div class="stat-card"><span class="stat-n">${durStr}</span><span class="stat-lbl">Top. Süre</span></div>`+
    `</div>`+
    (diffBar?`<div class="stats-diff">${diffBar}</div>`:'')+
    (topTags.length>1?`<div class="stats-section"><div class="stats-section-title">Konu Dağılımı</div>${tagBar}</div>`:'')+
    (Object.keys(typeCounts).length?`<div class="stats-section"><div class="stats-section-title">Soru Tipi</div><div class="stat-chips">${typeHtml}</div></div>`:'')+
    ``;
}


/* ═══ #7: OTOMATİK CEVAP TESPİTİ ══════════════════════
   fullText içinde bold/işaretli şık arar.
   Naif yaklaşım: en sona yazılan veya büyük harfli şık.
   Gerçek bold tespiti PDF.js textItem.fontName üzerinden.
═══════════════════════════════════════════════════════ */
function _detectAnswer(fullText){
  if(!fullText) return '';
  // "cevap: B" veya "yanıt: C" kalıbı
  const cvp=/[Cc]evap[:\s]+([A-E])/i.exec(fullText);
  if(cvp) return cvp[1].toUpperCase();
  // Parantez içinde tek şık: (B)
  const paren=/\(([A-E])\)\s*$/i.exec(fullText.trim());
  if(paren) return paren[1].toUpperCase();
  return '';
}

const PRESET_TAGS=['Fonksiyonlar','Türev','İntegral','Limit','Geometri','Cebir','Olasılık','İstatistik','Trigonometri','Diğer'];
function setQuestionTag(qid, tag){
  const q=S.questions.find(x=>x.id===qid);
  if(!q) return;
  snapshotState();
  q.tag=tag;
  updatePanel();
  saveSession();
}
function setQuestionScore(qid, score){
  const q=S.questions.find(x=>x.id===qid);
  if(!q) return;
  q.score=score;
  saveSession();
}

/* ═══ ÇOKLU PDF HAVUZU ══════════════════════════════════════ */
let _pdfIdCounter=0;
async function addToPdfPool(file){
  if(!file){ toast('Geçerli PDF seçin','error'); return; }
  // content:// ve diğer protokollerde file.type boş gelebilir — uzantıya da bak
  const isValidType=file.type==='application/pdf'||file.name?.toLowerCase().endsWith('.pdf');
  if(!isValidType){ toast('Geçerli PDF seçin','error'); return; }
  setLoading(true,'PDF yükleniyor...');
  try{
    let buf;
    try{
      buf=await file.arrayBuffer();
    }catch(e){
      // Fallback: FileReader ile oku (Android content:// için)
      buf=await new Promise((res,rej)=>{
        const fr=new FileReader();
        fr.onload=()=>res(fr.result);
        fr.onerror=()=>rej(fr.error);
        fr.readAsArrayBuffer(file);
      });
    }
    if(!buf||buf.byteLength===0){ toast('Dosya okunamadı (boş)','error'); return; }
    const pdfDoc=await pdfjsLib.getDocument({data:new Uint8Array(buf)}).promise;
    const id='pdf_'+(++_pdfIdCounter);
    const entry={id, fname:file.name, pdf:pdfDoc, pages:pdfDoc.numPages, rawItems:{}, regions:[]};
    S.pdfPool.push(entry);
    if(!S.pdf){
      await switchActivePdf(id);
    } else {
      toast(`"${file.name}" havuza eklendi (${pdfDoc.numPages} sayfa)`,'success');
      renderPdfPoolList();
    }
  }catch(e){
    console.error('addToPdfPool hatası:', e);
    toast('PDF eklenemedi: '+e.message,'error');
    sfLog('addToPdfPool HATA: '+e.message+' | '+e.stack?.slice(0,200));
  }
  finally{ setLoading(false); }
}
async function switchActivePdf(id){
  const entry=S.pdfPool.find(p=>p.id===id);
  if(!entry) return;
  // Mevcut PDF'in region/rawItems'ını kaydet
  if(S.activePdfId){
    const prev=S.pdfPool.find(p=>p.id===S.activePdfId);
    if(prev){ prev.regions=S.regions.filter(r=>r.pdfId===S.activePdfId); prev.rawItems={...S.rawItems}; }
  }
  S.pdf=entry.pdf; S.pages=entry.pages; S.fname=entry.fname;
  S.activePdfId=id;
  S.curPage=1; S.rawItems=entry.rawItems||{};
  S.dominantPattern=null;
  // Aktif PDF değişince sadece yeni PDF'e ait bölgeler görünür olmalı.
  // Diğer PDF'lerin bölgeleri kendi entry.regions'larında saklanır,
  // S.regions'a dahil edilmez — overlay'de görünmezler.
  const isNew=!entry._loaded;
  if(isNew){
    entry._loaded=true;
    // Yeni PDF için boş bölge listesiyle başla
    entry.regions=[];
  }
  // Her geçişte: sadece bu PDF'e ait bölgeler aktif
  S.regions=[...entry.regions];
  D.pageTotal.textContent=S.pages;
  D.fileLabel.textContent=S.fname;
  if(D.btnDetect) D.btnDetect.disabled=false;
  if(D.btnDetectModal) D.btnDetectModal.disabled=false;
  const _btnRange=G('btn-detect-range'); if(_btnRange) _btnRange.disabled=false;
  G('btn-open-pdf').disabled=false;
  await renderPage(1);
  updatePanel();
  openPdfModal();
  renderPdfPoolList();
  setStatus(`"${entry.fname}" yuklendi -- ${S.pages} sayfa`);
  toast(`PDF yuklendi (${S.pages} sayfa)`,'success');
}
function renderPdfPoolList(){
  const container=G('pdf-pool-list');
  if(!container) return;
  if(S.pdfPool.length<=1){ container.closest('.pdf-pool-bar')?.classList.add('hidden'); return; }
  container.closest('.pdf-pool-bar')?.classList.remove('hidden');
  container.innerHTML='';
  S.pdfPool.forEach(entry=>{
    const wrap=document.createElement('div');
    wrap.className='pool-pdf-wrap';
    const btn=document.createElement('button');
    btn.className='pool-pdf-btn'+(entry.id===S.activePdfId?' active':'');
    btn.title=entry.fname;
    btn.innerHTML=`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`+
      `<span>${entry.fname.replace('.pdf','').slice(0,18)}</span>`;
    btn.addEventListener('click',()=>switchActivePdf(entry.id));
    // × silme butonu
    const del=document.createElement('button');
    del.className='pool-pdf-del';
    del.title='Havuzdan kaldır';
    del.textContent='×';
    del.addEventListener('click',function(e){
      e.stopPropagation();
      removePdfFromPool(entry.id);
    });
    wrap.appendChild(btn);
    wrap.appendChild(del);
    container.appendChild(wrap);
  });
}
function removePdfFromPool(id){
  const idx=S.pdfPool.findIndex(p=>p.id===id);
  if(idx<0) return;
  const entry=S.pdfPool[idx];
  // Aktif PDF kaldırılıyorsa başkasına geç
  if(S.activePdfId===id){
    const next=S.pdfPool.find(p=>p.id!==id);
    if(next){
      switchActivePdf(next.id);
    } else {
      S.pdf=null; S.activePdfId=null; S.pages=0; S.fname='';
      S.regions=[]; S.questions=[]; S.rid=0; S.qnum=1;
      S.smartLayout=null; S.smartOrder=null; S.thumbCache={};
      updatePanel(); redraw();
    }
  }
  // İlgili region'ları temizle
  S.regions=S.regions.filter(r=>r.pdfId!==id);
  S.questions=S.questions.filter(q=>{
    // Bu PDF'e ait soruları sil
    const r=S.regions.find(x=>x.id===q.rid);
    return !!r;
  });
  S.questions.forEach((q,i)=>{q.num=i+1;});
  S.pdfPool.splice(idx,1);
  toast(`"${entry.fname}" kaldırıldı`,'info',2000);
  renderPdfPoolList();
  updatePanel();
  saveSession();
}

/* ═══ TARAMA ÖNİZLE / ONAYLA / REDDET ══════════════════════ */
function openScanReview(found){
  if(!found.length){ toast('Soru bulunamadı','info'); return; }
  S.pendingRegions=[...found];
  sfLog(`openScanReview: ${found.length} bölge, ilk id=${found[0]?.id}`);
  const modal=G('scan-review-modal');
  if(!modal){
    sfLog('UYARI: scan-review-modal bulunamadı — direkt onaylanıyor');
    approveScanAll(found); return;
  }
  // PDF modal'ı kapat ki scan-review önde görünsün
  if(D.pdfModal) D.pdfModal.classList.add('hidden');
  const list=G('scan-review-list');
  list.innerHTML='';
  // #8: Toplu seçim toolbar
  const toolbar=G('scan-review-toolbar');
  if(toolbar){
    toolbar.innerHTML=
      `<button class="scan-bulk-btn" id="scan-select-all">✓ Tümünü Seç</button>`+
      `<button class="scan-bulk-btn" id="scan-reject-all">✕ Tümünü Reddet</button>`+
      `<span class="scan-count-badge" id="scan-count">${found.length} soru</span>`;
    G('scan-select-all').onclick=()=>{
      document.querySelectorAll('.scan-item').forEach(li=>{
        li.classList.add('scan-approved'); li.classList.remove('scan-rejected');
      });
    };
    G('scan-reject-all').onclick=()=>{
      document.querySelectorAll('.scan-item').forEach(li=>{
        li.classList.add('scan-rejected'); li.classList.remove('scan-approved');
      });
    };
  }
  found.forEach((r,i)=>{
    const li=document.createElement('div');
    li.className='scan-item'; li.dataset.rid=r.id;
    // Thumbnail için canvas placeholder
    const thumbId='sr-thumb-'+r.id;
    const _conf=r.score||r._meta?.confidence||0;
    const _confClass=_conf>=55?'conf-high':_conf>=25?'conf-mid':'conf-low';
    const _confLabel=_conf>=55?'✓':_conf>=25?'~':'?';
    li.innerHTML=
      `<div class="scan-item-num">${i+1}</div>`+
      `<canvas class="scan-item-thumb" id="${thumbId}" width="60" height="42"></canvas>`+
      `<div class="scan-item-text">`+
        `${esc(r.text.slice(0,60))}<br/>`+
        `<small>Sayfa ${r.page}</small>`+
        `<span class="scan-conf-badge ${_confClass}" title="Güven: ${Math.round(_conf)}%">${_confLabel} ${Math.round(_conf)}%</span>`+
      `</div>`+
      `<div class="scan-item-actions">`+
        `<button class="scan-btn approve" data-rid="${r.id}" title="Ekle">✓</button>`+
        `<button class="scan-btn reject" data-rid="${r.id}" title="Reddet">✕</button>`+
      `</div>`;
    li.querySelector('.scan-btn.approve').addEventListener('click',function(){
      li.classList.add('scan-approved'); li.classList.remove('scan-rejected');
    });
    li.querySelector('.scan-btn.reject').addEventListener('click',function(){
      li.classList.add('scan-rejected'); li.classList.remove('scan-approved');
      recordFeedback(r,'reject');
    });
    list.appendChild(li);
    // Thumbnail async yükle
    if(S.pdf){
      (async()=>{
        try{
          const img=await regionImg(r,0.6,false);
          if(!img) return;
          const cvs=document.getElementById(thumbId);
          if(!cvs) return;
          const im=new Image();
          im.onload=function(){
            const sc=Math.min(60/im.width,42/im.height,1);
            cvs.width=Math.round(im.width*sc); cvs.height=Math.round(im.height*sc);
            const ctx=cvs.getContext('2d');
            ctx.fillStyle='#fff'; ctx.fillRect(0,0,cvs.width,cvs.height);
            ctx.drawImage(im,0,0,cvs.width,cvs.height);
          };
          im.src=img.dataUrl;
        }catch(e){}
      })();
    }
  });
  modal.classList.remove('hidden');
}
function approveScanAll(found){
  if(!found.length) return;
  snapshotState();
  S.regions.push(...found);
  for(const r of found){
    r.confirmed=true;
    r.pdfId=S.activePdfId||null;
    // #7: Şık satırlarından otomatik cevap tespit et
    const detectedAnswer=_detectAnswer(r.fullText||r.text||'');
    S.questions.push({id:'q'+Date.now()+'_'+r.id,rid:r.id,page:r.page,text:r.text,full:r.fullText,num:S.qnum++,answer:detectedAnswer});
  }
  // Buton durumlarını güncelle
  D.btnExport.disabled=false;
  D.btnSmartLayout.disabled=false;
  if(D.btnPrint) D.btnPrint.disabled=false;
  if(D.btnClassify) D.btnClassify.disabled=false;
  if(D.btnClear) D.btnClear.disabled=false;
  S.smartLayout=null;
  // Aktif PDF entry'sini güncelle
  const _ae=S.pdfPool.find(p=>p.id===S.activePdfId);
  if(_ae) _ae.regions=[...S.regions];
  updatePanel();
  redraw(); // onaylanan bölgeleri overlay'e çiz
  buildThumbCache().then(()=>updatePanel());
  saveSession();
}
function closeScanReview(approveSelected){
  const modal=G('scan-review-modal');
  if(approveSelected){
    const approved=[];
    const items=document.querySelectorAll('.scan-item:not(.scan-rejected)');
    sfLog(`closeScanReview: items=${items.length} pending=${S.pendingRegions.length}`);
    items.forEach(li=>{
      const rid=li.dataset.rid;
      sfLog(`  rid=${rid}`);
      const r=S.pendingRegions.find(x=>x.id===rid);
      sfLog(`  found=${!!r}`);
      if(r) approved.push(r);
    });
    sfLog(`approved=${approved.length}`);
    approveScanAll(approved);
    toast(`${approved.length} soru eklendi`,'success');
  }
  if(modal) modal.classList.add('hidden');
  S.pendingRegions=[];
  // PDF modal'ı geri aç
  if(S.pdf && D.pdfModal) D.pdfModal.classList.remove('hidden');
}

/* ═══ A/B FORM KARIŞTIRMA ═══════════════════════════════════ */
function shuffleQuestions(){
  if(S.questions.length<2){ toast('Yeterli soru yok','info'); return; }
  snapshotState();
  // Fisher-Yates
  const arr=[...S.questions];
  for(let i=arr.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]]=[arr[j],arr[i]];
  }
  arr.forEach((q,i)=>{q.num=i+1;});
  S.questions=arr;
  S.smartLayout=null; S.smartOrder=null;
  updatePanel();
  saveSession();
  toast('Soru sırası karıştırıldı (A/B form)','success');
}

/* ═══ #4: A/B FORM — İKİ AYRI PDF ════════════════════════ */
async function generateDualForm(){
  if(!S.questions.length){ toast('Önce soru seçin','error'); return; }
  setLoading(true,'A/B Form PDF oluşturuluyor…');
  try{
    // A formu — mevcut sıra
    const origOffset=S.qNumOffset||0;
    await _generateFormPdf([...S.questions],'sinav-A-formu.pdf','A',origOffset);
    // B formu — Fisher-Yates karıştır
    const shuffled=[...S.questions];
    for(let i=shuffled.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];
    }
    await _generateFormPdf(shuffled,'sinav-B-formu.pdf','B',origOffset);
    toast('A ve B formu indirildi!','success');
  }catch(e){ toast('Hata: '+e.message,'error'); console.error(e); }
  finally{ setLoading(false); }
}

async function _generateFormPdf(questions, filename, formLabel, qOffset){
  clearRenderPageCache();
  const jsPDFLib=window.jspdf;
  const pdf=new jsPDFLib.jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  await ensurePdfFont(pdf);
  const sp=Math.max(2,parseInt(D.spacingIn.value)||6);
  const colCount=S.outMode==='a4-1col'?1:S.outMode==='a4-3col'?3:2;
  const lay=getLAY();
  const totalColW=(A4W-lay.MRG_L-lay.MRG_R-(colCount-1)*lay.CGAP)/colCount;
  const origQ=S.questions;
  S.questions=questions; // geçici swap — buildLayoutN için
  const pages=await buildLayoutN(questions,sp,colCount,getStudentRowOffset()+getExamInfoOffset());
  S.questions=origQ;
  const font=_pdfFontState.name;
  let qn=0;
  async function drawHdr(p){
    const hdrPng=await renderTextBandToPng(S.hdr.text+' — Form '+formLabel,'Sayfa '+p,S.hdr.bg,S.hdr.color,S.hdr.fontSize,A4W,HDRH);
    if(hdrPng) pdf.addImage(hdrPng,'PNG',0,0,A4W,HDRH);
    const examH=getExamInfoOffset();
    if(examH>0){const ep=await renderExamInfoBandToPng(A4W,examH);if(ep) pdf.addImage(ep,'PNG',0,HDRH,A4W,examH);}
    drawStudentInfoRow(pdf,font,lay);
    drawWatermark(pdf,A4W,A4H);
  }
  for(let pi=0;pi<pages.length;pi++){
    if(pi>0) pdf.addPage();
    await drawHdr(pi+1);
    if(colCount>1){
      const lineY=lay.contentStart+getStudentRowOffset()+getExamInfoOffset();
      for(let c=1;c<colCount;c++){
        const lx=lay.MRG_L+c*(totalColW+lay.CGAP)-lay.CGAP/2;
        pdf.setDrawColor(200,200,200);pdf.setLineWidth(0.3);pdf.setLineDashPattern([2,2],0);
        pdf.line(lx,lineY,lx,A4H-lay.MRG_B-FTRH);pdf.setLineDashPattern([],0);
      }
    }
    const allItems=[];
    for(let c=0;c<colCount;c++){const col=pages[pi].cols[c];if(col)col.items.forEach(ei=>allItems.push(ei));}
    allItems.sort((a,b)=>a.col!==b.col?a.col-b.col:a.y-b.y);
    for(const entry of allItems){
      const item=entry.item,y=entry.y,col=entry.col;
      const cx=lay.MRG_L+col*(totalColW+lay.CGAP);
      pdf.setFontSize(7);pdf.setFont(font,'bold');pdf.setTextColor(0,0,0);
      pdf.text(''+((qOffset||0)+(++qn))+'.',cx,y+BADGE_H-1);
      pdf.setFont(font,'normal');
      setLoading(true,`Form ${formLabel}… ${qn}/${questions.length}`);
      const _sp=(item.q.sizePercent||100)/100;
      const _sc=Math.max(1.8,getExportScale(false)*Math.sqrt(_sp));
      const hiImg=await regionImg(item.r,_sc,true);
      if(hiImg){
        const bW=totalColW*_sp,bH=hiImg.mmH*(bW/hiImg.mmW);
        let dW=Math.min(bW,totalColW),dH=bH*(dW/bW);
        const mH=lay.usableH*0.92;if(dH>mH){dH=mH;dW=hiImg.mmW*(dH/hiImg.mmH);dW=Math.min(dW,totalColW);}
        pdf.addImage(hiImg.dataUrl,'PNG',cx,y+BADGE_H,dW,dH,undefined,'FAST');
        drawScoreBox(pdf,cx,y+BADGE_H+dH-1,totalColW,font);
      }
    }
  }
  if(S.answerKey) await addAnswerKeyPage(pdf,questions,font);
  try{const blob=pdf.output('blob');const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
  catch(e){pdf.save(filename);}
}

/* ═══ ÖĞRENCİ BİLGİ ALANI ══════════════════════════════════ */
// drawHdr'a ek satır ekler: Ad Soyad / Sınıf / Tarih
const STUDENT_ROW_H=14; // mm
function drawStudentInfoRow(pdf, font, lay){
  if(!S.hdr.studentInfo) return;
  const y=HDRH+2;
  pdf.setDrawColor(200,200,200); pdf.setLineWidth(0.2);
  pdf.rect(lay.MRG_L, y, A4W-lay.MRG_L-lay.MRG_R, STUDENT_ROW_H);
  const fields=[{label:'Ad Soyad',w:0.45},{label:'Sınıf',w:0.25},{label:'Tarih',w:0.30}];
  const totalW=A4W-lay.MRG_L-lay.MRG_R;
  let curX=lay.MRG_L;
  fields.forEach((f,i)=>{
    const fw=totalW*f.w;
    pdf.setFontSize(7); pdf.setFont(font,'bold'); pdf.setTextColor(100,100,100);
    pdf.text(pdfText(f.label+':'), curX+2, y+4);
    pdf.setDrawColor(180,180,180); pdf.setLineWidth(0.15);
    pdf.line(curX+20, y+STUDENT_ROW_H-4, curX+fw-2, y+STUDENT_ROW_H-4);
    if(i<fields.length-1){
      pdf.setDrawColor(200,200,200); pdf.setLineWidth(0.2);
      pdf.line(curX+fw, y, curX+fw, y+STUDENT_ROW_H);
    }
    curX+=fw;
  });
  pdf.setTextColor(0);
}
function getStudentRowOffset(){ return S.hdr.studentInfo ? STUDENT_ROW_H+2 : 0; }

/* ═══ TAG DROPDOWN ══════════════════════════════════════════ */
let _tagTargetQid=null;
function openTagDropdown(qid, anchor){
  _tagTargetQid=qid;
  const dd=G('tag-dropdown');
  const list=G('tag-dropdown-list');
  const q=S.questions.find(x=>x.id===qid);
  list.innerHTML='';
  const clearBtn=document.createElement('button');
  clearBtn.className='tag-opt'+((!q||!q.tag)?' active':'');
  clearBtn.textContent='— Etiketsiz —';
  clearBtn.addEventListener('click',()=>{ setQuestionTag(qid,''); dd.classList.add('hidden'); });
  list.appendChild(clearBtn);
  PRESET_TAGS.forEach(tag=>{
    const btn=document.createElement('button');
    btn.className='tag-opt'+((q&&q.tag===tag)?' active':'');
    btn.textContent=tag;
    btn.addEventListener('click',()=>{ setQuestionTag(qid,tag); dd.classList.add('hidden'); });
    list.appendChild(btn);
  });
  const rect=anchor.getBoundingClientRect();
  dd.style.left=rect.left+'px';
  dd.style.top=(rect.bottom+4)+'px';
  dd.classList.remove('hidden');
}
document.addEventListener('click',function(e){
  const dd=G('tag-dropdown');
  if(dd&&!dd.contains(e.target)&&!e.target.classList.contains('q-tag-btn')){
    dd.classList.add('hidden');
  }
});

/* ═══ SCAN REVIEW EVENTS ════════════════════════════════════ */
(function(){
  const appr=G('scan-review-approve');
  const canc=G('scan-review-cancel');
  const cls=G('scan-review-close');
  if(appr) appr.addEventListener('click',()=>closeScanReview(true));
  if(canc) canc.addEventListener('click',()=>closeScanReview(false));
  if(cls)  cls.addEventListener('click',()=>closeScanReview(false));
})();

/* ═══ JSON IMPORT / EXPORT ══════════════════════════════════ */
(function(){
  const expBtn=G('btn-export-json');
  const impInp=G('import-json-input');
  if(expBtn) expBtn.addEventListener('click',exportSessionJSON);
  if(impInp) impInp.addEventListener('change',function(e){
    if(e.target.files[0]) importSessionJSON(e.target.files[0]);
    e.target.value='';
  });
})();

/* ═══ SHUFFLE / UNDO ════════════════════════════════════════ */
(function(){
  const shuf=G('btn-shuffle');
  const undo=G('btn-undo');
  const pool=G('pdf-pool-upload');
  const stInf=G('toggle-student-info');
  if(shuf) shuf.addEventListener('click',shuffleQuestions);
  if(undo) undo.addEventListener('click',undoAction);
  if(pool) pool.addEventListener('change',function(e){
    if(e.target.files[0]) addToPdfPool(e.target.files[0]);
    e.target.value='';
  });
  if(stInf) stInf.addEventListener('change',function(){
    S.hdr.studentInfo=this.checked; S.smartLayout=null; saveSession();
  });
})();

/* ═══ APPLE PENCIL / S-PEN — Kalem ile otomatik çizim ══════
   pointerType === 'pen' ise seçim modunda olsanız bile
   otomatik olarak çizim moduna geçer, bırakınca geri döner.
════════════════════════════════════════════════════════════ */
let _pencilAutoMode=false;
D.ovCvs.addEventListener('pointerdown',function(e){
  if(e.pointerType==='pen' && !S.drawMode && S.pdf && S.spenMode){
    _pencilAutoMode=true;
    enterDraw();
  }
},{passive:false,capture:true});
D.ovCvs.addEventListener('pointerup',function(e){
  if(e.pointerType==='pen' && _pencilAutoMode && S.spenMode){
    _pencilAutoMode=false;
    setTimeout(()=>{ if(!S.drawMode) return; enterSel(); },50);
  }
},{passive:false,capture:true});

/* ═══ S-PEN TOGGLE BUTONU ═══════════════════════════════════ */
(function(){
  const btn=G('btn-spen-toggle');
  if(!btn) return;
  function updateSpenUI(){
    btn.classList.toggle('active', S.spenMode);
    btn.title=S.spenMode ? 'S-Pen modu: AÇIK — kapatmak için dokun' : 'S-Pen modu: KAPALI — açmak için dokun';
  }
  btn.addEventListener('click',function(){
    S.spenMode=!S.spenMode;
    updateSpenUI();
    toast(S.spenMode ? 'S-Pen modu açıldı ✏' : 'S-Pen modu kapatıldı', S.spenMode?'success':'info', 1800);
    if(S.spenMode && navigator.vibrate) navigator.vibrate([20,10,20]);
  });
  updateSpenUI();
})();

/* ═══ SAYFA GEÇİŞİNDE SORU SEÇİMİNİ KORU ══════════════════
   renderPage çağrıldığında mevcut sayfanın region'ları
   zaten S.regions içinde. Sorun: detectedScale değişince
   koordinatlar kaymıyor. rescaleRegions bunu hallediyor
   ama sayfa geçişinde scale aynı kalıyor — sorun yok.
   Ekstra güvence: sayfa geçişinde float panel gizlenir
   ama seçili region'lar kaybolmaz (zaten S.regions'da).
   Bu kısım doğrulama amaçlı — mevcut kod zaten koruyor.
════════════════════════════════════════════════════════════ */

/* ═══ DUPLICATE SORU TESPİTİ ═══════════════════════════════ */
function checkDuplicates(){
  const dups=[];
  for(let i=0;i<S.questions.length;i++){
    const qi=S.questions[i];
    const ri=S.regions.find(r=>r.id===qi.rid);
    if(!ri) continue;
    for(let j=i+1;j<S.questions.length;j++){
      const qj=S.questions[j];
      const rj=S.regions.find(r=>r.id===qj.rid);
      if(!rj) continue;
      // Aynı sayfa + koordinat örtüşmesi > %60
      if(ri.page===rj.page && overlap(ri,rj)>0.6){
        dups.push({i,j,qi,qj});
      }
      // Aynı metin içeriği (> 80% benzerlik)
      if(ri.page!==rj.page){
        const a=qi.text.trim().toLowerCase().slice(0,50);
        const b=qj.text.trim().toLowerCase().slice(0,50);
        if(a.length>10 && b.length>10 && a===b) dups.push({i,j,qi,qj});
      }
    }
  }
  return dups;
}
function showDuplicateWarning(){
  const dups=checkDuplicates();
  if(!dups.length) return;
  const msg=dups.map(d=>`Soru ${d.i+1} ve ${d.j+1}`).join(', ');
  toast(`⚠️ Tekrar eden soru tespit edildi: ${msg}`,'error',6000);
}

/* ═══ SINAV ŞABLONLARı ══════════════════════════════════════ */
const TEMPLATES_KEY='sinavforge_templates_v1';
function loadTemplates(){
  try{ S.templates=JSON.parse(localStorage.getItem(TEMPLATES_KEY)||'[]'); }catch(e){ S.templates=[]; }
}
function saveTemplate(name){
  if(!name||!S.questions.length){ toast('Şablon adı girin ve en az 1 soru seçin','error'); return; }
  loadTemplates();
  const tpl={
    id:'tpl_'+Date.now(), name, createdAt:new Date().toISOString(),
    questions:JSON.parse(JSON.stringify(S.questions)),
    // FIX #4: pdfId şablona kaydediliyor — çoklu PDF pool uyumu
    regions:JSON.parse(JSON.stringify(S.regions.filter(r=>r.confirmed).map(r=>({
      ...r, pdfId:r.pdfId||S.activePdfId||null
    })))),
    // Hangi PDF'lerin gerekli olduğunu kaydet
    pdfPoolMeta:S.pdfPool.map(p=>({id:p.id, fname:p.fname})),
    activePdfId:S.activePdfId||null,
    hdr:{...S.hdr}, mrg:{...S.mrg}, outMode:S.outMode,
    scoreBox:S.scoreBox, answerKey:S.answerKey, examInfo:{...S.examInfo},
  };
  S.templates.unshift(tpl);
  if(S.templates.length>20) S.templates=S.templates.slice(0,20);
  try{ localStorage.setItem(TEMPLATES_KEY, JSON.stringify(S.templates)); }catch(e){}
  toast(`"${name}" şablonu kaydedildi`,'success');
  renderTemplateList();
}
function loadTemplate(id){
  loadTemplates();
  const tpl=S.templates.find(t=>t.id===id);
  if(!tpl){ toast('Şablon bulunamadı','error'); return; }
  snapshotState();
  // FIX #4: region'ları pdfId ile yükle; eksik PDF varsa uyar
  if(tpl.pdfPoolMeta && tpl.pdfPoolMeta.length > 1){
    const missing=tpl.pdfPoolMeta.filter(pm=>!S.pdfPool.find(p=>p.fname===pm.fname));
    if(missing.length){
      const names=missing.map(p=>p.fname).join(', ');
      toast(`Şablon uyarısı: "${names}" yüklü değil. Görsel olmayabilir.`,'info',6000);
    }
  }
  S.regions=[...S.regions.filter(r=>!r.confirmed), ...tpl.regions.map(r=>({
    ...r, confirmed:true,
    pdfId:r.pdfId||S.activePdfId||null,
  }))];
  S.questions=tpl.questions.map((q,i)=>({...q,num:i+1}));
  S.qnum=S.questions.length+1;
  if(tpl.hdr) Object.assign(S.hdr,tpl.hdr);
  if(tpl.mrg) Object.assign(S.mrg,tpl.mrg);
  if(tpl.outMode) S.outMode=tpl.outMode;
  if(tpl.examInfo) Object.assign(S.examInfo,tpl.examInfo);
  S.scoreBox=tpl.scoreBox||false;
  S.answerKey=tpl.answerKey||false;
  S.smartLayout=null; S.smartOrder=null; S.thumbCache={};
  syncHdrUI(); updatePanel(); saveSession();
  buildThumbCache().then(()=>updatePanel());
  toast(`"${tpl.name}" şablonu yüklendi`,'success');
  closeSettings();
}
function deleteTemplate(id){
  S.templates=S.templates.filter(t=>t.id!==id);
  try{ localStorage.setItem(TEMPLATES_KEY, JSON.stringify(S.templates)); }catch(e){}
  renderTemplateList();
  toast('Şablon silindi','info',2000);
}
function renderTemplateList(){
  const container=G('template-list');
  if(!container) return;
  loadTemplates();
  if(!S.templates.length){
    container.innerHTML='<div class="tpl-empty">Kayıtlı şablon yok</div>';
    return;
  }
  container.innerHTML='';
  S.templates.forEach(tpl=>{
    const row=document.createElement('div');
    row.className='tpl-row';
    const d=new Date(tpl.createdAt);
    const dateStr=d.toLocaleDateString('tr-TR');
    row.innerHTML=
      `<div class="tpl-info"><strong>${esc(tpl.name)}</strong><span>${tpl.questions.length} soru · ${dateStr}</span></div>`+
      `<div class="tpl-actions">`+
        `<button class="tpl-btn load" data-id="${tpl.id}">Yükle</button>`+
        `<button class="tpl-btn del" data-id="${tpl.id}">Sil</button>`+
      `</div>`;
    row.querySelector('.tpl-btn.load').addEventListener('click',()=>loadTemplate(tpl.id));
    row.querySelector('.tpl-btn.del').addEventListener('click',()=>{ if(confirm('Şablonu sil?')) deleteTemplate(tpl.id); });
    container.appendChild(row);
  });
}

/* ═══ WATERMARK ══════════════════════════════════════════════ */
function drawWatermark(pdf, W, H){
  if(!S.watermark.enabled) return;
  const op=S.watermark.opacity||0.12;
  if(S.watermark.imageDataUrl){
    try{
      // Görsel watermark — sayfanın ortasına büyük, şeffaf
      const iW=80, iH=80;
      pdf.saveGraphicsState();
      pdf.setGState(new pdf.GState({opacity:op}));
      pdf.addImage(S.watermark.imageDataUrl,'PNG',(W-iW)/2,(H-iH)/2,iW,iH);
      pdf.restoreGraphicsState();
    }catch(e){}
  } else if(S.watermark.text){
    // Metin watermark
    const r=hexToRgbArr('#888888');
    pdf.setTextColor(r[0],r[1],r[2]);
    pdf.setFontSize(36);
    pdf.setFont(_pdfFontState.name,'bold');
    const x=W/2, y=H/2;
    pdf.text(pdfText(S.watermark.text), x, y, {angle:45, align:'center'});
    pdf.setTextColor(0);
  }
}
function handleWatermarkImageUpload(file){
  if(!file) return;
  const reader=new FileReader();
  reader.onload=function(e){
    S.watermark.imageDataUrl=e.target.result;
    S.watermark.enabled=true;
    const tog=G('toggle-watermark');
    if(tog) tog.checked=true;
    toast('Logo/watermark yüklendi','success');
    saveSession();
  };
  reader.readAsDataURL(file);
}

/* ═══ SINAV BİLGİLERİ (DERS / SINIF / TARİH) ═══════════════ */
function syncExamInfo(){
  const lesson=G('exam-lesson'), cls=G('exam-class'), date=G('exam-date');
  if(lesson) S.examInfo.lesson=lesson.value;
  if(cls)    S.examInfo.className=cls.value;
  if(date)   S.examInfo.date=date.value;
  S.smartLayout=null;
  saveSession();
}
function drawExamInfoBand(pdf, font, lay){
  if(!S.examInfo.lesson&&!S.examInfo.className&&!S.examInfo.date) return;
  const EH=10; // mm
  const y=HDRH;
  const bg=hexToRgbArr('#f5f5f5');
  pdf.setFillColor(bg[0],bg[1],bg[2]);
  pdf.rect(0,y,A4W,EH,'F');
  pdf.setDrawColor(220,220,220); pdf.setLineWidth(0.2);
  pdf.line(0,y+EH,A4W,y+EH);
  pdf.setFontSize(8); pdf.setFont(font,'normal'); pdf.setTextColor(60,60,60);
  const parts=[];
  if(S.examInfo.lesson) parts.push('Ders: '+pdfText(S.examInfo.lesson));
  if(S.examInfo.className) parts.push('Sınıf: '+pdfText(S.examInfo.className));
  if(S.examInfo.date) parts.push('Tarih: '+pdfText(S.examInfo.date));
  pdf.text(parts.join('   |   '), lay.MRG_L, y+6.5);
  pdf.setTextColor(0);
}
function getExamInfoOffset(){ return (S.examInfo.lesson||S.examInfo.className||S.examInfo.date)?10:0; }

/* ═══ SORU BANKASI ════════════════════════════════════════════ */
const BANK_KEY='sinavforge_bank_v1';
function loadBank(){ try{ S.questionBank=JSON.parse(localStorage.getItem(BANK_KEY)||'[]'); }catch(e){ S.questionBank=[]; } }
function saveToBank(){
  if(!S.questions.length){ toast('Bankaya eklenecek soru yok','info'); return; }
  loadBank();
  let added=0;
  S.questions.forEach(q=>{
    const existing=S.questionBank.find(b=>b.text===q.text&&b.tag===q.tag);
    if(!existing){
      S.questionBank.push({
        id:'bk_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),
        text:q.text, full:q.full||'', tag:q.tag||'',
        score:q.score||0, aiType:q.aiType||null,
        addedAt:new Date().toISOString(), fname:S.fname,
      });
      added++;
    }
  });
  try{ localStorage.setItem(BANK_KEY, JSON.stringify(S.questionBank)); }catch(e){}
  toast(`${added} soru bankaya eklendi`,'success');
  renderBankList();
}
function renderBankList(){
  const container=G('bank-list');
  if(!container) return;
  loadBank();
  if(!S.questionBank.length){
    container.innerHTML='<div class="tpl-empty">Banka boş</div>';
    return;
  }
  // Konuya göre grupla
  const byTag={};
  S.questionBank.forEach(q=>{ const t=q.tag||'Etiketlenmemiş'; (byTag[t]=byTag[t]||[]).push(q); });
  container.innerHTML='';
  Object.entries(byTag).forEach(([tag,qs])=>{
    const grp=document.createElement('div');
    grp.className='bank-group';
    grp.innerHTML=`<div class="bank-group-title">${esc(tag)} <span>(${qs.length})</span></div>`;
    qs.forEach(q=>{
      const row=document.createElement('div');
      row.className='bank-row';
      row.innerHTML=
        `<div class="bank-text">${esc(q.text.slice(0,60))}</div>`+
        `<div class="bank-src">${esc(q.fname||'')}</div>`;
      grp.appendChild(row);
    });
    container.appendChild(grp);
  });
}

/* ═══ PAYLAŞIM — Link ile soru listesi paylaş ════════════════ */
function generateShareLink(){
  if(!S.questions.length){ toast('Paylaşılacak soru yok','info'); return; }
  const data={
    v:1, fname:S.fname,
    questions:S.questions.map(q=>({text:q.text,full:q.full||'',tag:q.tag||'',score:q.score||0,page:q.page})),
    hdr:{...S.hdr}, outMode:S.outMode,
  };
  const json=JSON.stringify(data);
  // Base64 encode — link içine göm
  const b64=btoa(unescape(encodeURIComponent(json)));
  // URL: mevcut sayfanın URL'ine #share=... parametresi ekle
  const url=window.location.origin+window.location.pathname+'#share='+b64;
  // Panoya kopyala
  navigator.clipboard.writeText(url).then(()=>{
    toast('Paylaşım linki panoya kopyalandı!','success',4000);
  }).catch(()=>{
    // Fallback: modal içinde göster
    const shareModal=G('share-link-modal');
    const shareInput=G('share-link-input');
    if(shareModal&&shareInput){ shareInput.value=url; shareModal.classList.remove('hidden'); }
    else{ prompt('Paylaşım linki:', url); }
  });
}
function checkShareLink(){
  const hash=window.location.hash;
  if(!hash.startsWith('#share=')) return;
  try{
    const b64=hash.slice(7);
    const json=decodeURIComponent(escape(atob(b64)));
    const data=JSON.parse(json);
    if(!data.questions) return;
    // Sayfa yüklenince banner göster
    setTimeout(()=>{
      const banner=G('share-import-banner');
      const info=G('share-import-info');
      if(banner&&info){
        info.textContent=`"${data.fname||'Paylaşılan'}" — ${data.questions.length} soru`;
        banner.classList.remove('hidden');
        G('btn-import-share').addEventListener('click',()=>{
          // Bölge olmadan sadece metin/etiket bilgisi yükle
          data.questions.forEach((q,i)=>{
            S.questions.push({id:'shared_'+Date.now()+'_'+i,rid:'',page:q.page||1,text:q.text,full:q.full||'',num:S.qnum++,tag:q.tag||'',score:q.score||0});
          });
          updatePanel(); saveSession();
          banner.classList.add('hidden');
          toast(`${data.questions.length} soru eklendi`,'success');
          history.replaceState(null,'',window.location.pathname);
        });
        G('btn-dismiss-share').addEventListener('click',()=>{
          banner.classList.add('hidden');
          history.replaceState(null,'',window.location.pathname);
        });
      }
    },800);
  }catch(e){ console.warn('Share link parse error',e); }
}
// Sayfa yüklenince share link kontrol et
checkShareLink();

/* ═══ #10: HISTORY PANEL EVENTS ════════════════════════ */
(function(){
  const bar=G('history-bar');
  const restoreBtn=G('btn-restore-history');
  const closeBtn=G('btn-close-history');
  const histBtn=G('btn-open-history');
  if(restoreBtn) restoreBtn.addEventListener('click',function(){
    const sel=G('history-select');
    if(sel) restoreFromHistory(sel.value);
  });
  if(closeBtn) closeBtn.addEventListener('click',function(){
    G('history-bar')?.classList.add('hidden');
  });
  if(histBtn) histBtn.addEventListener('click',openHistoryPanel);
})();
/* ═══ YENİ ÖZELLİK EVENT LİSTENER'LARI ════════════════════ */
(function(){
  // Sınav bilgileri
  ['exam-lesson','exam-class','exam-date'].forEach(id=>{
    const el=G(id); if(el) el.addEventListener('change',syncExamInfo);
  });

  // Watermark
  const togWm=G('toggle-watermark');
  if(togWm) togWm.addEventListener('change',function(){ S.watermark.enabled=this.checked; saveSession(); });
  const wmText=G('watermark-text');
  if(wmText) wmText.addEventListener('input',function(){ S.watermark.text=this.value; saveSession(); });
  const wmOp=G('watermark-opacity');
  if(wmOp) wmOp.addEventListener('input',function(){
    S.watermark.opacity=parseInt(this.value)/100;
    const lbl=G('watermark-opacity-label'); if(lbl) lbl.textContent='%'+this.value;
    saveSession();
  });
  const wmImg=G('watermark-image');
  if(wmImg) wmImg.addEventListener('change',function(e){
    if(e.target.files[0]){
      handleWatermarkImageUpload(e.target.files[0]);
      const nm=G('watermark-image-name'); if(nm) nm.textContent=e.target.files[0].name;
    }
  });

  // Şablonlar
  const btnSaveTpl=G('btn-save-template');
  if(btnSaveTpl) btnSaveTpl.addEventListener('click',function(){
    const inp=G('template-name-input');
    saveTemplate(inp?inp.value.trim():'');
    if(inp) inp.value='';
  });
  const btnSaveBank=G('btn-save-to-bank');
  if(btnSaveBank) btnSaveBank.addEventListener('click',saveToBank);

  // Paylaşım
  const btnShare=G('btn-share-link');
  if(btnShare) btnShare.addEventListener('click',function(){
    generateShareLink();
    // Aynı zamanda box'ı göster
    const box=G('share-link-box');
    if(box) box.classList.remove('hidden');
  });
  const btnCopyShare=G('btn-copy-share');
  if(btnCopyShare) btnCopyShare.addEventListener('click',function(){
    const inp=G('share-link-input');
    if(inp){ inp.select(); navigator.clipboard.writeText(inp.value).then(()=>toast('Kopyalandı','success',1500)); }
  });

  // PDF kalite seçici
  document.querySelectorAll('input[name="pdf-dpi"]').forEach(function(inp){
    if(inp.value===S.exportQuality) inp.checked=true;
    inp.addEventListener('change',function(e){
      S.exportQuality=e.target.value;
      document.querySelectorAll('.dpi-btn').forEach(l=>l.classList.remove('active'));
      e.target.closest('.dpi-btn').classList.add('active');
      saveSession();
    });
  });

  // Drawer açılınca şablon/banka listesini güncelle
  const btnSettings=G('btn-settings');
  if(btnSettings) btnSettings.addEventListener('click',function(){
    renderTemplateList(); renderBankList();
    // examInfo alanlarını sync et
    const el=G('exam-lesson'),ec=G('exam-class'),ed=G('exam-date');
    if(el) el.value=S.examInfo.lesson||'';
    if(ec) ec.value=S.examInfo.className||'';
    if(ed) ed.value=S.examInfo.date||'';
    const wmT=G('watermark-text'); if(wmT) wmT.value=S.watermark.text||'';
    const wmO=G('watermark-opacity'); if(wmO){ wmO.value=Math.round((S.watermark.opacity||0.15)*100); }
    const togWm2=G('toggle-watermark'); if(togWm2) togWm2.checked=S.watermark.enabled||false;
    // DPI seçiciyi güncelle
    document.querySelectorAll('input[name="pdf-dpi"]').forEach(function(inp){
      inp.checked = inp.value===(S.exportQuality||'mid');
      inp.closest('.dpi-btn').classList.toggle('active', inp.checked);
    });
  },true); // capture=true: settings drawer open event'inden önce çalışsın
})();

/* ═══ ORIENTATION / RESIZE ══════════════════════════════════ */
var _resizeTimer = null;
function onViewportChange(){
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(function(){
    if(S.pdf) renderPage(S.curPage);
  }, 120);
}
window.addEventListener('resize', onViewportChange);

/* ═══ #8: GÖRÜNÜM MODU ══════════════════════════════════ */
(function(){
  document.querySelectorAll('.view-mode-btn').forEach(function(btn){
    btn.addEventListener('click',function(){
      S.viewMode=this.dataset.mode;
      document.querySelectorAll('.view-mode-btn').forEach(b=>b.classList.toggle('active',b===this));
      if(D.qList) D.qList.dataset.vm=S.viewMode;
      saveSession();
    });
  });
})();

/* ═══ SÜTUN AYIRıCı EVENTS ═════════════════════════════ */
(function(){
  // Stil seçici
  document.querySelectorAll('input[name="col-div-style"]').forEach(function(inp){
    inp.addEventListener('change',function(){
      S.colDivider.style=this.value;
      document.querySelectorAll('.col-div-style-btn').forEach(l=>l.classList.toggle('active',l.dataset.style===this.value));
      S.smartLayout=null; saveSession();
    });
  });
  // Renk
  const colDivColor=G('col-div-color');
  if(colDivColor) colDivColor.addEventListener('input',function(){
    S.colDivider.color=this.value; S.smartLayout=null; saveSession();
  });
  // Kalınlık
  const colDivW=G('col-div-width');
  if(colDivW) colDivW.addEventListener('change',function(){
    S.colDivider.width=parseFloat(this.value)||0.4; S.smartLayout=null; saveSession();
  });
  // Orta metin toggle
  const ctToggle=G('col-center-text-toggle');
  const ctRow=G('col-center-text-row');
  const ctOpts=G('col-center-text-opts');
  if(ctToggle){
    ctToggle.addEventListener('change',function(){
      if(ctRow) ctRow.style.display=this.checked?'':'none';
      if(ctOpts) ctOpts.style.display=this.checked?'':'none';
      if(!this.checked) S.colDivider.centerText='';
      saveSession();
    });
  }
  // Orta metin
  const ctInp=G('col-center-text');
  if(ctInp) ctInp.addEventListener('input',function(){
    S.colDivider.centerText=this.value; S.smartLayout=null; saveSession();
  });
  // Orta metin boyutu
  const ctSize=G('col-center-text-size');
  if(ctSize) ctSize.addEventListener('change',function(){
    S.colDivider.centerTextSize=parseFloat(this.value)||7; saveSession();
  });
  // Orta metin rengi
  const ctColor=G('col-center-text-color');
  if(ctColor) ctColor.addEventListener('input',function(){
    S.colDivider.centerTextColor=this.value; saveSession();
  });
  const ctGap=G('col-center-gap');
  if(ctGap) ctGap.addEventListener('change',function(){
    S.colDivider.centerGap=parseFloat(this.value)||2; saveSession();
  });
})();

/* ═══ #3: OFFSET EVENT ══════════════════════════════════ */
(function(){
  const el=G('q-num-offset');
  if(el) el.addEventListener('change',function(){
    S.qNumOffset=Math.max(0,parseInt(this.value)||0);
    saveSession();
  });
})();

/* ═══ #4: A/B FORM BUTONU ═══════════════════════════════ */
(function(){
  const btn=G('btn-dual-form');
  if(btn) btn.addEventListener('click',generateDualForm);
})();

/* ═══ #7: SORU LİSTESİ ARAMA ════════════════════════════════ */
(function(){
  const inp = G('q-search-input');
  if(!inp) return;
  let _ft = null;
  inp.addEventListener('input', function(){
    clearTimeout(_ft);
    _ft = setTimeout(()=> updatePanel(), 120);
  });
  inp.addEventListener('keydown', function(e){
    if(e.key==='Escape'){ this.value=''; updatePanel(); }
  });
})();
window.addEventListener('orientationchange', function(){
  // orientationchange'den sonra boyutlar ~300ms gecikmeyle güncellenir
  setTimeout(onViewportChange, 350);
});

/* ═══ FIX #5: SAYFA THUMBNAIL ŞERİDİ ══════════════════════
   PDF yüklenince tüm sayfaların küçük önizlemesi sol şeride
   çizilir. Tıklanınca o sayfaya geçilir. Aktif sayfa mavi çerçeve.
════════════════════════════════════════════════════════════ */
const _pageStripCache = new Map(); // pageNum → dataUrl

async function buildPageStrip(){
  const strip = G('page-strip');
  if(!strip || !S.pdf) return;
  if(S.pages <= 1){ strip.innerHTML=''; return; }

  strip.innerHTML='';
  _pageStripCache.clear();

  const THUMB_W = 52;
  const totalPages = S.pages;

  // Sadece sayfa numaralı placeholder'lar — tıklanınca lazy render
  for(let p = 1; p <= totalPages; p++){
    const item = document.createElement('div');
    item.className = 'page-thumb-item' + (p === S.curPage ? ' active' : '');
    item.dataset.page = p;
    item.title = 'Sayfa ' + p;
    item.dataset.rendered = '0';

    const cvs = document.createElement('canvas');
    cvs.width = THUMB_W;
    cvs.height = Math.round(THUMB_W * 1.414);
    const ctx = cvs.getContext('2d');
    ctx.fillStyle = '#1e2538';
    ctx.fillRect(0, 0, cvs.width, cvs.height);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(p), THUMB_W/2, cvs.height/2);

    const numEl = document.createElement('span');
    numEl.className = 'page-thumb-num';
    numEl.textContent = p;

    item.appendChild(cvs);
    item.appendChild(numEl);
    item.addEventListener('click', () => renderPage(p));
    strip.appendChild(item);
  }

  // Görünür sayfaları IntersectionObserver ile lazy render et
  // Bu sayede S.pdf.getPage() ana render'ı bloklamaz
  if(typeof IntersectionObserver !== 'undefined'){
    const obs = new IntersectionObserver(async (entries) => {
      for(const entry of entries){
        if(!entry.isIntersecting) continue;
        const item = entry.target;
        if(item.dataset.rendered === '1') continue;
        const p = parseInt(item.dataset.page);
        if(!S.pdf || isNaN(p)) continue;
        obs.unobserve(item);
        item.dataset.rendered = '1';
        // Ana render task bitmesini bekle
        let w = 0;
        while(_currentRenderTask && w++ < 30) await new Promise(r=>setTimeout(r,50));
        if(!S.pdf) continue;
        try{
          const page = await S.pdf.getPage(p);
          const nVp = page.getViewport({scale:1});
          const sc = THUMB_W / nVp.width;
          const vp = page.getViewport({scale: sc});
          const cvs = item.querySelector('canvas');
          if(!cvs) continue;
          cvs.width = Math.round(vp.width);
          cvs.height = Math.round(vp.height);
          const c = cvs.getContext('2d');
          c.fillStyle='#fff'; c.fillRect(0,0,cvs.width,cvs.height);
          await page.render({canvasContext:c, viewport:vp}).promise;
          _pageStripCache.set(p, cvs.toDataURL('image/jpeg',0.6));
        }catch(e){}
      }
    }, {root: strip, rootMargin:'50px', threshold:0.01});

    strip.querySelectorAll('.page-thumb-item').forEach(el => obs.observe(el));
  }
}

function updatePageStripActive(){
  const strip = G('page-strip');
  if(!strip) return;
  let activeEl = null;
  strip.querySelectorAll('.page-thumb-item').forEach(el=>{
    const isActive = parseInt(el.dataset.page) === S.curPage;
    el.classList.toggle('active', isActive);
    if(isActive) activeEl = el;
  });
  // Aktif thumbnail'ı strip içinde scroll et (scrollIntoView kullanma —
  // o sayfanın body/window'unu da kaydırarak toolbar'ı gizleyebilir)
  if(activeEl){
    const elTop = activeEl.offsetTop;
    const elBot = elTop + activeEl.offsetHeight;
    const stripH = strip.clientHeight;
    const scrollTop = strip.scrollTop;
    if(elTop < scrollTop){
      strip.scrollTop = elTop - 6;
    } else if(elBot > scrollTop + stripH){
      strip.scrollTop = elBot - stripH + 6;
    }
  }
}



/* ═══ #3: BÖLGE KOORDİNAT DÜZENLEYİCİ ══════════════════════ */
function openRegionEditor(r){
  let dlg = G('region-editor-dlg');
  if(dlg) dlg.remove();
  dlg = document.createElement('div');
  dlg.id = 'region-editor-dlg';
  dlg.style.cssText = 'position:fixed;inset:0;z-index:9995;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5)';
  const fields = [
    {label:'X (px)', key:'x', val:Math.round(r.x)},
    {label:'Y (px)', key:'y', val:Math.round(r.y)},
    {label:'Genişlik', key:'w', val:Math.round(r.w)},
    {label:'Yükseklik', key:'h', val:Math.round(r.h)},
  ];
  dlg.innerHTML =
    `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:22px 26px;min-width:280px;box-shadow:0 8px 40px rgba(0,0,0,.25)">` +
    `<div style="font-weight:700;font-size:15px;margin-bottom:14px">✏️ Bölge Düzenle</div>` +
    fields.map(f =>
      `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">` +
      `<label style="width:80px;font-size:12px;color:var(--text-muted)">${f.label}</label>` +
      `<input id="re-${f.key}" type="number" value="${f.val}" style="width:80px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-warm);color:var(--text);font-size:13px;text-align:center"/>` +
      `<div style="display:flex;gap:4px">` +
        `<button onclick="document.getElementById('re-${f.key}').value=+document.getElementById('re-${f.key}').value-5" style="width:24px;height:24px;border:1px solid var(--border);border-radius:4px;background:none;cursor:pointer;font-size:14px">−</button>` +
        `<button onclick="document.getElementById('re-${f.key}').value=+document.getElementById('re-${f.key}').value+5" style="width:24px;height:24px;border:1px solid var(--border);border-radius:4px;background:none;cursor:pointer;font-size:14px">+</button>` +
      `</div></div>`
    ).join('') +
    `<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">` +
    `<button id="re-cancel" style="padding:7px 16px;border:1px solid var(--border);border-radius:8px;background:none;color:var(--text);cursor:pointer;font-size:13px">İptal</button>` +
    `<button id="re-ok" style="padding:7px 16px;border:none;border-radius:8px;background:#3d7eff;color:#fff;cursor:pointer;font-size:13px;font-weight:600">Uygula</button>` +
    `</div></div>`;
  document.body.appendChild(dlg);
  G('re-cancel').onclick = () => dlg.remove();
  dlg.addEventListener('click', e => { if(e.target===dlg) dlg.remove(); });
  G('re-ok').onclick = () => {
    snapshotState();
    r.x = Math.max(0, parseInt(G('re-x').value)||0);
    r.y = Math.max(0, parseInt(G('re-y').value)||0);
    r.w = Math.max(20, parseInt(G('re-w').value)||20);
    r.h = Math.max(10, parseInt(G('re-h').value)||10);
    r.detectedScale = S.scale;
    S.smartLayout = null;
    redraw(); saveSession();
    dlg.remove();
    showFloat(r);
    toast('Bölge güncellendi','success',1800);
  };
}

/* ═══ FIX #7: KLAVYE KISAYOLLARI PANELİ ════════════════════ */
function toggleShortcutPanel(){
  let panel=G('shortcut-panel');
  if(panel){ panel.remove(); return; }
  panel=document.createElement('div');
  panel.id='shortcut-panel';
  panel.style.cssText=[
    'position:fixed','top:50%','left:50%',
    'transform:translate(-50%,-50%)',
    'background:var(--bg-card)','border:1px solid var(--border)',
    'border-radius:12px','padding:20px 28px','z-index:99999',
    'box-shadow:0 8px 40px rgba(0,0,0,.18)',
    'min-width:320px','font-size:13px',
  ].join(';');
  const rows=[
    ['←/→',          'Önceki / Sonraki sayfa'],
    ['D',             'Çizim modu aç/kapat'],
    ['Enter',         'Seçili bölgeyi onayla'],
    ['Delete',        'Seçili soruyu sil'],
    ['Escape',        'Panel kapat / Seçim moduna dön'],
    ['Ctrl+Z',        'Geri al'],
    ['Ctrl+Y',        'İleri al'],
    ['Ctrl+S',        'JSON olarak kaydet'],
    ['?',             'Bu paneli aç/kapat'],
  ];
  panel.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">'+
      '<b style="font-size:15px">⌨ Klavye Kısayolları</b>'+
      '<button onclick="this.parentElement.parentElement.remove()" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-muted)">✕</button>'+
    '</div>'+
    rows.map(([k,v])=>
      `<div style="display:flex;gap:12px;padding:5px 0;border-bottom:1px solid var(--border)">
         <code style="background:var(--bg-warm);border:1px solid var(--border);border-radius:4px;padding:1px 7px;font-size:12px;min-width:80px;text-align:center;flex-shrink:0">${k}</code>
         <span style="color:var(--text-mid)">${v}</span>
       </div>`
    ).join('');
  document.body.appendChild(panel);
  // Dışına tıklayınca kapat
  setTimeout(()=>{
    document.addEventListener('click',function handler(e){
      if(!panel.contains(e.target)){ panel.remove(); document.removeEventListener('click',handler); }
    });
  },50);
}
