/* ================================================================
   Big Ben RMC -- Compressive Testing Timeliness Dashboard
   app.js | Firebase | Offline-first | Mon-Sat working days
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

const DAYS_LIST = ['01 Days','03 Days','07 Days','14 Days','21 Days','28 Days'];
const DAYS_NUM  = {'01 Days':1,'03 Days':3,'07 Days':7,'14 Days':14,'21 Days':21,'28 Days':28};

function getNumDays() {
  const sel = getVal('m-days');
  if (sel === '__other__') {
    const custom = parseInt(getVal('m-days-other'));
    return isNaN(custom) ? 0 : custom;
  }
  return DAYS_NUM[sel] || 0;
}

function getDaysLabel() {
  const sel = getVal('m-days');
  if (sel === '__other__') {
    const n = getVal('m-days-other');
    return n ? n + ' Days' : '';
  }
  return sel;
}

function getTestCenter() {
  const sel = getVal('m-testcenter');
  if (sel === '__other__') return getVal('m-testcenter-other').trim();
  return sel;
}

function getAggSize() {
  const sel = getVal('m-aggsize');
  if (sel === '__other__') return getVal('m-aggsize-other').trim();
  return sel;
}

function toggleDaysOther() {
  const wrap = document.getElementById('days-other-wrap');
  if (wrap) wrap.style.display = getVal('m-days') === '__other__' ? '' : 'none';
  computeDueDate();
}

function toggleAggOther() {
  const wrap = document.getElementById('agg-other-wrap');
  if (wrap) wrap.style.display = getVal('m-aggsize') === '__other__' ? '' : 'none';
}

const BRANCHES = {
  'Megatesting Center, Inc.': ['Quezon City','Manila','Pasay City','Pasig City','Valenzuela City','Caloocan City','Navotas City','Malabon City','Bulacan','Pampanga'],
  'Terms Concrete':            ['Quezon City','Manila','Pasay City','Pasig City','Valenzuela City','Caloocan City','Navotas City','Malabon City','Bulacan','Pampanga'],
  'EP Materials Testing Center':['Quezon City','Manila','Pasay City','Pasig City','Valenzuela City','Caloocan City','Navotas City','Malabon City','Bulacan','Pampanga'],
  'Philippine Geoanalytics':   ['Quezon City','Manila','Pasay City','Pasig City','Valenzuela City','Caloocan City','Navotas City','Malabon City','Bulacan','Pampanga'],
  'DPWH':                      ['Quezon City','Manila','Pasay City','Pasig City','Valenzuela City','Caloocan City','Navotas City','Malabon City','Bulacan','Pampanga'],
};

let specimens   = [];
let holidays    = [];
let editIdx     = null;
let gaugeCharts = {};
let trendChart  = null;
let activeTab   = 'kpi';
let db          = null;
let isOnline    = navigator.onLine;
let pendingSync = [];
let modalIsOpen = false;  // flag to pause Firebase UI updates

/* ================================================================
   DATE UTILITIES
   ================================================================ */
function getHolidayDates() { return new Set(holidays.map(h => h.date)); }

function isWorkingDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  if (d.getDay() === 0) return false;
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

function computeDueDateFor(castedDate, numDays) {
  if (!castedDate || !numDays) return '';
  const num = typeof numDays === 'number' ? numDays : (DAYS_NUM[numDays] || parseInt(numDays) || 0);
  if (!num) return '';
  const d = new Date(castedDate + 'T00:00:00');
  d.setDate(d.getDate() + num);
  return d.toISOString().split('T')[0];
}

function getEffectiveDueDate(dueDate) {
  // If due date falls on Sunday or holiday, move to next working day
  if (!dueDate) return dueDate;
  let d = new Date(dueDate + 'T00:00:00');
  const holidays = getHolidayDates();
  while (d.getDay() === 0 || holidays.has(d.toISOString().split('T')[0])) {
    d.setDate(d.getDate() + 1);
  }
  return d.toISOString().split('T')[0];
}

function computeAgeFor(castedDate, testDate) {
  if (!castedDate || !testDate) return '';
  const diff = Math.round(
    (new Date(testDate + 'T00:00:00') - new Date(castedDate + 'T00:00:00')) / 86400000
  );
  return diff >= 0 ? diff : '';
}

function computeStatusFor(dueDate, testDate) {
  if (!dueDate || !testDate) return 'Pending';
  // Use effective due date (move if holiday/Sunday)
  const effectiveDue = getEffectiveDueDate(dueDate);
  return testDate <= effectiveDue ? 'On Time' : 'Late';
}

function statusColor(s) {
  if (s === 'On Time') return '#3B6D11';
  if (s === 'Late')    return '#A32D2D';
  return '#854F0B';
}

function today() { return new Date().toISOString().split('T')[0]; }

function daysBetween(a, b) {
  return Math.round((new Date(b+'T00:00:00') - new Date(a+'T00:00:00')) / 86400000);
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
const LS_SPEC    = 'compress_v3_specimens';
const LS_HOL     = 'compress_v3_holidays';
const LS_PENDING = 'compress_v3_pending';

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
      const newData = val
        ? Object.entries(val).map(([id, d]) => ({ ...d, _id: id }))
        : [];
      newData.sort((a,b) => (b.dateCasted||'').localeCompare(a.dateCasted||''));

      // Always update the data
      specimens = newData;
      saveLocal();
      updateAutocomplete();

      // Only update UI if modal is NOT open
      if (modalIsOpen) return;

      const currentSel = document.getElementById('sel-month');
      const savedMonth = currentSel ? currentSel.value : '';
      buildMonthSelect();
      if (savedMonth && currentSel) {
        const opts = Array.from(currentSel.options).map(o=>o.value);
        if (opts.includes(savedMonth)) currentSel.value = savedMonth;
      }
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
      // Only update UI if modal is not open
      if (!modalIsOpen) {
        renderHolidays();
        const badge = document.getElementById('holiday-count');
        if (badge) badge.textContent = holidays.length;
      }
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
      .then(() => toast('Synced: '+(entry.labNo||entry.project), '#639922'))
      .catch(() => { pendingSync.push(entry); savePending(); });
  });
}

/* ================================================================
   SAVE / DELETE
   ================================================================ */
function saveSpecimenToDb(entry) {
  if (!isOnline || !db) {
    const offline = { ...entry, _id: 'offline_'+Date.now(), _pending: true };
    specimens.unshift(offline);
    saveLocal();
    pendingSync.push(entry);
    savePending();
    return Promise.resolve();
  }
  if (editIdx !== null && specimens[editIdx] && specimens[editIdx]._id) {
    return db.ref('specimens/'+specimens[editIdx]._id).set(entry);
  }
  return db.ref('specimens').push(entry);
}

function deleteSpecimenFromDb() {
  if (!isOnline || !db) return Promise.reject(new Error('Offline'));
  return db.ref('specimens/'+specimens[editIdx]._id).remove();
}

function saveHolidayToDb(h) {
  if (!isOnline || !db) return Promise.reject(new Error('Offline'));
  return db.ref('holidays').push(h);
}

function deleteHolidayFromDb(id) {
  if (!isOnline || !db) return Promise.reject(new Error('Offline'));
  return db.ref('holidays/'+id).remove();
}

function clearAllData() {
  if (!confirm('Clear ALL specimen data? This cannot be undone.')) return;
  if (!isOnline || !db) { toast('Cannot clear while offline','#E24B4A'); return; }
  db.ref('specimens').remove()
    .then(() => { localStorage.removeItem(LS_SPEC); toast('All data cleared.','#378ADD'); })
    .catch(err => toast('Error: '+err.message,'#E24B4A'));
}

/* ================================================================
   MONTH SELECT
   ================================================================ */
function buildMonthSelect() {
  const sel = document.getElementById('sel-month');
  if (!sel) return;
  const cur = sel.value;
  const months = new Set(specimens.map(d => (d.dateTesting||d.dateCasted||'').slice(0,7)).filter(Boolean));
  const now = new Date();
  const thisMonth = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  months.add(thisMonth);
  sel.innerHTML = '';
  [...months].sort().reverse().forEach(m => {
    const [y,mo] = m.split('-');
    const lbl = new Date(+y,+mo-1,1).toLocaleDateString('en-PH',{year:'numeric',month:'long'});
    const o = document.createElement('option');
    o.value=m; o.textContent=lbl;
    if (m===(cur||thisMonth)) o.selected=true;
    sel.appendChild(o);
  });
}

function selMonth() { const s=document.getElementById('sel-month'); return s?s.value:''; }
function monthSpecimens() {
  const m = selMonth();
  return specimens.filter(d => {
    // Show in the month of testing; if no test date yet, show in month of casted
    const key = (d.dateTesting||d.dateCasted||'').slice(0,7);
    return key === m;
  });
}

/* ================================================================
   TABS
   ================================================================ */
function setTab(name, btn) {
  document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
  btn.classList.add('active');
  const tab = document.getElementById('tab-'+name);
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
  const [y,mo] = (selMonth()||'').split('-');
  const lbl = y&&mo?new Date(+y,+mo-1,1).toLocaleDateString('en-PH',{year:'numeric',month:'long'}):'';
  const logLbl = document.getElementById('log-month-label');
  if (logLbl) logLbl.textContent = lbl;
  const trendLbl = document.getElementById('trend-month-label');
  if (trendLbl) trendLbl.textContent = lbl;

  renderOverall(md);
  renderGaugeAge(md);
  renderUpcoming();
  renderLog();
}

/* -- Overall -- */
function renderOverall(md) {
  const tot    = md.length;
  const ontime = md.filter(d=>d.status==='On Time').length;
  const late   = md.filter(d=>d.status==='Late').length;
  const pend   = md.filter(d=>d.status==='Pending').length;
  const pct    = tot?Math.round(ontime/tot*100):0;

  const color    = pct===100?'#3B6D11':pct>=80?'#854F0B':'#A32D2D';
  const barColor = pct===100?'#639922':pct>=80?'#EF9F27':'#E24B4A';

  const pctEl = document.querySelector('#overall-card .overall-big span:first-child');
  if (pctEl) { pctEl.textContent=pct+'%'; pctEl.style.color=color; }
  const bar = document.getElementById('overall-bar');
  if (bar) { bar.style.width=pct+'%'; bar.style.background=barColor; }
  const noteEl = document.getElementById('overall-note');
  if (noteEl) noteEl.textContent = pct===100
    ?'All '+tot+' specimens tested on time -- monthly target achieved!'
    :(100-pct)+'% gap to 100% target - '+late+' late test'+(late!==1?'s':'')+' this month'+(pend?' - '+pend+' pending':'');

  ['mini-total','mini-pass','mini-rej','mini-pend'].forEach(function(id,i){
    const el=document.querySelector('#'+id+' .ms-val');
    if (el) el.textContent=[tot,ontime,late,pend][i];
  });
}

/* -- Gauges per days -- */
function renderGaugeAge(md) {
  const grid = document.getElementById('gauge-age-grid');
  if (!grid) return;
  grid.innerHTML = '';

  DAYS_LIST.forEach(function(days, i) {
    const rows   = md.filter(d=>d.numDays===days);
    const tot    = rows.length;
    const ontime = rows.filter(d=>d.status==='On Time').length;
    const pct    = tot?Math.round(ontime/tot*100):null;
    const color     = pct===null?'#999':pct===100?'#3B6D11':pct>=80?'#854F0B':'#A32D2D';
    const fillColor = pct===null?'#ddd':pct===100?'#639922':pct>=80?'#EF9F27':'#E24B4A';
    const cls       = pct===null?'':pct===100?'hit':pct>=80?'warn':'critical';
    const pillCls   = pct===null?'p-pend':pct===100?'p-pass':pct>=80?'p-pend':'p-rej';
    const pillLbl   = pct===null?'no data':pct===100?'on target':pct>=80?'below target':'critical';

    const card = document.createElement('div');
    card.className='gauge-card '+cls;
    card.innerHTML=
      '<div class="gauge-mat">'+days+'</div>'+
      '<div class="gauge-wrap"><canvas id="gc-'+i+'" width="90" height="50"></canvas></div>'+
      '<div class="gauge-pct" style="color:'+color+'">'+(pct!==null?pct+'%':'--')+'</div>'+
      '<div class="gauge-det">'+ontime+'/'+tot+' on time</div>'+
      '<span class="gauge-pill badge '+pillCls+'">'+pillLbl+'</span>';
    grid.appendChild(card);

    setTimeout(function(){
      const ctx=document.getElementById('gc-'+i);
      if(!ctx) return;
      if(gaugeCharts[i]){try{gaugeCharts[i].destroy();}catch(e){}}
      gaugeCharts[i]=new Chart(ctx,{
        type:'doughnut',
        data:{datasets:[{data:[pct||0,100-(pct||0)],
          backgroundColor:[fillColor,'rgba(128,128,128,0.1)'],
          borderWidth:0,circumference:180,rotation:270}]},
        options:{responsive:false,maintainAspectRatio:false,cutout:'68%',
          plugins:{legend:{display:false},tooltip:{enabled:false}},animation:{duration:500}}
      });
    },100+i*30);
  });
}

/* -- Upcoming -- */
function renderUpcoming() {
  const el = document.getElementById('upcoming-list');
  if (!el) return;
  const todayStr = today();
  const in7 = new Date(); in7.setDate(in7.getDate()+7);
  const in7Str = in7.toISOString().split('T')[0];

  const pending = specimens.filter(d=>d.status==='Pending'&&d.dueDate)
    .sort((a,b)=>a.dueDate.localeCompare(b.dueDate));

  if (!pending.length) {
    el.innerHTML='<div style="color:var(--text-2);font-size:12px;padding:12px 0">No pending tests in the next 7 days.</div>';
    return;
  }

  const makeRow=(d,color,label)=>{
    const days=daysBetween(todayStr,d.dueDate);
    const dText=days<0?Math.abs(days)+' day'+(Math.abs(days)!==1?'s':'')+' overdue'
               :days===0?'Due today':'Due in '+days+' day'+(days!==1?'s':'');
    return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:0.5px solid var(--border);font-size:11px">'+
      '<span style="background:'+color+';color:#fff;padding:2px 8px;border-radius:6px;font-size:9px;font-weight:600;white-space:nowrap">'+label+'</span>'+
      '<span style="font-weight:500">'+(d.structure||d.project||'--')+'</span>'+
      '<span style="color:var(--text-2)">'+d.numDays+'</span>'+
      '<span style="color:var(--text-2)">Due: '+d.dueDate+'</span>'+
      '<span style="color:'+color+';font-weight:500">'+dText+'</span>'+
      (d.project?'<span style="color:var(--text-2)">'+d.project+'</span>':'')+
    '</div>';
  };

  el.innerHTML=
    pending.filter(d=>d.dueDate<todayStr).map(d=>makeRow(d,'#E24B4A','OVERDUE')).join('')+
    pending.filter(d=>d.dueDate===todayStr).map(d=>makeRow(d,'#EF9F27','TODAY')).join('')+
    pending.filter(d=>d.dueDate>todayStr&&d.dueDate<=in7Str).map(d=>makeRow(d,'#378ADD','UPCOMING')).join('');
}

/* -- Trend chart -- */
function renderCharts() {
  const md=monthSpecimens();
  const monthStr=selMonth();
  if(!monthStr) return;
  if(trendChart){try{trendChart.destroy();}catch(e){}trendChart=null;}
  const [y,mo]=monthStr.split('-');
  const days=Array.from({length:new Date(+y,+mo,0).getDate()},(_,i)=>
    monthStr+'-'+String(i+1).padStart(2,'0'));
  const rates=days.map(date=>{
    const rows=md.filter(d=>d.dueDate===date&&d.status!=='Pending');
    if(!rows.length) return null;
    return Math.round(rows.filter(d=>d.status==='On Time').length/rows.length*100);
  });
  const lateCounts=days.map(date=>md.filter(d=>d.dueDate===date&&d.status==='Late').length);
  const ctx=document.getElementById('chartTrend');
  if(!ctx) return;
  trendChart=new Chart(ctx,{
    type:'bar',
    data:{labels:days.map(d=>d.slice(8)),datasets:[
      {type:'line',data:rates,borderColor:'#3B6D11',backgroundColor:'rgba(59,109,17,0.07)',
       tension:0.35,fill:true,pointRadius:3,pointBackgroundColor:'#639922',borderWidth:2,spanGaps:true,yAxisID:'y'},
      {type:'line',data:days.map(()=>100),borderColor:'#378ADD',borderDash:[5,4],
       pointRadius:0,fill:false,borderWidth:1.5,yAxisID:'y'},
      {type:'bar',data:lateCounts,backgroundColor:'rgba(226,75,74,0.28)',borderRadius:2,yAxisID:'y2'}
    ]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
      scales:{
        x:{grid:{display:false},ticks:{font:{size:9},autoSkip:true,maxTicksLimit:15}},
        y:{min:0,max:105,position:'left',ticks:{font:{size:9},callback:v=>v+'%'},
          grid:{color:'rgba(128,128,128,0.07)'}},
        y2:{min:0,max:6,position:'right',ticks:{font:{size:9},stepSize:1},grid:{display:false}}
      }}
  });
}

/* -- Log -- */
function renderLog() {
  const md     = monthSpecimens();
  const search = (document.getElementById('search-box')||{value:''}).value.toLowerCase();
  const fDays  = (document.getElementById('filter-days')||{value:''}).value;
  const fStat  = (document.getElementById('filter-status')||{value:''}).value;

  let rows=[...md].sort((a,b)=>(b.dateCasted||'').localeCompare(a.dateCasted||''));
  if(search) rows=rows.filter(r=>
    [r.labNo,r.client,r.project,r.location,r.structure,r.design,r.testing,r.remarks]
    .join(' ').toLowerCase().includes(search));
  if(fDays)  rows=rows.filter(r=>r.numDays===fDays);
  if(fStat)  rows=rows.filter(r=>r.status===fStat);

  const tbody=document.getElementById('log-body');
  if(!tbody) return;
  const todayStr=today();

  if(!rows.length){
    tbody.innerHTML='<tr class="empty-row"><td colspan="17">No specimens logged yet. Click "+ Log Specimen" to start.</td></tr>';
  } else {
    tbody.innerHTML=rows.map(function(d){
      const idx=specimens.findIndex(x=>x._id===d._id);
      const pc=d.status==='On Time'?'p-pass':d.status==='Late'?'p-rej':'p-pend';
      const isOver=d.status==='Pending'&&d.dueDate&&d.dueDate<todayStr;
      const op=d._pending?' style="opacity:0.7"':'';
      return '<tr'+op+'>'+
        '<td>'+(d.dateCasted||'--')+'</td>'+
        '<td>'+(d.dateTesting||'--')+'</td>'+
        '<td style="text-align:center">'+(d.age!==''&&d.age!==undefined?d.age:'--')+'</td>'+
        '<td title="'+(d.labNo||'')+'">'+(d.labNo||'--')+'</td>'+
        '<td title="'+(d.testCenter||'')+'">'+(d.testCenter||'--')+'</td>'+
        '<td>'+(d.branch||'--')+'</td>'+
        '<td title="'+(d.client||'')+'">'+(d.client||'--')+'</td>'+
        '<td title="'+(d.project||'')+'">'+(d.project||'--')+'</td>'+
        '<td title="'+(d.location||'')+'">'+(d.location||'--')+'</td>'+
        '<td title="'+(d.structure||'')+'">'+(d.structure||'--')+'</td>'+
        '<td>'+(d.design||'--')+'</td>'+
        '<td>'+(d.aggSize||'--')+'</td>'+
        '<td style="text-align:center">'+(d.numDays||'--')+'</td>'+
        '<td><span class="pill '+pc+'" style="'+(d.status==='On Time'?'background:#EAF3DE;color:#3B6D11':d.status==='Late'?'background:#FCEBEB;color:#A32D2D':'background:#FAEEDA;color:#854F0B')+'">'+d.status+'</span>'+
          (isOver?'<span style="font-size:9px;color:#A32D2D;margin-left:3px">OVERDUE</span>':'')+
          (d._pending?'<span style="font-size:9px;color:#854F0B;margin-left:3px">pending</span>':'')+
        '</td>'+
        '<td>'+(d.coordinator||'--')+'</td>'+
        '<td title="'+(d.remarks||'')+'">'+(d.remarks||'--')+'</td>'+
        '<td style="white-space:nowrap">'+(d._pending?'':
          '<button class="act-btn" onclick="openEditForm('+idx+')" title="Edit">'+
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'+
          '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>'+
          '<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>'+
          '</svg></button>'+
          '<button class="act-btn" onclick="duplicateEntry('+idx+')" title="Duplicate" style="margin-left:2px">'+
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'+
          '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'+
          '</svg></button>')+
        '</td>'+
      '</tr>';
    }).join('');
  }
  const footer=document.getElementById('log-footer');
  if(footer) footer.textContent='Showing '+rows.length+' of '+md.length+' specimens for this month';
}

/* ================================================================
   FORM HELPERS
   ================================================================ */
function getVal(id){const el=document.getElementById(id);return el?el.value:'';}
function setVal(id,v){const el=document.getElementById(id);if(el) el.value=v||'';}

function computeDueDate(){
  const casted = getVal('m-casted');
  const num    = getNumDays();
  setVal('m-due', computeDueDateFor(casted, num));
  computeAgeAndStatus();
}

function computeAgeAndStatus(){
  const casted=getVal('m-casted');
  const tested=getVal('m-tested');
  const due=getVal('m-due');
  const age=computeAgeFor(casted,tested);
  setVal('m-age', age!==''?age:'');
  const status=computeStatusFor(due,tested);
  setVal('m-status',status);
  const el=document.getElementById('m-status');
  if(el) el.style.color=statusColor(status);
}

function updateCoordinatorOther() {
  const sel = getVal('m-coordinator');
  const wrap = document.getElementById('coord-other-wrap');
  if (wrap) wrap.style.display = sel === '__other__' ? '' : 'none';
}

function updateBranches(selected) {
  const center = getVal('m-testcenter');
  const tcWrap = document.getElementById('tc-other-wrap');
  if (tcWrap) tcWrap.style.display = center === '__other__' ? '' : 'none';

  const sel = document.getElementById('m-branch');
  if (!sel) return;
  const branches = center === '__other__' ? [] : (BRANCHES[center] || []);
  if (!branches.length) {
    sel.innerHTML = '<option value="">-- Enter branch manually --</option>';
    sel.disabled = center === '__other__';
    if (center === '__other__') {
      // Replace with text input for branch too
      sel.innerHTML = '<option value="">n/a</option>';
    }
    return;
  }
  sel.disabled = false;
  sel.innerHTML = '<option value="">-- Select --</option>';
  branches.forEach(b => {
    const o = document.createElement('option');
    o.value = b; o.textContent = b;
    if (b === selected) o.selected = true;
    sel.appendChild(o);
  });
  // Add Other option to branch too
  const other = document.createElement('option');
  other.value = '__branch_other__'; other.textContent = 'Other (specify)';
  sel.appendChild(other);
}

/* ================================================================
   MODAL
   ================================================================ */
function openAddForm(){
  try{
    editIdx=null;
    const title=document.getElementById('modal-title');
    if(title) title.textContent='Log New Specimen';
    const delBtn=document.getElementById('modal-delete-btn');
    if(delBtn) delBtn.style.display='none';
    const saveBtn=document.getElementById('modal-save-btn');
    if(saveBtn) saveBtn.textContent='Save Specimen';

    setVal('m-casted',today());
    ['m-labno','m-client','m-project','m-location','m-structure','m-design',
     'm-due','m-tested','m-age','m-remarks'].forEach(id=>setVal(id,''));
    setVal('m-testing','');setVal('m-sample','');setVal('m-aggsize','');setVal('m-days','');
    setVal('m-testcenter','');setVal('m-branch','');setVal('m-testcenter-other','');
    setVal('m-aggsize-other','');setVal('m-days-other','');
    setVal('m-coordinator','');setVal('m-coordinator-other','');
    ['coord-other-wrap','tc-other-wrap','agg-other-wrap','days-other-wrap'].forEach(id=>{
      const el=document.getElementById(id); if(el) el.style.display='none';
    });
    setVal('m-status','Pending');
    const statusEl=document.getElementById('m-status');
    if(statusEl) statusEl.style.color='#854F0B';

    const modal=document.getElementById('delivery-modal');
    if(modal) modal.classList.add('open');
  }catch(e){console.error('openAddForm:',e);toast('Error: '+e.message,'#E24B4A');}
}

function openEditForm(idx){
  try{
    editIdx=idx;
    const d=specimens[idx];
    if(!d) return;
    const title=document.getElementById('modal-title');
    if(title) title.textContent='Edit Specimen';
    const delBtn=document.getElementById('modal-delete-btn');
    if(delBtn) delBtn.style.display='inline-flex';
    const saveBtn=document.getElementById('modal-save-btn');
    if(saveBtn) saveBtn.textContent='Save Changes';

    setVal('m-labno',    d.labNo);
    setVal('m-client',   d.client);
    setVal('m-project',  d.project);
    setVal('m-location', d.location);
    setVal('m-testing',  d.testing);
    setVal('m-sample',   d.sample);
    setVal('m-structure',d.structure);
    setVal('m-design',   d.design);
    setVal('m-aggsize',  d.aggSize);
    setVal('m-days',     d.numDays);
    setVal('m-casted',   d.dateCasted);
    setVal('m-due',      d.dueDate);
    setVal('m-tested',   d.dateTesting);
    setVal('m-age',      d.age!==undefined?d.age:'');
    setVal('m-status',   d.status);
    setVal('m-remarks',  d.remarks);
    // Restore Testing Center (handle Other)
    const knownCenters = ['Megatesting Center, Inc.','Terms Concrete','EP Materials Testing Center','Philippine Geoanalytics','DPWH'];
    const tcVal = d.testCenter||'';
    const tcIsOther = tcVal && !knownCenters.includes(tcVal);
    setVal('m-testcenter', tcIsOther?'__other__':tcVal);
    setVal('m-testcenter-other', tcIsOther?tcVal:'');
    const tcWrap=document.getElementById('tc-other-wrap'); if(tcWrap) tcWrap.style.display=tcIsOther?'':'none';
    updateBranches(d.branch||'');
    // Restore Agg Size (handle Other)
    const knownAgg = ['Agg - G1"','Agg - 3/4"','Agg - 3/8"'];
    const aggVal = d.aggSize||'';
    const aggIsOther = aggVal && !knownAgg.includes(aggVal);
    setVal('m-aggsize', aggIsOther?'__other__':aggVal);
    setVal('m-aggsize-other', aggIsOther?aggVal:'');
    const aggWrap=document.getElementById('agg-other-wrap'); if(aggWrap) aggWrap.style.display=aggIsOther?'':'none';
    // Restore No. of Days (handle Other)
    const knownDays = ['01 Days','03 Days','07 Days','14 Days','21 Days','28 Days'];
    const daysVal = d.numDays||'';
    const daysIsOther = daysVal && !knownDays.includes(daysVal);
    setVal('m-days', daysIsOther?'__other__':daysVal);
    setVal('m-days-other', daysIsOther?daysVal.replace(' Days',''):'');
    const daysWrap=document.getElementById('days-other-wrap'); if(daysWrap) daysWrap.style.display=daysIsOther?'':'none';
    const coord = d.coordinator||'';
    const isOther = coord && !['Dio Balili','Joshua Facun','Roni Aguilar','JM Buitizon','Teodoro Taysa'].includes(coord);
    setVal('m-coordinator', isOther?'__other__':coord);
    setVal('m-coordinator-other', isOther?coord:'');
    const cw=document.getElementById('coord-other-wrap'); if(cw) cw.style.display=isOther?'':'none';

    const statusEl=document.getElementById('m-status');
    if(statusEl) statusEl.style.color=statusColor(d.status||'Pending');

    const modal=document.getElementById('delivery-modal');
    if(modal) modal.classList.add('open');
  }catch(e){console.error('openEditForm:',e);toast('Error: '+e.message,'#E24B4A');}
}

function duplicateEntry(idx) {
  try {
    const d = specimens[idx];
    if (!d) return;
    editIdx = null;
    const title = document.getElementById('modal-title');
    if (title) title.textContent = 'Duplicate Entry';
    const delBtn = document.getElementById('modal-delete-btn');
    if (delBtn) delBtn.style.display = 'none';
    const saveBtn = document.getElementById('modal-save-btn');
    if (saveBtn) saveBtn.textContent = 'Save Specimen';

    // Pre-fill all fields except No. of Days, Date Testing, Age, Status
    setVal('m-labno',    d.labNo);
    setVal('m-client',   d.client);
    setVal('m-project',  d.project);
    setVal('m-location', d.location);
    setVal('m-testing',  d.testing);
    setVal('m-sample',   d.sample);
    setVal('m-structure',d.structure);
    setVal('m-design',   d.design);
    setVal('m-aggsize',  d.aggSize);
    setVal('m-casted',   d.dateCasted);
    // Restore Testing Center (handle Other)
    const knownCenters = ['Megatesting Center, Inc.','Terms Concrete','EP Materials Testing Center','Philippine Geoanalytics','DPWH'];
    const tcVal = d.testCenter||'';
    const tcIsOther = tcVal && !knownCenters.includes(tcVal);
    setVal('m-testcenter', tcIsOther?'__other__':tcVal);
    setVal('m-testcenter-other', tcIsOther?tcVal:'');
    const tcWrap=document.getElementById('tc-other-wrap'); if(tcWrap) tcWrap.style.display=tcIsOther?'':'none';
    updateBranches(d.branch||'');
    // Restore Agg Size (handle Other)
    const knownAgg = ['Agg - G1"','Agg - 3/4"','Agg - 3/8"'];
    const aggVal = d.aggSize||'';
    const aggIsOther = aggVal && !knownAgg.includes(aggVal);
    setVal('m-aggsize', aggIsOther?'__other__':aggVal);
    setVal('m-aggsize-other', aggIsOther?aggVal:'');
    const aggWrap=document.getElementById('agg-other-wrap'); if(aggWrap) aggWrap.style.display=aggIsOther?'':'none';
    // Restore No. of Days (handle Other)
    const knownDays = ['01 Days','03 Days','07 Days','14 Days','21 Days','28 Days'];
    const daysVal = d.numDays||'';
    const daysIsOther = daysVal && !knownDays.includes(daysVal);
    setVal('m-days', daysIsOther?'__other__':daysVal);
    setVal('m-days-other', daysIsOther?daysVal.replace(' Days',''):'');
    const daysWrap=document.getElementById('days-other-wrap'); if(daysWrap) daysWrap.style.display=daysIsOther?'':'none';
    const coord = d.coordinator||'';
    const isOther = coord && !['Dio Balili','Joshua Facun','Roni Aguilar','JM Buitizon','Teodoro Taysa'].includes(coord);
    setVal('m-coordinator', isOther?'__other__':coord);
    setVal('m-coordinator-other', isOther?coord:'');
    const cw = document.getElementById('coord-other-wrap');
    if (cw) cw.style.display = isOther?'':'none';

    // Clear testing-specific fields
    setVal('m-days',   '');
    setVal('m-due',    '');
    setVal('m-tested', '');
    setVal('m-age',    '');
    setVal('m-status', 'Pending');
    setVal('m-remarks','');
    const statusEl = document.getElementById('m-status');
    if (statusEl) statusEl.style.color = '#854F0B';

    const modal = document.getElementById('delivery-modal');
    if (modal) { modal.classList.add('open'); modalIsOpen = true; }
    toast('Pre-filled! Change No. of Days and Date Testing.', '#378ADD');
  } catch(e) {
    console.error('duplicateEntry:', e);
    toast('Error: '+e.message, '#E24B4A');
  }
}

function closeDeliveryModal(){
  const modal=document.getElementById('delivery-modal');
  if(modal) modal.classList.remove('open');
  editIdx=null;
  modalIsOpen = false;
}

function saveDelivery(){
  const labNo  =getVal('m-labno').trim();
  const client =getVal('m-client').trim();
  const project=getVal('m-project').trim();
  const numDays=getVal('m-days');
  const casted =getVal('m-casted');

  if(!labNo||!client||!project||!numDays||!casted){
    toast('Please fill in Lab No., Client, Project, No. of Days and Date Casted.','#E24B4A');
    return;
  }

  const dueDate   =getVal('m-due')||computeDueDateFor(casted, getNumDays());
  const dateTesting=getVal('m-tested');
  const age       =computeAgeFor(casted,dateTesting);
  const status    =computeStatusFor(dueDate,dateTesting);

  const entry={
    labNo, client, project,
    location:  getVal('m-location').trim(),
    testing:   getVal('m-testing'),
    sample:    getVal('m-sample'),
    structure: getVal('m-structure').trim(),
    design:    getVal('m-design').trim(),
    aggSize:   getVal('m-aggsize'),
    numDays:     getDaysLabel(),
    dateCasted:  casted,
    dateTesting, age, status,
    testCenter:  getTestCenter(),
    branch:      getVal('m-branch')==='__branch_other__' ? getVal('m-branch-other-val')||getVal('m-branch') : getVal('m-branch'),
    coordinator: getVal('m-coordinator')==='__other__' ? getVal('m-coordinator-other').trim() : getVal('m-coordinator'),
    aggSize:     getAggSize(),
    remarks:     getVal('m-remarks').trim(),
  };

  const btn=document.getElementById('modal-save-btn');
  if(btn){btn.textContent='Saving...';btn.disabled=true;}

  saveSpecimenToDb(entry)
    .then(()=>{
      const testDate = entry.dateTesting;
      const targetMonth = (testDate||casted).slice(0,7);
      closeDeliveryModal();
      buildMonthSelect();
      const selEl = document.getElementById('sel-month');
      if (selEl) selEl.value = targetMonth;
      render();
      if(activeTab==='kpi') setTimeout(renderCharts,80);
      toast(editIdx!==null?'Specimen updated!':'Logged: '+project+' ('+numDays+')',
        status==='On Time'?'#639922':status==='Late'?'#E24B4A':'#854F0B');
    })
    .catch(err=>toast('Save failed: '+err.message,'#E24B4A'))
    .finally(()=>{
      if(btn){btn.textContent=editIdx!==null?'Save Changes':'Save Specimen';btn.disabled=false;}
    });
}

function deleteEntry(){
  if(editIdx===null) return;
  if(!confirm('Delete this specimen? This cannot be undone.')) return;
  deleteSpecimenFromDb()
    .then(()=>{closeDeliveryModal();toast('Specimen deleted.','#E24B4A');})
    .catch(err=>toast('Delete failed: '+err.message,'#E24B4A'));
}

/* ================================================================
   HOLIDAY MANAGER
   ================================================================ */
function openHolidayForm(){
  setVal('hf-date',today());setVal('hf-name','');
  const fp=document.getElementById('holiday-form-panel');
  if(fp) fp.classList.add('open');
}
function closeHolidayForm(){
  const fp=document.getElementById('holiday-form-panel');
  if(fp) fp.classList.remove('open');
}
function saveHoliday(){
  const date=getVal('hf-date');const name=getVal('hf-name').trim();
  if(!date||!name){toast('Please fill in date and name.','#E24B4A');return;}
  saveHolidayToDb({date,name,type:getVal('hf-type')})
    .then(()=>{closeHolidayForm();toast('Holiday saved: '+name,'#639922');})
    .catch(err=>toast('Error: '+err.message,'#E24B4A'));
}
function deleteHoliday(id){
  if(!confirm('Delete this holiday?')) return;
  deleteHolidayFromDb(id)
    .then(()=>toast('Holiday deleted.','#E24B4A'))
    .catch(err=>toast('Error: '+err.message,'#E24B4A'));
}
function renderHolidays(){
  const list=document.getElementById('holiday-list');
  if(!list) return;
  if(!holidays.length){
    list.innerHTML='<div style="color:var(--text-2);font-size:12px;padding:16px 0">No holidays added yet.</div>';
    return;
  }
  list.innerHTML='<div class="table-wrap"><table class="log-tbl"><thead><tr><th>Date</th><th>Holiday Name</th><th>Type</th><th></th></tr></thead><tbody>'+
    holidays.map(h=>
      '<tr><td>'+h.date+'</td><td>'+h.name+'</td><td>'+h.type+'</td>'+
      '<td><button class="act-btn" onclick="deleteHoliday(\''+h._id+'\')" style="color:#A32D2D">'+
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'+
      '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>'+
      '</svg></button></td></tr>'
    ).join('')+
  '</tbody></table></div>';
}

/* ================================================================
   EXPORT CSV
   ================================================================ */
function exportCSV(){
  const md=monthSpecimens();
  if(!md.length){toast('No data to export.','#E24B4A');return;}
  const hdrs=['Lab No.','Client Name','Project Name','Project Location',
    'Kind of Testing','Kind of Sample','Structure','Design (PSI)','Agg. Size',
    'Date Casted','Date Testing','Age (days)','Lab No.','Testing Center','Branch','Client','Project Title/Name','Location','Structure','Design (PSI)','Agg. Size','No. of Days','Due Date','Status','Coordinator','Remarks'];
  const rows=md.map(d=>[d.labNo,d.client,d.project,d.location,
    d.testing,d.sample,d.structure,d.design,d.aggSize,
    d.dateCasted,d.dateTesting,d.age,d.labNo,d.testCenter,d.branch,d.client,d.project,d.location,d.structure,d.design,d.aggSize,d.numDays,d.dueDate,d.status,d.coordinator,d.remarks]
    .map(v=>'"'+(v||'').toString().replace(/"/g,'""')+'"').join(','));
  const csv=[hdrs.join(','),...rows].join('\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  const [y,m]=(selMonth()||'').split('-');
  a.download='BigBen_Testing_Timeliness_'+(y&&m?y+'_'+m:'export')+'.csv';
  a.click();
  toast('CSV exported.','#378ADD');
}

/* ================================================================
   TOAST
   ================================================================ */
function toast(msg,color){
  color=color||'#639922';
  const el=document.getElementById('toast');
  const dot=document.getElementById('toast-dot');
  const msgEl=document.getElementById('toast-msg');
  if(!el) return;
  if(dot) dot.style.background=color;
  if(msgEl) msgEl.textContent=msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t=setTimeout(()=>el.classList.remove('show'),3500);
}

/* ================================================================
   KEYBOARD
   ================================================================ */
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'){closeDeliveryModal();closeHolidayForm();}
});

/* ================================================================
   INIT
   ================================================================ */
/* ================================================================
   AUTOCOMPLETE
   ================================================================ */
function updateAutocomplete() {
  const fields = {
    'ac-client':    [...new Set(specimens.map(d=>d.client).filter(Boolean))],
    'ac-project':   [...new Set(specimens.map(d=>d.project).filter(Boolean))],
    'ac-location':  [...new Set(specimens.map(d=>d.location).filter(Boolean))],
    'ac-structure': [...new Set(specimens.map(d=>d.structure).filter(Boolean))],
    'ac-design':    [...new Set(specimens.map(d=>d.design).filter(Boolean))],
    'ac-labno':     [...new Set(specimens.map(d=>d.labNo).filter(Boolean))],
  };
  Object.entries(fields).forEach(([id, values]) => {
    let dl = document.getElementById(id);
    if (!dl) { dl = document.createElement('datalist'); dl.id = id; document.body.appendChild(dl); }
    dl.innerHTML = values.map(v => '<option value="'+v.replace(/"/g,'&quot;')+'">').join('');
  });
}

document.addEventListener('DOMContentLoaded',function(){
  const sel=document.getElementById('sel-month');
  if(sel) sel.addEventListener('change',function(){
    render();
    if(activeTab==='kpi') setTimeout(renderCharts,80);
  });
  loadLocal();
  buildMonthSelect();
  render();
  initFirebase();
  updateOnlineStatus();
  setTimeout(renderCharts,200);
});
