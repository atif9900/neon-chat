import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, set, push, onChildAdded, onChildRemoved, remove, onDisconnect } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAmUXXGPNHqPf_Iq9EGnHhoYIZ3k7HM90I",
  authDomain: "neon-chat-9b1fb.firebaseapp.com",
  projectId: "neon-chat-9b1fb",
  databaseURL: "https://neon-chat-9b1fb-default-rtdb.firebaseio.com/",
  appId: "1:664526960727:web:e173fe7694a86af7c78b12"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

let roomId = '';
let currentRoomDisplayCode = ''; 
let localPeerId = 'p_' + Math.random().toString(36).substring(2, 7);
let cryptoKey = '';
let peers = {};
let dataChannels = {};

let localAVStream = null;
let screenStream = null; 
let currentFacingMode = 'user';
let currentQuality = 'HD'; // Feature: Default to HD
let isAudioMuted = false;
let isVideoStopped = false;
let localDisplayName = 'Anonymous_Node';

let isIncognito = false;
let incomingFiles = {}; 

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' }
    ]
};

// --- DOM ACQUISITIONS ---
const appContainer = document.getElementById('app-container');
const roomCodeInput = document.getElementById('room-code-input');
const connectEngineBtn = document.getElementById('connect-engine-btn');
const messagesContainer = document.getElementById('messages-container');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const attachFileBtn = document.getElementById('attach-file-btn');
const hiddenFileInput = document.getElementById('hidden-file-input');
const typingIndicator = document.getElementById('typing-indicator');

const audioCallBtn = document.getElementById('audio-call-btn');
const videoCallBtn = document.getElementById('video-call-btn');
const blackboardToggleBtn = document.getElementById('blackboard-toggle-btn');
const leaveChatBtn = document.getElementById('leave-chat-btn'); 

const blackboardOverlay = document.getElementById('blackboard-overlay');
const blackboardCanvas = document.getElementById('blackboard-canvas');
const ctx = blackboardCanvas ? blackboardCanvas.getContext('2d') : null;
let isDrawing = false, currentTool = 'pencil', currentColor = '#00ff41';
let startX = 0, startY = 0, canvasSnapshot = null;

const videoWorkspaceOverlay = document.getElementById('video-workspace-overlay');
const localVideoStreamNode = document.getElementById('local-video-stream');
const videoControlDock = document.getElementById('video-control-dock');
const dynamicVideoGrid = document.getElementById('dynamic-video-grid');

const vToggleCamBtn = document.getElementById('v-toggle-cam-btn');
const vFlipCamBtn = document.getElementById('v-flip-cam-btn');
const screenShareBtn = document.getElementById('v-screen-share-btn');
const vBoardBtn = document.getElementById('v-board-btn'); 
const vQualityBtn = document.getElementById('v-quality-btn'); // New Quality Button

const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
const incognitoToggle = document.getElementById('incognito-toggle');

if(incognitoToggle) {
    incognitoToggle.addEventListener('change', (e) => { isIncognito = e.target.checked; });
}

function rc4Cipher(key, str) {
    let s = [], j = 0, x, res = '';
    for (let i = 0; i < 256; i++) s[i] = i;
    for (let i = 0; i < 256; i++) { j = (j + s[i] + key.charCodeAt(i % key.length)) % 256; x = s[i]; s[i] = s[j]; s[j] = x; }
    let i = 0; j = 0;
    for (let y = 0; y < str.length; y++) {
        i = (i + 1) % 256; j = (j + s[i]) % 256; x = s[i]; s[i] = s[j]; s[j] = x;
        res += String.fromCharCode(str.charCodeAt(y) ^ s[(s[i] + s[j]) % 256]);
    }
    return res;
}
function generateDeterministicId(text) {
    let hash = 0; for (let i = 0; i < text.length; i++) { hash = (hash << 5) - hash + text.charCodeAt(i); hash |= 0; }
    return 'r_' + Math.abs(hash).toString(16).padStart(8, '0');
}

// --- GATEKEEPER & UI ---
const ageCheck = document.getElementById('age-check');
const enterBtn = document.getElementById('enter-btn');
if(ageCheck && enterBtn) {
    ageCheck.addEventListener('change', (e) => { enterBtn.disabled = !e.target.checked; });
    enterBtn.addEventListener('click', () => {
        const nameInput = document.getElementById('display-name-input');
        const nameVal = nameInput ? nameInput.value.trim() : '';
        localDisplayName = nameVal ? nameVal.replace(/[^a-zA-Z0-9_]/g, '').substring(0, 15) : 'Node_' + localPeerId.substring(2).toUpperCase();
        document.getElementById('splash-screen').style.display = 'none'; appContainer.classList.remove('app-hidden');
    });
}

document.querySelectorAll('[data-set-theme]').forEach(btn => {
    btn.addEventListener('click', () => { 
        document.querySelectorAll('[data-set-theme]').forEach(b => b.classList.remove('active')); 
        btn.classList.add('active'); 
        document.documentElement.setAttribute('data-theme', btn.getAttribute('data-set-theme')); 
    });
});

const menuBtn = document.getElementById('menu-btn');
const closeMenuBtn = document.getElementById('close-menu-btn');
if(menuBtn) menuBtn.addEventListener('click', () => { document.getElementById('sidebar').classList.add('active'); });
if(closeMenuBtn) closeMenuBtn.addEventListener('click', () => { document.getElementById('sidebar').classList.remove('active'); });

// --- FIREBASE SYNC ENGINE (Permanent Groups Setup) ---
function initializeSecureChatMatrix(code) {
    currentRoomDisplayCode = code; roomId = generateDeterministicId(code); cryptoKey = "sec_" + code;
    document.getElementById('share-url').value = code; document.getElementById('invite-section').classList.remove('hidden');
    if(roomCodeInput) roomCodeInput.disabled = true; 
    if(connectEngineBtn) connectEngineBtn.disabled = true; 
    if(messageInput) messageInput.disabled = false; 
    if(sendBtn) sendBtn.disabled = false; 
    if(attachFileBtn) attachFileBtn.disabled = false;
    document.getElementById('status-text').innerHTML = `<i class="fa-solid fa-circle" style="color:#00ff41;"></i> Pipeline Active`;
    
    messagesContainer.innerHTML = '';
    
    // FIREBASE PEER PRESENCE
    const peerRef = ref(db, `rooms/${roomId}/peers/${localPeerId}`);
    set(peerRef, true);
    onDisconnect(peerRef).remove();

    onChildAdded(ref(db, `rooms/${roomId}/peers`), (snapshot) => {
        const id = snapshot.key;
        if (id !== localPeerId && !peers[id]) buildWebRTCLink(id, localPeerId > id);
    });

    onChildRemoved(ref(db, `rooms/${roomId}/peers`), (snapshot) => {
        const id = snapshot.key;
        removeRemoteVideoNode(id); delete peers[id]; delete dataChannels[id];
        if(document.getElementById('peer-count')) document.getElementById('peer-count').innerText = `${Object.keys(dataChannels).length} Active Nodes`;
    });

    onChildAdded(ref(db, `rooms/${roomId}/signals/${localPeerId}`), (snapshot) => {
        handleIncomingSignal(snapshot.val());
        remove(snapshot.ref);
    });

    // FIREBASE PERMANENT MESSAGES
    onChildAdded(ref(db, `rooms/${roomId}/messages`), (snapshot) => {
        let data = snapshot.val();
        if (!document.querySelector(`[data-msg-id="${data.msgId}"]`)) {
            let senderType = (data.senderId === localPeerId) ? 'me' : 'them';
            let clearText = data.cipher ? rc4Cipher(cryptoKey, decodeURIComponent(escape(atob(data.cipher)))) : '';
            pushBubble(clearText, senderType, data.msgId, data.mediaObj, data.senderName, true);
        }
    });

    onChildRemoved(ref(db, `rooms/${roomId}/messages`), (snapshot) => {
        let msgId = snapshot.val().msgId;
        let b = document.querySelector(`[data-msg-id="${msgId}"] .bubble`); 
        if(b) b.innerHTML = `<i>🔒 Wiped via Delete for Everyone.</i>`;
    });

    resizeCanvas();
}

if(connectEngineBtn) {
    connectEngineBtn.addEventListener('click', () => { initializeSecureChatMatrix(roomCodeInput.value.trim() || 'pool_123'); });
}

async function sendGatewaySignal(action, data = {}, targetPeer = '') {
    if (action === 'send_signal') push(ref(db, `rooms/${roomId}/signals/${targetPeer}`), { from: localPeerId, ...data });
}

async function handleIncomingSignal(sig) {
    if (!peers[sig.from]) buildWebRTCLink(sig.from, false);
    let pc = peers[sig.from];
    
    try {
        const polite = localPeerId < sig.from; 
        const isStable = pc.signalingState === "stable";
        const collision = (sig.type === "offer") && (!isStable || pc.makingOffer);
        if (collision) { if (!polite) return; await pc.setLocalDescription({type: "rollback"}); }
        
        if (sig.type === 'offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(sig.sdp));
            if(localAVStream) localAVStream.getTracks().forEach(t => { if(!pc.getSenders().find(s => s.track === t)) pc.addTrack(t, localAVStream); });
            let ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
            sendGatewaySignal('send_signal', { type: 'answer', sdp: ans }, sig.from);
            if (pc.iceQueue) { for (let c of pc.iceQueue) { try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch(e){} } pc.iceQueue = []; }
        } else if (sig.type === 'answer') { 
            await pc.setRemoteDescription(new RTCSessionDescription(sig.sdp));
            if (pc.iceQueue) { for (let c of pc.iceQueue) { try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch(e){} } pc.iceQueue = []; }
        } else if (sig.type === 'candidate') {
            if (pc.remoteDescription && pc.remoteDescription.type) { try { await pc.addIceCandidate(new RTCIceCandidate(sig.candidate)); } catch(e){} 
            } else { if (!pc.iceQueue) pc.iceQueue = []; pc.iceQueue.push(sig.candidate); }
        }
    } catch(error) {}
}

function updateVideoGrid() {
    if (!dynamicVideoGrid) return;
    const count = dynamicVideoGrid.children.length;
    dynamicVideoGrid.className = 'video-grid-container'; 
    if (count > 1) dynamicVideoGrid.classList.add(`peers-${count > 6 ? 'many' : count}`);
}

function removeRemoteVideoNode(id) {
    let wrapper = document.getElementById(`wrapper_${id}`);
    if(wrapper) wrapper.remove(); updateVideoGrid();
    if(dynamicVideoGrid && dynamicVideoGrid.children.length === 0 && !localAVStream) videoWorkspaceOverlay.classList.add('video-hidden');
}

function resetCallUI() {
    isVideoStopped = false; isAudioMuted = false;
    if(vToggleCamBtn) { vToggleCamBtn.style.background = 'rgba(255,255,255,0.1)'; vToggleCamBtn.innerHTML = '<i class="fa-solid fa-video"></i>'; }
    if(document.getElementById('v-mute-audio-btn')) { document.getElementById('v-mute-audio-btn').style.background = 'rgba(255,255,255,0.1)'; document.getElementById('v-mute-audio-btn').innerHTML = '<i class="fa-solid fa-microphone"></i>'; }
    screenStream = null;
}

// --- VIDEO CONSTRAINTS RESOLUTION (4K / HD / SD) ---
function getVideoConstraints() {
    let constraints = { facingMode: currentFacingMode };
    if (currentQuality === '4K') { constraints.width = { ideal: 3840 }; constraints.frameRate = { ideal: 30 }; }
    else if (currentQuality === 'HD') { constraints.width = { ideal: 1280 }; constraints.frameRate = { ideal: 30 }; }
    else { constraints.width = { ideal: 640 }; constraints.frameRate = { ideal: 24 }; }
    return { video: constraints, audio: true };
}

// --- NETWORK CORE ---
function buildWebRTCLink(remoteId, isOffer) {
    if(!window.RTCPeerConnection) return;
    let pc = new RTCPeerConnection(rtcConfig); peers[remoteId] = pc; pc.iceQueue = []; pc.makingOffer = false;

    if (localAVStream) localAVStream.getTracks().forEach(t => pc.addTrack(t, localAVStream));

    pc.onnegotiationneeded = async () => {
        try {
            pc.makingOffer = true;
            let offer = await pc.createOffer(); 
            if (pc.signalingState !== "stable") return;
            await pc.setLocalDescription(offer);
            sendGatewaySignal('send_signal', { type: 'offer', sdp: offer }, remoteId);
        } catch(err) { } finally { pc.makingOffer = false; }
    };

    pc.oniceconnectionstatechange = () => {
        if(['disconnected', 'failed', 'closed'].includes(pc.iceConnectionState)) {
            removeRemoteVideoNode(remoteId); delete peers[remoteId]; delete dataChannels[remoteId];
        }
    };

    pc.ontrack = (e) => {
        let existingVid = document.getElementById(`vid_${remoteId}`);
        if (!existingVid) {
            let wrapper = document.createElement('div'); wrapper.className = 'dynamic-remote-frame'; wrapper.id = `wrapper_${remoteId}`;
            let vid = document.createElement('video'); vid.id = `vid_${remoteId}`; vid.autoplay = true; vid.playsInline = true;
            let label = document.createElement('span'); label.className = 'video-peer-label'; label.id = `label_${remoteId}`; label.innerText = 'Connecting...';
            wrapper.appendChild(vid); wrapper.appendChild(label); 
            if(dynamicVideoGrid) dynamicVideoGrid.appendChild(wrapper);
            vid.srcObject = e.streams[0];
            if(dataChannels[remoteId] && dataChannels[remoteId].remoteName) label.innerText = dataChannels[remoteId].remoteName;
        } else if(existingVid.srcObject !== e.streams[0]) {
            existingVid.srcObject = e.streams[0]; existingVid.play().catch(()=>{});
        }

        if(videoWorkspaceOverlay) videoWorkspaceOverlay.classList.remove('video-hidden');
        if(videoControlDock) videoControlDock.style.display = 'flex';
        updateVideoGrid(); 
        
        let hasVideo = e.streams[0].getVideoTracks().length > 0;
        if(vToggleCamBtn) vToggleCamBtn.style.display = hasVideo ? 'flex' : 'none'; 
        if(screenShareBtn) screenShareBtn.style.display = hasVideo && !isMobileDevice ? 'flex' : 'none'; 
        if(vFlipCamBtn) vFlipCamBtn.style.display = hasVideo && isMobileDevice ? 'flex' : 'none';
        if(vQualityBtn) vQualityBtn.style.display = hasVideo ? 'flex' : 'none'; // Show Quality Button
    };
    
    pc.onicecandidate = (e) => { if (e.candidate) sendGatewaySignal('send_signal', { type: 'candidate', candidate: e.candidate }, remoteId); };
    if (isOffer) { let dc = pc.createDataChannel("chat"); bindChannel(remoteId, dc);
    } else { pc.ondatachannel = (e) => bindChannel(remoteId, e.channel); }
}

function bindChannel(id, dc) {
    dataChannels[id] = dc;
    dc.onopen = () => { 
        dc.send(JSON.stringify({ type: 'name_sync', name: localDisplayName }));
        [audioCallBtn, videoCallBtn, blackboardToggleBtn, leaveChatBtn].forEach(b => { if(b) b.classList.remove('hidden'); }); 
        if(document.getElementById('peer-count')) document.getElementById('peer-count').innerText = `${Object.keys(dataChannels).length} Active Nodes`;
    };
    dc.onclose = () => { delete dataChannels[id]; delete peers[id]; removeRemoteVideoNode(id); };
    dc.onmessage = async (e) => {
        let data = JSON.parse(e.data);
        if(data.type === 'typing') { if(typingIndicator) typingIndicator.classList[data.isTyping ? 'remove' : 'add']('hidden'); }
        else if(data.type === 'draw') renderDraw(data.payload);
        else if(data.type === 'clear') { if(ctx) ctx.clearRect(0, 0, blackboardCanvas.width, blackboardCanvas.height); }
        else if(data.type === 'name_sync') { dc.remoteName = data.name; let lbl = document.getElementById(`label_${id}`); if(lbl) lbl.innerText = data.name; }
        else if(data.type === 'end_video_call_signal') { 
            removeRemoteVideoNode(id);
            if(dynamicVideoGrid && dynamicVideoGrid.children.length === 0) {
                if(localAVStream) { localAVStream.getTracks().forEach(t => t.stop()); localAVStream = null; }
                if(localVideoStreamNode) localVideoStreamNode.srcObject = null;
                if(videoWorkspaceOverlay) videoWorkspaceOverlay.classList.add('video-hidden'); resetCallUI(); 
            }
        }
    };
}

// --- CALL INITIATION & QUALITY SELECTOR ---
if(videoCallBtn) {
    videoCallBtn.addEventListener('click', async () => {
        try {
            localAVStream = await navigator.mediaDevices.getUserMedia(getVideoConstraints());
            if(localVideoStreamNode) { localVideoStreamNode.srcObject = localAVStream; localVideoStreamNode.muted = true; }
            Object.values(peers).forEach(pc => { localAVStream.getTracks().forEach(t => pc.addTrack(t, localAVStream)); });
            resetCallUI();
            if(vToggleCamBtn) vToggleCamBtn.style.display = 'flex'; 
            if(vQualityBtn) vQualityBtn.style.display = 'flex'; 
            if(videoWorkspaceOverlay) videoWorkspaceOverlay.classList.remove('video-hidden'); 
            if(videoControlDock) videoControlDock.style.display = 'flex'; 
        } catch(err) { alert("Hardware Denied."); }
    });
}

// FEATURE: Video Quality Toggle (Real-time Resolution Change)
if(vQualityBtn) {
    vQualityBtn.addEventListener('click', async function() {
        if(!localAVStream) return;
        if(currentQuality === 'HD') currentQuality = '4K';
        else if(currentQuality === '4K') currentQuality = 'SD';
        else currentQuality = 'HD';
        this.innerText = currentQuality;
        
        let oldT = localAVStream.getVideoTracks()[0]; if(oldT) oldT.stop();
        try { 
            let newS = await navigator.mediaDevices.getUserMedia(getVideoConstraints()); 
            let newT = newS.getVideoTracks()[0]; 
            localAVStream.removeTrack(oldT); localAVStream.addTrack(newT); 
            if(localVideoStreamNode) localVideoStreamNode.srcObject = localAVStream; 
            Object.values(peers).forEach(pc => { 
                let sender = pc.getSenders().find(s => s.track && s.track.kind === 'video'); 
                if(sender) sender.replaceTrack(newT); 
            }); 
        } catch(err) { console.warn(err); }
    });
}

// --- MESSAGING (Permanent Firebase DB) ---
if(messageInput) {
    messageInput.addEventListener('keydown', (e) => { if(e.key === 'Enter') sendMsg(messageInput.value, null); });
}
if(sendBtn) sendBtn.addEventListener('click', () => sendMsg(messageInput ? messageInput.value : '', null));

function sendMsg(text, mediaObj) {
    text = text.trim(); if (!text && !mediaObj) return;
    let msgId = 'm_' + Date.now(); 
    if(messageInput) messageInput.value = '';
    
    // Feature: Firebase Permanent Messaging
    let encryptedText = text ? btoa(unescape(encodeURIComponent(rc4Cipher(cryptoKey, text)))) : '';
    set(ref(db, `rooms/${roomId}/messages/${msgId}`), {
        msgId, cipher: encryptedText, mediaObj, senderName: localDisplayName, senderId: localPeerId, timestamp: Date.now()
    });
}

function pushBubble(text, sender, id, mediaObj, nameLabel, isHistoryLoad = false) {
    if(!messagesContainer) return;
    let row = document.createElement('div'); row.className = `msg-row ${sender}`; row.setAttribute('data-msg-id', id);
    if(sender === 'me') {
        let dBtn = document.createElement('button'); dBtn.className = 'p2p-delete-btn'; dBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
        dBtn.onclick = () => { remove(ref(db, `rooms/${roomId}/messages/${id}`)); }; // Global Delete
        row.appendChild(dBtn);
    }
    let b = document.createElement('div'); b.className = 'bubble'; b.innerHTML += `<span class="bubble-name-tag">${nameLabel}</span>`;
    if(text) b.innerHTML += `<span>${text}</span>`;
    row.appendChild(b); messagesContainer.appendChild(row); messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// --- BLACKBOARD (Pencil Crash Fix applied) ---
if(blackboardToggleBtn) blackboardToggleBtn.addEventListener('click', () => { if(blackboardOverlay) blackboardOverlay.classList.remove('blackboard-hidden'); resizeCanvas(); });
const closeBoardBtn = document.getElementById('close-board-btn');
if(closeBoardBtn) closeBoardBtn.addEventListener('click', () => { if(blackboardOverlay) blackboardOverlay.classList.add('blackboard-hidden'); });
const clearBoardBtn = document.getElementById('clear-board-btn');
if(clearBoardBtn) clearBoardBtn.addEventListener('click', () => { if(ctx) ctx.clearRect(0,0,blackboardCanvas.width, blackboardCanvas.height); Object.values(dataChannels).forEach(dc => { if(dc.readyState === "open") dc.send(JSON.stringify({type:'clear'})); }); });
document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => { btn.addEventListener('click', () => { document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active')); btn.classList.add('active'); currentTool = btn.dataset.tool; }); });
document.querySelectorAll('.color-btn').forEach(btn => { btn.addEventListener('click', () => { document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); currentColor = btn.dataset.color; }); });

function resizeCanvas() { if(ctx && blackboardCanvas && blackboardCanvas.parentElement) { blackboardCanvas.width = blackboardCanvas.parentElement.clientWidth; blackboardCanvas.height = blackboardCanvas.parentElement.clientHeight; ctx.lineCap='round'; ctx.lineWidth=3; } }
window.addEventListener('resize', resizeCanvas);
function getCoords(e) { let r = blackboardCanvas.getBoundingClientRect(); let cx = e.clientX || (e.touches && e.touches[0].clientX); let cy = e.clientY || (e.touches && e.touches[0].clientY); return {x: cx-r.left, y: cy-r.top}; }

if(ctx) {
    blackboardCanvas.addEventListener('mousedown', (e) => { isDrawing=true; let c=getCoords(e); startX=c.x; startY=c.y; ctx.beginPath(); ctx.moveTo(startX, startY); canvasSnapshot = ctx.getImageData(0,0,blackboardCanvas.width, blackboardCanvas.height); });
    blackboardCanvas.addEventListener('mousemove', (e) => { if(!isDrawing) return; let c=getCoords(e); if(currentTool==='pencil') { ctx.strokeStyle=currentColor; ctx.lineTo(c.x, c.y); ctx.stroke(); syncDraw({tool:'pencil', x1:startX, y1:startY, x2:c.x, y2:c.y, color:currentColor}); startX=c.x; startY=c.y; }});
    window.addEventListener('mouseup', (e) => { isDrawing=false; });
}

let lastDrawTime = 0;
function syncDraw(p) { 
    // Feature: PENCIL CRASH FIX - Throttling data channel to prevent buffer overflow
    if (p.tool === 'pencil') {
        if (Date.now() - lastDrawTime < 25) return; 
        lastDrawTime = Date.now();
    }
    
    let cw = blackboardCanvas.width, ch = blackboardCanvas.height; let pOut = { ...p, x1: p.x1/cw, y1: p.y1/ch };
    if(p.x2 !== undefined) { pOut.x2 = p.x2/cw; pOut.y2 = p.y2/ch; }
    
    Object.values(dataChannels).forEach(dc => { 
        if(dc.readyState === "open") {
            try { dc.send(JSON.stringify({type:'draw', payload:pOut})); } catch(e) {}
        }
    }); 
}

function renderDraw(p) { 
    if(!ctx) return; 
    let cw = blackboardCanvas.width, ch = blackboardCanvas.height;
    ctx.strokeStyle=p.color; ctx.fillStyle=p.color; ctx.beginPath(); 
    if(p.tool==='pencil'||p.tool==='line'){ ctx.moveTo(p.x1*cw, p.y1*ch); ctx.lineTo(p.x2*cw, p.y2*ch); ctx.stroke(); } 
}

window.addEventListener('beforeunload', () => { if (roomId) { remove(ref(db, `rooms/${roomId}/peers/${localPeerId}`)); } });
