import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getDatabase, ref, push, set, onValue, runTransaction, remove } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";

/* CÁC GIÁ TRỊ THỜI GIAN CỐ ĐỊNH */
const DEFAULT_ROUND_TIME = 90; // 1 phút 30 giây
const DEFAULT_REST_TIME = 30; // 30 giây
const VOTE_WINDOW = 1500; // 1.5 giây

/* STATE */
let state = {
  redScore:0, blueScore:0, round:1,
  timePerRound:DEFAULT_ROUND_TIME, timeLeft:DEFAULT_ROUND_TIME, timerRunning:false, lastUpdate:Date.now(),
  restTime:DEFAULT_REST_TIME, restLeft:DEFAULT_REST_TIME, restRunning:false,
  votes:[], 
  processedAwardKeys:new Set(), 
  judgeLightTimeouts:{},
  roundLabel:'round1',
  roundLabelText:'Hiệp 1',
  redName:'',
  blueName:'',
  eventTitle:'',
  eventSub:''
};

/* DOM */
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

/* selected round mode: 'round1','round2','round3','rest' (default round1) */
let selectedMode = 'round1';

/* UTILS */
function formatTime(sec){ const m = Math.floor(sec/60).toString().padStart(2,'0'); const s = (sec%60).toString().padStart(2,'0'); return `${m}:${s}`; }

function updateDisplay(){
  displayRedScore.innerText = state.redScore;
  displayBlueScore.innerText = state.blueScore;

  // round label: prefer roundLabelText from DB/state if present
  if(state.roundLabelText) displayRound.innerText = state.roundLabelText;
  else {
    if(selectedMode === 'rest') displayRound.innerText = 'Giải lao';
    else {
      const rnum = parseInt(inputRound.value) || state.round || 1;
      if(selectedMode === 'round1') displayRound.innerText = 'Hiệp ' + rnum;
      else if(selectedMode === 'round2') displayRound.innerText = 'Hiệp ' + (rnum>=2? rnum : 2);
      else if(selectedMode === 'round3') displayRound.innerText = 'Hiệp ' + (rnum>=3? rnum : 3);
    }
  }

  // compute shown time: if remote timer running, compute remaining using lastUpdate
  displayClock.innerText = formatTime(state.restRunning ? state.restLeft : state.timeLeft);
  displayRedName.innerText = state.redName || redNameInput.value || 'VĐV ĐỎ';
  displayBlueName.innerText = state.blueName || blueNameInput.value || 'VĐV XANH';
  eventTitle.innerText = state.eventTitle || tournamentNameInput.value || 'GIẢI IPES MỞ RỘNG NĂM 2025';
  eventSubDisplay.innerText = state.eventSub || eventSubInput.value || '';
  document.title = `${displayRedName.innerText} ${state.redScore}-${state.blueScore} ${displayBlueName.innerText}`;
}

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

/* overlay show points for judge light: hide badge/sub and show +X big */
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

/* quick flash for +point (short) */
function quickPointFlash(side){
  const flash = side==='red' ? document.getElementById('leftFlash') : document.getElementById('rightFlash');
  if(!flash) return;
  flash.style.opacity = '0.9';
  setTimeout(()=>{ flash.style.opacity = '0'; }, 900); // ~1s flash
}

/* flash message */
function flashMessage(txt){
  const el = document.createElement('div'); el.style.position='fixed'; el.style.left='50%'; el.style.top='18px'; el.style.transform='translateX(-50%)'; el.style.background='linear-gradient(90deg,#121216,#0b0b0b)'; el.style.padding='10px 14px'; el.style.borderRadius='10px'; el.style.boxShadow='0 12px 40px rgba(0,0,0,0.6)'; el.style.zIndex=9999; el.style.color='#fff'; el.style.opacity='0'; el.style.transition='opacity .16s ease'; el.innerText = txt; document.body.appendChild(el); requestAnimationFrame(()=>el.style.opacity=1); setTimeout(()=>{ el.style.opacity=0; setTimeout(()=>el.remove(),300); },1600);
}

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
// Âm thanh "keng keng" khi hết giờ/trận/giải lao
function playEndGameBeep(){
  playTone(980, 0.2, 0);
  setTimeout(()=>playTone(980,0.2,0), 300);
}
function playWinBeep(){ playTone(1200,0.12); } // optional single flourish for winner

/* WIN flash: blink whole card for 5s (0.5s on/off) + sound */
function winnerFlash(side){
  const isRed = (side==='red');
  const flash = isRed ? document.getElementById('leftFlash') : document.getElementById('rightFlash');
  const card = isRed ? document.getElementById('leftCard') : document.getElementById('rightCard');
  if(!flash || !card) return;
  card.style.position = card.style.position || 'relative';
  let visible = false;
  // play small win beep once at start
  playWinBeep();
  const interval = setInterval(()=> {
    visible = !visible;
    flash.style.opacity = visible ? '0.98' : '0';
  }, 500); // 0.5s toggle
  // stop after 5 seconds
  setTimeout(()=>{
    clearInterval(interval);
    flash.style.opacity = '0';
  }, 5000);
}

/* ADMIN manual score */
function manualScore(side, delta){
  if(window._manualScore) return window._manualScore(side, delta);
  if(side==='red') state.redScore = Math.max(-999, state.redScore + delta);
  else state.blueScore = Math.max(-999, state.blueScore + delta);
  // write to DB if available (keeps in sync)
  if(window.setMatchKey) window.setMatchKey(side+'Score', side==='red' ? state.redScore : state.blueScore);
  updateDisplay();
  flashMessage((delta>0?'+':'')+delta+' '+(side==='red'?'ĐỎ':'XANH')+' (TT)');
}

/* judgeVote: push vote to Firebase (only), show small local light for 1s */
function judgeVote(judge, side, points){
  if(window.pushVote){
    window.pushVote({
      judge: judge,
      side: side,
      points: points,
      timestamp: Date.now()
    }).catch(err => console.error('pushVote err', err));
    // show small immediate feedback light (no big flash, just indicate button hit)
    const el = document.getElementById(`light-${side}-${judge}`);
    if(el){ 
      // show overlay briefly using existing UI
      const overlay = el.querySelector('.overlay');
      overlay.innerText = '+' + points;
      el.classList.add('on','showPoints');
      const badge = el.querySelector('.badge'), sub = el.querySelector('.sub');
      badge.style.visibility='hidden'; sub.style.visibility='hidden';
      setTimeout(()=>{ if(el){ el.classList.remove('showPoints'); overlay.innerText=''; badge.style.visibility='visible'; sub.style.visibility='visible'; el.classList.remove('on'); } }, 900);
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
document.getElementById('selRound1').addEventListener('click', ()=> setRound('Hiệp 1', 'round1', 1));
document.getElementById('selRound2').addEventListener('click', ()=> setRound('Hiệp 2', 'round2', 2));
document.getElementById('selRound3').addEventListener('click', ()=> setRound('Hiệp 3', 'round3', 3));
document.getElementById('selRest').addEventListener('click', ()=> setRound('Giải lao', 'rest', parseInt(inputRound.value) || 1));

/* Bind admin control buttons - existing functions may be provided by Firebase module; we keep compatibility */
(function bindControlButtons(){
  const el = id => document.getElementById(id);
  if(el('btnStart')) el('btnStart').addEventListener('click', ()=> { if(window.startTimer) window.startTimer(); else { startTimerLocal(); } });
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
    } else if(state.restRunning){
      state.restLeft = Math.max(0, state.restLeft - 1);
      if(window.setMatchKey) window.setMatchKey('restLeft', state.restLeft);
      if(state.restLeft === 0){
        playEndGameBeep();
        state.restRunning = false;
        if(window.setMatchKey) { window.setMatchKey('restRunning', false); window.setMatchKey('restLeft', 0); }
      }
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
  state.votes = [];
  state.processedAwardKeys = new Set();
  inputRound.value = 1; // reset input
  selectedMode = 'round1';
  setSelectedModeLocal('round1');
  createJudgeLights();
  updateDisplay();
  if(_localTimerInterval) clearInterval(_localTimerInterval);
  flashMessage("Đã reset cục bộ về 0-0.");
}

/* -------------------- End local timer fallback -------------------- */


/* -------------------- Start Firebase module (Sử dụng cú pháp module) -------------------- */

/* ---------- Firebase config ---------- */
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


/* Hàm debounce để tránh lỗi race condition khi xử lý votes */
let _consensusDebounceTimeout = null;
function debounceConsensus(callback, delay = 150) { // Tăng nhẹ delay lên 150ms để ổn định hơn
    if (_consensusDebounceTimeout) {
        clearTimeout(_consensusDebounceTimeout);
    }
    _consensusDebounceTimeout = setTimeout(() => {
        callback();
        _consensusDebounceTimeout = null; // Reset timeout ID
    }, delay);
}


/* admin control functions (use setMatchKey to sync state) */
window.startTimer = async function(){
    const r = Math.max(1, parseInt(inputRound.value) || 1);
    const timePerRound = DEFAULT_ROUND_TIME;
    const isRest = selectedMode === 'rest';

    if(isRest){
        await window.setMatchKey('restLeft', DEFAULT_REST_TIME);
        await window.setMatchKey('restRunning', true);
        await window.setMatchKey('timerRunning', false);
        await window.setMatchKey('roundLabel', 'rest');
        await window.setMatchKey('roundLabelText', 'Giải lao');
    } else {
        await window.setMatchKey('round', r);
        await window.setMatchKey('timePerRound', timePerRound);
        await window.setMatchKey('timeLeft', timePerRound);
        await window.setMatchKey('timerRunning', true);
        await window.setMatchKey('restRunning', false);
        await window.setMatchKey('roundLabel', selectedMode || 'round1');
        await window.setMatchKey('roundLabelText', `Hiệp ${r}`);
    }
    await window.setMatchKey('lastUpdate', Date.now());
    playStartBeep();
}

window.pauseTimer = async function(){
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
        if (currentScore === null) return delta;
        return Math.max(-999, currentScore + delta);
    });
    flashMessage((delta>0?'+':'')+delta+' '+(side==='red'?'ĐỎ':'XANH')+' (TT DB)');
}

/* Push vote to DB */
window.pushVote = async function(voteData){
    await push(votesRef, voteData);
}


/* --------------- CORE LOGIC: CHECK CONSENSUS AND AWARD POINTS --------------- */
function checkConsensusAndAwardPointsLogic(allVotes) {
  const now = Date.now();
  
  // 1. Lọc ra các votes MỚI NHẤT trong cửa sổ VOTE_WINDOW (1500ms)
  const recentVotes = Object.entries(allVotes || {}).filter(([key, vote]) => {
    // Votes hợp lệ: trong cửa sổ thời gian 1500ms
    return (now - vote.timestamp) <= VOTE_WINDOW;
  }).map(([key, vote]) => ({ ...vote, key }));

  if (recentVotes.length < 2) return; // Cần ít nhất 2 vote để có đồng thuận

  // 2. Gom nhóm votes theo Side và Points
  const consensusMap = {};
  recentVotes.forEach(vote => {
    const key = `${vote.side}-${vote.points}`; // Ví dụ: red-2 hoặc blue-1
    if (!consensusMap[key]) {
      consensusMap[key] = {
        side: vote.side,
        points: vote.points,
        count: 0,
        judges: [], // lưu lại judge ID để bật đèn
        voteKeys: [] // lưu lại key của vote
      };
    }
    consensusMap[key].count++;
    consensusMap[key].judges.push(vote.judge);
    consensusMap[key].voteKeys.push(vote.key);
  });

  // 3. Kiểm tra điều kiện đồng thuận (>= 2/3)
  for (const key in consensusMap) {
    const { side, points, count, judges, voteKeys } = consensusMap[key];
    
    if (count >= 2) { // 2/3 Giám định đồng thuận
      // Đã đạt đồng thuận, tiến hành trao điểm
      
      // A. Tăng điểm (dùng runTransaction để đảm bảo atomic)
      runTransaction(ref(db, `match/${side}Score`), (currentScore) => {
        if (currentScore === null) currentScore = 0;
        // Trả về giá trị mới
        return currentScore + points; 
      }).then(transactionResult => {
        // Chỉ tiếp tục nếu điểm đã được cộng thành công
        if (!transactionResult.committed) return;

        // B. Ghi nhận Award
        const awardId = push(awardsRef).key;
        const awardData = {
          awardId: awardId,
          side: side,
          points: points,
          judges: judges,
          timestamp: Date.now(),
          voteKeys: voteKeys // lưu lại keys của votes đã dùng
        };
        
        // Ghi award
        set(ref(db, `awards/${awardId}`), awardData);

        // C. Đánh dấu votes đã được xử lý bằng cách xóa chúng
        // Đây là bước QUAN TRỌNG NHẤT để ngăn chặn việc xử lý lặp lại/cộng điểm kép
        voteKeys.forEach(voteKey => {
          remove(ref(db, `votes/${voteKey}`)); 
        });
        
        // D. Hiển thị trên màn hình local
        quickPointFlash(side);

      }).catch(err => {
        console.error('Award Transaction Failed:', err);
      });

      // Chỉ xử lý một lần đồng thuận/cửa sổ. Sau khi tìm thấy đồng thuận, thoát khỏi vòng lặp.
      return; 
    }
  }
}


/* --------------- Firebase Listeners --------------- */

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
  
  // Ẩn tất cả đèn
  document.querySelectorAll('.judge-light').forEach(el => el.classList.remove('on'));

  // Tìm award mới nhất
  const latestAward = Object.values(allAwards)
    .sort((a,b) => b.timestamp - a.timestamp)
    .find(award => (Date.now() - award.timestamp) < VOTE_WINDOW); // Chỉ giữ lại các award trong VOTE_WINDOW (1.5s)

  if(latestAward){
    // Bật đèn giám định đã tham gia vào award này
    latestAward.judges.forEach(judge => {
      // Sử dụng VOTE_WINDOW làm thời gian hiển thị đèn
      showJudgeOverlay(judge, latestAward.side, latestAward.points, VOTE_WINDOW);
    });
  }
});


// 3. Listen for Votes (to check for consensus)
onValue(votesRef, (snapshot) => {
  const allVotes = snapshot.val() || {};

  // Dùng Debounce để giới hạn tốc độ xử lý sự kiện votes (giảm lỗi cộng điểm kép)
  debounceConsensus(() => {
    checkConsensusAndAwardPointsLogic(allVotes); 
  }, 150); // Đợi 150ms để votes ổn định và lệnh xóa votes đầu tiên có thể hoàn tất
});


// 4. Client-side timer synchronization (Update time every second)
setInterval(() => {
  if(state.timerRunning || state.restRunning){
    // Calculate elapsed time since last update
    const elapsed = Math.floor((Date.now() - state.lastUpdate) / 1000);
    
    if(state.timerRunning){
      let newTimeLeft = Math.max(0, state.timeLeft - elapsed);

      if(newTimeLeft === 0){
        playEndGameBeep();
        state.timerRunning = false;
        // If running on Admin device, write 0 and stop running to DB
        if(window.setMatchKey){
          window.setMatchKey('timerRunning', false);
          window.setMatchKey('timeLeft', 0);
        }
      } 
      state.timeLeft = newTimeLeft;

    } else if(state.restRunning){
      let newRestLeft = Math.max(0, state.restLeft - elapsed);

      if(newRestLeft === 0){
        playEndGameBeep();
        state.restRunning = false;
        // If running on Admin device, write 0 and stop running to DB
        if(window.setMatchKey){
          window.setMatchKey('restRunning', false);
          window.setMatchKey('restLeft', 0);
        }
      }
      state.restLeft = newRestLeft;
    }
  }
  
  updateDisplay();

}, 1000);