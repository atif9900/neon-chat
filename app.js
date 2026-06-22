import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, push, onChildAdded, set, onValue } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// Firebase Configurations
const firebaseConfig = {
  apiKey: "AIzaSyAmUXXGPNHqPf_Iq9EGnHhoYIZ3k7HM90I",
  authDomain: "neon-chat-9b1fb.firebaseapp.com",
  projectId: "neon-chat-9b1fb",
  databaseURL: "https://neon-chat-9b1fb-default-rtdb.firebaseio.com/",
  appId: "1:664526960727:web:e173fe7694a86af7c78b12"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Free STUN/TURN Architecture
const iceServersConfig = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: ["turn:openrelay.metered.ca:80", "turn:openrelay.metered.ca:443"], username: "openrelayproject", credential: "openrelayproject" }
    ]
};

let localStream;
let peerConnection;
let roomId = null;
let isEraser = false;
const myId = Math.random().toString(36).substring(2, 9);

const roomInput = document.getElementById('roomInput');
const connectBtn = document.getElementById('connectBtn');
const videoGrid = document.getElementById('videoGrid');

// Permanent Group Persistence Check
window.addEventListener('DOMContentLoaded', () => {
    const savedRoom = localStorage.getItem('permanentNeonRoom');
    if (savedRoom) {
        roomInput.value = savedRoom;
        Swal.fire({ title: 'Permanent Group Loaded', text: `Room Code: ${savedRoom}`, icon: 'info', toast: true, position: 'top-end', timer: 4000 });
    }
});

// Connect Trigger
connectBtn.addEventListener('click', async () => {
    roomId = roomInput.value.trim().toUpperCase();
    if (!roomId) {
        roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        roomInput.value = roomId;
        navigator.clipboard.writeText(roomId);
        Swal.fire({ title: 'Room Created & Copied!', text: `Code: ${roomId}`, icon: 'success' });
    }
    await initMediaEngine(720);
    initSignalingEngine(roomId);
});

// Adaptive Constraints Audio/Video Engine
async function initMediaEngine(targetHeight) {
    try {
        if(localStream) localStream.getTracks().forEach(track => track.stop());
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            video: { height: { ideal: targetHeight }, facingMode: "user" }
        });
        createVideoElement('localVideo', localStream, true);
    } catch (e) {
        Swal.fire('Hardware Error', 'Camera or Mic access denied!', 'error');
    }
}

// Full Operational WebRTC P2P Signaling Loop
function initSignalingEngine(room) {
    const signalRef = ref(db, `rooms/${room}/signals`);
    peerConnection = new RTCPeerConnection(iceServersConfig);

    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = (event) => {
        if (!document.getElementById('remoteVideo')) {
            createVideoElement('remoteVideo', event.streams[0], false);
        }
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            push(ref(db, `rooms/${room}/candidates`), { candidate: event.candidate.toJSON(), sender: myId });
        }
    };

    // Quality Watchdog Adaptive Bitrate Logic
    onValue(ref(db, `rooms/${room}/users`), (snapshot) => {
        const userCount = snapshot.exists() ? Object.keys(snapshot.val()).length : 1;
        if(userCount > 2) {
            initMediaEngine(480); // Auto Downgrade to protect devices
        }
    });
    set(ref(db, `rooms/${room}/users/${myId}`), true);

    // Create WebRTC Offer
    peerConnection.createOffer().then(offer => {
        peerConnection.setLocalDescription(offer);
        set(ref(db, `rooms/${room}/offer`), { sdp: offer.sdp, sender: myId });
    });

    // Listeners for Signaling Handshake
    onValue(ref(db, `rooms/${room}/offer`), (snapshot) => {
        const data = snapshot.val();
        if (data && data.sender !== myId) {
            peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: data.sdp }));
            peerConnection.createAnswer().then(answer => {
                peerConnection.setLocalDescription(answer);
                set(ref(db, `rooms/${room}/answer`), { sdp: answer.sdp, sender: myId });
            });
        }
    });

    onValue(ref(db, `rooms/${room}/answer`), (snapshot) => {
        const data = snapshot.val();
        if (data && data.sender !== myId && peerConnection.signalingState === "have-local-offer") {
            peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: data.sdp }));
        }
    });

    onChildAdded(ref(db, `rooms/${room}/candidates`), (snapshot) => {
        const data = snapshot.val();
        if (data && data.sender !== myId) {
            peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(e => {});
        }
    });

    // Realtime Whiteboard Sync Setup
    setupWhiteboardSync(room);
}

// Whiteboard Anti-Crash Engine + Eraser Integration
const canvas = document.getElementById('whiteboard');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth; canvas.height = window.innerHeight * 0.85;
let drawing = false;

canvas.addEventListener('mousedown', () => drawing = true);
canvas.addEventListener('mouseup', () => { drawing = false; ctx.beginPath(); set(ref(db, `rooms/${roomId}/board/reset`), Date.now()); });
canvas.addEventListener('mousemove', (e) => {
    if (!drawing || !roomId) return;
    const drawData = { x: e.clientX, y: e.clientY, eraser: isEraser };
    push(ref(db, `rooms/${roomId}/board/stream`), drawData);
    executeDraw(drawData);
});

function executeDraw(data) {
    ctx.lineWidth = data.eraser ? 40 : 4;
    ctx.lineCap = 'round';
    ctx.strokeStyle = data.eraser ? '#0f0f13' : '#00ffcc';
    ctx.globalCompositeOperation = data.eraser ? 'destination-out' : 'source-over';
    ctx.lineTo(data.x, data.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(data.x, data.y);
}

function setupWhiteboardSync(room) {
    onChildAdded(ref(db, `rooms/${room}/board/stream`), (snapshot) => {
        executeDraw(snapshot.val());
    });
    onValue(ref(db, `rooms/${room}/board/reset`), () => ctx.beginPath());
}

// Media Controls Actions
document.getElementById('eraserBtn').addEventListener('click', (e) => { isEraser = true; document.getElementById('drawBtn').classList.remove('active'); e.target.classList.add('active'); });
document.getElementById('drawBtn').addEventListener('click', (e) => { isEraser = false; document.getElementById('eraserBtn').classList.remove('active'); e.target.classList.add('active'); });
document.getElementById('clearBtn').addEventListener('click', () => { ctx.clearRect(0, 0, canvas.width, canvas.height); if(roomId) set(ref(db, `rooms/${roomId}/board/stream`), null); });

// Permanent Group Persistence Logic
document.getElementById('permGroupBtn').addEventListener('click', () => {
    Swal.fire({
        title: 'Initialize Permanent Group',
        text: 'Enter Admin Password to lock this network space:',
        input: 'password',
        showCancelButton: true
    }).then((res) => {
        if(res.value === 'admin123') {
            const permCode = roomInput.value.trim().toUpperCase() || "PERM-" + Math.random().toString(36).substring(2, 7).toUpperCase();
            localStorage.setItem('permanentNeonRoom', permCode);
            roomInput.value = permCode;
            Swal.fire('Success!', `This device is permanently linked to Room: ${permCode}`, 'success');
        } else if(res.value) {
            Swal.fire('Error', 'Incorrect Security Password', 'error');
        }
    });
});

function createVideoElement(id, stream, isMuted) {
    let video = document.getElementById(id);
    if (!video) {
        video = document.createElement('video');
        video.id = id;
        videoGrid.append(video);
    }
    video.srcObject = stream;
    video.muted = isMuted;
    video.autoplay = true;
    video.playsInline = true;
}