/* global cordova, window */
const API_BASE = 'https://tyradex.vercel.app/api/v1/pokemon/';
const TOTAL_Q = 10;
const DB_FILE = 'scores.json';

let state = {
  qIndex: 0,
  score: 0,
  startMs: 0,
  elapsedMs: 0,
  current: null,
  askedIds: new Set(),
};

// -------- UI helpers
const $ = (s) => document.querySelector(s);
const screens = {
  home: $('#screen-home'),
  quiz: $('#screen-quiz'),
  result: $('#screen-result'),
  lb: $('#screen-leaderboard')
};
function show(name) {
  Object.values(screens).forEach(el => el.classList.remove('active'));
  screens[name].classList.add('active');
}
function fmt(ms){
  const t = Math.floor(ms/1000);
  const m = String(Math.floor(t/60)).padStart(2,'0');
  const s = String(t%60).padStart(2,'0');
  return `${m}:${s}`;
}

// -------- Draw & API
function randId(){ return Math.floor(Math.random()*1025)+1; } // 1..1025
async function fetchPokemon() {
  let id;
  do { id = randId(); } while (state.askedIds.has(id));
  state.askedIds.add(id);

  const url = API_BASE + id;
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error('API error');
  const data = await res.json();

  const name = (data.name?.fr || data.name?.en || data.name || '').toString().trim();
  const img = data.sprites?.regular || data.sprites?.default || '';
  if (!img) throw new Error('Missing image');
  state.current = { id, name: name.toLowerCase(), imgUrl: img };
  $('#poke-img').src = img;
}

// -------- Timer
let timerInt = null;
function startTimer(){
  state.startMs = Date.now();
  timerInt = setInterval(() => {
    const elapsed = Date.now() - state.startMs;
    $('#timer').textContent = fmt(elapsed);
  }, 300);
}
function stopTimer(){
  if (timerInt) clearInterval(timerInt);
  state.elapsedMs = Date.now() - state.startMs;
}

// -------- Game flow
async function nextQuestion() {
  $('#feedback').textContent = '';
  $('#answer').value = '';
  $('#count').textContent = `${state.qIndex+1}/${TOTAL_Q}`;
  await fetchPokemon();
}

async function submitAnswer(e){
  e.preventDefault();
  const v = $('#answer').value.trim().toLowerCase();
  if (!v) return;
  const ok = v === state.current.name;
  if (ok) {
    state.score++;
    $('#feedback').textContent = `✅ Correct! (${state.current.name})`;
  } else {
    $('#feedback').textContent = `❌ Not quite… That Pokémon was: ${state.current.name}`;
  }

  state.qIndex++;
  if (state.qIndex >= TOTAL_Q) {
    stopTimer();
    $('#final-score').textContent = `Score: ${state.score}/${TOTAL_Q}`;
    $('#final-time').textContent = `Time: ${fmt(state.elapsedMs)}`;
    show('result');
  } else {
    setTimeout(() => nextQuestion(), 600);
  }
}

// -------- Persistence (cordova-plugin-file)
async function resolveDataDir() {
  return new Promise((resolve, reject) => {
    if (!cordova?.file?.dataDirectory) {
      console.error("cordova.file.dataDirectory not available. Is cordova-plugin-file installed?");
      reject("No dataDirectory");
      return;
    }
    window.resolveLocalFileSystemURL(cordova.file.dataDirectory, resolve, reject);
  });
}
async function readText(fileEntry) {
  return new Promise((resolve, reject) => {
    fileEntry.file(file => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result || '');
      reader.onerror = reject;
      reader.readAsText(file);
    }, reject);
  });
}
async function loadScores() {
  const dir = await resolveDataDir();
  return new Promise((resolve) => {
    dir.getFile(DB_FILE, { create: true }, (f) => {
      readText(f).then(txt => {
        console.log("Raw scores file:", txt);
        resolve(txt ? JSON.parse(txt) : []);
      }).catch(e => {
        console.error("Parse error in loadScores:", e);
        resolve([]);
      });
    }, (err) => {
      console.error("getFile error:", err);
      resolve([]);
    });
  });
}

async function saveScores(arr) {
  const dir = await resolveDataDir();
  return new Promise((resolve, reject) => {
    dir.getFile(DB_FILE, { create: true }, (f) => {
      f.createWriter(w => {
        w.onerror = reject;

        // vider le fichier puis écrire
        w.onwriteend = () => {
          w.onwriteend = resolve;
          const blob = new Blob([JSON.stringify(arr)], { type: 'application/json' });
          w.write(blob);
        };

        w.truncate(0);
      }, reject);
    }, reject);
  });
}
async function addScore(name, score, ms) {
  const list = await loadScores();
  list.push({ name, score, ms, at: Date.now() });
  list.sort((a,b)=> (b.score - a.score) || (a.ms - b.ms));
  await saveScores(list);
  return list.slice(0,5);
}
async function showLeaderboard(){
  const list = await loadScores();
  list.sort((a,b)=> (b.score - a.score) || (a.ms - b.ms));
  const top = list.slice(0,5);
  $('#leader-list').innerHTML = top
    .map(x => `<li><b>${x.name}</b> — ${x.score}/${TOTAL_Q} — ${fmt(x.ms)}</li>`)
    .join('') || '<li>No records yet — Be the very best!</li>';
}

// -------- Navigation
function startGame(){
  state = { qIndex:0, score:0, startMs:0, elapsedMs:0, current:null, askedIds:new Set() };
  $('#timer').textContent = '00:00';
  show('quiz');
  startTimer();
  nextQuestion().catch(err=>{
    $('#feedback').textContent = 'Network error — The Pokédex is unavailable!';
    console.error(err);
  });
}

document.addEventListener('deviceready', () => {
  $('#btn-start').onclick = startGame;
  $('#btn-leaderboard').onclick = () => { show('lb'); showLeaderboard(); };

  $('#answer-form').addEventListener('submit', submitAnswer);
  $('#btn-skip').onclick = () => { state.qIndex++; nextQuestion(); };

  $('#btn-save').onclick = async () => {
    const name = ($('#player-name').value || 'Mystery Trainer').trim();
    const top = await addScore(name, state.score, state.elapsedMs);
    $('#player-name').value = '';
    $('#leader-list').innerHTML = top
      .map(x => `<li><b>${x.name}</b> — ${x.score}/${TOTAL_Q} — ${fmt(x.ms)}</li>`)
      .join('');
    show('lb');
  };

  $('#btn-go-leaderboard').onclick = () => { show('lb'); showLeaderboard(); };
  $('#btn-home-1').onclick = () => show('home');
  $('#btn-home-2').onclick = () => show('home');
});
