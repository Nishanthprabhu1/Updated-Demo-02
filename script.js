/* script.js - Jewels-Ai Atelier: v4.3 (Product Name Announcer) */

/* --- CONFIGURATION --- */
const API_KEY = "AIzaSyAXG3iG2oQjUA_BpnO8dK8y-MHJ7HLrhyE"; 

const DRIVE_FOLDERS = {
  earrings: "1eftKhpOHbCj8hzO11-KioFv03g0Yn61n",
  chains: "1G136WEiA9QBSLtRk0LW1fRb3HDZb4VBD",
  rings: "1iB1qgTE-Yl7w-CVsegecniD_DzklQk90",
  bangles: "1d2b7I8XlhIEb8S_eXnRFBEaNYSwngnba"
};

/* --- ASSETS & STATE --- */
const JEWELRY_ASSETS = {}; 
const CATALOG_PROMISES = {}; 
const IMAGE_CACHE = {}; 
let dailyItem = null; 

const watermarkImg = new Image(); watermarkImg.src = 'logo_watermark.png'; 

/* DOM Elements */
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('overlay');
const canvasCtx = canvasElement.getContext('2d');
const loadingStatus = document.getElementById('loading-status');
const flashOverlay = document.getElementById('flash-overlay'); 
const voiceBtn = document.getElementById('voice-btn'); 

/* App State */
let earringImg = null, necklaceImg = null, ringImg = null, bangleImg = null;
let currentType = ''; 
let isProcessingHand = false, isProcessingFace = false;
let lastGestureTime = 0;
const GESTURE_COOLDOWN = 800; 
let previousHandX = null;     

/* Tracking Variables */
let currentAssetName = "Select a Design"; 
let currentAssetIndex = 0; 

/* Physics State */
let physics = { 
    earringAngle: 0, 
    earringVelocity: 0,
    swayOffset: 0,    
    lastHeadX: 0      
};

/* Camera State */
let currentCameraMode = 'user'; 

/* Voice & AI State */
let recognition = null;
let voiceEnabled = true;
let isRecognizing = false;
let autoTryRunning = false;
let autoSnapshots = [];
let autoTryIndex = 0;
let autoTryTimeout = null;
let currentPreviewData = { url: null, name: 'Jewels-Ai_look.png' }; 

/* Stabilizer Variables */
const SMOOTH_FACTOR = 0.8; 
let handSmoother = {
    active: false,
    ring: { x: 0, y: 0, angle: 0, size: 0 },
    bangle: { x: 0, y: 0, angle: 0, size: 0 }
};

/* --- AI CONCIERGE "NILA" ENGINE --- */
const concierge = {
    synth: window.speechSynthesis,
    voice: null,
    active: true,
    hasStarted: false, 
    
    init: function() {
        if (speechSynthesis.onvoiceschanged !== undefined) {
            speechSynthesis.onvoiceschanged = this.setVoice;
        }
        this.setVoice();
        setTimeout(() => {
            const bubble = document.getElementById('ai-bubble');
            if(bubble) {
                bubble.innerText = "Tap me to start Voice AI";
                bubble.classList.add('bubble-visible');
            }
        }, 1000);
    },

    setVoice: function() {
        const voices = window.speechSynthesis.getVoices();
        concierge.voice = voices.find(v => v.name.includes("Google US English") || v.name.includes("Female")) || voices[0];
    },

    speak: function(text) {
        if (!this.active || !this.synth) return;
        
        const bubble = document.getElementById('ai-bubble');
        const avatar = document.getElementById('ai-avatar');
        if(bubble) { bubble.innerText = text; bubble.classList.add('bubble-visible'); }
        if(avatar) avatar.classList.add('talking');

        if (this.hasStarted) {
            this.synth.cancel();
            const utter = new SpeechSynthesisUtterance(text);
            utter.voice = this.voice;
            utter.rate = 1.0; 
            utter.pitch = 1.1;
            utter.onend = () => {
                if(bubble) setTimeout(() => bubble.classList.remove('bubble-visible'), 2000);
                if(avatar) avatar.classList.remove('talking');
            };
            this.synth.speak(utter);
        } else {
            setTimeout(() => {
                 if(avatar) avatar.classList.remove('talking');
                 if(bubble) bubble.classList.remove('bubble-visible');
            }, 3000);
        }
    },

    toggle: function() {
        if (!this.hasStarted) {
            this.hasStarted = true;
            this.speak("Namaste! I am Nila. I am now active.");
            return;
        }
        this.active = !this.active;
        if(this.active) this.speak("I am listening.");
        else { 
            this.synth.cancel(); 
            const bubble = document.getElementById('ai-bubble');
            if(bubble) bubble.innerText = "Muted"; 
        }
    }
};

window.toggleConciergeMute = () => concierge.toggle();

/* --- HELPER: LERP & CLEAN NAME --- */
function lerp(start, end, amt) { return (1 - amt) * start + amt * end; }

function getCleanName(filename) {
    // Removes .png/.jpg and replaces underscores/dashes with spaces
    return filename.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
}

/* --- 1. DAILY DROP FEATURE --- */
function checkDailyDrop() {
    const today = new Date().toDateString();
    const lastSeen = localStorage.getItem('jewels_daily_date');

    if (lastSeen !== today && JEWELRY_ASSETS['earrings'] && JEWELRY_ASSETS['earrings'].length > 0) {
        const list = JEWELRY_ASSETS['earrings'];
        const randomIdx = Math.floor(Math.random() * list.length);
        dailyItem = { item: list[randomIdx], index: randomIdx, type: 'earrings' };
        
        document.getElementById('daily-img').src = dailyItem.item.thumbSrc;
        let cleanName = getCleanName(dailyItem.item.name);
        document.getElementById('daily-name').innerText = cleanName;
        document.getElementById('daily-drop-modal').style.display = 'flex';
        
        localStorage.setItem('jewels_daily_date', today);
        concierge.speak("Today's special is the " + cleanName);
    }
}

function closeDailyDrop() { document.getElementById('daily-drop-modal').style.display = 'none'; }

function tryDailyItem() {
    closeDailyDrop();
    if (dailyItem) {
        selectJewelryType(dailyItem.type).then(() => {
            applyAssetInstantly(dailyItem.item, dailyItem.index);
        });
    }
}

/* --- 2. PHYSICS ENGINE --- */
function updatePhysics(headTilt, headX, width) {
    const gravityTarget = -headTilt; 
    physics.earringVelocity += (gravityTarget - physics.earringAngle) * 0.1; 
    physics.earringVelocity *= 0.92; 
    physics.earringAngle += physics.earringVelocity;

    const headSpeed = (headX - physics.lastHeadX); 
    physics.lastHeadX = headX;
    physics.swayOffset += headSpeed * -1.5; 
    physics.swayOffset *= 0.85; 
    if (physics.swayOffset > 0.5) physics.swayOffset = 0.5;
    if (physics.swayOffset < -0.5) physics.swayOffset = -0.5;
}

/* --- 3. BACKGROUND FETCHING --- */
function initBackgroundFetch() {
    Object.keys(DRIVE_FOLDERS).forEach(key => { fetchCategoryData(key); });
}

function fetchCategoryData(category) {
    if (CATALOG_PROMISES[category]) return CATALOG_PROMISES[category];

    const fetchPromise = new Promise(async (resolve, reject) => {
        try {
            const folderId = DRIVE_FOLDERS[category];
            const query = `'${folderId}' in parents and trashed = false and mimeType contains 'image/'`;
            const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&pageSize=1000&fields=files(id,name,thumbnailLink)&key=${API_KEY}`;
            
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.error) throw new Error(data.error.message);

            JEWELRY_ASSETS[category] = data.files.map(file => {
                const baseLink = file.thumbnailLink;
                let thumbSrc, fullSrc;
                if (baseLink) {
                    thumbSrc = baseLink.replace(/=s\d+$/, "=s400");
                    fullSrc = baseLink.replace(/=s\d+$/, "=s3000");
                } else {
                    thumbSrc = `https://drive.google.com/thumbnail?id=${file.id}`;
                    fullSrc = `https://drive.google.com/uc?export=view&id=${file.id}`;
                }
                return { id: file.id, name: file.name, thumbSrc: thumbSrc, fullSrc: fullSrc };
            });
            
            if (category === 'earrings') setTimeout(checkDailyDrop, 2000);
            resolve(JEWELRY_ASSETS[category]);
        } catch (err) {
            console.error(`Error loading ${category}:`, err);
            resolve([]); 
        }
    });

    CATALOG_PROMISES[category] = fetchPromise;
    return fetchPromise;
}

/* --- 4. ASSET LOADING --- */
function loadAsset(src, id) {
    return new Promise((resolve) => {
        if (!src) { resolve(null); return; }
        if (IMAGE_CACHE[id]) { resolve(IMAGE_CACHE[id]); return; }
        const img = new Image(); img.crossOrigin = 'anonymous';
        img.onload = () => { IMAGE_CACHE[id] = img; resolve(img); };
        img.onerror = () => { resolve(null); };
        img.src = src;
    });
}
function setActiveARImage(img) {
    if (currentType === 'earrings') earringImg = img;
    else if (currentType === 'chains') necklaceImg = img;
    else if (currentType === 'rings') ringImg = img;
    else if (currentType === 'bangles') bangleImg = img;
}

/* --- 5. INITIALIZATION --- */
window.onload = async () => {
    initBackgroundFetch();
    concierge.init(); 
    await startCameraFast('user');
    setTimeout(() => { loadingStatus.style.display = 'none'; }, 2000);
    await selectJewelryType('earrings');
};

/* --- 6. CORE APP LOGIC --- */
async function selectJewelryType(type) {
  if (currentType === type) return;
  currentType = type;
  
  if(concierge.hasStarted) {
      if(type === 'earrings') concierge.speak("Earrings mode. Try moving your head.");
      else if(type === 'chains') concierge.speak("Necklaces loaded.");
      else if(type === 'rings') concierge.speak("Ring mode. Show your hand.");
  }
  
  const targetMode = (type === 'rings' || type === 'bangles') ? 'environment' : 'user';
  startCameraFast(targetMode); 

  earringImg = null; necklaceImg = null; ringImg = null; bangleImg = null;
  const container = document.getElementById('jewelry-options'); 
  container.innerHTML = ''; 
  
  let assets = JEWELRY_ASSETS[type];
  if (!assets) assets = await fetchCategoryData(type);

  if (!assets || assets.length === 0) return;

  container.style.display = 'flex';
  const fragment = document.createDocumentFragment();
  
  assets.forEach((asset, i) => {
    const btnImg = new Image(); btnImg.src = asset.thumbSrc; btnImg.crossOrigin = 'anonymous'; btnImg.className = "thumb-btn"; btnImg.loading = "lazy"; 
    btnImg.onclick = () => { applyAssetInstantly(asset, i); };
    fragment.appendChild(btnImg);
  });
  container.appendChild(fragment);
  applyAssetInstantly(assets[0], 0);
}

// *** THIS IS THE NEW PART THAT READS THE NAME ***
async function applyAssetInstantly(asset, index) {
    currentAssetIndex = index; 
    currentAssetName = asset.name; 
    
    // 1. Highlight UI
    highlightButtonByIndex(index);
    
    // 2. Load Images (Low Res -> High Res)
    const thumbImg = new Image(); thumbImg.src = asset.thumbSrc; thumbImg.crossOrigin = 'anonymous'; setActiveARImage(thumbImg);
    const highResImg = await loadAsset(asset.fullSrc, asset.id);
    if (currentAssetName === asset.name && highResImg) setActiveARImage(highResImg);

    // 3. NILA SPEAKS THE NAME
    if(concierge.hasStarted) {
        let cleanName = getCleanName(asset.name);
        concierge.speak("This is the " + cleanName);
    }
}

function highlightButtonByIndex(index) {
    const children = document.getElementById('jewelry-options').children;
    for (let i = 0; i < children.length; i++) {
        if (i === index) { children[i].style.borderColor = "var(--accent)"; children[i].style.transform = "scale(1.05)"; children[i].scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" }); } 
        else { children[i].style.borderColor = "rgba(255,255,255,0.2)"; children[i].style.transform = "scale(1)"; }
    }
}
function navigateJewelry(dir) {
  if (!currentType || !JEWELRY_ASSETS[currentType]) return;
  const list = JEWELRY_ASSETS[currentType];
  let nextIdx = (currentAssetIndex + dir + list.length) % list.length;
  applyAssetInstantly(list[nextIdx], nextIdx);
}

/* --- 7. CAMERA & AI LOOP --- */
async function startCameraFast(mode = 'user') {
    if (videoElement.srcObject && currentCameraMode === mode && videoElement.readyState >= 2) return;
    currentCameraMode = mode;
    if (videoElement.srcObject) { videoElement.srcObject.getTracks().forEach(track => track.stop()); }
    if (mode === 'environment') { videoElement.classList.add('no-mirror'); } else { videoElement.classList.remove('no-mirror'); }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: mode } });
        videoElement.srcObject = stream;
        videoElement.onloadeddata = () => { videoElement.play(); detectLoop(); if(!recognition) initVoiceControl(); };
    } catch (err) { alert("Camera Error: " + err.message); }
}

async function detectLoop() {
    if (videoElement.readyState >= 2) {
        if (!isProcessingFace) { isProcessingFace = true; await faceMesh.send({image: videoElement}); isProcessingFace = false; }
        if (!isProcessingHand) { isProcessingHand = true; await hands.send({image: videoElement}); isProcessingHand = false; }
    }
    requestAnimationFrame(detectLoop);
}

/* --- 8. MEDIAPIPE FACE --- */
const faceMesh = new FaceMesh({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}` });
faceMesh.setOptions({ refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });

faceMesh.onResults((results) => {
  if (currentType !== 'earrings' && currentType !== 'chains') return;
  const w = videoElement.videoWidth; const h = videoElement.videoHeight;
  canvasElement.width = w; canvasElement.height = h;
  canvasCtx.save(); canvasCtx.clearRect(0, 0, w, h);
  if (currentCameraMode === 'environment') { canvasCtx.translate(0, 0); canvasCtx.scale(1, 1); } 
  else { canvasCtx.translate(w, 0); canvasCtx.scale(-1, 1); }

  if (results.multiFaceLandmarks && results.multiFaceLandmarks[0]) {
    const lm = results.multiFaceLandmarks[0]; 
    const leftEar = { x: lm[132].x * w, y: lm[132].y * h }; const rightEar = { x: lm[361].x * w, y: lm[361].y * h };
    const neck = { x: lm[152].x * w, y: lm[152].y * h }; const nose = { x: lm[1].x * w, y: lm[1].y * h };
    const headTilt = Math.atan2(rightEar.y - leftEar.y, rightEar.x - leftEar.x);
    updatePhysics(headTilt, lm[1].x, w);
    const earDist = Math.hypot(rightEar.x - leftEar.x, rightEar.y - leftEar.y);
    const distToLeft = Math.hypot(nose.x - leftEar.x, nose.y - leftEar.y);
    const distToRight = Math.hypot(nose.x - rightEar.x, nose.y - rightEar.y);
    const ratio = distToLeft / (distToLeft + distToRight);
    const showLeft = ratio > 0.25; 
    const showRight = ratio < 0.75; 

    if (earringImg && earringImg.complete) {
      let ew = earDist * 0.25; let eh = (earringImg.height/earringImg.width) * ew;
      const xShift = ew * 0.05; 
      const totalAngle = physics.earringAngle + (physics.swayOffset * 0.5);
      canvasCtx.shadowColor = "rgba(0,0,0,0.5)"; canvasCtx.shadowBlur = 15; canvasCtx.shadowOffsetX = 2; canvasCtx.shadowOffsetY = 5;
      if (showLeft) { canvasCtx.save(); canvasCtx.translate(leftEar.x, leftEar.y); canvasCtx.rotate(totalAngle); canvasCtx.drawImage(earringImg, (-ew/2) - xShift, -eh * 0.20, ew, eh); canvasCtx.restore(); }
      if (showRight) { canvasCtx.save(); canvasCtx.translate(rightEar.x, rightEar.y); canvasCtx.rotate(totalAngle); canvasCtx.drawImage(earringImg, (-ew/2) + xShift, -eh * 0.20, ew, eh); canvasCtx.restore(); }
      canvasCtx.shadowColor = "transparent";
    }
    if (necklaceImg && necklaceImg.complete) {
      const nw = earDist * 0.85; const nh = (necklaceImg.height/necklaceImg.width) * nw;
      canvasCtx.drawImage(necklaceImg, neck.x - nw/2, neck.y + (nw*0.1), nw, nh);
    }
  }
  canvasCtx.restore();
});

/* --- 9. MEDIAPIPE HANDS --- */
const hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
function calculateAngle(p1, p2) { return Math.atan2(p2.y - p1.y, p2.x - p1.x); }

hands.onResults((results) => {
  const w = videoElement.videoWidth; 
  const h = videoElement.videoHeight;
  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const lm = results.multiHandLandmarks[0];
      const indexTipX = lm[8].x; 
      if (!autoTryRunning && (Date.now() - lastGestureTime > GESTURE_COOLDOWN)) {
          if (previousHandX !== null) {
              const diff = indexTipX - previousHandX;
              if (Math.abs(diff) > 0.04) { 
                  navigateJewelry(diff < 0 ? 1 : -1); 
                  triggerVisualFeedback(diff < 0 ? "Next" : "Previous");
                  lastGestureTime = Date.now(); 
                  previousHandX = null; 
              }
          }
          if (Date.now() - lastGestureTime > 100) previousHandX = indexTipX;
      }
  } else { previousHandX = null; handSmoother.active = false; }

  if (currentType !== 'rings' && currentType !== 'bangles') return;
  canvasElement.width = w; canvasElement.height = h;
  canvasCtx.save(); canvasCtx.clearRect(0, 0, w, h);
  if (currentCameraMode === 'environment') { canvasCtx.translate(0, 0); canvasCtx.scale(1, 1); } 
  else { canvasCtx.translate(w, 0); canvasCtx.scale(-1, 1); }

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const lm = results.multiHandLandmarks[0];
      const mcp = { x: lm[13].x * w, y: lm[13].y * h }; const pip = { x: lm[14].x * w, y: lm[14].y * h };
      const targetRingAngle = calculateAngle(mcp, pip) - (Math.PI / 2);
      const targetRingWidth = Math.hypot(pip.x - mcp.x, pip.y - mcp.y) * 0.6; 
      const wrist = { x: lm[0].x * w, y: lm[0].y * h }; 
      const targetArmAngle = calculateAngle(wrist, { x: lm[9].x * w, y: lm[9].y * h }) - (Math.PI / 2);
      const targetBangleWidth = Math.hypot((lm[17].x*w)-(lm[5].x*w), (lm[17].y*h)-(lm[5].y*h)) * 1.25; 

      if (!handSmoother.active) {
          handSmoother.ring = { x: mcp.x, y: mcp.y, angle: targetRingAngle, size: targetRingWidth };
          handSmoother.bangle = { x: wrist.x, y: wrist.y, angle: targetArmAngle, size: targetBangleWidth };
          handSmoother.active = true;
      } else {
          handSmoother.ring.x = lerp(handSmoother.ring.x, mcp.x, SMOOTH_FACTOR);
          handSmoother.ring.y = lerp(handSmoother.ring.y, mcp.y, SMOOTH_FACTOR);
          handSmoother.ring.angle = lerp(handSmoother.ring.angle, targetRingAngle, SMOOTH_FACTOR);
          handSmoother.ring.size = lerp(handSmoother.ring.size, targetRingWidth, SMOOTH_FACTOR);
          handSmoother.bangle.x = lerp(handSmoother.bangle.x, wrist.x, SMOOTH_FACTOR);
          handSmoother.bangle.y = lerp(handSmoother.bangle.y, wrist.y, SMOOTH_FACTOR);
          handSmoother.bangle.angle = lerp(handSmoother.bangle.angle, targetArmAngle, SMOOTH_FACTOR);
          handSmoother.bangle.size = lerp(handSmoother.bangle.size, targetBangleWidth, SMOOTH_FACTOR);
      }
      canvasCtx.shadowColor = "rgba(0,0,0,0.4)"; canvasCtx.shadowBlur = 10; canvasCtx.shadowOffsetY = 5;
      if (ringImg && ringImg.complete) {
          const rHeight = (ringImg.height / ringImg.width) * handSmoother.ring.size;
          canvasCtx.save(); canvasCtx.translate(handSmoother.ring.x, handSmoother.ring.y); canvasCtx.rotate(handSmoother.ring.angle); 
          canvasCtx.drawImage(ringImg, -handSmoother.ring.size/2, (handSmoother.ring.size/0.6)*0.15, handSmoother.ring.size, rHeight); canvasCtx.restore();
      }
      if (bangleImg && bangleImg.complete) {
          const bHeight = (bangleImg.height / bangleImg.width) * handSmoother.bangle.size;
          canvasCtx.save(); canvasCtx.translate(handSmoother.bangle.x, handSmoother.bangle.y); canvasCtx.rotate(handSmoother.bangle.angle);
          canvasCtx.drawImage(bangleImg, -handSmoother.bangle.size/2, -bHeight/2, handSmoother.bangle.size, bHeight); canvasCtx.restore();
      }
      canvasCtx.shadowColor = "transparent";
  }
  canvasCtx.restore();
});

/* --- EXPORTS --- */
window.selectJewelryType = selectJewelryType; window.toggleTryAll = toggleTryAll; window.tryDailyItem = tryDailyItem; window.closeDailyDrop = closeDailyDrop;
window.takeSnapshot = takeSnapshot; window.downloadAllAsZip = downloadAllAsZip; window.closePreview = closePreview;
window.downloadSingleSnapshot = downloadSingleSnapshot; window.shareSingleSnapshot = shareSingleSnapshot;
window.changeLightboxImage = changeLightboxImage; window.toggleVoiceControl = toggleVoiceControl; window.initVoiceControl = initVoiceControl;