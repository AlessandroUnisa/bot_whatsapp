'use strict';
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const cron = require('node-cron');
const XLSX = require('xlsx');
const express = require('express');
const { execSync } = require('child_process');

// Rimuove SingletonLock di Chromium rimasto da container precedenti
try { execSync('find /app/data -name "SingletonLock" -delete'); } catch {}
try { execSync('find /app/data -name "SingletonSocket" -delete'); } catch {}
try { execSync('pkill -9 -f chromium || true'); } catch {}

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CONFIG = {
  COMPLEANNI_FILE: './data/compleanni.xlsx',
  RICORRENZE_FILE: './data/ricorrenze.xlsx',
  GROUP_NAME: process.env.GROUP_NAME || 'SPIKE RM 🏛️',
  SEND_TIME: process.env.SEND_TIME || '0 9 * * *',
  PORT: parseInt(process.env.PORT) || 3000,
};

// ─── STATE ────────────────────────────────────────────────────────────────────
let currentQR = null;
let botReady = false;

// ─── WHATSAPP CLIENT ─────────────────────────────────────────────────────────
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './data' }),
  puppeteer: {
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  },
});

client.on('qr', qr => {
  currentQR = qr;
  botReady = false;
  qrcodeTerminal.generate(qr, { small: true });
  console.log(`\n📱 QR disponibile su: http://localhost:${CONFIG.PORT}`);
});

client.on('ready', () => {
  currentQR = null;
  botReady = true;
  console.log('✅ Bot connesso a WhatsApp!');
  avviaScheduler();
});

client.on('auth_failure', () => console.error('❌ Autenticazione fallita'));
client.on('disconnected', reason => {
  botReady = false;
  console.log('⚠️ Disconnesso:', reason);
});

// ─── EXCEL ────────────────────────────────────────────────────────────────────
function leggiCompleanni(tutti = false) {
  try {
    const wb = XLSX.readFile(CONFIG.COMPLEANNI_FILE);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws);
    if (tutti) return rows;
    return rows.filter(r => r.Nome && r.Cognome && r.Compleanno && r.Attivo !== 'NO');
  } catch (e) {
    console.error('❌ Errore lettura compleanni:', e.message);
    return [];
  }
}

function scriviCompleanni(rows) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Compleanni');
  XLSX.writeFile(wb, CONFIG.COMPLEANNI_FILE);
}

function leggiRicorrenze(tutti = false) {
  try {
    const wb = XLSX.readFile(CONFIG.RICORRENZE_FILE);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws);
    if (tutti) return rows;
    return rows.filter(r => r.Ricorrenza && r.Data && r.Messaggio && r.Attivo !== 'NO');
  } catch (e) {
    console.error('❌ Errore lettura ricorrenze:', e.message);
    return [];
  }
}

function scriviRicorrenze(rows) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Ricorrenze');
  XLSX.writeFile(wb, CONFIG.RICORRENZE_FILE);
}

// Converte numero seriale Excel in stringa GG/MM
function serialeToData(val) {
  if (typeof val === 'number') {
    const d = XLSX.SSF.parse_date_code(val);
    return `${String(d.d).padStart(2, '0')}/${String(d.m).padStart(2, '0')}`;
  }
  return String(val || '');
}

// ─── BOT LOGIC ────────────────────────────────────────────────────────────────
function isOggi(dataExcel) {
  const oggi = new Date();
  let d;
  if (dataExcel instanceof Date) {
    d = dataExcel;
  } else if (typeof dataExcel === 'number') {
    const p = XLSX.SSF.parse_date_code(dataExcel);
    d = new Date(p.y || 1900, (p.m || 1) - 1, p.d || 1);
  } else {
    const str = String(dataExcel).trim();
    const parts = str.includes('/') ? str.split('/') : str.split('-');
    if (parts.length >= 2) {
      const mese = parseInt(parts[str.includes('/') ? 1 : 1]) - 1;
      const giorno = parseInt(parts[str.includes('/') ? 0 : 2]);
      d = new Date(2000, mese, giorno);
    } else return false;
  }
  return d.getDate() === oggi.getDate() && d.getMonth() === oggi.getMonth();
}

function formatMsg(template, vars = {}) {
  let msg = template;
  for (const [k, v] of Object.entries(vars)) {
    msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
  }
  return msg;
}

async function trovaChatGruppo() {
  const chats = await client.getChats();
  const gruppo = chats.find(c => c.isGroup && c.name === CONFIG.GROUP_NAME);
  if (!gruppo) {
    console.error(`❌ Gruppo "${CONFIG.GROUP_NAME}" non trovato.`);
    console.log('Gruppi disponibili:', chats.filter(c => c.isGroup).map(c => c.name));
  }
  return gruppo || null;
}

async function controllaEInvia() {
  console.log(`\n[${new Date().toLocaleString('it-IT')}] 🔍 Controllo in corso...`);
  const gruppo = await trovaChatGruppo();
  if (!gruppo) return;
  let inviati = 0;

  for (const p of leggiCompleanni()) {
    if (isOggi(p.Compleanno)) {
      const msg = formatMsg(
        p.Template_personalizzato ||
        '🎂 *Tanti auguri {Nome} {Cognome}!* 🎉\n\n🆕 SPIKE RM 🏛️\nBuongiorno a tutti!\nOggi è il compleanno di *{Nome} {Cognome}*! 🥳\n\nUniamoci tutti per fargli/farle gli auguri più sinceri! 🎈\n\n*Tanti auguri da tutto il team SPIKE Roma!* 🍾',
        { Nome: p.Nome, Cognome: p.Cognome }
      );
      await gruppo.sendMessage(msg);
      console.log(`🎂 Auguri inviati per ${p.Nome} ${p.Cognome}`);
      inviati++;
      await sleep(2000);
    }
  }

  for (const r of leggiRicorrenze()) {
    if (isOggi(r.Data)) {
      await gruppo.sendMessage(r.Messaggio);
      console.log(`🗓️ Messaggio inviato per: ${r.Ricorrenza}`);
      inviati++;
      await sleep(2000);
    }
  }

  console.log(inviati === 0 ? '📭 Nessun messaggio da inviare oggi.' : `✅ ${inviati} messaggio/i inviato/i.`);
}

function avviaScheduler() {
  cron.schedule(CONFIG.SEND_TIME, controllaEInvia, { timezone: 'Europe/Rome' });
  console.log('📅 Scheduler attivo — ogni giorno alle 09:00 (Roma)');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── EXPRESS ADMIN ────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

const HTML = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SPIKE Bot Admin</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#f0f2f5;color:#1a1a1a}
  header{background:#075e54;color:#fff;padding:16px 24px;display:flex;align-items:center;gap:12px}
  header h1{font-size:1.2rem;font-weight:600}
  .badge{padding:4px 10px;border-radius:20px;font-size:.75rem;font-weight:600}
  .badge.on{background:#25d366;color:#fff}
  .badge.off{background:#ff6b6b;color:#fff}
  .badge.wait{background:#ffa500;color:#fff}
  main{max-width:1100px;margin:24px auto;padding:0 16px}
  .card{background:#fff;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.1);padding:24px;margin-bottom:20px}
  .card h2{font-size:1rem;font-weight:600;margin-bottom:16px;color:#075e54}
  .qr-wrap{text-align:center;padding:20px 0}
  .qr-wrap img{max-width:280px;border:8px solid #fff;box-shadow:0 2px 12px rgba(0,0,0,.15);border-radius:8px}
  .qr-wrap p{margin-top:12px;color:#666;font-size:.9rem}
  .tabs{display:flex;gap:4px;margin-bottom:20px}
  .tab{padding:10px 20px;border:none;background:#e8f5e9;border-radius:8px;cursor:pointer;font-size:.9rem;font-weight:500;color:#075e54}
  .tab.active{background:#075e54;color:#fff}
  .section{display:none}
  .section.active{display:block}
  .toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:12px;flex-wrap:wrap}
  input[type=search]{padding:8px 12px;border:1px solid #ddd;border-radius:8px;font-size:.9rem;width:240px}
  .btn{padding:8px 16px;border:none;border-radius:8px;cursor:pointer;font-size:.85rem;font-weight:500}
  .btn-green{background:#075e54;color:#fff}
  .btn-green:hover{background:#054d46}
  .btn-red{background:#ff6b6b;color:#fff}
  .btn-red:hover{background:#e05555}
  .btn-blue{background:#1a73e8;color:#fff}
  .btn-blue:hover{background:#155ab6}
  .btn-gray{background:#eee;color:#333}
  table{width:100%;border-collapse:collapse;font-size:.88rem}
  th{text-align:left;padding:10px 12px;background:#f7f7f7;font-weight:600;color:#555;border-bottom:2px solid #eee}
  td{padding:10px 12px;border-bottom:1px solid #f0f0f0;vertical-align:top}
  tr:hover td{background:#fafff9}
  .attivo-si{color:#25d366;font-weight:600}
  .attivo-no{color:#ff6b6b;font-weight:600}
  .msg-preview{max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#666}
  .actions{display:flex;gap:6px}
  /* Modal */
  .overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100;align-items:center;justify-content:center}
  .overlay.open{display:flex}
  .modal{background:#fff;border-radius:12px;padding:28px;width:min(560px,95vw);max-height:90vh;overflow-y:auto}
  .modal h3{font-size:1.05rem;font-weight:600;margin-bottom:20px;color:#075e54}
  .form-row{margin-bottom:14px}
  .form-row label{display:block;font-size:.83rem;font-weight:500;color:#555;margin-bottom:5px}
  .form-row input,.form-row select,.form-row textarea{width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:8px;font-size:.9rem;font-family:inherit}
  .form-row textarea{min-height:140px;resize:vertical;line-height:1.5}
  .modal-footer{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}
  .empty{text-align:center;padding:32px;color:#999;font-size:.9rem}
  @media(max-width:600px){input[type=search]{width:100%}.tabs{flex-wrap:wrap}}
</style>
</head>
<body>
<header>
  <div style="font-size:1.6rem">🤖</div>
  <h1>SPIKE Bot Admin</h1>
  <span id="statusBadge" class="badge wait">Connessione...</span>
</header>
<main>
  <!-- QR sezione -->
  <div id="qrSection" class="card" style="display:none">
    <h2>Scansiona il QR con WhatsApp</h2>
    <div class="qr-wrap">
      <img id="qrImg" src="" alt="QR Code">
      <p>WhatsApp → Menu → Dispositivi collegati → Collega un dispositivo</p>
    </div>
  </div>

  <!-- Tabs -->
  <div id="adminSection" style="display:none">
    <div class="tabs">
      <button class="tab active" onclick="showTab('compleanni')">🎂 Compleanni</button>
      <button class="tab" onclick="showTab('ricorrenze')">🗓️ Ricorrenze</button>
    </div>

    <!-- COMPLEANNI -->
    <div id="tab-compleanni" class="section active">
      <div class="card">
        <div class="toolbar">
          <input type="search" id="searchCompleanni" placeholder="Cerca per nome..." oninput="filterCompleanni()">
          <button class="btn btn-green" onclick="openModal('compleanni')">+ Aggiungi persona</button>
        </div>
        <table>
          <thead><tr><th>Nome</th><th>Cognome</th><th>Compleanno</th><th>Telefono</th><th>Attivo</th><th>Azioni</th></tr></thead>
          <tbody id="tbodyCompleanni"></tbody>
        </table>
      </div>
    </div>

    <!-- RICORRENZE -->
    <div id="tab-ricorrenze" class="section">
      <div class="card">
        <div class="toolbar">
          <input type="search" id="searchRicorrenze" placeholder="Cerca ricorrenza..." oninput="filterRicorrenze()">
          <button class="btn btn-green" onclick="openModal('ricorrenze')">+ Aggiungi ricorrenza</button>
        </div>
        <table>
          <thead><tr><th>Ricorrenza</th><th>Data</th><th>Attivo</th><th>Messaggio</th><th>Azioni</th></tr></thead>
          <tbody id="tbodyRicorrenze"></tbody>
        </table>
      </div>
    </div>
  </div>
</main>

<!-- MODAL COMPLEANNI -->
<div id="modalCompleanni" class="overlay">
  <div class="modal">
    <h3 id="modalCompTitle">Aggiungi persona</h3>
    <input type="hidden" id="compIdx" value="-1">
    <div class="form-row"><label>Nome *</label><input id="compNome" type="text" placeholder="es. Mario"></div>
    <div class="form-row"><label>Cognome *</label><input id="compCognome" type="text" placeholder="es. Rossi"></div>
    <div class="form-row"><label>Compleanno * (GG/MM o GG/MM/AAAA)</label><input id="compCompleanno" type="text" placeholder="es. 25/12 oppure 25/12/1990"></div>
    <div class="form-row"><label>Telefono</label><input id="compTelefono" type="text" placeholder="opzionale"></div>
    <div class="form-row">
      <label>Attivo</label>
      <select id="compAttivo"><option value="SI">SI</option><option value="NO">NO</option></select>
    </div>
    <div class="form-row"><label>Messaggio personalizzato (usa {Nome} e {Cognome})</label><textarea id="compTemplate" placeholder="Lascia vuoto per messaggio standard"></textarea></div>
    <div class="modal-footer">
      <button class="btn btn-gray" onclick="closeModal('compleanni')">Annulla</button>
      <button class="btn btn-green" onclick="saveCompleanni()">Salva</button>
    </div>
  </div>
</div>

<!-- MODAL RICORRENZE -->
<div id="modalRicorrenze" class="overlay">
  <div class="modal">
    <h3 id="modalRicTitle">Aggiungi ricorrenza</h3>
    <input type="hidden" id="ricIdx" value="-1">
    <div class="form-row"><label>Ricorrenza *</label><input id="ricNome" type="text" placeholder="es. Natale"></div>
    <div class="form-row"><label>Data * (GG/MM)</label><input id="ricData" type="text" placeholder="es. 25/12"></div>
    <div class="form-row">
      <label>Attivo</label>
      <select id="ricAttivo"><option value="SI">SI</option><option value="NO">NO</option></select>
    </div>
    <div class="form-row"><label>Messaggio *</label><textarea id="ricMessaggio" placeholder="Testo del messaggio da inviare"></textarea></div>
    <div class="modal-footer">
      <button class="btn btn-gray" onclick="closeModal('ricorrenze')">Annulla</button>
      <button class="btn btn-green" onclick="saveRicorrenza()">Salva</button>
    </div>
  </div>
</div>

<script>
let compleanni = [];
let ricorrenze = [];

// ─── STATUS POLLING ──────────────────────────────────────────────────────────
async function pollStatus() {
  try {
    const r = await fetch('/api/status');
    const s = await r.json();
    const badge = document.getElementById('statusBadge');
    const qrSec = document.getElementById('qrSection');
    const adminSec = document.getElementById('adminSection');

    if (s.connected) {
      badge.textContent = '✅ Connesso';
      badge.className = 'badge on';
      qrSec.style.display = 'none';
      adminSec.style.display = 'block';
    } else if (s.qr) {
      badge.textContent = '⏳ Attesa QR';
      badge.className = 'badge wait';
      qrSec.style.display = 'block';
      adminSec.style.display = 'none';
      loadQR();
    } else {
      badge.textContent = '🔴 Disconnesso';
      badge.className = 'badge off';
      qrSec.style.display = 'none';
      adminSec.style.display = 'none';
    }
  } catch {}
}

async function loadQR() {
  try {
    const r = await fetch('/api/qr');
    const d = await r.json();
    if (d.qr) document.getElementById('qrImg').src = d.qr;
  } catch {}
}

// ─── TABS ─────────────────────────────────────────────────────────────────────
function showTab(name) {
  document.querySelectorAll('.tab').forEach((t, i) => {
    const names = ['compleanni','ricorrenze'];
    t.classList.toggle('active', names[i] === name);
  });
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  if (name === 'compleanni') loadCompleanni();
  if (name === 'ricorrenze') loadRicorrenze();
}

// ─── COMPLEANNI ───────────────────────────────────────────────────────────────
async function loadCompleanni() {
  const r = await fetch('/api/compleanni');
  compleanni = await r.json();
  renderCompleanni(compleanni);
}

function renderCompleanni(rows) {
  const tbody = document.getElementById('tbodyCompleanni');
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty">Nessuna persona trovata</td></tr>'; return; }
  tbody.innerHTML = rows.map((p, i) => \`
    <tr>
      <td>\${esc(p.Nome||'')}</td>
      <td>\${esc(p.Cognome||'')}</td>
      <td>\${esc(p._dataDisplay||p.Compleanno||'')}</td>
      <td>\${esc(String(p.Telefono||''))}</td>
      <td class="attivo-\${(p.Attivo||'SI').toLowerCase()}">\${p.Attivo||'SI'}</td>
      <td class="actions">
        <button class="btn btn-blue" onclick="editCompleanni(\${p._idx})">Modifica</button>
        <button class="btn btn-red" onclick="deleteCompleanni(\${p._idx})">Elimina</button>
      </td>
    </tr>
  \`).join('');
}

function filterCompleanni() {
  const q = document.getElementById('searchCompleanni').value.toLowerCase();
  renderCompleanni(compleanni.filter(p =>
    (p.Nome||'').toLowerCase().includes(q) || (p.Cognome||'').toLowerCase().includes(q)
  ));
}

function openModal(type, data = null) {
  if (type === 'compleanni') {
    document.getElementById('modalCompTitle').textContent = data ? 'Modifica persona' : 'Aggiungi persona';
    document.getElementById('compIdx').value = data ? data._idx : -1;
    document.getElementById('compNome').value = data?.Nome || '';
    document.getElementById('compCognome').value = data?.Cognome || '';
    document.getElementById('compCompleanno').value = data?._dataDisplay || data?.Compleanno || '';
    document.getElementById('compTelefono').value = data?.Telefono || '';
    document.getElementById('compAttivo').value = data?.Attivo || 'SI';
    document.getElementById('compTemplate').value = data?.Template_personalizzato || '';
    document.getElementById('modalCompleanni').classList.add('open');
  } else {
    document.getElementById('modalRicTitle').textContent = data ? 'Modifica ricorrenza' : 'Aggiungi ricorrenza';
    document.getElementById('ricIdx').value = data ? data._idx : -1;
    document.getElementById('ricNome').value = data?.Ricorrenza || '';
    document.getElementById('ricData').value = data?.Data || '';
    document.getElementById('ricAttivo').value = data?.Attivo || 'SI';
    document.getElementById('ricMessaggio').value = data?.Messaggio || '';
    document.getElementById('modalRicorrenze').classList.add('open');
  }
}

function closeModal(type) {
  document.getElementById(type === 'compleanni' ? 'modalCompleanni' : 'modalRicorrenze').classList.remove('open');
}

function editCompleanni(idx) {
  const p = compleanni.find(x => x._idx === idx);
  if (p) openModal('compleanni', p);
}

async function deleteCompleanni(idx) {
  if (!confirm('Eliminare questa persona?')) return;
  await fetch('/api/compleanni/' + idx, { method: 'DELETE' });
  loadCompleanni();
}

async function saveCompleanni() {
  const idx = parseInt(document.getElementById('compIdx').value);
  const body = {
    Nome: document.getElementById('compNome').value.trim(),
    Cognome: document.getElementById('compCognome').value.trim(),
    Compleanno: document.getElementById('compCompleanno').value.trim(),
    Telefono: document.getElementById('compTelefono').value.trim() || '.',
    Attivo: document.getElementById('compAttivo').value,
    Template_personalizzato: document.getElementById('compTemplate').value.trim(),
  };
  if (!body.Nome || !body.Cognome || !body.Compleanno) { alert('Nome, Cognome e Compleanno sono obbligatori'); return; }
  if (idx === -1) {
    await fetch('/api/compleanni', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  } else {
    await fetch('/api/compleanni/' + idx, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  }
  closeModal('compleanni');
  loadCompleanni();
}

// ─── RICORRENZE ───────────────────────────────────────────────────────────────
async function loadRicorrenze() {
  const r = await fetch('/api/ricorrenze');
  ricorrenze = await r.json();
  renderRicorrenze(ricorrenze);
}

function renderRicorrenze(rows) {
  const tbody = document.getElementById('tbodyRicorrenze');
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty">Nessuna ricorrenza trovata</td></tr>'; return; }
  tbody.innerHTML = rows.map((r, i) => \`
    <tr>
      <td>\${esc(r.Ricorrenza||'')}</td>
      <td>\${esc(r.Data||'')}</td>
      <td class="attivo-\${(r.Attivo||'SI').toLowerCase()}">\${r.Attivo||'SI'}</td>
      <td><div class="msg-preview" title="\${esc(r.Messaggio||'')}">\${esc(r.Messaggio||'')}</div></td>
      <td class="actions">
        <button class="btn btn-blue" onclick="editRicorrenza(\${r._idx})">Modifica</button>
        <button class="btn btn-red" onclick="deleteRicorrenza(\${r._idx})">Elimina</button>
      </td>
    </tr>
  \`).join('');
}

function filterRicorrenze() {
  const q = document.getElementById('searchRicorrenze').value.toLowerCase();
  renderRicorrenze(ricorrenze.filter(r => (r.Ricorrenza||'').toLowerCase().includes(q)));
}

function editRicorrenza(idx) {
  const r = ricorrenze.find(x => x._idx === idx);
  if (r) openModal('ricorrenze', r);
}

async function deleteRicorrenza(idx) {
  if (!confirm('Eliminare questa ricorrenza?')) return;
  await fetch('/api/ricorrenze/' + idx, { method: 'DELETE' });
  loadRicorrenze();
}

async function saveRicorrenza() {
  const idx = parseInt(document.getElementById('ricIdx').value);
  const body = {
    Ricorrenza: document.getElementById('ricNome').value.trim(),
    Data: document.getElementById('ricData').value.trim(),
    Attivo: document.getElementById('ricAttivo').value,
    Messaggio: document.getElementById('ricMessaggio').value.trim(),
  };
  if (!body.Ricorrenza || !body.Data || !body.Messaggio) { alert('Tutti i campi obbligatori devono essere compilati'); return; }
  if (idx === -1) {
    await fetch('/api/ricorrenze', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  } else {
    await fetch('/api/ricorrenze/' + idx, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  }
  closeModal('ricorrenze');
  loadRicorrenze();
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ─── INIT ─────────────────────────────────────────────────────────────────────
pollStatus();
setInterval(pollStatus, 5000);
loadCompleanni();
</script>
</body>
</html>`;

// ─── API ROUTES ───────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.send(HTML));

app.get('/api/status', (req, res) => {
  res.json({ connected: botReady, qr: !!currentQR });
});

app.get('/api/qr', async (req, res) => {
  if (!currentQR) return res.status(404).json({ error: 'QR non disponibile' });
  try {
    const dataUrl = await QRCode.toDataURL(currentQR, { width: 280 });
    res.json({ qr: dataUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Compleanni CRUD
app.get('/api/compleanni', (req, res) => {
  const rows = leggiCompleanni(true).map((r, i) => ({
    ...r,
    _idx: i,
    _dataDisplay: serialeToData(r.Compleanno),
  }));
  res.json(rows);
});

app.post('/api/compleanni', (req, res) => {
  const rows = leggiCompleanni(true);
  rows.push(req.body);
  scriviCompleanni(rows);
  res.json({ ok: true });
});

app.put('/api/compleanni/:idx', (req, res) => {
  const rows = leggiCompleanni(true);
  const idx = parseInt(req.params.idx);
  if (idx < 0 || idx >= rows.length) return res.status(404).json({ error: 'Not found' });
  rows[idx] = req.body;
  scriviCompleanni(rows);
  res.json({ ok: true });
});

app.delete('/api/compleanni/:idx', (req, res) => {
  const rows = leggiCompleanni(true);
  const idx = parseInt(req.params.idx);
  if (idx < 0 || idx >= rows.length) return res.status(404).json({ error: 'Not found' });
  rows.splice(idx, 1);
  scriviCompleanni(rows);
  res.json({ ok: true });
});

// Ricorrenze CRUD
app.get('/api/ricorrenze', (req, res) => {
  const rows = leggiRicorrenze(true).map((r, i) => ({ ...r, _idx: i }));
  res.json(rows);
});

app.post('/api/ricorrenze', (req, res) => {
  const rows = leggiRicorrenze(true);
  rows.push(req.body);
  scriviRicorrenze(rows);
  res.json({ ok: true });
});

app.put('/api/ricorrenze/:idx', (req, res) => {
  const rows = leggiRicorrenze(true);
  const idx = parseInt(req.params.idx);
  if (idx < 0 || idx >= rows.length) return res.status(404).json({ error: 'Not found' });
  rows[idx] = req.body;
  scriviRicorrenze(rows);
  res.json({ ok: true });
});

app.delete('/api/ricorrenze/:idx', (req, res) => {
  const rows = leggiRicorrenze(true);
  const idx = parseInt(req.params.idx);
  if (idx < 0 || idx >= rows.length) return res.status(404).json({ error: 'Not found' });
  rows.splice(idx, 1);
  scriviRicorrenze(rows);
  res.json({ ok: true });
});

app.listen(CONFIG.PORT, () => {
  console.log(`🌐 Admin panel: http://localhost:${CONFIG.PORT}`);
});

client.initialize();
