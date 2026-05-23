/* ================================================================
   Big Ben RMC -- Compressive Strength Results Dashboard
   app.js | Firebase | Offline-first | ASTM C-39
   ================================================================ */

const firebaseConfig = {
  apiKey:            "AIzaSyCLcet4nnKKYH7SanIKD6z2l9AL_n6rwaY",
  authDomain:        "bigben-strength.firebaseapp.com",
  databaseURL:       "https://bigben-strength-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "bigben-strength",
  storageBucket:     "bigben-strength.firebasestorage.app",
  messagingSenderId: "548228560584",
  appId:             "1:548228560584:web:aae3a34c94a23b9026d7fd"
};

/* ================================================================
   THEORETICAL STRENGTH TABLE
   % of design strength per day for each curing age (7, 14, 28 days design)
   ================================================================ */
const THEO = {
  7:  {1:25.37, 2:53.53, 3:69.00, 4:80.27, 5:89.00, 6:96.00, 7:100},
  14: {1:20.69, 2:43.68, 3:56.32, 4:65.52, 5:72.41, 6:78.16, 7:81.61,
       8:85.06, 9:88.50, 10:90.80, 11:93.10, 12:95.40, 13:97.70, 14:100},
  28: {1:18.00, 2:38.00, 3:49.00, 4:57.00, 5:63.00, 6:68.00, 7:71.00,
       8:74.00, 9:77.00, 10:79.00, 11:81.00, 12:83.00, 13:85.00, 14:87.00,
       15:88.00, 16:88.50, 17:90.00, 18:91.50, 19:93.00, 20:94.00,
       21:95.00, 22:96.00, 23:97.00, 24:97.50, 25:98.00, 26:99.00,
       27:99.50, 28:100}
};

const CURING_AGES = ['1 Day','3 Days','7 Days','14 Days','21 Days','28 Days'];
const AGE_DAYS    = {'1 Day':1,'3 Days':3,'7 Days':7,'14 Days':14,'21 Days':21,'28 Days':28};
const DESIGN_PSI  = {
  '1000 PSI':1000,'1500 PSI':1500,'2000 PSI':2000,'2500 PSI':2500,
  '3000 PSI':3000,'3500 PSI':3500,'4000 PSI':4000,'4500 PSI':4500,
  '5000 PSI':5000,'6000 PSI':6000,'7000 PSI':7000,'8000 PSI':8000,'10000 PSI':10000
};

/* Get theoretical required PSI */
function getRequiredPSI(designLabel, curingDaysLabel, testDayNum) {
  const designPsi = DESIGN_PSI[designLabel] || 0;
  const curingDays = AGE_DAYS[curingDaysLabel] || 28;
  if (!designPsi || !testDayNum) return 0;

  // Find the appropriate table to use
  let tableKey = 28;
  if (curingDays <= 7)  tableKey = 7;
  else if (curingDays <= 14) tableKey = 14;
  else tableKey = 28;

  const table = THEO[tableKey] || THEO[28];
  const pct = table[testDayNum] || 100;
  return Math.round(designPsi * pct / 100);
}

/* ================================================================
   STATE
   ================================================================ */
let pours       = [];
let editPourIdx = null;
let testPourIdx = null;
let gaugeCharts = {};
let trendChart  = null;
let activeTab   = 'kpi';
let db          = null;
let isOnline    = navigator.onLine;
let pendingSync = [];
let modalIsOpen = false;

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
const LS_POURS   = 'strength_pours_v1';
const LS_PENDING = 'strength_pending_v1';

function saveLocal() {
  try { localStorage.setItem(LS_POURS, JSON.stringify(pours)); } catch(e) {}
}
function loadLocal() {
  try {
    const p = localStorage.getItem(LS_POURS); if (p) pours = JSON.parse(p);
    const q = localStorage.getItem(LS_PENDING); if (q) pendingSync = JSON.parse(q);
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

    db.ref('pours').on('value', snap => {
      const val = snap.val();
      pours = val
        ? Object.entries(val).map(([id, d]) => ({ ...d, _id: id }))
        : [];
      pours.sort((a,b) => (b.datePoured||'').localeCompare(a.datePoured||''));
      saveLocal();
      updateAutocomplete();
      if (modalIsOpen) return;
      buildMonthSelect();
      render();
      if (activeTab === 'kpi') setTimeout(renderCharts, 80);
    }, err => {
      console.warn('Firebase error:', err);
      toast('Using offline data', '#854F0B');
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
    db.ref('pours').push(entry)
      .then(() => toast('Synced: '+(entry.client||entry.project), '#639922'))
      .catch(() => { pendingSync.push(entry); savePending(); });
  });
}

/* ================================================================
   SAVE / DELETE POUR
   ================================================================ */
function savePourToDb(entry) {
  if (!isOnline || !db) {
    const offline = { ...entry, _id: 'offline_'+Date.now(), _pending: true };
    pours.unshift(offline);
    saveLocal();
    pendingSync.push(entry);
    savePending();
    return Promise.resolve();
  }
  if (editPourIdx !== null && pours[editPourIdx] && pours[editPourIdx]._id) {
    return db.ref('pours/'+pours[editPourIdx]._id).set(entry);
  }
  return db.ref('pours').push(entry);
}

function updatePourInDb(pourId, testKey, testEntry) {
  if (!isOnline || !db) return Promise.reject(new Error('Offline'));
  return db.ref('pours/'+pourId+'/tests/'+testKey).set(testEntry);
}

function deletePourFromDb(pourId) {
  if (!isOnline || !db) return Promise.reject(new Error('Offline'));
  return db.ref('pours/'+pourId).remove();
}

/* ================================================================
   MONTH SELECT
   ================================================================ */
function buildMonthSelect() {
  const sel = document.getElementById('sel-month');
  if (!sel) return;
  const cur = sel.value;
  const months = new Set(pours.map(d => (d.datePoured||'').slice(0,7)).filter(Boolean));
  const now = new Date();
  const thisMonth = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  months.add(thisMonth);
  sel.innerHTML = '';
  const allOpt = document.createElement('option');
  allOpt.value = 'all'; allOpt.textContent = 'All Months';
  if (cur === 'all') allOpt.selected = true;
  sel.appendChild(allOpt);
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
function monthPours() {
  const m = selMonth();
  if (m==='all') return [...pours];
  return pours.filter(d=>(d.datePoured||'').startsWith(m));
}

/* ================================================================
   COMPUTE OVERALL STATUS
   ================================================================ */
function computePourStatus(pour) {
  const tests = pour.tests || {};
  const testList = Object.values(tests);
  if (!testList.length) return 'Pending';
  if (testList.some(t => t.result === 'Failed')) return 'Failed';
  if (testList.every(t => t.result === 'Passed')) return 'Passed';
  return 'Pending';
}

function computeRemaining(pour) {
  const total = parseInt(pour.totalSamples) || 0;
  const tests = pour.tests || {};
  const used  = Object.values(tests).reduce((sum, t) => sum + (parseInt(t.count)||0), 0);
  return Math.max(0, total - used);
}

/* ================================================================
   TABS
   ================================================================ */
function setTab(name, btn) {
  document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
  btn.classList.add('active');
  const tab=document.getElementById('tab-'+name);
  if (tab) tab.classList.add('active');
  activeTab=name;
  if (name==='kpi') setTimeout(renderCharts,80);
}

/* ================================================================
   RENDER
   ================================================================ */
function render() {
  const now = new Date();
  const dateEl = document.getElementById('cur-date');
  if (dateEl) dateEl.textContent = now.toLocaleDateString('en-PH',
    {weekday:'short',year:'numeric',month:'short',day:'numeric'});

  const md = monthPours();
  const m = selMonth();
  let lbl = m==='all' ? 'All Months' : '';
  if (!lbl) {
    const [y,mo] = (m||'').split('-');
    lbl = y&&mo ? new Date(+y,+mo-1,1).toLocaleDateString('en-PH',{year:'numeric',month:'long'}) : '';
  }
  const logLbl = document.getElementById('log-month-label');
  if (logLbl) logLbl.textContent = lbl;
  const trendLbl = document.getElementById('trend-month-label');
  if (trendLbl) trendLbl.textContent = lbl;

  renderOverall(md);
  renderGaugeAge(md);
  renderLog();
}

/* -- Overall KPI -- */
function renderOverall(md) {
  // Gather all test results from all pours
  let tot=0, pass=0, fail=0, pend=0;
  md.forEach(pour => {
    const tests = Object.values(pour.tests||{});
    if (!tests.length) { pend++; return; }
    tests.forEach(t => {
      tot++;
      if (t.result==='Passed') pass++;
      else if (t.result==='Failed') fail++;
      else pend++;
    });
  });

  const pct = tot ? Math.round(pass/tot*100) : 0;
  const color    = pct===100?'#3B6D11':pct>=80?'#854F0B':'#A32D2D';
  const barColor = pct===100?'#639922':pct>=80?'#EF9F27':'#E24B4A';

  const pctEl = document.querySelector('#overall-card .overall-big span:first-child');
  if (pctEl) { pctEl.textContent=pct+'%'; pctEl.style.color=color; }
  const bar = document.getElementById('overall-bar');
  if (bar) { bar.style.width=pct+'%'; bar.style.background=barColor; }
  const noteEl = document.getElementById('overall-note');
  if (noteEl) noteEl.textContent = pct===100
    ? 'All '+tot+' tests passed -- monthly target achieved!'
    : (100-pct)+'% gap to 100% target - '+fail+' failed test'+(fail!==1?'s':'')+' this month'+(pend?' - '+pend+' pending':'');

  const setMini = (id, val, color) => {
    const el = document.querySelector('#'+id+' .ms-val');
    if (el) { el.textContent=val; if(color) el.style.color=color; }
  };
  setMini('mini-total', tot);
  setMini('mini-pass',  pass, '#3B6D11');
  setMini('mini-rej',   fail, '#A32D2D');
  setMini('mini-pend',  pend, '#854F0B');
}

/* -- Gauges per curing age -- */
function renderGaugeAge(md) {
  const grid = document.getElementById('gauge-age-grid');
  if (!grid) return;
  grid.innerHTML = '';

  CURING_AGES.forEach(function(age, i) {
    const ageDays = AGE_DAYS[age];
    let tot=0, pass=0;
    md.forEach(pour => {
      const tests = Object.values(pour.tests||{});
      tests.forEach(t => {
        if (AGE_DAYS[t.age] === ageDays) {
          tot++;
          if (t.result==='Passed') pass++;
        }
      });
    });

    const pct    = tot ? Math.round(pass/tot*100) : null;
    const color     = pct===null?'#999':pct===100?'#3B6D11':pct>=80?'#854F0B':'#A32D2D';
    const fillColor = pct===null?'#ddd':pct===100?'#639922':pct>=80?'#EF9F27':'#E24B4A';
    const cls       = pct===null?'':pct===100?'hit':pct>=80?'warn':'critical';
    const pillCls   = pct===null?'p-pend':pct===100?'p-pass':pct>=80?'p-pend':'p-rej';
    const pillLbl   = pct===null?'no data':pct===100?'on target':pct>=80?'below target':'critical';

    const card = document.createElement('div');
    card.className='gauge-card '+cls;
    card.innerHTML=
      '<div class="gauge-mat">'+age+'</div>'+
      '<div class="gauge-wrap"><canvas id="gc-'+i+'" width="90" height="50"></canvas></div>'+
      '<div class="gauge-pct" style="color:'+color+'">'+(pct!==null?pct+'%':'--')+'</div>'+
      '<div class="gauge-det">'+pass+'/'+tot+' passed</div>'+
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

/* -- Trend chart -- */
function renderCharts() {
  const md = monthPours();
  const monthStr = selMonth();
  if (!monthStr || monthStr === 'all') return;
  if (trendChart) { try { trendChart.destroy(); } catch(e){} trendChart=null; }
  const [y,mo] = monthStr.split('-');
  const days = Array.from({length:new Date(+y,+mo,0).getDate()},(_,i)=>
    monthStr+'-'+String(i+1).padStart(2,'0'));

  const rates = days.map(date => {
    let tot=0, pass=0;
    md.forEach(pour => {
      if ((pour.datePoured||'').startsWith(date)) {
        Object.values(pour.tests||{}).forEach(t => {
          tot++; if(t.result==='Passed') pass++;
        });
      }
    });
    return tot ? Math.round(pass/tot*100) : null;
  });

  const ctx = document.getElementById('chartTrend');
  if (!ctx) return;
  trendChart = new Chart(ctx,{
    type:'line',
    data:{labels:days.map(d=>d.slice(8)),datasets:[
      {data:rates,borderColor:'#3B6D11',backgroundColor:'rgba(59,109,17,0.07)',
       tension:0.35,fill:true,pointRadius:3,pointBackgroundColor:'#639922',
       borderWidth:2,spanGaps:true},
      {data:days.map(()=>100),borderColor:'#378ADD',borderDash:[5,4],
       pointRadius:0,fill:false,borderWidth:1.5}
    ]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{
        x:{grid:{display:false},ticks:{font:{size:9},autoSkip:true,maxTicksLimit:15}},
        y:{min:0,max:105,ticks:{font:{size:9},callback:v=>v+'%'},
          grid:{color:'rgba(128,128,128,0.07)'}}
      }}
  });
}

/* -- Pour Log -- */
function renderLog() {
  const md = monthPours();
  const search = (document.getElementById('search-box')||{value:''}).value.toLowerCase();
  const fStat  = (document.getElementById('filter-status')||{value:''}).value;

  let rows = [...md].sort((a,b)=>(b.datePoured||'').localeCompare(a.datePoured||''));
  if (search) rows = rows.filter(r=>
    [r.client,r.project,r.location,r.structure,r.design,r.siteCoord].join(' ').toLowerCase().includes(search));
  if (fStat) rows = rows.filter(r=>computePourStatus(r)===fStat);

  const tbody = document.getElementById('log-body');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML='<tr class="empty-row"><td colspan="19">No pours logged yet. Click "+ Log Pour" to start.</td></tr>';
  } else {
    tbody.innerHTML = rows.map(function(pour) {
      const idx = pours.findIndex(x=>x._id===pour._id);
      const status = computePourStatus(pour);
      const remaining = computeRemaining(pour);
      const pc = status==='Passed'?'p-pass':status==='Failed'?'p-rej':'p-pend';
      const tests = Object.values(pour.tests||{});
      const testedAges = tests.map(t=>t.age).join(', ');

      // Build test result cells per curing age
      const AGE_KEYS = {'1 Day':'1_Day','3 Days':'3_Days','7 Days':'7_Days','14 Days':'14_Days','21 Days':'21_Days','28 Days':'28_Days'};
      const testCells = ['1 Day','3 Days','7 Days','14 Days','21 Days','28 Days'].map(function(age) {
        const key = AGE_KEYS[age];
        const t = (pour.tests||{})[key];
        if (!t) return '<td style="text-align:center;color:var(--text-2);font-size:10px;padding:6px">--</td>';
        const isPassed = t.result === 'Passed';
        const color = isPassed ? '#3B6D11' : '#A32D2D';
        const bg    = isPassed ? '#EAF3DE' : '#FCEBEB';
        return '<td style="text-align:center;padding:5px 6px;font-size:10px;line-height:1.5">'+
          '<div style="font-weight:700;font-size:11px;color:'+(isPassed?'#3B6D11':'#A32D2D')+'">'+t.average+' PSI</div>'+
          (t.labNo?'<div style="color:var(--text-2);font-size:9px">'+t.labNo+'</div>':'')+
          '<div style="color:var(--text-2);font-size:9px">Theo: '+t.required+' PSI</div>'+
          '<span style="font-size:9px;padding:1px 7px;border-radius:6px;background:'+bg+';color:'+color+';font-weight:600">'+t.result+'</span>'+
          '</td>';
      }).join('');

      return '<tr>'+
        '<td>'+(pour.datePoured||'--')+'</td>'+
        '<td title="'+(pour.client||'')+'">'+(pour.client||'--')+'</td>'+
        '<td title="'+(pour.project||'')+'">'+(pour.project||'--')+'</td>'+
        '<td title="'+(pour.location||'')+'">'+(pour.location||'--')+'</td>'+
        '<td title="'+(pour.structure||'')+'">'+(pour.structure||'--')+'</td>'+
        '<td>'+(pour.design||'--')+' '+(pour.curingDays||'')+'</td>'+
        '<td>'+(pour.sampleType||'--')+'</td>'+
        '<td style="text-align:center">'+(pour.totalSamples||'--')+'</td>'+
        '<td style="text-align:center;'+(remaining===0?'color:#639922;font-weight:500':remaining<=2?'color:#EF9F27':'')+'">'+remaining+'</td>'+
        '<td>'+(pour.siteCoord||'--')+'</td>'+
        '<td>'+(pour.testCoord||'--')+'</td>'+
        testCells+
        '<td><span class="pill '+pc+'" style="'+(status==='Passed'?'background:#EAF3DE;color:#3B6D11':status==='Failed'?'background:#FCEBEB;color:#A32D2D':'background:#FAEEDA;color:#854F0B')+'">'+status+'</span></td>'+
        '<td style="white-space:nowrap">'+
          '<button class="act-btn" onclick="openTestModal('+idx+')" title="Log Test Result" style="color:#378ADD">'+
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'+
          '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>'+
          '<circle cx="18" cy="6" r="3"/><path d="m15.5 8.5 1 1 2-2"/>'+
          '</svg></button>'+
          '<button class="act-btn" onclick="openEditPour('+idx+')" title="Edit Pour">'+
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'+
          '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>'+
          '<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>'+
          '</svg></button>'+
        '</td>'+
      '</tr>';
    }).join('');
  }
  const footer = document.getElementById('log-footer');
  if (footer) footer.textContent = 'Showing '+rows.length+' of '+md.length+' pours for this period';
}

/* ================================================================
   POUR MODAL
   ================================================================ */
function getVal(id){const el=document.getElementById(id);return el?el.value:'';}
function setVal(id,v){const el=document.getElementById(id);if(el) el.value=v||'';}

function openAddForm() {
  try {
    editPourIdx = null;
    modalIsOpen = true;
    const title=document.getElementById('modal-title');
    if(title) title.textContent='Log New Pour';
    const delBtn=document.getElementById('modal-delete-btn');
    if(delBtn) delBtn.style.display='none';
    const saveBtn=document.getElementById('modal-save-btn');
    if(saveBtn) saveBtn.textContent='Save Pour';

    setVal('m-date', new Date().toISOString().split('T')[0]);
    ['m-client','m-project','m-location','m-structure','m-totalsamples','m-sitecoord'].forEach(id=>setVal(id,''));
    setVal('m-design','');setVal('m-curing','');setVal('m-agg','');setVal('m-sampletype','');
    setVal('m-testcoord','');setVal('m-testcoord-other','');
    const tw=document.getElementById('testcoord-other-wrap');if(tw) tw.style.display='none';

    const modal=document.getElementById('pour-modal');
    if(modal) modal.classList.add('open');
  } catch(e) { console.error(e); toast('Error: '+e.message,'#E24B4A'); }
}

function openEditPour(idx) {
  try {
    editPourIdx = idx;
    modalIsOpen = true;
    const p = pours[idx];
    if (!p) return;
    const title=document.getElementById('modal-title');
    if(title) title.textContent='Edit Pour';
    const delBtn=document.getElementById('modal-delete-btn');
    if(delBtn) delBtn.style.display='inline-flex';
    const saveBtn=document.getElementById('modal-save-btn');
    if(saveBtn) saveBtn.textContent='Save Changes';

    setVal('m-date',    p.datePoured);
    setVal('m-client',  p.client);
    setVal('m-project', p.project);
    setVal('m-location',p.location);
    setVal('m-structure',p.structure);
    setVal('m-design',  p.design);
    setVal('m-curing',  p.curingDays);
    setVal('m-agg',     p.aggSize);
    setVal('m-sampletype',p.sampleType);
    setVal('m-totalsamples',p.totalSamples);
    setVal('m-sitecoord',p.siteCoord);
    const knownCoords=['Dio Balili','Joshua Facun','Roni Aguilar','JM Buitizon','Teodoro Taysa'];
    const coordIsOther = p.testCoord && !knownCoords.includes(p.testCoord);
    setVal('m-testcoord', coordIsOther?'__other__':p.testCoord||'');
    setVal('m-testcoord-other', coordIsOther?p.testCoord:'');
    const tw=document.getElementById('testcoord-other-wrap');
    if(tw) tw.style.display=coordIsOther?'':'none';

    const modal=document.getElementById('pour-modal');
    if(modal) modal.classList.add('open');
  } catch(e) { console.error(e); toast('Error: '+e.message,'#E24B4A'); }
}

function closePourModal() {
  modalIsOpen = false;
  const modal=document.getElementById('pour-modal');
  if(modal) modal.classList.remove('open');
  editPourIdx = null;
}

function toggleTestCoordOther() {
  const wrap=document.getElementById('testcoord-other-wrap');
  if(wrap) wrap.style.display=getVal('m-testcoord')==='__other__'?'':'none';
}

function savePour() {
  const date    = getVal('m-date');
  const client  = getVal('m-client').trim();
  const project = getVal('m-project').trim();
  const design  = getVal('m-design');
  const curing  = getVal('m-curing');
  const total   = getVal('m-totalsamples');

  if (!date||!client||!project||!design||!curing||!total) {
    toast('Please fill in all required fields.','#E24B4A');
    return;
  }

  const testCoord = getVal('m-testcoord')==='__other__'
    ? getVal('m-testcoord-other').trim()
    : getVal('m-testcoord');

  // Preserve existing tests if editing
  const existingTests = editPourIdx!==null && pours[editPourIdx] ? (pours[editPourIdx].tests||{}) : {};

  const entry = {
    datePoured:   date,
    client,
    project,
    location:     getVal('m-location').trim(),
    structure:    getVal('m-structure').trim(),
    design,
    curingDays:   curing,
    aggSize:      getVal('m-agg'),
    sampleType:   getVal('m-sampletype'),
    totalSamples: parseInt(total),
    siteCoord:    getVal('m-sitecoord').trim(),
    testCoord,
    tests:        existingTests,
  };

  const btn=document.getElementById('modal-save-btn');
  if(btn){btn.textContent='Saving...';btn.disabled=true;}

  savePourToDb(entry)
    .then(()=>{
      closePourModal();
      buildMonthSelect();
      const sel=document.getElementById('sel-month');
      if(sel&&sel.value!=='all') sel.value=date.slice(0,7);
      render();
      if(activeTab==='kpi') setTimeout(renderCharts,80);
      toast(editPourIdx!==null?'Pour updated!':'Pour logged: '+client+' - '+project,'#639922');
    })
    .catch(err=>toast('Save failed: '+err.message,'#E24B4A'))
    .finally(()=>{if(btn){btn.textContent=editPourIdx!==null?'Save Changes':'Save Pour';btn.disabled=false;}});
}

function deletePour() {
  if (editPourIdx===null) return;
  if (!confirm('Delete this pour and all its test results? This cannot be undone.')) return;
  const id = pours[editPourIdx]._id;
  deletePourFromDb(id)
    .then(()=>{closePourModal();toast('Pour deleted.','#E24B4A');})
    .catch(err=>toast('Delete failed: '+err.message,'#E24B4A'));
}

/* ================================================================
   TEST RESULT MODAL
   ================================================================ */
function openTestModal(idx) {
  try {
    testPourIdx = idx;
    modalIsOpen = true;
    const pour = pours[idx];
    if (!pour) return;

    const info = document.getElementById('test-pour-info');
    if (info) info.innerHTML =
      '<strong>'+pour.client+'</strong>  -  '+pour.project+' | '+
      '<strong>'+pour.design+'</strong> '+pour.curingDays+' | '+
      pour.sampleType+' | Total: '+pour.totalSamples+' samples | '+
      'Remaining: <strong>'+computeRemaining(pour)+'</strong>';

    setVal('t-age','');setVal('t-date',new Date().toISOString().split('T')[0]);
    setVal('t-labno','');setVal('t-count','');setVal('t-remarks','');
    setVal('t-average','');setVal('t-required','');setVal('t-result','');
    document.getElementById('reading-inputs').innerHTML='';

    const modal=document.getElementById('test-modal');
    if(modal) modal.classList.add('open');
  } catch(e) { console.error(e); toast('Error: '+e.message,'#E24B4A'); }
}

function closeTestModal() {
  modalIsOpen = false;
  const modal=document.getElementById('test-modal');
  if(modal) modal.classList.remove('open');
  testPourIdx = null;
}

function buildReadingInputs() {
  const count = parseInt(getVal('t-count')) || 0;
  const container = document.getElementById('reading-inputs');
  if (!container) return;

  if (!count || count > 20) {
    container.innerHTML = '';
    return;
  }

  let html = '<div style="font-size:11px;font-weight:600;color:var(--text-2);margin-bottom:6px">Individual Readings (PSI)</div>';
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px">';
  for (let i = 1; i <= count; i++) {
    html += '<div class="form-group"><label>Specimen '+i+'</label>'+
      '<input type="number" id="t-r'+i+'" placeholder="e.g. 2850" step="1" oninput="computeAverage()"></div>';
  }
  html += '</div>';
  container.innerHTML = html;
  computeAverage();
}

function computeAverage() {
  const count = parseInt(getVal('t-count')) || 0;
  const age   = getVal('t-age');
  if (!count) return;

  const pour = testPourIdx !== null ? pours[testPourIdx] : null;
  const readings = [];
  for (let i = 1; i <= count; i++) {
    const v = parseFloat(document.getElementById('t-r'+i)?.value || '');
    if (!isNaN(v)) readings.push(v);
  }

  const avg = readings.length ? Math.round(readings.reduce((a,b)=>a+b,0)/readings.length) : null;
  setVal('t-average', avg !== null ? avg : '');

  if (pour && age) {
    const testDay = AGE_DAYS[age] || 0;
    const required = getRequiredPSI(pour.design, pour.curingDays, testDay);
    setVal('t-required', required || '');

    if (avg !== null && required) {
      const passed = avg >= required;
      const el = document.getElementById('t-result');
      if (el) {
        el.value = passed ? 'Passed' : 'Failed';
        el.style.color = passed ? '#3B6D11' : '#A32D2D';
      }
    } else {
      setVal('t-result', '');
    }
  }
}

function saveTestResult() {
  const age   = getVal('t-age');
  const date  = getVal('t-date');
  const count = parseInt(getVal('t-count')) || 0;

  if (!age || !date || !count) {
    toast('Please fill in Curing Age, Date Tested and No. of Specimens.','#E24B4A');
    return;
  }

  const readings = [];
  for (let i = 1; i <= count; i++) {
    const v = parseFloat(document.getElementById('t-r'+i)?.value || '');
    if (!isNaN(v)) readings.push(v);
  }

  if (!readings.length) {
    toast('Please enter at least one reading.','#E24B4A');
    return;
  }

  const avg      = Math.round(readings.reduce((a,b)=>a+b,0)/readings.length);
  const pour     = pours[testPourIdx];
  const testDay  = AGE_DAYS[age] || 0;
  const required = getRequiredPSI(pour.design, pour.curingDays, testDay);
  const result   = avg >= required ? 'Passed' : 'Failed';

  const testEntry = {
    age, dateTested:date,
    labNo:    getVal('t-labno').trim(),
    count,
    readings,
    average:  avg,
    required,
    result,
    remarks:  getVal('t-remarks').trim(),
  };

  const btn=document.getElementById('test-save-btn');
  if(btn){btn.textContent='Saving...';btn.disabled=true;}

  // Save test under pour/tests/{age}
  const pourId = pour._id;
  const testKey = age.replace(/ /g,'_');

  updatePourInDb(pourId, testKey, testEntry)
    .then(()=>{
      // Update local array immediately so render shows it right away
      if (!pours[testPourIdx].tests) pours[testPourIdx].tests = {};
      pours[testPourIdx].tests[testKey] = testEntry;
      saveLocal();
      closeTestModal();
      render();
      if(activeTab==='kpi') setTimeout(renderCharts,80);
      toast('Test result saved! '+result+': '+avg+' PSI (Required: '+required+' PSI)',
        result==='Passed'?'#639922':'#E24B4A');
    })
    .catch(err=>toast('Save failed: '+err.message,'#E24B4A'))
    .finally(()=>{if(btn){btn.textContent='Save Result';btn.disabled=false;}});
}

/* ================================================================
   AUTOCOMPLETE
   ================================================================ */
function updateAutocomplete() {
  const fields = {
    'ac-client':   [...new Set(pours.map(d=>d.client).filter(Boolean))],
    'ac-project':  [...new Set(pours.map(d=>d.project).filter(Boolean))],
    'ac-location': [...new Set(pours.map(d=>d.location).filter(Boolean))],
    'ac-structure':[...new Set(pours.map(d=>d.structure).filter(Boolean))],
    'ac-sitecoord':[...new Set(pours.map(d=>d.siteCoord).filter(Boolean))],
    'ac-labno':    [...new Set(Object.values(Object.values(pours.reduce((acc,p)=>({...acc,...(p.tests||{})}),{})))
                    .map(t=>t.labNo).filter(Boolean))],
  };
  Object.entries(fields).forEach(([id,values])=>{
    let dl=document.getElementById(id);
    if(!dl){dl=document.createElement('datalist');dl.id=id;document.body.appendChild(dl);}
    dl.innerHTML=values.map(v=>'<option value="'+v.replace(/"/g,'&quot;')+'">').join('');
  });
}

/* ================================================================
   EXPORT CSV
   ================================================================ */
function exportCSV() {
  const md = monthPours();
  if (!md.length) { toast('No data to export.','#E24B4A'); return; }
  const hdrs = ['Date Poured','Client','Project','Location','Structure',
    'Design','Curing Days','Agg Size','Sample Type','Total Samples',
    'Site Coord','Test Coord','Curing Age Tested','Date Tested','Lab No.',
    'Specimens','Average PSI','Required PSI','Result','Remarks'];
  const rows = [];
  md.forEach(pour => {
    const tests = Object.values(pour.tests||{});
    if (!tests.length) {
      rows.push([pour.datePoured,pour.client,pour.project,pour.location,
        pour.structure,pour.design,pour.curingDays,pour.aggSize,pour.sampleType,
        pour.totalSamples,pour.siteCoord,pour.testCoord,'','','','','','','Pending','']
        .map(v=>'"'+(v||'').toString().replace(/"/g,'""')+'"').join(','));
    } else {
      tests.forEach(t => {
        rows.push([pour.datePoured,pour.client,pour.project,pour.location,
          pour.structure,pour.design,pour.curingDays,pour.aggSize,pour.sampleType,
          pour.totalSamples,pour.siteCoord,pour.testCoord,t.age,t.dateTested,
          t.labNo,t.count,t.average,t.required,t.result,t.remarks]
          .map(v=>'"'+(v||'').toString().replace(/"/g,'""')+'"').join(','));
      });
    }
  });
  const csv=[hdrs.join(','),...rows].join('\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  const [y,mo]=(selMonth()||'').split('-');
  a.download='BigBen_Strength_'+(y&&mo?y+'_'+mo:'export')+'.csv';
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
  el._t=setTimeout(()=>el.classList.remove('show'),4000);
}

/* ================================================================
   KEYBOARD
   ================================================================ */
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'){ closePourModal(); closeTestModal(); }
});

/* ================================================================
   INIT
   ================================================================ */
document.addEventListener('DOMContentLoaded',function(){
  const sel=document.getElementById('sel-month');
  if(sel) sel.addEventListener('change',function(){
    render(); if(activeTab==='kpi') setTimeout(renderCharts,80);
  });
  const testcoordSel=document.getElementById('m-testcoord');
  if(testcoordSel) testcoordSel.addEventListener('change', toggleTestCoordOther);

  loadLocal();
  buildMonthSelect();
  render();
  initFirebase();
  updateOnlineStatus();
  setTimeout(renderCharts,200);
});
