/* ================================================================
PHẦN 1: CẤU HÌNH FIREBASE
================================================================
*/
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import { getDatabase, ref, set, push, onValue, runTransaction, remove } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyArFyjGuW7fBuRYu8jOGw_03OQQXtQjcj8",
  authDomain: "ipes-2b9db.firebaseapp.com",
  databaseURL: "https://ipes-2b9db-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "ipes-2b9db",
  storageBucket: "ipes-2b9db.firebasestorage.app",
  messagingSenderId: "410102574315",
  appId: "1:410102574315:web:191862efacd5e14a62e2ae",
  measurementId: "G-SCKTXEWZ6E"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const matchRef = ref(db, 'match');
const votesRef = ref(db, 'votes');
const awardsRef = ref(db, 'awards');


/* ================================================================
PHẦN 2: LOGIC CỤC BỘ (LOCAL STATE & UI)
================================================================
*/

/* CÁC GIÁ TRỊ THỜI GIAN CỐ ĐỊNH */
const DEFAULT_ROUND_TIME = 90; // 1 phút 30 giây
const DEFAULT_REST_TIME = 30; // 30 giây
const VOTE_WINDOW = 2000; // 2 giây (Theo bộ quy tắc mới nhất)

/* STATE (Trạng thái cục bộ, sẽ được đồng bộ bởi Firebase) */
let state = {
  redScore:0, blueScore:0, round:1,
  timePerRound:DEFAULT_ROUND_TIME, timeLeft:DEFAULT_ROUND_TIME, timerRunning:false, lastUpdate:Date.now(),
  restTime:DEFAULT_REST_TIME, restLeft:DEFAULT_REST_TIME, restRunning:false,
  judgeLightTimeouts:{},
  roundLabel:'round1',
  roundLabelText:'Hiệp 1',
  redName:'',
  blueName:'',
  eventTitle:'',
  eventSub:''
};
window.state = state; // Đưa ra global scope để dễ debug

// ** ĐÃ XÓA CỜ CỤC BỘ isProcessingConsensus - CHUYỂN SANG DÙNG KHÓA TOÀN CỤC TRÊN FIREBASE **

/* DOM (Lấy các phần tử HTML) */
const displayRedScore = document.getElementById('displayRedScore');
const displayBlueScore = document.getElementById('displayBlueScore');
const displayRedName = document.getElementById('displayRedName');
const displayBlueName = document.getElementById('displayBlueName');
const displayRound = document.getElementById('displayRound');
const displayClock = document.getElementById('displayClock');
const tournamentNameInput = document.getElementById('tournamentName');
const redNameInput = document.getElementById('redName');
const blueNameInput = document.getElementById('blueName');
const inputRound = document.getElementById('inputRound');
const soundToggle = document.getElementById('soundToggle');
const eventTitle = document.getElementById('eventTitle');
const eventSubDisplay = document.getElementById('displayEventSub');
const eventSubInput = document.getElementById('eventSubInput');

let selectedMode = 'round1';

/* UTILS (Hàm tiện ích) */
function formatTime(sec){ const m = Math.floor(sec/60).toString().padStart(2,'0'); const s = (sec%60).toString().padStart(2,'0'); return `${m}:${s}`; }
window.formatTime = formatTime; 

function updateDisplay(){
  displayRedScore.innerText = state.redScore;
  displayBlueScore.innerText = state.blueScore;

  if(state.roundLabelText) displayRound.innerText = state.roundLabelText;
  else {
    if(selectedMode === 'rest') displayRound.innerText = 'Giải lao';
    else {
      const rnum = parseInt(inputRound.value) || state.round || 1;
      displayRound.innerText = `Hiệp ${rnum}`;
    }
  }

  displayClock.innerText = formatTime(state.restRunning ? state.restLeft : state.timeLeft);
  displayRedName.innerText = state.redName || redNameInput.value || 'VĐV ĐỎ';
  displayBlueName.innerText = state.blueName || blueNameInput.value || 'VĐV XANH';
  eventTitle.innerText = state.eventTitle || tournamentNameInput.value || 'GIẢI IPES MỞ RỘNG NĂM 2025';
  eventSubDisplay.innerText = state.eventSub || eventSubInput.value || '';
  document.title = `${displayRedName.innerText} ${state.redScore}-${state.blueScore} ${displayBlueName.innerText}`;
}
window.updateDisplay = updateDisplay; 

/* judge lights creation */
function createJudgeLights(){
  const redLights = document.getElementById('displayRedLights');
  const blueLights = document.getElementById('displayBlueLights');
  redLights.innerHTML = ''; blueLights.innerHTML = '';
  for(let j=1;j<=3;j++){
    const d1 = document.createElement('div'); d1.className='judge-light'; d1.id=`light-red-${j}`;
    d1.innerHTML = `<div class="badge">GĐ${j}</div><div class="sub">+?</div><div class="overlay"></div>`;
    redLights.appendChild(d1);
    const d2 = document.createElement('div'); d2.className='judge-light'; d2.id=`light-blue-${j}`;
    d2.innerHTML = `<div class="badge">GĐ${j}</div><div class="sub">+?</div><div class="overlay"></div>`;
    blueLights.appendChild(d2);
  }
}

/* overlay show points for judge light */
function showJudgeOverlay(judge, side, points, dur=VOTE_WINDOW){
  const el = document.getElementById(`light-${side}-${judge}`);
  if(!el) return;
  const overlay = el.querySelector('.overlay');
  overlay.innerText = '+' + points;
  el.classList.add('on','showPoints');
  const badge = el.querySelector('.badge');
  const sub = el.querySelector('.sub');
  badge.style.visibility='hidden'; sub.style.visibility='hidden';
  if(state.judgeLightTimeouts[`${judge}-${side}`]) clearTimeout(state.judgeLightTimeouts[`${judge}-${side}`]);
  state.judgeLightTimeouts[`${judge}-${side}`] = setTimeout(()=>{ if(el){ el.classList.remove('showPoints'); overlay.innerText=''; badge.style.visibility='visible'; sub.style.visibility='visible'; el.classList.remove('on'); } delete state.judgeLightTimeouts[`${judge}-${side}`]; }, dur);
}
window.showJudgeOverlay = showJudgeOverlay; 

/* quick flash for +point (short) */
function quickPointFlash(side){
  const flash = side==='red' ? document.getElementById('leftFlash') : document.getElementById('rightFlash');
  if(!flash) return;
  flash.style.opacity = '0.9';
  setTimeout(()=>{ flash.style.opacity = '0'; }, 900); // ~1s flash
}
window.quickPointFlash = quickPointFlash; 

/* flash message */
function flashMessage(txt){
  const el = document.createElement('div'); el.style.position='fixed'; el.style.left='50%'; el.style.top='18px'; el.style.transform='translateX(-50%)'; el.style.background='linear-gradient(90deg,#121216,#0b0b0b)'; el.style.padding='10px 14px'; el.style.borderRadius='10px'; el.style.boxShadow='0 12px 40px rgba(0,0,0,0.6)'; el.style.zIndex=9999; el.style.color='#fff'; el.style.opacity='0'; el.style.transition='opacity .16s ease'; el.innerText = txt; document.body.appendChild(el); requestAnimationFrame(()=>el.style.opacity=1); setTimeout(()=>{ el.style.opacity=0; setTimeout(()=>el.remove(),300); },1600);
}
window.flashMessage = flashMessage; 

/* BEEP SOUNDS via WebAudio (no external files) */
function playTone(freq, duration=0.14, when=0, ctx=null){
  if(!soundToggle.checked) return;
  try{
    const C = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const o = C.createOscillator();
    const g = C.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.value = 0.0001;
    o.connect(g); g.connect(C.destination);
    const t = C.currentTime + when;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.18, t+0.02);
    g.gain.linearRampToValueAtTime(0.0001, t+duration);
    o.start(t);
    o.stop(t+duration+0.02);
  }catch(e){ console.warn('tone err', e); }
}
function playStartBeep(){ playTone(880, 0.12); } // single short
function playEndGameBeep(){
  playTone(980, 0.2, 0);
  setTimeout(()=>playTone(980,0.2,0), 300);
}
function playWinBeep(){ playTone(1200,0.12); } // optional single flourish for winner
window.playStartBeep = playStartBeep;
window.playEndGameBeep = playEndGameBeep;

/* WIN flash: blink whole card for 5s (0.5s on/off) + sound */
function winnerFlash(side){
  const isRed = (side==='red');
  const flash = isRed ? document.getElementById('leftFlash') : document.getElementById('rightFlash');
  const card = isRed ? document.getElementById('leftCard') : document.getElementById('rightCard');
  if(!flash || !card) return;
  card.style.position = card.style.position || 'relative';
  let visible = false;
  playWinBeep();
  const interval = setInterval(()=> {
    visible = !visible;
    flash.style.opacity = visible ? '0.98' : '0';
  }, 500); 
  setTimeout(()=>{
    clearInterval(interval);
    flash.style.opacity = '0';
  }, 5000);
}
window.winnerFlash = winnerFlash;

/* ADMIN manual score (gán vào window để HTML gọi được) */
window.manualScore = function(side, delta){
  if(window._manualScore) return window._manualScore(side, delta); 
  // Fallback nếu Firebase chưa tải
  if(side==='red') state.redScore = Math.max(-999, state.redScore + delta);
  else state.blueScore = Math.max(-999, state.blueScore + delta);
  updateDisplay();
  flashMessage((delta>0?'+':'')+delta+' '+(side==='red'?'ĐỎ':'XANH')+' (TT)');
}

/* judgeVote (gán vào window để HTML gọi được) */
window.judgeVote = function(judge, side, points){
  if(window.pushVote){
    window.pushVote({
      judge: judge,
      side: side,
      points: points,
      timestamp: Date.now()
    }).catch(err => console.error('pushVote err', err));
    
    // Tách biệt logic đèn tín hiệu: Sáng đèn 1s để báo đã bấm (CHỈ TRÊN THIẾT BỊ BẤM)
    const el = document.getElementById(`light-${side}-${judge}`);
    if(el){ 
      const overlay = el.querySelector('.overlay');
      overlay.innerText = '+' + points;
      el.classList.add('on','showPoints');
      const badge = el.querySelector('.badge'), sub = el.querySelector('.sub');
      badge.style.visibility='hidden'; sub.style.visibility='hidden';
      // Tắt đèn tín hiệu sau 1s (1000ms), không đợi VOTE_WINDOW
      setTimeout(()=>{ 
          if(el){ 
              el.classList.remove('showPoints'); 
              overlay.innerText=''; 
              badge.style.visibility='visible'; 
              sub.style.visibility='visible'; 
              el.classList.remove('on'); 
          } 
      }, 1000); 
    }
  } else {
    flashMessage("Lỗi: Không kết nối DB (Firebase).");
  }
}

/* full screen control button */
document.getElementById('btnFullscreenControl').addEventListener('click', ()=>{
  const el = document.getElementById('displaySection');
  if(!document.fullscreenElement) el.requestFullscreen && el.requestFullscreen();
  else document.exitFullscreen && document.exitFullscreen();
});

/* win buttons -> triggers winnerFlash and writes to DB if available */
document.getElementById('btnWinRed').addEventListener('click', async ()=>{
  winnerFlash('red');
  if(window.setMatchKey) await window.setMatchKey('lastWinner','red');
});
document.getElementById('btnWinBlue').addEventListener('click', async ()=>{
  winnerFlash('blue');
  if(window.setMatchKey) await window.setMatchKey('lastWinner','blue');
});

/* wire name inputs -> write to DB when changed (sync) */
redNameInput.addEventListener('input', ()=> {
  const v = redNameInput.value || '';
  if(window.setMatchKey) window.setMatchKey('redName', v);
  state.redName = v;
  updateDisplay();
});
blueNameInput.addEventListener('input', ()=> {
  const v = blueNameInput.value || '';
  if(window.setMatchKey) window.setMatchKey('blueName', v);
  state.blueName = v;
  updateDisplay();
});

/* event sub input -> write to DB when changed */
eventSubInput.addEventListener('input', ()=> {
  const v = eventSubInput.value || '';
  if(window.setMatchKey) window.setMatchKey('eventSub', v);
  state.eventSub = v;
  updateDisplay();
});

/* tournament name sync */
tournamentNameInput.addEventListener('input', ()=> {
  const v = tournamentNameInput.value || '';
  if(window.setMatchKey) window.setMatchKey('eventTitle', v);
  state.eventTitle = v;
  updateDisplay();
});

/* init UI */
createJudgeLights();
updateDisplay();

/* Round selection UI wiring (keeps display same layout). Set roundLabel in DB to sync to other devices */
function setSelectedModeLocal(mode){
  selectedMode = mode;
  document.querySelectorAll('.round-select-btn').forEach(b=>b.classList.remove('active'));
  if(mode === 'round1') document.getElementById('selRound1').classList.add('active');
  if(mode === 'round2') document.getElementById('selRound2').classList.add('active');
  if(mode === 'round3') document.getElementById('selRound3').classList.add('active');
  if(mode === 'rest') document.getElementById('selRest').classList.add('active');
  updateDisplay();
}
window.setSelectedModeLocal = setSelectedModeLocal; // Gán vào window

document.getElementById('selRound1').addEventListener('click', ()=> setRound('Hiệp 1', 'round1', 1));
document.getElementById('selRound2').addEventListener('click', ()=> setRound('Hiệp 2', 'round2', 2));
document.getElementById('selRound3').addEventListener('click', ()=> setRound('Hiệp 3', 'round3', 3));
document.getElementById('selRest').addEventListener('click', ()=> setRound('Giải lao', 'rest', parseInt(inputRound.value) || 1));

/* Bind admin control buttons - existing functions may be provided by Firebase module; we keep compatibility */
(function bindControlButtons(){
  const el = id => document.getElementById(id);
  // ** Đã đổi btnStart để gọi startOrResumeTimer **
  if(el('btnStart')) el('btnStart').addEventListener('click', ()=> { if(window.startOrResumeTimer) window.startOrResumeTimer(); else { startTimerLocal(); } });
  if(el('btnPause')) el('btnPause').addEventListener('click', ()=> { if(window.pauseTimer) window.pauseTimer(); else { pauseTimerLocal(); } });
  if(el('btnResume')) el('btnResume').addEventListener('click', ()=> { if(window.resumeTimer) window.resumeTimer(); else { resumeTimerLocal(); } });
  if(el('btnReset')) el('btnReset').addEventListener('click', ()=> {
    if(!confirm('Xác nhận reset toàn bộ điểm, hiệp và xóa lịch sử chấm điểm?')) return;
    if(window.resetAll) window.resetAll();
    else { resetLocal(); }
  });
})();

/* -------------------- Local fallback timer logic (if Firebase not present) -------------------- */
let _localTimerInterval = null;
function startTimerLocal(){
  if(selectedMode === 'rest'){
    state.restLeft = DEFAULT_REST_TIME;
    state.restRunning = true;
    state.timerRunning = false;
    if(window.setMatchKey) window.setMatchKey('restLeft', state.restLeft);
    if(window.setMatchKey) window.setMatchKey('restRunning', true);
    if(window.setMatchKey) window.setMatchKey('roundLabel', 'rest');
    if(window.setMatchKey) window.setMatchKey('roundLabelText', 'Giải lao');
  } else {
    state.timePerRound = DEFAULT_ROUND_TIME;
    state.timeLeft = state.timePerRound;
    state.timerRunning = true;
    state.restRunning = false;
    const r = Math.max(1, parseInt(inputRound.value) || 1);
    state.round = r;
    if(window.setMatchKey) window.setMatchKey('round', r);
    if(window.setMatchKey) window.setMatchKey('timePerRound', state.timePerRound);
    if(window.setMatchKey) window.setMatchKey('timeLeft', state.timeLeft);
    if(window.setMatchKey) window.setMatchKey('timerRunning', true);
    if(window.setMatchKey) window.setMatchKey('roundLabel', selectedMode || 'round1');
    if(window.setMatchKey) window.setMatchKey('roundLabelText', selectedMode === 'round1' ? `Hiệp ${r}` : (selectedMode === 'round2' ? `Hiệp ${r}` : `Hiệp ${r}`));
  }
  if(window.setMatchKey) window.setMatchKey('lastUpdate', Date.now());
  updateDisplay();
  playStartBeep();
  if(_localTimerInterval) clearInterval(_localTimerInterval);
  _localTimerInterval = setInterval(()=>{
    if(state.timerRunning){
      state.timeLeft = Math.max(0, state.timeLeft - 1);
      if(window.setMatchKey) window.setMatchKey('timeLeft', state.timeLeft);
      if(state.timeLeft === 0){
        playEndGameBeep();
        state.timerRunning = false;
        if(window.setMatchKey) { window.setMatchKey('timerRunning', false); window.setMatchKey('timeLeft', 0); }
      } 
      // FIX: Lỗi đồng hồ nhảy sau 1s dừng
      if(window.setMatchKey) window.setMatchKey('lastUpdate', Date.now());
    } else if(state.restRunning){
      state.restLeft = Math.max(0, state.restLeft - 1);
      if(window.setMatchKey) window.setMatchKey('restLeft', state.restLeft);
      if(state.restLeft === 0){
        playEndGameBeep();
        state.restRunning = false;
        if(window.setMatchKey) { window.setMatchKey('restRunning', false); window.setMatchKey('restLeft', 0); }
      }
      // FIX: Lỗi đồng hồ nhảy sau 1s dừng
      if(window.setMatchKey) window.setMatchKey('lastUpdate', Date.now());
    }
    updateDisplay();
  }, 1000);
}

function pauseTimerLocal(){
  state.timerRunning = false;
  state.restRunning = false;
  if(window.setMatchKey){ window.setMatchKey('timerRunning', false); window.setMatchKey('restRunning', false); window.setMatchKey('lastUpdate', Date.now()); }
  updateDisplay();
}

function resumeTimerLocal(){
  if(state.timeLeft > 0 && !state.timerRunning && selectedMode !== 'rest'){
    state.timerRunning = true;
    if(window.setMatchKey) window.setMatchKey('timerRunning', true);
  } else if(state.restLeft > 0 && !state.restRunning && selectedMode === 'rest'){
    state.restRunning = true;
    if(window.setMatchKey) window.setMatchKey('restRunning', true);
  }
  if(window.setMatchKey) window.setMatchKey('lastUpdate', Date.now());
  updateDisplay();
}

function resetLocal(){
  state.redScore = 0; state.blueScore = 0; state.round = 1;
  state.timePerRound = DEFAULT_ROUND_TIME; state.timeLeft = DEFAULT_ROUND_TIME; state.timerRunning = false;
  state.restTime = DEFAULT_REST_TIME; state.restLeft = DEFAULT_REST_TIME; state.restRunning = false;
  inputRound.value = 1; // reset input
  selectedMode = 'round1';
  setSelectedModeLocal('round1');
  createJudgeLights();
  updateDisplay();
  if(_localTimerInterval) clearInterval(_localTimerInterval);
  flashMessage("Đã reset cục bộ về 0-0.");
}
window.resetLocal = resetLocal; // Gán vào window

/* -------------------- End local timer fallback -------------------- */


/* ================================================================
PHẦN 3: LOGIC FIREBASE (Code chính đã sửa lỗi)
================================================================
*/

/* helper to update match keys */
window.setMatchKey = async function(key, val){
  await set(ref(db, `match/${key}`), val);
}

/* New helper: setRound(displayLabel, modeKey, roundNumber) -> writes both display label and mode key */
window.setRound = async function(displayLabel, modeKey, roundNumber){
  await set(ref(db, 'match/roundLabel'), modeKey);
  await set(ref(db, 'match/roundLabelText'), displayLabel);
  if(modeKey !== 'rest') {
    await window.setMatchKey('round', roundNumber);
  }
  // Update local state and UI immediately
  state.roundLabel = modeKey;
  state.roundLabelText = displayLabel;
  inputRound.value = roundNumber;
  setSelectedModeLocal(modeKey); // update active button locally
  updateDisplay();
}

// ** CHỨC NĂNG MỚI: START HOẶC RESUME (KHÔNG RESET NẾU CÓ THỜI GIAN CÒN LẠI) **
window.startOrResumeTimer = async function(){
    const r = Math.max(1, parseInt(inputRound.value) || 1);
    const timePerRound = DEFAULT_ROUND_TIME;
    const isRest = selectedMode === 'rest';

    // *** LOGIC SỬA LỖI: Nếu còn thời gian (>0) và đang dừng, thì chỉ TIẾP TỤC (RESUME) ***
    if (!state.timerRunning && !state.restRunning) {
        if (!isRest && state.timeLeft > 0) {
            // Chỉ resume nếu có thời gian còn lại
            await window.resumeTimer(); 
            return;
        } else if (isRest && state.restLeft > 0) {
            // Chỉ resume giải lao nếu có thời gian còn lại
            await window.resumeTimer(); 
            return;
        }
    }
    // *** END LOGIC SỬA LỖI ***

    // Logic START/RESET NEW ROUND (chỉ chạy khi thời gian đã hết hoặc chưa từng chạy)
    if(isRest){
        await window.setMatchKey('restLeft', DEFAULT_REST_TIME);
        await window.setMatchKey('restRunning', true);
        await window.setMatchKey('timerRunning', false);
        await window.setMatchKey('roundLabel', 'rest');
        await window.setMatchKey('roundLabelText', 'Giải lao');
    } else {
        await window.setMatchKey('round', r);
        await window.setMatchKey('timePerRound', timePerRound);
        await window.setMatchKey('timeLeft', timePerRound); // RESET VỀ 90s
        await window.setMatchKey('timerRunning', true);
        await window.setMatchKey('restRunning', false);
        await window.setMatchKey('roundLabel', selectedMode || 'round1');
        await window.setMatchKey('roundLabelText', `Hiệp ${r}`);
    }
    await window.setMatchKey('lastUpdate', Date.now());
    playStartBeep();
}

window.pauseTimer = async function(){
    // *** ĐÃ THÊM LOGIC QUAN TRỌNG: LƯU THỜI GIAN CÒN LẠI HIỆN TẠI VÀO DB ***
    await window.setMatchKey('timeLeft', state.timeLeft);
    await window.setMatchKey('restLeft', state.restLeft);

    await window.setMatchKey('timerRunning', false);
    await window.setMatchKey('restRunning', false);
    await window.setMatchKey('lastUpdate', Date.now());
}

window.resumeTimer = async function(){
    const isRest = state.roundLabel === 'rest';
    if(isRest && state.restLeft > 0){
        await window.setMatchKey('restRunning', true);
    } else if(!isRest && state.timeLeft > 0){
        await window.setMatchKey('timerRunning', true);
    }
    await window.setMatchKey('lastUpdate', Date.now());
}

window.resetAll = async function(){
    // Reset core match state
    await window.setMatchKey('redScore', 0);
    await window.setMatchKey('blueScore', 0);
    await window.setMatchKey('round', 1);
    await window.setMatchKey('timeLeft', DEFAULT_ROUND_TIME);
    await window.setMatchKey('restLeft', DEFAULT_REST_TIME);
    await window.setMatchKey('timerRunning', false);
    await window.setMatchKey('restRunning', false);
    await window.setMatchKey('lastUpdate', Date.now());
    await window.setMatchKey('roundLabel', 'round1');
    await window.setMatchKey('roundLabelText', 'Hiệp 1');
    await window.setMatchKey('lastWinner', ''); // Clear winner

    // Clear all votes and awards history
    await remove(votesRef);
    await remove(awardsRef);
    
    // Reset local UI
    resetLocal(); 
    flashMessage("Đã reset toàn bộ trạng thái thi đấu và lịch sử.");
}

// Override local manualScore to write to DB
window._manualScore = async function(side, delta){
    const scoreKey = `${side}Score`;
    await runTransaction(ref(db, `match/${scoreKey}`), (currentScore) => {
        if (currentScore === null) currentScore = 0;
        return Math.max(-999, currentScore + delta);
    });
    flashMessage((delta>0?'+':'')+delta+' '+(side==='red'?'ĐỎ':'XANH')+' (TT DB)');
}

/* Push vote to DB */
window.pushVote = async function(voteData){
    await push(votesRef, voteData);
}


/* --------------- CORE LOGIC: CHECK CONSENSUS AND AWARD POINTS (V5.5 - GLOBAL LOCK) --------------- */
function checkConsensusAndAwardPointsLogic(allVotes) {
    // Đã xóa cờ isProcessingConsensus cục bộ
    const now = Date.now();
    
    // 1. Lọc và Ưu tiên votes: Chỉ lấy vote mới nhất của mỗi giám định trong cửa sổ 2s (Rule 5)
    const recentVotes = Object.entries(allVotes || {}).filter(([key, vote]) => {
        return (now - vote.timestamp) <= VOTE_WINDOW; 
    }).map(([key, vote]) => ({ ...vote, key }));

    const prioritizedVotes = {}; 
    recentVotes.slice().reverse().forEach(v => {
        if (!prioritizedVotes[v.judge]) {
            prioritizedVotes[v.judge] = v;
        }
    });
    const finalVotes = Object.values(prioritizedVotes); 

    if (finalVotes.length < 2) return; 

    // 2. Kiểm tra đa số VĐV (Rule 6, 7)
    const redVotes = finalVotes.filter(v => v.side === 'red');
    const blueVotes = finalVotes.filter(v => v.side === 'blue');
    
    let winningSide = null;
    let votesForWinningSide = [];

    if (redVotes.length >= 2 && redVotes.length > blueVotes.length) {
        winningSide = 'red';
        votesForWinningSide = redVotes;
    } else if (blueVotes.length >= 2 && blueVotes.length > redVotes.length) {
        winningSide = 'blue';
        votesForWinningSide = blueVotes;
    } else {
        return; 
    }

    // 3. Kiểm tra đa số Loại điểm (Rule 2)
    const point1Count = votesForWinningSide.filter(v => v.points === 1).length;
    const point2Count = votesForWinningSide.filter(v => v.points === 2).length;
    
    let awardedPoints = 0;

    if (point1Count >= 2 && point1Count >= point2Count) {
        awardedPoints = 1; 
    } else if (point2Count >= 2 && point2Count > point1Count) {
        awardedPoints = 2; 
    } else {
        return; 
    }

    // 4. Đã đạt đồng thuận -> Áp dụng GLOBAL LOCK trước khi cộng điểm
    if (awardedPoints > 0) {
        
        const lockRef = ref(db, 'match/consensusLock');
        
        // THỬ CỐ GẮNG KHÓA (Global Lock)
        runTransaction(lockRef, (currentLock) => {
            // Nếu khóa rỗng (null) hoặc false, thì cố gắng đặt nó thành true
            if (currentLock === null || currentLock === false) {
                return true; // Thiết bị này thành công khóa
            }
            return undefined; // Thiết bị đã bị khóa, hủy giao dịch
        }).then(async (transactionResult) => {
            if (!transactionResult.committed) {
                // Khóa thất bại -> thiết bị khác đã xử lý rồi.
                return; 
            }
            // Khóa thành công (Thiết bị này là MASTER)
            
            // Lấy TẤT CẢ keys của votes trong cửa sổ 2s để xóa 
            const allVoteKeysInWindow = recentVotes.map(v => v.key);
            
            // A. Tăng điểm
            const scoreRef = ref(db, `match/${winningSide}Score`);
            await runTransaction(scoreRef, (currentScore) => {
                if (currentScore === null) currentScore = 0;
                return currentScore + awardedPoints; 
            }); 

            // B. Ghi nhận Award
            const awardId = push(awardsRef).key;
            const awardData = {
                awardId: awardId,
                side: winningSide,
                points: awardedPoints,
                judges: votesForWinningSide.map(v => v.judge),
                timestamp: Date.now(),
                voteKeys: allVoteKeysInWindow 
            };
            await set(ref(db, `awards/${awardId}`), awardData);

            // C. Xóa TẤT CẢ votes đã dùng
            allVoteKeysInWindow.forEach(voteKey => {
                set(ref(db, `votes/${voteKey}`), null);
            });
            
            // D. Hiển thị flash cục bộ (Tùy chọn)
            quickPointFlash(winningSide);
            
            // E. QUAN TRỌNG: Giải phóng Global Lock sau khi hoàn tất
            // Đợi 300ms để đảm bảo lệnh xóa votes đã bắt đầu lan truyền
            setTimeout(() => {
                set(lockRef, false); 
            }, 300); 

        }).catch(err => {
            console.error('Award/Lock Transaction Failed:', err);
            // Cố gắng giải phóng khóa khi có lỗi
            set(lockRef, false); 
        });
        
        return; // Thoát hàm ngay lập tức
    }
}


/* --------------- Firebase Listeners (Đã cập nhật) --------------- */

// 1. Listen for Match State (score, time, names, etc.)
onValue(matchRef, (snapshot) => {
  const matchData = snapshot.val() || {};
  
  // Update state from DB
  state.redScore = matchData.redScore || 0;
  state.blueScore = matchData.blueScore || 0;
  state.round = matchData.round || 1;
  state.timePerRound = matchData.timePerRound || DEFAULT_ROUND_TIME;
  state.timeLeft = matchData.timeLeft !== undefined ? matchData.timeLeft : DEFAULT_ROUND_TIME;
  state.timerRunning = matchData.timerRunning || false;
  state.restTime = matchData.restTime || DEFAULT_REST_TIME;
  state.restLeft = matchData.restLeft !== undefined ? matchData.restLeft : DEFAULT_REST_TIME;
  state.restRunning = matchData.restRunning || false;
  state.lastUpdate = matchData.lastUpdate || Date.now();
  state.roundLabel = matchData.roundLabel || 'round1';
  state.roundLabelText = matchData.roundLabelText || 'Hiệp 1';
  state.redName = matchData.redName || '';
  state.blueName = matchData.blueName || '';
  state.eventTitle = matchData.eventTitle || '';
  state.eventSub = matchData.eventSub || '';

  // Update UI inputs to reflect DB (for Admin panel)
  redNameInput.value = state.redName;
  blueNameInput.value = state.blueName;
  tournamentNameInput.value = state.eventTitle;
  eventSubInput.value = state.eventSub;
  inputRound.value = state.round;
  setSelectedModeLocal(state.roundLabel); // Keep control panel in sync

  // Check for Win condition (for display only)
  if(matchData.lastWinner){
    winnerFlash(matchData.lastWinner);
    // Clear winner status after a short flash time so it doesn't loop
    setTimeout(()=> window.setMatchKey('lastWinner', ''), 5500);
  }
  
  updateDisplay();
});


// 2. Listen for Awards (to display judge lights)
onValue(awardsRef, (snapshot) => {
  const allAwards = snapshot.val() || {};
  
  // Tìm award mới nhất
  const latestAward = Object.values(allAwards)
    .sort((a,b) => b.timestamp - a.timestamp)
    .find(award => (Date.now() - award.timestamp) < VOTE_WINDOW); // Chỉ giữ lại các award trong VOTE_WINDOW (2s)

  if(latestAward){
    // Bật đèn giám định đã tham gia vào award này
    latestAward.judges.forEach(judge => {
      // Sử dụng VOTE_WINDOW làm thời gian hiển thị đèn
      showJudgeOverlay(judge, latestAward.side, latestAward.points, VOTE_WINDOW);
    });
  }
});


// 3. Listen for Votes (to check consensus VÀ SYNC ĐÈN GIÁM ĐỊNH LÊN MÀN HÌNH LỚN)
onValue(votesRef, (snapshot) => {
    const allVotes = snapshot.val() || {};

    // 1. Logic ĐỒNG BỘ ĐÈN GIÁM ĐỊNH (SYNC LIGHTS) cho màn hình lớn
    const now = Date.now();

    Object.values(allVotes).forEach(vote => {
        if ((now - vote.timestamp) <= VOTE_WINDOW) {
            // Nếu phiếu bầu còn hợp lệ trong 2s
            
            // Hiển thị đèn tạm thời trên màn hình lớn
            const el = document.getElementById(`light-${vote.side}-${vote.judge}`);
            if(el){
                const overlay = el.querySelector('.overlay');
                overlay.innerText = '+' + vote.points;
                // Bật lớp 'showPoints' để hiển thị số điểm
                el.classList.add('on','showPoints');
                const badge = el.querySelector('.badge'), sub = el.querySelector('.sub');
                badge.style.visibility='hidden'; sub.style.visibility='hidden';
            }
        }
    });

    // 2. Logic XỬ LÝ ĐỒNG THUẬN (Sử dụng Global Lock)
    checkConsensusAndAwardPointsLogic(allVotes);
});


// 4. Client-side timer synchronization (Update time every second)
let lastTickTime = Date.now();

setInterval(() => {
  const now = Date.now();
  const elapsedMs = now - lastTickTime;

  if(state.timerRunning || state.restRunning){
    // Đảm bảo chỉ trừ 1 giây khi đủ 1000ms
    if (elapsedMs >= 1000) { 
        const secondsElapsed = Math.floor(elapsedMs / 1000); // Số giây thực sự trôi qua
        lastTickTime = now; // Reset thời gian tick

      if(state.timerRunning){
        let newTimeLeft = Math.max(0, state.timeLeft - secondsElapsed);
        state.timeLeft = newTimeLeft;
        if(newTimeLeft === 0){
          playEndGameBeep();
          state.timerRunning = false;
          if(window.setMatchKey) window.setMatchKey('timerRunning', false);
        } 
      } else if(state.restRunning){
        let newRestLeft = Math.max(0, state.restLeft - secondsElapsed);
        state.restLeft = newRestLeft;
        if(newRestLeft === 0){
          playEndGameBeep();
          state.restRunning = false;
          if(window.setMatchKey) window.setMatchKey('restRunning', false);
        }
      }
    }
  } else {
    lastTickTime = now; // Reset tick time khi đồng hồ đang dừng để không bị nhảy khi resume
  }
  
  updateDisplay();

}, 200); // Chạy 5 lần/giây để hiển thị mượt mà hơn