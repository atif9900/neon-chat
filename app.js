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
let currentQuality = 'SD'; // Default Set to SD (480p equivalent)
let isAudioMuted = false;
let isVideoStopped = false;
let localDisplayName = 'Anonymous_Node';

let isIncognito = false;
let incomingFiles = {}; 

// Local Decentralized Storage (True P2P)
function getDecentralizedChat() { return JSON.parse(localStorage.getItem('P2P_Chat_' + currentRoomDisplayCode) || '[]'); }
function saveDecentralizedMsg(msg) { 
    if(isIncognito) return;
    let chats = getDecentralizedChat();
    if(!chats.find(m => m.msgId === msg.msgId)) { chats.push(msg); localStorage.setItem('P2P_Chat_' + currentRoomDisplayCode, JSON.stringify(chats)); }
}
function deleteDecentralizedMsg(id) {
    let chats = getDecentralizedChat();
    chats = chats.filter(m => m.msgId !== id);
    localStorage.setItem('P2P_Chat_' + currentRoomDisplayCode, JSON.stringify(chats));
}

// Admin Logic
function getRoomAdmins() { return JSON.parse(localStorage.getItem('P2P_Admins_' + currentRoomDisplayCode) || '[]'); }
function isLocalAdmin() { return getRoomAdmins().includes(localPeerId); }

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
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
let localStartX = 0, localStartY = 0;
let remotePointers = {}; // Multi-user blackboard fix

const videoWorkspaceOverlay = document.getElementById('video-workspace-overlay');
const localVideoStreamNode = document.getElementById('local-video-stream');
const videoControlDock = document.getElementById('video-control-dock');
const dynamicVideoGrid = document.getElementById('dynamic-video-grid');

const vToggleCamBtn = document.getElementById('v-toggle-cam-btn');
const vFlipCamBtn = document.getElementById('v-flip-cam-btn');
const screenShareBtn = document.getElementById('v-screen-share-btn');
const vBoardBtn = document.getElementById('v-board-btn'); 
const vQualityBtn = document.getElementById('v-quality-btn'); 

const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
const incognitoToggle = document.getElementById('incognito-toggle');

if(incognitoToggle) { incognitoToggle.addEventListener('change', (e) => { isIncognito = e.target.checked; }); }

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

// --- GATEKEEPER & LIVE THEMES ---
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

// --- LIVE EFFECTS ENGINE ---
const mCanvas = document.getElementById('matrix-canvas'); const mCtx = mCanvas ? mCanvas.getContext('2d') : null; let columns = [];
if (mCanvas && mCtx) {
    mCanvas.width = window.innerWidth; mCanvas.height = window.innerHeight; const font_size = 14; const cols = mCanvas.width / font_size;
    for (let x = 0; x < cols; x++) columns[x] = 1;
    function renderCanvasMatrix() {
        const theme = document.documentElement.getAttribute('data-theme');
        if (theme === 'hacker') {
            mCtx.fillStyle = 'rgba(0, 0, 0, 0.05)'; mCtx.fillRect(0, 0, mCanvas.width, mCanvas.height); mCtx.fillStyle = '#00ff41'; mCtx.font = "bold " + font_size + "px monospace"; 
            for (let i = 0; i < columns.length; i++) { const text = String.fromCharCode(33 + Math.floor(Math.random() * 93)); mCtx.fillText(text, i * font_size, columns[i] * font_size); if (columns[i] * font_size > mCanvas.height && Math.random() > 0.975) columns[i] = 0; columns[i]++; }
        } else if (theme === 'romance') {
            mCtx.fillStyle = 'rgba(20, 3, 9, 0.06)'; mCtx.fillRect(0, 0, mCanvas.width, mCanvas.height); mCtx.fillStyle = '#ff2a6d'; mCtx.font = (12 + Math.floor(Math.random() * 6)) + "px Arial";
            for (let i = 0; i < columns.length; i++) { const hearts = ['❤', '♥', '💕', '💖']; const text = hearts[Math.floor(Math.random() * hearts.length)]; if(Math.random() > 0.4) mCtx.fillText(text, i * font_size, columns[i] * font_size); if (columns[i] * font_size > mCanvas.height && Math.random() > 0.96) columns[i] = 0; columns[i] += 0.5; }
        } else if (theme === 'neon-cinematic') {
            mCtx.clearRect(0, 0, mCanvas.width, mCanvas.height);
            // Live Thunder Effect Engine
            if(Math.random() > 0.99) {
                let th = document.getElementById('thunder-overlay');
                if(th) { th.classList.remove('thunder-hidden'); th.classList.add('thunder-flash'); setTimeout(()=>{ th.classList.remove('thunder-flash'); th.classList.add('thunder-hidden'); }, 1000); }
            }
        } else { mCtx.clearRect(0, 0, mCanvas.width, mCanvas.height); } // Formal theme
        window.requestAnimationFrame(renderCanvasMatrix);
    }
    window.requestAnimationFrame(renderCanvasMatrix);
}

// --- FIREBASE SIGNALING (P2P True Sync Setup) ---
function initializeSecureChatMatrix(code) {
    // Check if banned
    let bannedUsers = JSON.parse(localStorage.getItem('P2P_Banned_' + code) || '[]');
    if(bannedUsers.includes(localPeerId)) return alert("❌ You are banned from this Node.");

    currentRoomDisplayCode = code; roomId = generateDeterministicId(code); cryptoKey = "sec_" + code;
    document.getElementById('share-url').value = code; document.getElementById('invite-section').classList.remove('hidden');
    if(roomCodeInput) roomCodeInput.disabled = true; 
    if(connectEngineBtn) connectEngineBtn.disabled = true; 
    if(messageInput) messageInput.disabled = false; 
    if(sendBtn) sendBtn.disabled = false; 
    if(attachFileBtn) attachFileBtn.disabled = false;
    document.getElementById('status-text').innerHTML = `<i class="fa-solid fa-circle" style="color:#00ff41;"></i> Pipeline Active`;
    
    messagesContainer.innerHTML = '';
    
    // Load local history immediately
    let history = getDecentralizedChat();
    history.forEach(m => {
        let clearText = m.cipher ? rc4Cipher(cryptoKey, decodeURIComponent(escape(atob(m.cipher)))) : '';
        pushBubble(clearText, m.senderId === localPeerId ? 'me' : 'them', m.msgId, m.mediaObj, m.senderName, true);
    });

    // Handle Admin creation if first
    const peerRef = ref(db, `rooms/${roomId}/peers/${localPeerId}`);
    set(peerRef, Date.now());
    onDisconnect(peerRef).remove();

    onChildAdded(ref(db, `rooms/${roomId}/peers`), (snapshot) => {
        const id = snapshot.key;
        if (id !== localPeerId && !peers[id]) buildWebRTCLink(id, localPeerId > id);
    });

    onChildRemoved(ref(db, `rooms/${roomId}/peers`), (snapshot) => {
        const id = snapshot.key;
        removeRemoteVideoNode(id); delete peers[id]; delete dataChannels[id]; delete remotePointers[id];
        if(document.getElementById('peer-count')) document.getElementById('peer-count').innerText = `${Object.keys(dataChannels).length} Active Nodes`;
    });

    onChildAdded(ref(db, `rooms/${roomId}/signals/${localPeerId}`), (snapshot) => {
        handleIncomingSignal(snapshot.val());
        remove(snapshot.ref);
    });

    // Auto-promote to admin if I am the only one creating this (locally)
    let admins = getRoomAdmins();
    if(admins.length === 0) { admins.push(localPeerId); localStorage.setItem('P2P_Admins_' + currentRoomDisplayCode, JSON.stringify(admins)); }
    updateAdminUI();
    resizeCanvas();
}

function updateAdminUI() {
    let bdg = document.getElementById('admin-badge');
    if(bdg) bdg.classList[isLocalAdmin() ? 'remove' : 'add']('hidden');
    [audioCallBtn, videoCallBtn].forEach(b => { if(b) b.classList[isLocalAdmin() ? 'remove' : 'add']('hidden'); });
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

function getVideoConstraints() {
    let constraints = { facingMode: currentFacingMode };
    if (currentQuality === '4K') { constraints.width = { ideal: 3840 }; constraints.frameRate = { ideal: 30 }; }
    else if (currentQuality === 'HD') { constraints.width = { ideal: 1280 }; constraints.frameRate = { ideal: 30 }; }
    else { constraints.width = { ideal: 640 }; constraints.frameRate = { ideal: 24 }; } // SD Default
    return { video: constraints, audio: true };
}

// --- NETWORK CORE (P2P) ---
function buildWebRTCLink(remoteId, isOffer) {
    if(!window.RTCPeerConnection) return;
    let pc = new RTCPeerConnection(rtcConfig); peers[remoteId] = pc; pc.iceQueue = []; pc.makingOffer = false;

    if (localAVStream) localAVStream.getTracks().forEach(t => pc.addTrack(t, localAVStream));

    pc.onnegotiationneeded = async () => {
        try { pc.makingOffer = true; let offer = await pc.createOffer(); if (pc.signalingState !== "stable") return; await pc.setLocalDescription(offer); sendGatewaySignal('send_signal', { type: 'offer', sdp: offer }, remoteId); } catch(err) { } finally { pc.makingOffer = false; }
    };

    pc.oniceconnectionstatechange = () => { if(['disconnected', 'failed', 'closed'].includes(pc.iceConnectionState)) { removeRemoteVideoNode(remoteId); delete peers[remoteId]; delete dataChannels[remoteId]; delete remotePointers[remoteId]; } };

    pc.ontrack = (e) => {
        let existingVid = document.getElementById(`vid_${remoteId}`);
        if (!existingVid) {
            let wrapper = document.createElement('div'); wrapper.className = 'dynamic-remote-frame'; wrapper.id = `wrapper_${remoteId}`;
            let vid = document.createElement('video'); vid.id = `vid_${remoteId}`; vid.autoplay = true; vid.playsInline = true;
            let label = document.createElement('span'); label.className = 'video-peer-label'; label.id = `label_${remoteId}`; label.innerText = 'Connecting...';
            // Admin control modal trigger
            label.onclick = (ev) => { if(isLocalAdmin()) showAdminModal(remoteId, ev.clientX, ev.clientY, dataChannels[remoteId]?.remoteName || 'User'); };
            
            wrapper.appendChild(vid); wrapper.appendChild(label); 
            if(dynamicVideoGrid) dynamicVideoGrid.appendChild(wrapper);
            vid.srcObject = e.streams[0];
            if(dataChannels[remoteId] && dataChannels[remoteId].remoteName) label.innerText = dataChannels[remoteId].remoteName;
        } else if(existingVid.srcObject !== e.streams[0]) { existingVid.srcObject = e.streams[0]; existingVid.play().catch(()=>{}); }

        if(videoWorkspaceOverlay) videoWorkspaceOverlay.classList.remove('video-hidden');
        if(videoControlDock) videoControlDock.style.display = 'flex';
        updateVideoGrid(); 
        
        let hasVideo = e.streams[0].getVideoTracks().length > 0;
        if(vToggleCamBtn) vToggleCamBtn.style.display = hasVideo ? 'flex' : 'none'; 
        if(screenShareBtn) screenShareBtn.style.display = hasVideo && !isMobileDevice ? 'flex' : 'none'; 
        if(vFlipCamBtn) vFlipCamBtn.style.display = hasVideo && isMobileDevice ? 'flex' : 'none';
        if(vQualityBtn) vQualityBtn.style.display = hasVideo ? 'flex' : 'none'; 
    };
    
    pc.onicecandidate = (e) => { if (e.candidate) sendGatewaySignal('send_signal', { type: 'candidate', candidate: e.candidate }, remoteId); };
    if (isOffer) { let dc = pc.createDataChannel("chat"); bindChannel(remoteId, dc);
    } else { pc.ondatachannel = (e) => bindChannel(remoteId, e.channel); }
}

let activeModalPeer = null;
const adminModal = document.getElementById('admin-action-modal');
function showAdminModal(peerId, x, y, name) {
    if(!adminModal) return; activeModalPeer = peerId;
    document.getElementById('admin-modal-title').innerText = `Manage: ${name}`;
    adminModal.style.left = `${Math.min(x, window.innerWidth - 220)}px`; adminModal.style.top = `${y}px`;
    adminModal.classList.remove('hidden');
}
if(adminModal) {
    document.getElementById('admin-cancel-btn').onclick = () => adminModal.classList.add('hidden');
    document.getElementById('admin-kick-btn').onclick = () => { if(activeModalPeer) sendAdminAction('kick', activeModalPeer); adminModal.classList.add('hidden'); };
    document.getElementById('admin-ban-btn').onclick = () => { if(activeModalPeer) sendAdminAction('ban', activeModalPeer); adminModal.classList.add('hidden'); };
    document.getElementById('admin-make-btn').onclick = () => { if(activeModalPeer) sendAdminAction('make_admin', activeModalPeer); adminModal.classList.add('hidden'); };
}

function sendAdminAction(action, targetId) {
    Object.values(dataChannels).forEach(dc => { if(dc.readyState === "open") dc.send(JSON.stringify({ type: 'admin_action', action, targetId, sender: localPeerId })); });
}

function bindChannel(id, dc) {
    dataChannels[id] = dc;
    dc.onopen = () => { 
        dc.send(JSON.stringify({ type: 'name_sync', name: localDisplayName }));
        [blackboardToggleBtn, leaveChatBtn].forEach(b => { if(b) b.classList.remove('hidden'); }); 
        if(document.getElementById('peer-count')) document.getElementById('peer-count').innerText = `${Object.keys(dataChannels).length} Active Nodes`;
        
        // P2P Silent Sync (Send data to new user if I have it)
        if(isLocalAdmin() || getDecentralizedChat().length > 0) {
            setTimeout(() => {
                let chunks = getDecentralizedChat();
                let admins = getRoomAdmins();
                dc.send(JSON.stringify({ type: 'history_sync', history: chunks, admins: admins }));
            }, 1000);
        }
    };
    dc.onclose = () => { delete dataChannels[id]; delete peers[id]; delete remotePointers[id]; removeRemoteVideoNode(id); };
    dc.onmessage = async (e) => {
        let data = JSON.parse(e.data);
        if(data.type === 'history_sync') {
            let myChats = getDecentralizedChat();
            if(data.history.length > myChats.length) {
                localStorage.setItem('P2P_Chat_' + currentRoomDisplayCode, JSON.stringify(data.history));
                messagesContainer.innerHTML = '';
                data.history.forEach(m => { let cText = m.cipher ? rc4Cipher(cryptoKey, decodeURIComponent(escape(atob(m.cipher)))) : ''; pushBubble(cText, m.senderId === localPeerId ? 'me' : 'them', m.msgId, m.mediaObj, m.senderName, true); });
            }
            if(data.admins) { localStorage.setItem('P2P_Admins_' + currentRoomDisplayCode, JSON.stringify(data.admins)); updateAdminUI(); }
        }
        else if(data.type === 'chat') { 
            let clearText = data.cipher ? rc4Cipher(cryptoKey, decodeURIComponent(escape(atob(data.cipher)))) : '';
            saveDecentralizedMsg(data); pushBubble(clearText, 'them', data.msgId, data.mediaObj, data.senderName); 
        }
        else if(data.type === 'admin_action') {
            if(data.action === 'kick' && data.targetId === localPeerId) { alert("Admin kicked you."); location.reload(); }
            if(data.action === 'ban') { 
                let bList = JSON.parse(localStorage.getItem('P2P_Banned_' + currentRoomDisplayCode) || '[]'); bList.push(data.targetId); localStorage.setItem('P2P_Banned_' + currentRoomDisplayCode, JSON.stringify(bList));
                if(data.targetId === localPeerId) { alert("Admin Banned you permanently."); location.reload(); }
            }
            if(data.action === 'make_admin') {
                let aList = getRoomAdmins(); if(!aList.includes(data.targetId)) aList.push(data.targetId); localStorage.setItem('P2P_Admins_' + currentRoomDisplayCode, JSON.stringify(aList));
                updateAdminUI(); if(data.targetId === localPeerId) appendSystemMessage("👑 You have been granted Admin rights.");
            }
            if(data.action === 'del_msg') {
                let b = document.querySelector(`[data-msg-id="${data.msgId}"] .bubble`); if(b) b.innerHTML = `<i>🔒 Wiped via Admin / Everyone.</i>`; deleteDecentralizedMsg(data.msgId);
            }
            if(data.action === 'call_start') {
                if(!localAVStream) {
                    let confirmCall = confirm("Admin started a call broadcast. Join?");
                    if(confirmCall && videoCallBtn) videoCallBtn.click(); // Auto-join
                }
            }
        }
        else if(data.type === 'typing') { if(typingIndicator) typingIndicator.classList[data.isTyping ? 'remove' : 'add']('hidden'); }
        else if(data.type === 'draw') renderDraw(data.payload, id);
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

// --- CALL INITIATION (Admin protected logic applied UI side) ---
if(videoCallBtn) {
    videoCallBtn.addEventListener('click', async () => {
        try {
            localAVStream = await navigator.mediaDevices.getUserMedia(getVideoConstraints());
            if(localVideoStreamNode) { localVideoStreamNode.srcObject = localAVStream; localVideoStreamNode.muted = true; localVideoStreamNode.parentElement.style.display = 'block'; }
            Object.values(peers).forEach(pc => { localAVStream.getTracks().forEach(t => pc.addTrack(t, localAVStream)); });
            resetCallUI();
            if(vToggleCamBtn) vToggleCamBtn.style.display = 'flex'; 
            if(vQualityBtn) vQualityBtn.style.display = 'flex'; 
            if(videoWorkspaceOverlay) videoWorkspaceOverlay.classList.remove('video-hidden'); 
            if(videoControlDock) videoControlDock.style.display = 'flex'; 
            if(isLocalAdmin()) sendAdminAction('call_start', 'all');
        } catch(err) { alert("Hardware Denied or No Camera."); }
    });
}
const endCallBtn = document.getElementById('v-end-call-btn');
if(endCallBtn) {
    endCallBtn.addEventListener('click', () => {
        if(videoWorkspaceOverlay) videoWorkspaceOverlay.classList.add('video-hidden');
        if(localAVStream) { localAVStream.getTracks().forEach(t => t.stop()); localAVStream = null; }
        if(localVideoStreamNode) localVideoStreamNode.srcObject = null; localVideoStreamNode.parentElement.style.display = 'none';
        if(dynamicVideoGrid) dynamicVideoGrid.innerHTML = ''; 
        resetCallUI(); 
        Object.values(dataChannels).forEach(dc => { if(dc.readyState === "open") dc.send(JSON.stringify({type:'end_video_call_signal'})); });
    });
}

if(vQualityBtn) {
    vQualityBtn.addEventListener('click', async function() {
        if(!localAVStream) return;
        if(currentQuality === 'SD') currentQuality = 'HD';
        else if(currentQuality === 'HD') currentQuality = '4K';
        else currentQuality = 'SD';
        this.innerText = currentQuality;
        
        let oldT = localAVStream.getVideoTracks()[0]; if(oldT) oldT.stop();
        try { 
            let newS = await navigator.mediaDevices.getUserMedia(getVideoConstraints()); 
            let newT = newS.getVideoTracks()[0]; 
            localAVStream.removeTrack(oldT); localAVStream.addTrack(newT); 
            if(localVideoStreamNode) localVideoStreamNode.srcObject = localAVStream; 
            Object.values(peers).forEach(pc => { let sender = pc.getSenders().find(s => s.track && s.track.kind === 'video'); if(sender) sender.replaceTrack(newT); }); 
        } catch(err) {}
    });
}

// --- MESSAGING ---
if(messageInput) messageInput.addEventListener('keydown', (e) => { if(e.key === 'Enter') sendMsg(messageInput.value, null); });
if(sendBtn) sendBtn.addEventListener('click', () => sendMsg(messageInput ? messageInput.value : '', null));

function sendMsg(text, mediaObj) {
    text = text.trim(); if (!text && !mediaObj) return;
    let msgId = 'm_' + Date.now(); 
    if(messageInput) messageInput.value = '';
    
    let encryptedText = text ? btoa(unescape(encodeURIComponent(rc4Cipher(cryptoKey, text)))) : '';
    let msgObj = { msgId, cipher: encryptedText, mediaObj, senderName: localDisplayName, senderId: localPeerId, timestamp: Date.now() };
    saveDecentralizedMsg(msgObj);
    pushBubble(text, 'me', msgId, mediaObj, localDisplayName);
    
    Object.values(dataChannels).forEach(dc => { if(dc.readyState === "open") dc.send(JSON.stringify({ type: 'chat', ...msgObj })); });
}

function pushBubble(text, sender, id, mediaObj, nameLabel, isHistoryLoad = false) {
    if(!messagesContainer) return;
    let row = document.createElement('div'); row.className = `msg-row ${sender}`; row.setAttribute('data-msg-id', id);
    let dBtn = document.createElement('button'); dBtn.className = 'p2p-delete-btn' + (sender !== 'me' && isLocalAdmin() ? ' admin-del' : ''); dBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
    if(sender === 'me' || isLocalAdmin()) {
        dBtn.onclick = () => { row.querySelector('.bubble').innerHTML = '<i>🔒 Wiped via Delete for Everyone.</i>'; deleteDecentralizedMsg(id); sendAdminAction('del_msg', id); dBtn.remove(); };
        row.appendChild(dBtn);
    }
    let b = document.createElement('div'); b.className = 'bubble'; b.innerHTML += `<span class="bubble-name-tag">${nameLabel}</span>`;
    if(text) b.innerHTML += `<span>${text}</span>`;
    row.appendChild(b); messagesContainer.appendChild(row); messagesContainer.scrollTop = messagesContainer.scrollHeight;
}
function appendSystemMessage(t) { let m = document.createElement('div'); m.className = 'system-msg'; m.innerText = t; messagesContainer.appendChild(m); messagesContainer.scrollTop = messagesContainer.scrollHeight; }

// --- BLACKBOARD (Glitch Fix + Eraser applied) ---
if(blackboardToggleBtn) blackboardToggleBtn.addEventListener('click', () => { if(blackboardOverlay) blackboardOverlay.classList.remove('blackboard-hidden'); resizeCanvas(); });
const closeBoardBtn = document.getElementById('close-board-btn');
if(closeBoardBtn) closeBoardBtn.addEventListener('click', () => { if(blackboardOverlay) blackboardOverlay.classList.add('blackboard-hidden'); });
const clearBoardBtn = document.getElementById('clear-board-btn');
if(clearBoardBtn) clearBoardBtn.addEventListener('click', () => { if(ctx) ctx.clearRect(0,0,blackboardCanvas.width, blackboardCanvas.height); Object.values(dataChannels).forEach(dc => { if(dc.readyState === "open") dc.send(JSON.stringify({type:'clear'})); }); });
document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => { btn.addEventListener('click', () => { document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active')); btn.classList.add('active'); currentTool = btn.dataset.tool; }); });
document.querySelectorAll('.color-btn').forEach(btn => { btn.addEventListener('click', () => { document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); currentColor = btn.dataset.color; }); });

function resizeCanvas() { if(ctx && blackboardCanvas && blackboardCanvas.parentElement) { blackboardCanvas.width = blackboardCanvas.parentElement.clientWidth; blackboardCanvas.height = blackboardCanvas.parentElement.clientHeight; ctx.lineCap='round'; ctx.lineJoin='round'; } }
window.addEventListener('resize', resizeCanvas);
function getCoords(e) { let r = blackboardCanvas.getBoundingClientRect(); let cx = e.clientX || (e.touches && e.touches[0].clientX); let cy = e.clientY || (e.touches && e.touches[0].clientY); return {x: cx-r.left, y: cy-r.top}; }

if(ctx) {
    blackboardCanvas.addEventListener('mousedown', (e) => { isDrawing=true; let c=getCoords(e); localStartX=c.x; localStartY=c.y; canvasSnapshot = ctx.getImageData(0,0,blackboardCanvas.width, blackboardCanvas.height); syncDraw({tool:'start', x1:c.x, y1:c.y}); });
    blackboardCanvas.addEventListener('mousemove', (e) => { 
        if(!isDrawing) return; let c=getCoords(e); 
        if(currentTool==='pencil' || currentTool==='eraser') { 
            ctx.globalCompositeOperation = currentTool === 'eraser' ? 'destination-out' : 'source-over'; ctx.lineWidth = currentTool === 'eraser' ? 25 : 3;
            ctx.strokeStyle=currentColor; ctx.beginPath(); ctx.moveTo(localStartX, localStartY); ctx.lineTo(c.x, c.y); ctx.stroke(); 
            syncDraw({tool:currentTool, x1:localStartX, y1:localStartY, x2:c.x, y2:c.y, color:currentColor}); 
            localStartX=c.x; localStartY=c.y; 
        }
    });
    window.addEventListener('mouseup', () => { isDrawing=false; ctx.globalCompositeOperation = 'source-over'; });
}

let lastDrawTime = 0;
function syncDraw(p) { 
    if (p.tool === 'pencil' || p.tool === 'eraser') { if (Date.now() - lastDrawTime < 15) return; lastDrawTime = Date.now(); } // Throttling fix
    let cw = blackboardCanvas.width, ch = blackboardCanvas.height; let pOut = { ...p, x1: p.x1/cw, y1: p.y1/ch };
    if(p.x2 !== undefined) { pOut.x2 = p.x2/cw; pOut.y2 = p.y2/ch; }
    Object.values(dataChannels).forEach(dc => { if(dc.readyState === "open") { try { dc.send(JSON.stringify({type:'draw', payload:pOut})); } catch(e) {} } }); 
}

function renderDraw(p, senderId) { 
    if(!ctx) return; let cw = blackboardCanvas.width, ch = blackboardCanvas.height;
    if(p.tool === 'start') { remotePointers[senderId] = {x: p.x1*cw, y: p.y1*ch}; return; }
    
    ctx.strokeStyle=p.color; ctx.fillStyle=p.color; ctx.beginPath(); 
    if(p.tool==='pencil' || p.tool==='eraser') { 
        ctx.globalCompositeOperation = p.tool === 'eraser' ? 'destination-out' : 'source-over'; ctx.lineWidth = p.tool === 'eraser' ? 25 : 3;
        let startPoint = remotePointers[senderId] || {x: p.x1*cw, y: p.y1*ch}; // Fallback agar start miss ho jaye
        ctx.moveTo(startPoint.x, startPoint.y); ctx.lineTo(p.x2*cw, p.y2*ch); ctx.stroke(); 
        remotePointers[senderId] = {x: p.x2*cw, y: p.y2*ch}; // Update remote pointer specifically
    } 
    ctx.globalCompositeOperation = 'source-over'; ctx.lineWidth = 3;
}

window.addEventListener('beforeunload', () => { if (roomId) { remove(ref(db, `rooms/${roomId}/peers/${localPeerId}`)); } });

// --- PREMIUM PERMANENT GROUPS LOGIC ---
const savePermanentBtn = document.getElementById('save-permanent-btn');
const premiumGroupsList = document.getElementById('premium-groups-list');

function renderPremiumGroups() {
    if(!premiumGroupsList) return; premiumGroupsList.innerHTML = '';
    let pGroups = JSON.parse(localStorage.getItem('CryptChat_VIP_Groups') || '[]');
    pGroups.forEach(code => {
        let li = document.createElement('li'); li.className = 'premium-item';
        li.innerHTML = `<span><i class="fa-solid fa-crown"></i> ${code}</span> <button class="del-premium-btn" data-code="${code}"><i class="fa-solid fa-trash"></i></button>`;
        li.onclick = (e) => {
            if(e.target.closest('.del-premium-btn')) { pGroups = pGroups.filter(c => c !== code); localStorage.setItem('CryptChat_VIP_Groups', JSON.stringify(pGroups)); renderPremiumGroups(); return; }
            if(roomCodeInput) roomCodeInput.value = code; initializeSecureChatMatrix(code);
        };
        premiumGroupsList.appendChild(li);
    });
}

if(savePermanentBtn) {
    savePermanentBtn.addEventListener('click', () => {
        if(!currentRoomDisplayCode) return alert("Koi connection join karo bhai, fir save karna!");
        let pGroups = JSON.parse(localStorage.getItem('CryptChat_VIP_Groups') || '[]');
        if(!pGroups.includes(currentRoomDisplayCode)) { pGroups.push(currentRoomDisplayCode); localStorage.setItem('CryptChat_VIP_Groups', JSON.stringify(pGroups)); renderPremiumGroups(); alert(`👑 Room "${currentRoomDisplayCode}" VIP saved!`); } else { alert("Pehle se hi VIP list mein hai."); }
    });
}
renderPremiumGroups();

// ... (Upar ka tumhara purana code) ...

if(savePermanentBtn) {
    savePermanentBtn.addEventListener('click', () => {
        if(!currentRoomDisplayCode) return alert("Koi connection join karo bhai, fir save karna!");
        let pGroups = JSON.parse(localStorage.getItem('CryptChat_VIP_Groups') || '[]');
        if(!pGroups.includes(currentRoomDisplayCode)) { pGroups.push(currentRoomDisplayCode); localStorage.setItem('CryptChat_VIP_Groups', JSON.stringify(pGroups)); renderPremiumGroups(); alert(`👑 Room "${currentRoomDisplayCode}" VIP saved!`); } else { alert("Pehle se hi VIP list mein hai."); }
    });
}
renderPremiumGroups(); // <--- YEH TUMHARI FILE KI LAST LINE HAI


// 👇 YAHAN SE NAYA PiP WALA CODE PASTE KARNA HAI 👇

// --- PICTURE-IN-PICTURE (FLOATING POPUP) LOGIC ---
const vPipBtn = document.getElementById('v-pip-btn');

// Show PiP button only when a video is active
function updatePipButtonVisibility() {
    let remoteVideo = document.querySelector('.dynamic-remote-frame video');
    if (vPipBtn) {
        vPipBtn.style.display = remoteVideo ? 'flex' : 'none';
    }
}

// Check every time video grid updates
const observer = new MutationObserver(updatePipButtonVisibility);
if (dynamicVideoGrid) {
    observer.observe(dynamicVideoGrid, { childList: true, subtree: true });
}

// 1. Manual PiP Button Click
if (vPipBtn) {
    vPipBtn.addEventListener('click', async () => {
        let remoteVideo = document.querySelector('.dynamic-remote-frame video');
        if (!remoteVideo) return alert("Koi video chal nahi rahi hai PiP ke liye.");
        
        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            } else {
                await remoteVideo.requestPictureInPicture();
            }
        } catch (err) {
            console.error("PiP error:", err);
            alert("Tumhara browser PiP mode support nahi karta.");
        }
    });
}

// 2. Auto-PiP on Tab Switch (Smart Feature)
document.addEventListener('visibilitychange', async () => {
    let remoteVideo = document.querySelector('.dynamic-remote-frame video');
    
    // Agar user doosre tab me gaya (hidden)
    if (document.hidden && remoteVideo && !document.pictureInPictureElement) {
        try {
            // Background me aate hi video ko popup me fenk do
            await remoteVideo.requestPictureInPicture();
        } catch (err) {
            console.log("Auto-PiP blocked by browser permissions.");
        }
    }
});

