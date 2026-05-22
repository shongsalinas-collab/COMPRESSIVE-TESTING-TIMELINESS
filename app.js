/* ================================================================
   Big Ben RMC -- Compressive Testing Timeliness Dashboard
   app.js | Firebase Realtime Database | Offline-first
   Working days: Mon-Sat | Skip Sundays + Custom Holidays
   ================================================================ */

const firebaseConfig = {
  apiKey:            "AIzaSyAmXOD96TIe82qMBEuQKY042onRDE3GfnQ",
  authDomain:        "bigben-compressive.firebaseapp.com",
  databaseURL:       "https://bigben-compressive-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "bigben-compressive",
  storageBucket:     "bigben-compressive.firebasestorage.app",
  messagingSenderId: "62495783486",
  appId:             "1:62495783486:web:807ffc4769f60f8b372f6f"
};

const CURING_AGES = ['1 Day', '3 Days', '7 Days', '14 Days', '28 Days'];
const CURING_DAYS = { '1 Day':1, '3 Days':3, '7 Days':7, '14 Days':14, '28 Days':28 };

/* -- State -- */
let specimens   = [];
let holidays    = [];
let editIdx     = null;
let gaugeCharts = {};
let trendChart  = null;
let activeTab   = 'kpi';
let db          = null;
let isOnline    = navigator.onLine;
let pendingSync = [];

/* ================================================================
   HOLIDAY & DATE UTILITIES
   ================================================================ */
function getHolidayDates() {
  return new Set(holidays.map(h => h.date));
}

function isWorkingDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay(); // 0=Sun, 6=Sat
  if (day === 0) return false; // Sunday off
  if (getHolidayDates().has(dateStr)) return false;
  return true;
}

function addWorkingDays(startDateStr, numDays) {
  let d = new Date(startDateStr + 'T00:00:00');
  let added = 0;
  while (added < numDays) {
    d.setDate(d.getDate() + 1);
    const str = d.toISOString().split('T')[0];
    if (isWorkingDay(str)) added++;
  }
  return d.toISOString().split('T')[0];
}

function computeDueDateFor(pourDate, curingAge) {
  if (!pourDate || !curingAge) return '';
  const days = CURING_DAYS[curingAge];
  if (!days) return '';
  return addWorkingDays(pourDate, days);
}

function computeStatusFor(dueDate, testDate) {
  if (!dueDate) return 'Pending';
  if (!testDate) return 'Pending';
  if (testDate <= dueDate) return 'On Time';
  return 'Late';
}

function statusColor(status) {
  if (status === 'On Time') return '#3B6D11';
  if (status === 'Late') return '#A32D2D';
  return '#854F0B';
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function daysBetween(a, b) {
  const da = new Date(a + 'T00:00:00');
  const db2 = new Date(b + 'T00:00:00');
  return Math.round((db2 - da) / 86400000);
}

/* ================================================================
   ONLINE / OFFLINE
   ================================================================ */
function updateOnlineStatus() {
  isOnline = navigator.onLine;
  const el = document.getElementById('online-indicator');
  if (el) {
    el.textContent = isOnline ? 'Online' : 'Offline';
    el.style.background = isOnline ? '#EAF3DE' : '#FAEEDA';
    el.style.color      = isOnline ? '#3B6D11' : '#854F0B';
    el.style.border     = isOnline ? '0.5px solid #639922' : '0.5px solid #EF9F27';
  }
  if (isOnline) syncPending();
}
window.addEventListener('online',  updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

/* ================================================================
   LOCAL STORAGE
   ================================================================ */
const LS_SPEC     = 'compress_specimens';
const LS_HOL      = 'compress_holidays';
const LS_PENDING  = 'compress_pending';

function saveLocal() {
  try {
    localStorage.setItem(LS_SPEC, JSON.stringify(specimens));
    localStorage.setItem(LS_HOL,  JSON.stringify(holidays));
  } catch(e) {}
}
function loadLocal() {
  try {
    const s = localStorage.getItem(LS_SPEC); if (s) specimens = JSON.parse(s);
    const h = localStorage.getItem(LS_HOL);  if (h) holidays  = JSON.parse(h);
    const p = localStorage.getItem(LS_PENDING); if (p) pendingSync = JSON.parse(p);
  } catch(e) {}
}
function savePending() {
  try { localStorage.setItem(LS_PENDING, JSON.stringify(pendingSync)); } catch(e) {}
}
function clearPending() {
  pendingSync = [];
  try { localStorage.removeItem(LS_PENDING); } catch(e) {}
}

/* ================================================================
   FIREBASE
   ================================================================ */
function initFirebase() {
  try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();

    db.ref('specimens').on('value', snap => {
      const val = snap.val();
      specimens = val
        ? Object.entries(val).map(([id, d]) => ({ ...d, _id: id }))
        : [];
      specimens.sort((a,b) => (b.pourDate||'').localeCompare(a.pourDate||''));
      saveLocal();
      buildMonthSelect();
      render();
      if (activeTab === 'kpi') setTimeout(renderCharts, 80);
    }, err => {
      console.warn('Firebase error:', err);
      toast('Using offline data', '#854F0B');
    });

    db.ref('holidays').on('value', snap => {
      const val = snap.val();
      holidays = val
        ? Object.entries(val).map(([id, d]) => ({ ...d, _id: id }))
        : [];
      holidays.sort((a,b) => a.date.localeCompare(b.date));
      saveLocal();
      renderHolidays();
      const badge = document.getElementById('holiday-count');
      if (badge) badge.textContent = holidays.length;
    });

  } catch(e) {
    console.warn('Firebase init failed:', e);
    toast('Offline mode', '#854F0B');
  }
}

function syncPending() {
  if (!db || !pendingSync.length) return;
  const toSync = [...pendingSync];
  clearPending();
  toSync.forEach(entry => {
    db.ref('specimens').push(entry)
      .then(() => toast('Synced: ' + (entry.dr||entry.design), '#639922'))
      .catch(() => { pendingSync.push(entry); savePending(); });
  });
}

/* ================================================================
   SAVE / DELETE
   ================================================================ */
function saveSpecimenToDb(entry) {
  if (!isOnline || !db) {
    const offline = { ...entry, _id: 'offline_' + Date.now(), _pending: true };
    specimens.unshift(offline);
    saveLocal();
    pendingSync.push(entry);
    savePending();
    return Promise.resolve();
  }
  if (editIdx !== null && specimens[editIdx] && specimens[editIdx]._id) {
    return db.ref('specimens/' + specimens[editIdx]._id).set(entry);
  }
  return db.ref('specimens').push(entry);
}

function deleteSpecimenFromDb() {
  if (!isOnline || !db) return Promise.reject(new Error('Offline'));
  return db.ref('specimens/' + specimens[editIdx]._id).remove();
}

function saveHolidayToDb(h) {
  if (!isOnline || !db) return Promise.reject(new Error('Offline'));
  return db.ref('holidays').push(h);
}

function deleteHolidayFromDb(id) {
  if (!isOnline || !db) return Promise.reject(new Error('Offline'));
  return db.ref('holidays/' + id).remove();
}

function clearAllData() {
  if (!confirm('Clear ALL specimen data? This cannot be undone.')) return;
  if (!isOnline || !db) { toast('Cannot clear while offline', '#E24B4A'); return; }
  db.ref('specimens').remove()
    .then(() => { localStorage.removeItem(LS_SPEC); toast('All data cleared.', '#378ADD'); })
    .catch(err => toast('Error: ' + err.message, '#E24B4A'));
}

/* ================================================================
   MONTH SELECT
   ================================================================ */
function buildMonthSelect() {
  const sel = document.getElementById('sel-month');
  if (!sel) return;
  const cur = sel.value;
  const months = new Set(specimens.map(d => (d.pourDate||'').slice(0,7)).filter(Boolean));
  const now = new Date();
  const thisMonth = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
  months.add(thisMonth);
  sel.innerHTML = '';
  [...months].sort().reverse().forEach(m => {
    const [y, mo] = m.split('-');
    const lbl = new Date(+y,+mo-1,1).toLocaleDateString('en-PH',{year:'numeric',month:'long'});
    const o = document.createElement('option');
    o.value = m; o.textContent = lbl;
    if (m === (cur||thisMonth)) o.selected = true;
    sel.appendChild(o);
  });
}

function selMonth() {
  const s = document.getElementById('sel-month');
  return s ? s.value : '';
}

function monthSpecimens() {
  return specimens.filter(d => (d.pourDate||'').startsWith(selMonth()));
}

/* ================================================================
   TABS
   ================================================================ */
function setTab(name, btn) {
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  const tab = document.getElementById('tab-' + name);
  if (tab) tab.classList.add('active');
  activeTab = name;
  if (name === 'kpi') setTimeout(renderCharts, 80);
  if (name === 'holidays') renderHolidays();
}

/* ================================================================
   RENDER
   ================================================================ */
function render() {
  const now = new Date();
  const dateEl = document.getElementById('cur-date');
  if (dateEl) dateEl.textContent = now.toLocaleDateString('en-PH',
    {weekday:'short',year:'numeric',month:'short',day:'numeric'});

  const md = monthSpecimens();
  const [y, mo] = (selMonth()||'').split('-');
  const lbl = y && mo
    ? new Date(+y,+mo-1,1).toLocaleDateString('en-PH',{year:'numeric',month:'long'})
    : '';
  const logLbl = document.getElementById('log-month-label');
  if (logLbl) logLbl.textContent = lbl;
  const trendLbl = document.getElementById('trend-month-label');
  if (trendLbl) trendLbl.textContent = lbl;

  renderOverall(md);
  renderGaugeAge(md);
  renderUpcoming();
  renderLog();
}

/* -- Overall KPI -- */
function renderOverall(md) {
  const tot   = md.length;
  const ontime = md.filter(d => d.status==='On Time').length;
  const late  = md.filter(d => d.status==='Late').length;
  const pend  = md.filter(d => d.status==='Pending').length;
  const pct   = tot ? Math.round(ontime/tot*100) : 0;

  const color    = pct===100?'#3B6D11':pct>=80?'#854F0B':'#A32D2D';
  const barColor = pct===100?'#639922':pct>=80?'#EF9F27':'#E24B4A';

  const pctEl = document.querySelector('#overall-card .overall-big span:first-child');
  if (pctEl) { pctEl.textContent = pct+'%'; pctEl.style.color = color; }

  const bar = document.getElementById('overall-bar');
  if (bar) { bar.style.width = pct+'%'; bar.style.background = barColor; }

  const noteEl = document.getElementById('overall-note');
  if (noteEl) noteEl.textContent = pct===100
    ? 'All '+tot+' specimens tested on time -- monthly target achieved!'
    : (100-pct)+'% gap to 100% target - '+late+' late test'+(late!==1?'s':'')+' this month'+(pend?' - '+pend+' pending':'');

  ['mini-total','mini-pass','mini-rej','mini-pend'].forEach(function(id, i) {
    const el = document.querySelector('#'+id+' .ms-val');
    if (el) el.textContent = [tot,ontime,late,pend][i];
  });
}

/* -- Gauges per curing age -- */
function renderGaugeAge(md) {
  const grid = document.getElementById('gauge-age-grid');
  if (!grid) return;
  grid.innerHTML = '';

  CURING_AGES.forEach(function(age, i) {
    const rows  = md.filter(d => d.curingAge===age);
    const tot   = rows.length;
    const ontime = rows.filter(d => d.status==='On Time').length;
    const pct   = tot ? Math.round(ontime/tot*100) : null;
    const color     = pct===null?'#999':pct===100?'#3B6D11':pct>=80?'#854F0B':'#A32D2D';
    const fillColor = pct===null?'#ddd':pct===100?'#639922':pct>=80?'#EF9F27':'#E24B4A';
    const cls       = pct===null?'':pct===100?'hit':pct>=80?'warn':'critical';
    const pillCls   = pct===null?'p-pend':pct===100?'p-pass':pct>=80?'p-pend':'p-rej';
    const pillLbl   = pct===null?'no data':pct===100?'on target':pct>=80?'below target':'critical';

    const card = document.createElement('div');
    card.className = 'gauge-card '+cls;
    card.innerHTML =
      '<div class="gauge-mat">'+age+'</div>'+
      '<div class="gauge-wrap"><canvas id="gc-'+i+'" width="90" height="50"></canvas></div>'+
      '<div class="gauge-pct" style="color:'+color+'">'+(pct!==null?pct+'%':'--')+'</div>'+
      '<div class="gauge-det">'+ontime+'/'+tot+' on time</div>'+
      '<span class="gauge-pill badge '+pillCls+'">'+pillLbl+'</span>';
    grid.appendChild(card);

    setTimeout(function() {
      const ctx = document.getElementById('gc-'+i);
      if (!ctx) return;
      if (gaugeCharts[i]) { try { gaugeCharts[i].destroy(); } catch(e){} }
      gaugeCharts[i] = new Chart(ctx, {
        type:'doughnut',
        data:{ datasets:[{
          data:[pct||0, 100-(pct||0)],
          backgroundColor:[fillColor,'rgba(128,128,128,0.1)'],
          borderWidth:0, circumference:180, rotation:270
        }]},
        options:{ responsive:false, maintainAspectRatio:false, cutout:'68%',
          plugins:{legend:{display:false},tooltip:{enabled:false}},
          animation:{duration:500}}
      });
    }, 100+i*30);
  });
}

/* -- Upcoming due tests -- */
function renderUpcoming() {
  const el = document.getElementById('upcoming-list');
  if (!el) return;

  const todayStr = today();
  const in7days = new Date();
  in7days.setDate(in7days.getDate() + 7);
  const in7Str = in7days.toISOString().split('T')[0];

  const pending = specimens.filter(d =>
    d.status === 'Pending' && d.dueDate
  ).sort((a,b) => a.dueDate.localeCompare(b.dueDate));

  const overdue   = pending.filter(d => d.dueDate < todayStr);
  const dueToday  = pending.filter(d => d.dueDate === todayStr);
  const upcoming  = pending.filter(d => d.dueDate > todayStr && d.dueDate <= in7Str);

  if (!pending.length) {
    el.innerHTML = '<div style="color:var(--text-2);font-size:12px;padding:12px 0">No pending tests in the next 7 days.</div>';
    return;
  }

  const makeRow = (d, color, label) => {
    const days = daysBetween(todayStr, d.dueDate);
    const daysText = days < 0 ? Math.abs(days)+' day'+(Math.abs(days)!==1?'s':'')+' overdue'
                   : days === 0 ? 'Due today'
                   : 'Due in '+days+' day'+(days!==1?'s':'');
    return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:0.5px solid var(--border);font-size:11px">'+
      '<span style="background:'+color+';color:#fff;padding:2px 8px;border-radius:6px;font-size:9px;font-weight:600;white-space:nowrap">'+label+'</span>'+
      '<span style="font-weight:500">'+d.mixDesign+'</span>'+
      '<span style="color:var(--text-2)">'+d.curingAge+'</span>'+
      '<span style="color:var(--text-2)">Due: '+d.dueDate+'</span>'+
      '<span style="color:'+color+';font-weight:500">'+daysText+'</span>'+
      (d.project?'<span style="color:var(--text-2)">'+d.project+'</span>':'')+
    '</div>';
  };

  el.innerHTML =
    overdue.map(d => makeRow(d,'#E24B4A','OVERDUE')).join('') +
    dueToday.map(d => makeRow(d,'#EF9F27','TODAY')).join('') +
    upcoming.map(d => makeRow(d,'#378ADD','UPCOMING')).join('');
}

/* -- Trend chart -- */
function renderCharts() {
  const md = monthSpecimens();
  const monthStr = selMonth();
  if (!monthStr) return;
  if (trendChart) { try { trendChart.destroy(); } catch(e){} trendChart = null; }
  const [y, mo] = monthStr.split('-');
  const days = Array.from({length:new Date(+y,+mo,0).getDate()},(_,i) =>
    monthStr+'-'+String(i+1).padStart(2,'0'));

  const ontimeRates = days.map(date => {
    const rows = md.filter(d => d.dueDate===date && d.status!=='Pending');
    if (!rows.length) return null;
    return Math.round(rows.filter(d => d.status==='On Time').length/rows.length*100);
  });
  const lateCounts = days.map(date =>
    md.filter(d => d.dueDate===date && d.status==='Late').length);

  const ctx = document.getElementById('chartTrend');
  if (!ctx) return;
  trendChart = new Chart(ctx, {
    type:'bar',
    data:{ labels:days.map(d=>d.slice(8)), datasets:[
      {type:'line',data:ontimeRates,borderColor:'#3B6D11',backgroundColor:'rgba(59,109,17,0.07)',
       tension:0.35,fill:true,pointRadius:3,pointBackgroundColor:'#639922',
       borderWidth:2,spanGaps:true,yAxisID:'y'},
      {type:'line',data:days.map(()=>100),borderColor:'#378ADD',borderDash:[5,4],
       pointRadius:0,fill:false,borderWidth:1.5,yAxisID:'y'},
      {type:'bar',data:lateCounts,backgroundColor:'rgba(226,75,74,0.28)',
       borderRadius:2,yAxisID:'y2'}
    ]},
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{
        x:{grid:{display:false},ticks:{font:{size:9},autoSkip:true,maxTicksLimit:15}},
        y:{min:0,max:105,position:'left',ticks:{font:{size:9},callback:v=>v+'%'},
          grid:{color:'rgba(128,128,128,0.07)'}},
        y2:{min:0,max:6,position:'right',ticks:{font:{size:9},stepSize:1},grid:{display:false}}
      }
    }
  });
}

/* -- Specimen Log -- */
function renderLog() {
  const md     = monthSpecimens();
  const search = (document.getElementById('search-box')||{value:''}).value.toLowerCase();
  const fAge   = (document.getElementById('filter-age')||{value:''}).value;
  const fStat  = (document.getElementById('filter-status')||{value:''}).value;

  let rows = [...md].sort((a,b) =>
    (b.pourDate||'').localeCompare(a.pourDate||''));
  if (search) rows = rows.filter(r =>
    [r.mixDesign,r.dr,r.project,r.tester,r.remarks].join(' ').toLowerCase().includes(search));
  if (fAge)  rows = rows.filter(r => r.curingAge===fAge);
  if (fStat) rows = rows.filter(r => r.status===fStat);

  const tbody = document.getElementById('log-body');
  if (!tbody) return;

  const todayStr = today();

  if (!rows.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="12">No specimens logged yet. Click "+ Log Specimen" to start.</td></tr>';
  } else {
    tbody.innerHTML = rows.map(function(d) {
      const idx = specimens.findIndex(x => x._id===d._id);
      const isLate = d.status==='Late';
      const isPend = d.status==='Pending';
      const isOver = isPend && d.dueDate && d.dueDate < todayStr;
      const pc = d.status==='On Time'?'p-pass':d.status==='Late'?'p-rej':'p-pend';
      const op = d._pending?' style="opacity:0.7"':'';
      return '<tr'+op+'>'+
        '<td>'+(d.pourDate||'--')+'</td>'+
        '<td title="'+(d.mixDesign||'')+'">'+(d.mixDesign||'--')+'</td>'+
        '<td>'+(d.dr||'--')+'</td>'+
        '<td title="'+(d.project||'')+'">'+(d.project||'--')+'</td>'+
        '<td>'+(d.curingAge||'--')+'</td>'+
        '<td style="'+(isOver?'color:#A32D2D;font-weight:500':'')+'">'+(d.dueDate||'--')+'</td>'+
        '<td>'+(d.testDate||'--')+'</td>'+
        '<td>'+(d.result?d.result+' MPa':'--')+'</td>'+
        '<td><span class="pill '+pc+'">'+d.status+'</span>'+
          (isOver&&isPend?'<span style="font-size:9px;color:#A32D2D;margin-left:3px">OVERDUE</span>':'')+
          (d._pending?'<span style="font-size:9px;color:#854F0B;margin-left:3px">pending</span>':'')+
        '</td>'+
        '<td>'+(d.tester||'--')+'</td>'+
        '<td title="'+(d.remarks||'')+'">'+(d.remarks||'--')+'</td>'+
        '<td>'+(d._pending?'':
          '<button class="act-btn" onclick="openEditForm('+idx+')" title="Edit">'+
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'+
          '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>'+
          '<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>'+
          '</svg></button>')+
        '</td>'+
      '</tr>';
    }).join('');
  }
  const footer = document.getElementById('log-footer');
  if (footer) footer.textContent = 'Showing '+rows.length+' of '+md.length+' specimens for this month';
}

/* ================================================================
   SPECIMEN MODAL
   ================================================================ */
function getVal(id) { const el=document.getElementById(id); return el?el.value:''; }
function setVal(id,v){ const el=document.getElementById(id); if(el) el.value=v; }

function computeDueDate() {
  const pourDate = getVal('m-date');
  const curingAge = getVal('m-age');
  const due = computeDueDateFor(pourDate, curingAge);
  setVal('m-due', due);
  computeStatus();
}

function computeStatus() {
  const due    = getVal('m-due');
  const tested = getVal('m-tested');
  const status = computeStatusFor(due, tested);
  const el = document.getElementById('m-status');
  if (el) {
    el.value = status;
    el.style.color = statusColor(status);
  }
}

function openAddForm() {
  try {
    editIdx = null;
    const now = new Date();
    const title = document.getElementById('modal-title');
    if (title) title.textContent = 'Log New Specimen';
    const delBtn = document.getElementById('modal-delete-btn');
    if (delBtn) delBtn.style.display = 'none';
    const saveBtn = document.getElementById('modal-save-btn');
    if (saveBtn) saveBtn.textContent = 'Save Specimen';

    setVal('m-date', now.toISOString().split('T')[0]);
    ['m-design','m-dr','m-project','m-tested','m-result','m-tester','m-remarks']
      .forEach(id => setVal(id,''));
    setVal('m-age','');
    setVal('m-due','');
    setVal('m-status','Pending');
    const statusEl = document.getElementById('m-status');
    if (statusEl) statusEl.style.color = '#854F0B';

    const modal = document.getElementById('delivery-modal');
    if (modal) modal.classList.add('open');
  } catch(e) {
    console.error('openAddForm:', e);
    toast('Error: '+e.message,'#E24B4A');
  }
}

function openEditForm(idx) {
  try {
    editIdx = idx;
    const d = specimens[idx];
    if (!d) return;
    const title = document.getElementById('modal-title');
    if (title) title.textContent = 'Edit Specimen';
    const delBtn = document.getElementById('modal-delete-btn');
    if (delBtn) delBtn.style.display = 'inline-flex';
    const saveBtn = document.getElementById('modal-save-btn');
    if (saveBtn) saveBtn.textContent = 'Save Changes';

    setVal('m-date',    d.pourDate||'');
    setVal('m-design',  d.mixDesign||'');
    setVal('m-dr',      d.dr||'');
    setVal('m-project', d.project||'');
    setVal('m-age',     d.curingAge||'');
    setVal('m-due',     d.dueDate||'');
    setVal('m-tested',  d.testDate||'');
    setVal('m-result',  d.result||'');
    setVal('m-status',  d.status||'Pending');
    setVal('m-tester',  d.tester||'');
    setVal('m-remarks', d.remarks||'');
    const statusEl = document.getElementById('m-status');
    if (statusEl) statusEl.style.color = statusColor(d.status||'Pending');

    const modal = document.getElementById('delivery-modal');
    if (modal) modal.classList.add('open');
  } catch(e) {
    console.error('openEditForm:', e);
    toast('Error: '+e.message,'#E24B4A');
  }
}

function closeDeliveryModal() {
  const modal = document.getElementById('delivery-modal');
  if (modal) modal.classList.remove('open');
  editIdx = null;
}

function saveDelivery() {
  const pourDate  = getVal('m-date');
  const mixDesign = getVal('m-design').trim();
  const curingAge = getVal('m-age');
  if (!pourDate||!mixDesign||!curingAge) {
    toast('Please fill in Pour Date, Mix Design and Curing Age.','#E24B4A');
    return;
  }

  const dueDate  = getVal('m-due') || computeDueDateFor(pourDate, curingAge);
  const testDate = getVal('m-tested');
  const status   = computeStatusFor(dueDate, testDate);

  const entry = {
    pourDate, mixDesign, curingAge, dueDate,
    dr:      getVal('m-dr').trim(),
    project: getVal('m-project').trim(),
    testDate, status,
    result:  getVal('m-result'),
    tester:  getVal('m-tester').trim(),
    remarks: getVal('m-remarks').trim(),
  };

  const btn = document.getElementById('modal-save-btn');
  if (btn) { btn.textContent='Saving...'; btn.disabled=true; }

  saveSpecimenToDb(entry)
    .then(() => {
      closeDeliveryModal();
      setVal('sel-month', pourDate.slice(0,7));
      buildMonthSelect();
      render();
      if (activeTab==='kpi') setTimeout(renderCharts,80);
      toast(editIdx!==null?'Specimen updated!':'Specimen logged: '+mixDesign+' ('+curingAge+')',
        status==='On Time'?'#639922':status==='Late'?'#E24B4A':'#854F0B');
    })
    .catch(err => toast('Save failed: '+err.message,'#E24B4A'))
    .finally(() => {
      if (btn) { btn.textContent=editIdx!==null?'Save Changes':'Save Specimen'; btn.disabled=false; }
    });
}

function deleteEntry() {
  if (editIdx===null) return;
  if (!confirm('Delete this specimen? This cannot be undone.')) return;
  deleteSpecimenFromDb()
    .then(() => { closeDeliveryModal(); toast('Specimen deleted.','#E24B4A'); })
    .catch(err => toast('Delete failed: '+err.message,'#E24B4A'));
}

/* ================================================================
   HOLIDAY MANAGER
   ================================================================ */
function openHolidayManager() {
  const tab = document.querySelector('.tab:nth-child(3)');
  if (tab) setTab('holidays', tab);
}

function openHolidayForm() {
  setVal('hf-date', today());
  setVal('hf-name','');
  const fp = document.getElementById('holiday-form-panel');
  if (fp) fp.classList.add('open');
}

function closeHolidayForm() {
  const fp = document.getElementById('holiday-form-panel');
  if (fp) fp.classList.remove('open');
}

function saveHoliday() {
  const date = getVal('hf-date');
  const name = getVal('hf-name').trim();
  if (!date||!name) { toast('Please fill in date and name.','#E24B4A'); return; }

  const h = { date, name, type: getVal('hf-type') };
  saveHolidayToDb(h)
    .then(() => { closeHolidayForm(); toast('Holiday saved: '+name,'#639922'); })
    .catch(err => toast('Error: '+err.message,'#E24B4A'));
}

function deleteHoliday(id) {
  if (!confirm('Delete this holiday?')) return;
  deleteHolidayFromDb(id)
    .then(() => toast('Holiday deleted.','#E24B4A'))
    .catch(err => toast('Error: '+err.message,'#E24B4A'));
}

function renderHolidays() {
  const list = document.getElementById('holiday-list');
  if (!list) return;
  if (!holidays.length) {
    list.innerHTML = '<div style="color:var(--text-2);font-size:12px;padding:16px 0">No holidays added yet. Add holidays to ensure accurate due date computation.</div>';
    return;
  }
  list.innerHTML = '<div class="table-wrap"><table class="log-tbl"><thead><tr><th>Date</th><th>Holiday Name</th><th>Type</th><th></th></tr></thead><tbody>' +
    holidays.map(h =>
      '<tr><td>'+h.date+'</td><td>'+h.name+'</td><td>'+h.type+'</td>'+
      '<td><button class="act-btn" onclick="deleteHoliday(\''+h._id+'\')" style="color:#A32D2D">'+
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'+
      '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>'+
      '</svg></button></td></tr>'
    ).join('') +
  '</tbody></table></div>';
}

/* ================================================================
   EXPORT CSV
   ================================================================ */
function exportCSV() {
  const md = monthSpecimens();
  if (!md.length) { toast('No data to export.','#E24B4A'); return; }
  const hdrs = ['Pour Date','Mix Design','DR No.','Project','Curing Age',
    'Due Date','Test Date','Result (MPa)','Status','Tested By','Remarks'];
  const rows = md.map(d => [d.pourDate,d.mixDesign,d.dr,d.project,d.curingAge,
    d.dueDate,d.testDate,d.result,d.status,d.tester,d.remarks]
    .map(v => '"'+(v||'').replace(/"/g,'""')+'"').join(','));
  const csv = [hdrs.join(','),...rows].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  const [y,m] = (selMonth()||'').split('-');
  a.download = 'BigBen_CompressiveTesting_'+(y&&m?y+'_'+m:'export')+'.csv';
  a.click();
  toast('CSV exported.','#378ADD');
}

/* ================================================================
   TOAST
   ================================================================ */
function toast(msg, color) {
  color = color||'#639922';
  const el = document.getElementById('toast');
  const dot = document.getElementById('toast-dot');
  const msgEl = document.getElementById('toast-msg');
  if (!el) return;
  if (dot) dot.style.background = color;
  if (msgEl) msgEl.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3500);
}

/* ================================================================
   KEYBOARD
   ================================================================ */
document.addEventListener('keydown', function(e) {
  if (e.key==='Escape') { closeDeliveryModal(); closeHolidayForm(); }
});

/* ================================================================
   INIT
   ================================================================ */
document.addEventListener('DOMContentLoaded', function() {
  const sel = document.getElementById('sel-month');
  if (sel) sel.addEventListener('change', function() {
    render();
    if (activeTab==='kpi') setTimeout(renderCharts,80);
  });

  loadLocal();
  buildMonthSelect();
  render();
  initFirebase();
  updateOnlineStatus();
  setTimeout(renderCharts, 200);
});
