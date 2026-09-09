/* 티끌 - 개인 재정 트래커 (수입 · 지출 · 순수익 · 예산 · 목돈 목표) */
'use strict';

const KEY = 'tikkeul.v2';
const EXP_CATS = [
  { id:'food',    name:'식비',      icon:'ph-fork-knife' },
  { id:'cafe',    name:'카페/간식',  icon:'ph-coffee' },
  { id:'transit', name:'교통',      icon:'ph-bus' },
  { id:'living',  name:'생활용품',   icon:'ph-basket' },
  { id:'home',    name:'주거/공과금', icon:'ph-house-line' },
  { id:'shop',    name:'쇼핑',      icon:'ph-shopping-bag' },
  { id:'health',  name:'건강/의료',  icon:'ph-heartbeat' },
  { id:'culture', name:'문화/여가',  icon:'ph-ticket' },
  { id:'social',  name:'경조사',     icon:'ph-gift' },
  { id:'sub',     name:'구독/서비스', icon:'ph-repeat' },
  { id:'etc',     name:'기타 지출',  icon:'ph-dots-three-outline' },
];
const INC_CATS = [
  { id:'salary',  name:'급여',      icon:'ph-briefcase' },
  { id:'side',    name:'부수입',    icon:'ph-lightning' },
  { id:'invest',  name:'금융소득',   icon:'ph-chart-line-up' },
  { id:'refund',  name:'환급/보너스', icon:'ph-arrow-u-down-left' },
  { id:'etc_in',  name:'기타 수입',  icon:'ph-dots-three-outline' },
];
const ALL_CATS = [...EXP_CATS, ...INC_CATS, { id:'save', name:'목표 저축', icon:'ph-piggy-bank' }];
const catOf = id => ALL_CATS.find(c => c.id === id) || EXP_CATS[EXP_CATS.length-1];
const catsFor = type => type === 'income' ? INC_CATS : EXP_CATS;

/* ---------- store ---------- */
const blank = () => ({ v:2, txns:[], budget:{ monthly:0, fixed:[] }, bills:[], goals:[], settings:{ startBalance:0 }, deleted:[], updatedAt:null });
let S = load();
function load(){
  try{
    const raw = localStorage.getItem(KEY) || migrateV1();
    if(!raw) return blank();
    const d = JSON.parse(raw);
    return migrateFixed(Object.assign(blank(), d, {
      budget: Object.assign({ monthly:0, fixed:[] }, d.budget),
      settings: Object.assign({ startBalance:0 }, d.settings),
      bills: Array.isArray(d.bills) ? d.bills : [],
    }));
  }catch(e){ return blank(); }
}
/* 예전 '고정비'에는 납부일이 없었다. 매달 1일에 나가는 고정지출로 옮긴다.
   (이 함수는 load() 안에서 돌기 때문에 아래쪽 헬퍼를 쓸 수 없다) */
function migrateFixed(s){
  const n = new Date();
  const km = n.getFullYear() + '-' + String(n.getMonth()+1).padStart(2,'0');
  (s.budget.fixed || []).forEach(f => s.bills.push({
    id: f.id || ('b' + Math.random().toString(36).slice(2,9)),
    name: f.name, amount: f.amount, day: 1, cat: 'home', months: 0, start: km, paid: {},
  }));
  s.budget.fixed = [];
  s.bills.forEach(b => { if(!b.paid) b.paid = {}; });
  return s;
}
function migrateV1(){
  const old = localStorage.getItem('tikkeul.v1');
  if(!old) return null;
  try{ const d = JSON.parse(old); d.v = 2; localStorage.setItem(KEY, JSON.stringify(d)); return JSON.stringify(d); }
  catch(e){ return null; }
}
function save(){
  S.updatedAt = new Date().toISOString();
  pruneTombstones();
  try{ localStorage.setItem(KEY, JSON.stringify(S)); }
  catch(e){ toast('저장 공간이 부족합니다'); }
  takeSnapshot();
  scheduleBackup();
  scheduleSync();
}
/* 삭제한 거래는 id를 남겨 둬야 다른 기기에서 되살아나지 않는다 */
function tombstone(id){ (S.deleted = S.deleted || []).push({ id, at: today() }); }
function pruneTombstones(){
  if(!S.deleted) return;
  const limit = new Date(); limit.setDate(limit.getDate() - 120);
  S.deleted = S.deleted.filter(x => new Date(x.at) >= limit);
}

/* ---------- 안전장치 1: 날짜별 스냅샷 (같은 브라우저 안에서 실수 복구용) ---------- */
const SNAP = 'tikkeul.snap.';
const SNAP_KEEP = 7;
function takeSnapshot(){
  if(!S.txns.length && !S.goals.length) return;
  try{
    localStorage.setItem(SNAP + today(), JSON.stringify(S));
    const keys = Object.keys(localStorage).filter(k => k.startsWith(SNAP)).sort();
    while(keys.length > SNAP_KEEP) localStorage.removeItem(keys.shift());
  }catch(e){ /* 용량 부족이면 스냅샷은 건너뛴다 */ }
}
function snapshots(){
  return Object.keys(localStorage).filter(k => k.startsWith(SNAP)).sort().reverse().map(k => {
    let n = 0; try{ n = (JSON.parse(localStorage.getItem(k)).txns || []).length; }catch(e){}
    return { key:k, date:k.slice(SNAP.length), count:n };
  });
}

/* ---------- 안전장치 2: 로컬 파일 자동 백업 (File System Access) ---------- */
const FS_OK = typeof window.showSaveFilePicker === 'function';
const LAST_BK = 'tikkeul.lastBackup';
let backupHandle = null, backupTimer = null, backupState = 'off'; // off | ready | denied
let recoverOffer = null; // {source, count, apply()}

function idb(){
  return new Promise((res, rej) => {
    const r = indexedDB.open('tikkeul-fs', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(k){
  try{
    const db = await idb();
    return await new Promise(res => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(null); });
  }catch(e){ return null; }
}
async function idbSet(k, v){
  try{
    const db = await idb();
    await new Promise(res => { const q = db.transaction('kv','readwrite').objectStore('kv').put(v, k); q.onsuccess = () => res(); q.onerror = () => res(); });
  }catch(e){}
}

async function connectBackupFile(){
  if(!FS_OK) return toast('이 브라우저는 파일 자동 백업을 지원하지 않습니다');
  try{
    const h = await window.showSaveFilePicker({
      suggestedName: 'tikkeul-backup.json',
      types: [{ description: 'JSON 백업', accept: { 'application/json': ['.json'] } }],
    });
    backupHandle = h; backupState = 'ready';
    await idbSet('backupHandle', h);
    await writeBackup(true);
    render(); toast('자동 백업을 연결했습니다');
  }catch(e){ if(e.name !== 'AbortError') toast('백업 파일을 연결하지 못했습니다'); }
}
async function writeBackup(force){
  if(!backupHandle) return;
  try{
    const perm = await backupHandle.queryPermission({ mode: 'readwrite' });
    if(perm !== 'granted'){
      if(!force){ backupState = 'denied'; return; }
      const req = await backupHandle.requestPermission({ mode: 'readwrite' });
      if(req !== 'granted'){ backupState = 'denied'; render(); return; }
    }
    const w = await backupHandle.createWritable();
    await w.write(JSON.stringify(S, null, 1));
    await w.close();
    backupState = 'ready';
    localStorage.setItem(LAST_BK, new Date().toISOString());
  }catch(e){ backupState = 'denied'; }
}
function scheduleBackup(){
  if(!backupHandle) return;
  clearTimeout(backupTimer);
  backupTimer = setTimeout(() => writeBackup(false), 1200);
}
async function readBackupFile(){
  if(!backupHandle) return null;
  try{
    const perm = await backupHandle.queryPermission({ mode: 'readwrite' });
    if(perm !== 'granted' && await backupHandle.requestPermission({ mode: 'readwrite' }) !== 'granted') return null;
    const f = await backupHandle.getFile();
    const d = JSON.parse(await f.text());
    return Array.isArray(d.txns) ? d : null;
  }catch(e){ return null; }
}

/* 데이터가 비었는데 백업·스냅샷에 기록이 있으면 복구를 제안한다 */
async function checkRecovery(){
  if(S.txns.length) return;
  const snaps = snapshots().filter(x => x.count > 0);
  if(snaps.length){
    recoverOffer = { source: `${snaps[0].date} 스냅샷`, count: snaps[0].count,
      apply: () => { S = JSON.parse(localStorage.getItem(snaps[0].key)); save(); } };
    return render();
  }
  backupHandle = await idbGet('backupHandle');
  if(!backupHandle) return;
  const d = await readBackupFile();
  if(d && d.txns.length){
    recoverOffer = { source: '자동 백업 파일', count: d.txns.length,
      apply: () => { S = Object.assign(blank(), d, { budget:Object.assign({monthly:0,fixed:[]}, d.budget), settings:Object.assign({startBalance:0}, d.settings) }); save(); } };
    render();
  }
}
async function initBackup(){
  if(!FS_OK) return;
  backupHandle = backupHandle || await idbGet('backupHandle');
  if(!backupHandle) return;
  const perm = await backupHandle.queryPermission({ mode: 'readwrite' });
  backupState = perm === 'granted' ? 'ready' : 'denied';
  render();
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);

/* ---------- 날짜 · 금액 ---------- */
const pad = n => String(n).padStart(2,'0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const ym = s => s.slice(0,7);
const today = () => ymd(new Date());
const thisMonth = () => today().slice(0,7);
const monthKey = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}`;
function monthName(k){ return `${+k.split('-')[1]}월`; }
function monthFull(k){ const [y,m] = k.split('-'); return `${y}년 ${+m}월`; }
function daysInMonth(k){ const [y,m] = k.split('-').map(Number); return new Date(y, m, 0).getDate(); }
function daysLeftInMonth(){ const d = new Date(); return daysInMonth(thisMonth()) - d.getDate() + 1; }
function monthsUntil(due){
  if(!due) return 0;
  const [y,m] = due.split('-').map(Number), n = new Date();
  return Math.max(0, (y - n.getFullYear())*12 + (m - (n.getMonth()+1)));
}
function lastMonths(n, from){
  const out = [], d = from ? new Date(from + '-01') : new Date();
  for(let i=0;i<n;i++){ out.unshift(monthKey(d)); d.setMonth(d.getMonth()-1); }
  return out;
}
const won = n => (n < 0 ? '-' : '') + Math.round(Math.abs(n)).toLocaleString('ko-KR');
function shortWon(n){
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  if(a >= 100000000) return s + (a/100000000).toFixed(a % 100000000 ? 1 : 0) + '억';
  if(a >= 10000) return s + (a/10000).toFixed(a % 10000 ? (a < 1000000 ? 1 : 0) : 0).replace(/\.0$/,'') + '만';
  return won(n);
}
function relDay(dstr){
  const t = today();
  if(dstr === t) return '오늘';
  const y = new Date(); y.setDate(y.getDate()-1);
  if(dstr === ymd(y)) return '어제';
  const [ ,m,d] = dstr.split('-');
  return `${+m}.${+d}`;
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- 집계 ---------- */
const inMonth = k => S.txns.filter(t => ym(t.date) === k);
const sum = a => a.reduce((x,y) => x + y.amount, 0);

/* ---------- 납부 예정: 고정지출 · 할부 ---------- */
/* 납부일이 그 달에 없으면(31일 → 2월) 말일로 당긴다 */
function billDue(b, k){ return `${k}-${pad(Math.min(Math.max(1, b.day || 1), daysInMonth(k)))}`; }
/* 할부 회차(1부터). 고정지출이면 null */
function billTerm(b, k){
  if(!b.months) return null;
  const [y1,m1] = (b.start || k).split('-').map(Number);
  const [y2,m2] = k.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1) + 1;
}
function billActive(b, k){
  const n = billTerm(b, k);
  if(n === null) return (b.start || k) <= k;
  return n >= 1 && n <= b.months;
}
const billsFor = k => S.bills.filter(b => billActive(b, k))
                            .sort((a,b) => (a.day||1) - (b.day||1) || a.name.localeCompare(b.name));
const billPaid = (b, k) => !!(b.paid && b.paid[k]);
const daysApart = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
/* 납부일이 지나기 전까지는 '납부 예정' */
function billStatus(b, k){
  const due = billDue(b, k), now = thisMonth();
  if(billPaid(b, k)) return { s:'paid', label:'납부 완료', due };
  if(k > now) return { s:'due', label:'납부 예정', due };
  if(k < now) return { s:'late', label:'미납', due };
  const t = today();
  if(due > t) return { s:'due', label:`납부 예정 · D-${daysApart(t, due)}`, due };
  if(due === t) return { s:'today', label:'오늘 납부', due };
  return { s:'late', label:`미납 · ${daysApart(due, t)}일 지남`, due };
}
const billTotal = k => billsFor(k).reduce((a,b) => a + b.amount, 0);
const billsLeft = k => billsFor(k).filter(b => !billPaid(b, k));
const fixedTotal = () => billTotal(thisMonth());

/* 납부 완료 → 실제 지출 거래로 남긴다 */
function payBill(id, k){
  const b = S.bills.find(x => x.id === id);
  if(!b || billPaid(b, k)) return;
  const term = billTerm(b, k);
  const tx = { id: uid(), date: billDue(b, k), amount: b.amount, type:'expense',
    cat: b.cat || 'home', memo: b.name + (term ? ` ${term}/${b.months}회` : ''), goalId: null, billId: b.id };
  S.txns.push(tx);
  b.paid = b.paid || {}; b.paid[k] = tx.id;
  save(); render(); toast(`${b.name} ${won(b.amount)}원 납부로 기록했습니다`);
}
function unpayBill(id, k){
  const b = S.bills.find(x => x.id === id);
  if(!b || !billPaid(b, k)) return;
  const txid = b.paid[k];
  S.txns = S.txns.filter(t => t.id !== txid); tombstone(txid);
  delete b.paid[k];
  save(); render(); toast('납부 기록을 취소했습니다');
}

function stat(k){
  const rows = inMonth(k);
  const income = sum(rows.filter(t => t.type === 'income'));
  const expense = sum(rows.filter(t => t.type === 'expense'));
  const saved = sum(rows.filter(t => t.type === 'save'));
  const net = income - expense;
  const rate = income > 0 ? net / income : 0;
  const budget = S.budget.monthly, fixed = fixedTotal();
  const budgetLeft = budget ? budget - expense : 0;
  return { rows, income, expense, saved, net, rate, budget, fixed, budgetLeft };
}
function balance(){
  const inc = sum(S.txns.filter(t => t.type === 'income'));
  const exp = sum(S.txns.filter(t => t.type === 'expense'));
  return (S.settings.startBalance || 0) + inc - exp;
}
const goalSaved = g => (g.seed || 0) + sum(S.txns.filter(t => t.type === 'save' && t.goalId === g.id));
const sortTx = list => [...list].sort((a,b) => a.date === b.date ? b.id.localeCompare(a.id) : (a.date < b.date ? 1 : -1));

/* ---------- 라우팅 ---------- */
let tab = 'dash';
let filt = { month: thisMonth(), type:'all', cat:'all', q:'', limit:60 };
let statMonths = 6, rankMode = 'expense', statMonth = thisMonth();
const view = document.getElementById('view');
const TITLES = { dash:'대시보드', txns:'거래 내역', stats:'분석', bills:'납부 예정', goals:'목돈 목표', settings:'예산 · 설정' };

function banner(){
  if(recoverOffer) return `<div class="notice warn">
    <i class="ph ph-lifebuoy"></i>
    <div><b>${esc(recoverOffer.source)}에 거래 ${recoverOffer.count}건이 남아 있습니다.</b>
      <span>지금 화면은 비어 있습니다. 복구하면 그 기록으로 되돌립니다.</span></div>
    <button class="btn primary" data-act="recover">복구</button>
    <button class="btn ghost" data-act="recover-dismiss">닫기</button>
  </div>`;
  if(backupState === 'denied') return `<div class="notice">
    <i class="ph ph-warning-circle"></i>
    <div><b>자동 백업 파일에 쓸 권한이 필요합니다.</b><span>허용해야 기록이 파일에도 저장됩니다.</span></div>
    <button class="btn line" data-act="backup-permit">권한 허용</button>
  </div>`;
  if(FS_OK && !backupHandle && S.txns.length >= 5) return `<div class="notice">
    <i class="ph ph-floppy-disk"></i>
    <div><b>기록이 이 브라우저에만 있습니다.</b><span>백업 파일을 연결하면 저장할 때마다 자동으로 파일에 함께 남깁니다.</span></div>
    <button class="btn line" data-act="backup-connect">백업 파일 연결</button>
  </div>`;
  return '';
}

function render(){
  document.querySelectorAll('.nav button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
  document.getElementById('bar-title').textContent = TITLES[tab];
  document.getElementById('bar-sub').textContent =
    tab === 'dash' ? monthFull(thisMonth()) + ' 기준' :
    tab === 'txns' ? `${S.txns.length}건 기록됨` :
    tab === 'bills' ? (S.bills.length ? `${monthName(thisMonth())} 납부 ${billsLeft(thisMonth()).length}건 남음` : '') : '';
  view.innerHTML = banner() + ({ dash:vDash, txns:vTxns, stats:vStats, bills:vBills, goals:vGoals, settings:vSettings })[tab]();
}

/* ---------- 대시보드 ---------- */
function vDash(){
  const k = thisMonth(), m = stat(k);
  const prev = stat(lastMonths(2)[0]);
  const dExp = prev.expense ? m.expense - prev.expense : 0;

  const kpis = `<div class="kpis">
    <div class="kpi">
      <div class="k"><i class="ph ph-wallet"></i>현재 잔액</div>
      <div class="v num">${won(balance())}<small>원</small></div>
      <div class="d">시작 잔액 ${shortWon(S.settings.startBalance || 0)}원에서 누적</div>
    </div>
    <div class="kpi">
      <div class="k"><i class="ph ph-arrow-down-left"></i>${monthName(k)} 수입</div>
      <div class="v num pos">${won(m.income)}<small>원</small></div>
      <div class="d">${prev.income ? `지난달 ${shortWon(prev.income)}원` : '지난달 기록 없음'}</div>
    </div>
    <div class="kpi">
      <div class="k"><i class="ph ph-arrow-up-right"></i>${monthName(k)} 지출</div>
      <div class="v num">${won(m.expense)}<small>원</small></div>
      <div class="d">${prev.expense ? `지난달 대비 <span class="${dExp>0?'neg':'pos'}">${dExp>0?'+':''}${shortWon(dExp)}원</span>` : '지난달 기록 없음'}</div>
    </div>
    <div class="kpi">
      <div class="k"><i class="ph ph-equals"></i>순수익</div>
      <div class="v num ${m.net<0?'neg':'pos'}">${won(m.net)}<small>원</small></div>
      <div class="d">저축률 ${m.income ? Math.round(m.rate*100) : 0}%</div>
    </div>
  </div>`;

  const months = lastMonths(6);
  const flow = `<section class="panel">
    <div class="p-head"><h2>월별 현금 흐름</h2><span class="sub">최근 6개월</span></div>
    ${cashflowChart(months)}
    <div class="legend">
      <span><i style="background:var(--accent)"></i>수입</span>
      <span><i style="background:var(--surface-3)"></i>지출</span>
      <span><i style="background:var(--text);opacity:.5"></i>순수익</span>
    </div>
  </section>`;

  const budgetPanel = m.budget ? (() => {
    const used = Math.min(100, Math.round(m.expense / m.budget * 100));
    const over = m.budgetLeft < 0;
    const perDay = over ? 0 : m.budgetLeft / daysLeftInMonth();
    return `<section class="panel">
      <div class="p-head"><h2>${monthName(k)} 예산</h2>
        <span class="head-tools"><span class="sub">${daysLeftInMonth()}일 남음</span>
        <button class="btn ghost" data-act="budget">수정</button></span></div>
      <div class="kv"><span>예산</span><b class="num">${won(m.budget)}원</b></div>
      <div class="kv"><span>지출</span><b class="num">${won(m.expense)}원 <span style="color:var(--faint);font-weight:500">(${used}%)</span></b></div>
      <div class="kv"><span>${over ? '초과' : '남은 예산'}</span><b class="num ${over?'neg':'pos'}">${won(m.budgetLeft)}원</b></div>
      <div class="kv"><span>하루 사용 가능</span><b class="num">${won(perDay)}원</b></div>
      <div class="bar-line ${over?'over':''}" style="margin-top:14px"><i style="width:${used}%"></i></div>
    </section>`;
  })() : `<section class="panel">
      <div class="p-head"><h2>${monthName(k)} 예산</h2></div>
      <div class="empty" style="padding:26px 20px">
        <i class="ph ph-target"></i>
        <p>월 예산을 정하면 남은 금액과<br>하루 사용 가능액을 계산합니다.</p>
        <button class="btn primary" data-act="budget">예산 설정</button>
      </div>
    </section>`;

  const exp = m.rows.filter(t => t.type === 'expense');
  const total = sum(exp);
  const byCat = EXP_CATS.map(c => ({ c, amt: sum(exp.filter(t => t.cat === c.id)) }))
                        .filter(x => x.amt > 0).sort((a,b) => b.amt - a.amt).slice(0,6);
  const ranks = `<section class="panel">
    <div class="p-head"><h2>지출 카테고리</h2><span class="sub">${monthName(k)}</span></div>
    ${byCat.length ? `<div class="ranks">${byCat.map(x => rankRow(x.c, x.amt, byCat[0].amt, total)).join('')}</div>`
      : `<div class="empty" style="padding:28px"><i class="ph ph-chart-pie-slice"></i><p>이 달 지출 기록이 없습니다.</p></div>`}
  </section>`;

  const billRows = billsFor(k);
  const billPanel = billRows.length ? (() => {
    const left = billsLeft(k), leftSum = left.reduce((a,b) => a + b.amount, 0);
    const late = left.filter(b => billStatus(b, k).s === 'late').length;
    return `<section class="panel">
      <div class="p-head"><h2>${monthName(k)} 납부</h2>
        <button class="btn ghost" data-tab-go="bills">전체 보기 <i class="ph ph-arrow-right"></i></button></div>
      <div class="kv"><span>남은 납부</span><b class="num ${late?'neg':''}">${won(leftSum)}원 <span style="color:var(--faint);font-weight:500">(${left.length}건)</span></b></div>
      ${late ? `<div class="kv"><span>미납</span><b class="num neg">${late}건</b></div>` : ''}
      <div class="bills mini">${billRows.slice(0,4).map(b => billRow(b, k, true)).join('')}</div>
      ${billRows.length > 4 ? `<div style="padding:0 18px 14px;font-size:12px;color:var(--faint)">외 ${billRows.length-4}건</div>` : ''}
    </section>`;
  })() : '';

  const recent = sortTx(S.txns).slice(0,8);
  const recentPanel = `<section class="panel">
    <div class="p-head"><h2>최근 거래</h2><button class="btn ghost" data-tab-go="txns">전체 보기 <i class="ph ph-arrow-right"></i></button></div>
    ${recent.length ? `<div class="tblwrap">${txTable(recent, true)}</div>`
      : `<div class="empty"><i class="ph ph-receipt"></i><p>첫 거래를 기록해 보세요.<br>수입도 지출도 여기에 쌓입니다.</p>
         <button class="btn primary" data-act="new">새 거래 기록</button></div>`}
  </section>`;

  return kpis
    + `<div class="grid g-2 mt">${flow}${budgetPanel}</div>`
    + `<div class="grid g-2 mt">${recentPanel}<div class="stack">${billPanel}${S.goals.length ? goalsMini() : ''}${ranks}</div></div>`;
}

function rankRow(c, amt, max, total){
  return `<div class="rank">
    <div class="ic"><i class="ph ${c.icon}"></i></div>
    <div>
      <div class="nm"><span>${c.name}</span><em>${total ? Math.round(amt/total*100) : 0}%</em></div>
      <div class="tr"><i style="width:${Math.round(amt/max*100)}%"></i></div>
    </div>
    <div class="am num">${won(amt)}</div>
  </div>`;
}

function goalsMini(){
  return `<section class="panel">
    <div class="p-head"><h2>목돈 목표</h2><button class="btn ghost" data-tab-go="goals">관리 <i class="ph ph-arrow-right"></i></button></div>
    <div style="padding:4px 0">
      ${S.goals.slice(0,3).map(g => {
        const sv = goalSaved(g), pct = Math.min(100, Math.round(sv/g.target*100));
        return `<div class="goalcard" style="padding:14px 18px">
          <div style="display:flex;justify-content:space-between;align-items:baseline">
            <span class="gn">${esc(g.name)}</span><span class="num" style="font-size:12.5px;color:var(--accent);font-weight:650">${pct}%</span>
          </div>
          <div class="gv num" style="font-size:17px;margin-top:7px">${shortWon(sv)}<span> / ${shortWon(g.target)}원</span></div>
          <div class="gb"><i style="width:${pct}%"></i></div>
        </div>`;
      }).join('')}
    </div>
  </section>`;
}

/* ---------- 차트 ---------- */
function cashflowChart(months){
  const W=640,H=200,PL=46,PR=10,PT=14,PB=26;
  const d = months.map(k => { const s = stat(k); return { k, inc:s.income, exp:s.expense, net:s.net }; });
  if(!d.some(x => x.inc || x.exp))
    return `<div class="empty" style="padding:44px 20px"><i class="ph ph-chart-bar"></i>
      <p>기록이 쌓이면 월별 수입과 지출이 여기에 그려집니다.</p></div>`;
  const max = Math.max(1, ...d.map(x => Math.max(x.inc, x.exp)));
  const iw = (W-PL-PR)/d.length, bw = Math.min(26, iw*0.32);
  const y = v => PT + (H-PT-PB) * (1 - v/max);
  const grid = [0, .5, 1].map(f => {
    const yy = y(max*f);
    return `<line class="gl" x1="${PL}" y1="${yy.toFixed(1)}" x2="${W-PR}" y2="${yy.toFixed(1)}"/>
            <text class="lbl" x="${PL-8}" y="${(yy+3.5).toFixed(1)}" text-anchor="end">${f ? shortWon(max*f) : '0'}</text>`;
  }).join('');
  const bars = d.map((x,i) => {
    const cx = PL + iw*i + iw/2;
    const y0 = y(0);
    const hi = y0-y(x.inc), he = y0-y(x.exp);
    return `<rect class="bin" x="${(cx-bw-2).toFixed(1)}" y="${y(x.inc).toFixed(1)}" width="${bw}" height="${Math.max(1,hi).toFixed(1)}" rx="2"/>
      <rect class="bex" x="${(cx+2).toFixed(1)}" y="${y(x.exp).toFixed(1)}" width="${bw}" height="${Math.max(1,he).toFixed(1)}" rx="2"/>
      <text class="lbl" x="${cx.toFixed(1)}" y="${H-8}" text-anchor="middle">${monthName(x.k)}</text>`;
  }).join('');
  const netLine = d.map((x,i) => `${(PL+iw*i+iw/2).toFixed(1)},${y(Math.max(0,x.net)).toFixed(1)}`).join(' ');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="월별 수입과 지출 막대 그래프" style="padding:14px 4px 0">
    ${grid}${bars}<polyline class="net" points="${netLine}"/></svg>`;
}

function dailyChart(k){
  const W=1200,H=210,PL=54,PR=12,PT=14,PB=26;
  const dim = daysInMonth(k), rows = inMonth(k).filter(t => t.type === 'expense');
  const daily = Array.from({length:dim}, (_,i) => sum(rows.filter(t => +t.date.slice(8) === i+1)));
  if(!daily.some(v => v))
    return `<div class="empty" style="padding:38px 20px"><i class="ph ph-calendar-blank"></i>
      <p>이 달 지출 기록이 없습니다.</p></div>`;
  const max = Math.max(1, ...daily);
  const iw = (W-PL-PR)/dim, bw = Math.max(2, iw*0.62);
  const y = v => PT + (H-PT-PB)*(1 - v/max);
  const isNow = k === thisMonth(), td = new Date().getDate();
  const bars = daily.map((v,i) => {
    const x = PL + iw*i + (iw-bw)/2;
    const h = Math.max(v ? 2 : 1, y(0)-y(v));
    return `<rect x="${x.toFixed(1)}" y="${(y(0)-h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5"
      fill="${isNow && i+1 === td ? 'var(--accent)' : 'var(--surface-3)'}"/>`;
  }).join('');
  const gl = [0,1].map(f => `<line class="gl" x1="${PL}" y1="${y(max*f).toFixed(1)}" x2="${W-PR}" y2="${y(max*f).toFixed(1)}"/>
    <text class="lbl" x="${PL-8}" y="${(y(max*f)+3.5).toFixed(1)}" text-anchor="end">${f ? shortWon(max) : '0'}</text>`).join('');
  const ticks = [1, Math.ceil(dim/2), dim].map(n =>
    `<text class="lbl" x="${(PL+iw*(n-1)+iw/2).toFixed(1)}" y="${H-6}" text-anchor="middle">${n}일</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="일별 지출 그래프" style="padding:12px 4px 0">${gl}${bars}${ticks}</svg>`;
}

/* ---------- 거래 테이블 ---------- */
function txTable(list, compact){
  return `<table class="tbl">
    <thead><tr>
      <th style="width:74px">날짜</th>
      <th style="width:130px">분류</th>
      <th>내용</th>
      ${compact ? '' : '<th style="width:70px">구분</th>'}
      <th class="r" style="width:120px">금액</th>
      <th class="acts"></th>
    </tr></thead>
    <tbody>${list.map(t => txRow(t, compact)).join('')}</tbody>
  </table>`;
}
function txRow(t, compact){
  const c = catOf(t.type === 'save' ? 'save' : t.cat);
  const g = t.type === 'save' ? S.goals.find(x => x.id === t.goalId) : null;
  const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '-' : '';
  const cls = t.type === 'income' ? 'pos' : '';
  const label = t.memo || (g ? g.name : c.name);
  return `<tr data-id="${t.id}">
    <td class="date num">${relDay(t.date)}</td>
    <td><span class="cat"><i class="ph ${c.icon}"></i>${c.name}</span></td>
    <td class="memo">${t.memo ? esc(label) : `<em>${esc(label)}</em>`}</td>
    ${compact ? '' : `<td><span class="tag ${t.type === 'income' ? 'in' : t.type === 'save' ? 'sv' : ''}">${t.type === 'income' ? '수입' : t.type === 'save' ? '저축' : '지출'}</span></td>`}
    <td class="r amt num ${cls}">${sign}${won(t.amount)}</td>
    <td class="acts">
      <button data-edit="${t.id}" title="수정"><i class="ph ph-pencil-simple"></i></button>
      <button data-del="${t.id}" title="삭제"><i class="ph ph-trash"></i></button>
    </td>
  </tr>`;
}

/* ---------- 거래 내역 ---------- */
function vTxns(){
  let list = sortTx(S.txns);
  if(filt.month !== 'all') list = list.filter(t => ym(t.date) === filt.month);
  if(filt.type !== 'all') list = list.filter(t => t.type === filt.type);
  if(filt.cat !== 'all') list = list.filter(t => t.cat === filt.cat);
  if(filt.q){
    const q = filt.q.toLowerCase();
    list = list.filter(t => (t.memo || '').toLowerCase().includes(q) || catOf(t.cat).name.includes(q));
  }
  const inc = sum(list.filter(t => t.type === 'income'));
  const exp = sum(list.filter(t => t.type === 'expense'));
  const shown = list.slice(0, filt.limit);
  const monthOpts = ['all', ...lastMonths(13).reverse()].map(k =>
    `<option value="${k}"${k === filt.month ? ' selected' : ''}>${k === 'all' ? '전체 기간' : monthFull(k)}</option>`).join('');
  const catOpts = ['all', ...EXP_CATS, ...INC_CATS].map(c =>
    typeof c === 'string' ? `<option value="all"${filt.cat==='all'?' selected':''}>전체 분류</option>`
      : `<option value="${c.id}"${filt.cat===c.id?' selected':''}>${c.name}</option>`).join('');

  return `<section class="panel">
    <div class="filters">
      <select class="inp" id="f-month">${monthOpts}</select>
      <div class="seg">
        ${[['all','전체'],['expense','지출'],['income','수입'],['save','저축']].map(([v,l]) =>
          `<button data-ftype="${v}" aria-pressed="${filt.type===v}">${l}</button>`).join('')}
      </div>
      <select class="inp" id="f-cat">${catOpts}</select>
      <div class="search"><i class="ph ph-magnifying-glass"></i>
        <input id="f-q" type="search" placeholder="내용 검색" value="${esc(filt.q)}"></div>
      <button class="btn line" data-act="export-csv"><i class="ph ph-file-csv"></i>CSV</button>
    </div>
    <div class="filters" style="border-bottom:1px solid var(--line-soft);background:var(--surface-2)">
      <span style="font-size:12.5px;color:var(--muted)">${list.length}건</span>
      <span style="font-size:12.5px;color:var(--muted)">수입 <b class="num pos">${won(inc)}원</b></span>
      <span style="font-size:12.5px;color:var(--muted)">지출 <b class="num">${won(exp)}원</b></span>
      <span style="font-size:12.5px;color:var(--muted)">순수익 <b class="num ${inc-exp<0?'neg':'pos'}">${won(inc-exp)}원</b></span>
    </div>
    ${shown.length ? `<div class="tblwrap">${txTable(shown, false)}</div>`
      : `<div class="empty"><i class="ph ph-funnel"></i><p>조건에 맞는 거래가 없습니다.</p>
         <button class="btn line" data-act="reset-filter">필터 초기화</button></div>`}
    ${list.length > shown.length ? `<div style="padding:14px;text-align:center;border-top:1px solid var(--line-soft)">
      <button class="btn line" data-act="more">${list.length - shown.length}건 더 보기</button></div>` : ''}
  </section>`;
}

/* ---------- 분석 ---------- */
function vStats(){
  const k = statMonth, m = stat(k);
  const exp = m.rows.filter(t => t.type === 'expense');
  const elapsed = k === thisMonth() ? new Date().getDate() : daysInMonth(k);
  const avg = m.expense / Math.max(1, elapsed);
  const byDay = {};
  exp.forEach(t => { byDay[t.date] = (byDay[t.date] || 0) + t.amount; });
  const peak = Object.entries(byDay).sort((a,b) => b[1]-a[1])[0];
  const fixedShare = m.expense ? Math.round(fixedTotal() / m.expense * 100) : 0;

  const src = rankMode === 'income' ? INC_CATS : EXP_CATS;
  const rows = m.rows.filter(t => t.type === rankMode);
  const total = sum(rows);
  const ranks = src.map(c => ({ c, amt: sum(rows.filter(t => t.cat === c.id)) }))
                   .filter(x => x.amt > 0).sort((a,b) => b.amt - a.amt);

  const monthOpts = lastMonths(13).reverse().map(x =>
    `<option value="${x}"${x===k?' selected':''}>${monthFull(x)}</option>`).join('');

  return `<div class="filters panel" style="border-radius:var(--r);margin-bottom:14px">
      <select class="inp" id="s-month">${monthOpts}</select>
      <span style="font-size:12.5px;color:var(--faint)">${monthFull(k)} 기준으로 분석합니다</span>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="k">하루 평균 지출</div><div class="v num">${won(avg)}<small>원</small></div>
        <div class="d">${elapsed}일 집계</div></div>
      <div class="kpi"><div class="k">저축률</div><div class="v num ${m.rate<0?'neg':'pos'}">${m.income ? Math.round(m.rate*100) : 0}<small>%</small></div>
        <div class="d">수입 대비 남은 비율</div></div>
      <div class="kpi"><div class="k">최다 지출일</div><div class="v num">${peak ? shortWon(peak[1]) : 0}<small>원</small></div>
        <div class="d">${peak ? relDay(peak[0]) : '기록 없음'}</div></div>
      <div class="kpi"><div class="k">고정비 비중</div><div class="v num">${fixedShare}<small>%</small></div>
        <div class="d">고정비 ${shortWon(fixedTotal())}원</div></div>
    </div>

    <div class="grid g-2 mt">
      <section class="panel">
        <div class="p-head"><h2>월별 추이</h2>
          <div class="seg">${[6,12].map(n => `<button data-months="${n}" aria-pressed="${statMonths===n}">${n}개월</button>`).join('')}</div>
        </div>
        ${cashflowChart(lastMonths(statMonths, k))}
        <div class="legend"><span><i style="background:var(--accent)"></i>수입</span><span><i style="background:var(--surface-3)"></i>지출</span></div>
      </section>
      <section class="panel">
        <div class="p-head"><h2>카테고리</h2>
          <div class="seg">
            <button data-rank="expense" aria-pressed="${rankMode==='expense'}">지출</button>
            <button data-rank="income" aria-pressed="${rankMode==='income'}">수입</button>
          </div>
        </div>
        ${ranks.length ? `<div class="ranks">${ranks.map(x => rankRow(x.c, x.amt, ranks[0].amt, total)).join('')}</div>`
          : `<div class="empty" style="padding:30px"><i class="ph ph-chart-pie-slice"></i><p>이 달 ${rankMode==='income'?'수입':'지출'} 기록이 없습니다.</p></div>`}
      </section>
    </div>

    <div class="grid mt">
      <section class="panel">
        <div class="p-head"><h2>일별 지출</h2><span class="sub">${monthFull(k)}</span></div>
        ${dailyChart(k)}
        <div style="height:14px"></div>
      </section>
    </div>`;
}

/* ---------- 목표 ---------- */
/* ---------- 납부 예정 ---------- */
function billRow(b, k, compact){
  const st = billStatus(b, k), term = billTerm(b, k);
  return `<div class="bill ${st.s}">
    <span class="bday"><b class="num">${+st.due.slice(-2)}</b><i>일</i></span>
    <div class="binfo">
      <div class="bname">${esc(b.name)}${term ? `<span class="bterm">${term}/${b.months}회</span>` : ''}</div>
      <div class="bmeta"><span class="btag ${st.s}">${st.label}</span><span>${catOf(b.cat || 'home').name}</span></div>
    </div>
    <b class="num bamt">${won(b.amount)}원</b>
    ${compact ? '' : `<span class="bact">
      ${billPaid(b, k)
        ? `<button class="btn ghost" data-bill-unpay="${b.id}">취소</button>`
        : `<button class="btn line" data-bill-pay="${b.id}">납부 완료</button>`}
      <button data-bill-edit="${b.id}" title="수정" style="color:var(--faint);font-size:16px"><i class="ph ph-pencil-simple"></i></button>
    </span>`}
  </div>`;
}

function vBills(){
  const k = thisMonth();
  if(!S.bills.length){
    return `<section class="panel"><div class="empty" style="padding:56px 20px">
      <i class="ph ph-receipt"></i>
      <p>월세·통신비·구독료 같은 고정지출과 할부금을 등록해 두면<br>
         납부일이 지나기 전까지 <b>납부 예정</b>으로 띄우고, 지나면 미납으로 알려 줍니다.</p>
      <button class="btn primary lg" data-act="bill-new"><i class="ph ph-plus"></i>납부 항목 추가</button>
    </div></section>`;
  }
  const rows = billsFor(k);
  const left = billsLeft(k);
  const leftSum = left.reduce((a,b) => a + b.amount, 0);
  const paidSum = billTotal(k) - leftSum;
  const late = left.filter(b => billStatus(b, k).s === 'late');
  const nd = new Date(); nd.setDate(1); nd.setMonth(nd.getMonth() + 1);
  const nextK = monthKey(nd);
  const plans = S.bills.filter(b => b.months && billActive(b, k));
  const ended = S.bills.filter(b => b.months && !billActive(b, k) && billTerm(b, k) > b.months);

  return `<div class="kpis k-3">
      <div class="kpi"><div class="k"><i class="ph ph-calendar-check"></i>${monthName(k)} 납부 예정</div>
        <div class="v num">${won(billTotal(k))}<small>원</small></div>
        <div class="d">${rows.length}건 · 고정지출 ${rows.filter(b=>!b.months).length} · 할부 ${rows.filter(b=>b.months).length}</div></div>
      <div class="kpi"><div class="k"><i class="ph ph-hourglass"></i>아직 안 낸 금액</div>
        <div class="v num ${late.length?'neg':''}">${won(leftSum)}<small>원</small></div>
        <div class="d">${left.length}건 남음${late.length ? ` · 미납 ${late.length}건` : ''}</div></div>
      <div class="kpi"><div class="k"><i class="ph ph-check-circle"></i>이번 달 납부 완료</div>
        <div class="v num pos">${won(paidSum)}<small>원</small></div>
        <div class="d">다음 달 예정 ${won(billTotal(nextK))}원</div></div>
    </div>
    <div class="grid g-2 mt">
      <section class="panel">
        <div class="p-head"><h2>${monthName(k)} 납부 목록</h2>
          <button class="btn ghost" data-act="bill-new"><i class="ph ph-plus"></i>추가</button></div>
        <div class="bills">${rows.map(b => billRow(b, k, false)).join('')}</div>
        <div style="padding:12px 18px;font-size:12px;color:var(--faint);line-height:1.6">
          납부일이 지나기 전까지는 <b>납부 예정</b>, 지나도 처리하지 않으면 <b>미납</b>으로 표시됩니다.
          <b>납부 완료</b>를 누르면 그 날짜의 지출 거래로 기록됩니다.
        </div>
      </section>
      <div class="stack">
        <section class="panel">
          <div class="p-head"><h2>다음 달 예정</h2><span class="sub">${monthName(nextK)}</span></div>
          ${billsFor(nextK).length ? `<div class="bills mini">${billsFor(nextK).map(b => billRow(b, nextK, true)).join('')}</div>`
            : `<div class="empty" style="padding:26px"><p style="margin:0">다음 달에 예정된 납부가 없습니다.</p></div>`}
        </section>
        ${plans.length ? `<section class="panel">
          <div class="p-head"><h2>할부 진행</h2><span class="sub">${plans.length}건</span></div>
          ${plans.map(b => {
            const n = billTerm(b, k), done = Math.min(Math.max(0, n - 1), b.months);
            const rest = Math.max(0, b.months - done);
            const pct = Math.round(done / b.months * 100);
            return `<div class="kv"><span>${esc(b.name)}<br>
                <span style="font-size:11.5px;color:var(--faint)">${rest ? `${rest}회 남음 · 잔액 ${won(rest*b.amount)}원` : '완납'}</span></span>
              <span style="display:flex;gap:10px;align-items:center;min-width:120px;justify-content:flex-end">
                <span class="pbar"><i style="width:${pct}%"></i></span>
                <b class="num">${done}/${b.months}</b></span></div>`;
          }).join('')}
        </section>` : ''}
        ${ended.length ? `<section class="panel">
          <div class="p-head"><h2>끝난 할부</h2><span class="sub">${ended.length}건</span></div>
          ${ended.map(b => `<div class="kv"><span>${esc(b.name)}</span>
            <span style="display:flex;gap:10px;align-items:center"><b class="num">${won(b.amount * b.months)}원 완납</b>
            <button data-bill-edit="${b.id}" style="color:var(--faint)" title="수정"><i class="ph ph-pencil-simple"></i></button></span></div>`).join('')}
        </section>` : ''}
      </div>
    </div>`;
}

function vGoals(){
  if(!S.goals.length){
    return `<section class="panel"><div class="empty" style="padding:56px 20px">
      <i class="ph ph-target"></i>
      <p>목표 금액과 기한을 정하면 매달 얼마씩 넣어야 하는지 계산합니다.<br>거래를 기록할 때 구분을 저축으로 두면 자동으로 쌓입니다.</p>
      <button class="btn primary lg" data-act="goal-new"><i class="ph ph-plus"></i>목표 만들기</button>
    </div></section>`;
  }
  const cards = S.goals.map(g => {
    const sv = goalSaved(g), rest = Math.max(0, g.target - sv);
    const pct = Math.min(100, Math.round(sv/g.target*100));
    const mLeft = monthsUntil(g.due);
    const need = g.due ? (mLeft > 0 ? rest/mLeft : rest) : 0;
    const thisM = sum(inMonth(thisMonth()).filter(t => t.type === 'save' && t.goalId === g.id));
    return `<section class="panel goalcard">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
        <div><div class="gn">${esc(g.name)}</div>
          <div class="gd">${g.due ? `${monthFull(g.due)}까지 · ${mLeft}개월 남음` : '기한 없음'}</div></div>
        <button data-goal-edit="${g.id}" style="color:var(--faint);font-size:17px" title="수정"><i class="ph ph-pencil-simple"></i></button>
      </div>
      <div class="gv num">${won(sv)}<span> / ${won(g.target)}원</span></div>
      <div class="gb"><i style="width:${pct}%"></i></div>
      <div class="gf">
        <span>${g.due ? `매달 <b class="num" style="color:var(--text)">${won(need)}원</b> 필요` : `남은 금액 <b class="num" style="color:var(--text)">${won(rest)}원</b>`}</span>
        <span class="num" style="color:var(--accent);font-weight:650">${pct}%</span>
      </div>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn primary" style="flex:1" data-goal-save="${g.id}"><i class="ph ph-piggy-bank"></i>저축 기록</button>
      </div>
      ${thisM ? `<div style="margin-top:9px;font-size:11.5px;color:var(--faint)">이번 달 ${won(thisM)}원 적립</div>` : ''}
    </section>`;
  }).join('');
  return `<div class="grid g-3">${cards}</div>
    <div class="mt"><button class="btn line" data-act="goal-new"><i class="ph ph-plus"></i>목표 추가</button></div>`;
}

/* ---------- 설정 ---------- */
function vSettings(){
  const k = thisMonth(), bl = billsFor(k);
  return `<div class="grid g-2">
    <div>
      <section class="panel">
        <div class="p-head"><h2>월 예산</h2><button class="btn ghost" data-act="budget">수정</button></div>
        <div class="kv"><span>한 달 예산</span><b class="num">${won(S.budget.monthly)}원</b></div>
        <div class="kv"><span>고정지출 · 할부 합계</span><b class="num">${won(fixedTotal())}원</b></div>
        <div class="kv"><span>자유 지출 여력</span><b class="num pos">${won(Math.max(0, S.budget.monthly - fixedTotal()))}원</b></div>
      </section>
      <section class="panel mt">
        <div class="p-head"><h2>고정지출 · 할부</h2><button class="btn ghost" data-tab-go="bills">관리 <i class="ph ph-arrow-right"></i></button></div>
        ${bl.length ? `<div class="kv"><span>${monthName(k)} 납부 예정</span><b class="num">${won(billTotal(k))}원 <span style="color:var(--faint);font-weight:500">(${bl.length}건)</span></b></div>
          <div class="kv"><span>아직 안 낸 금액</span><b class="num">${won(billsLeft(k).reduce((a,b) => a + b.amount, 0))}원</b></div>`
          : `<div class="empty" style="padding:26px"><p style="margin:0">월세, 구독료, 할부금처럼 매달 정해진 날 빠져나가는 돈을 등록하면 예산 여력 계산에 반영되고 납부일을 놓치지 않습니다.</p>
             <button class="btn line" data-act="bill-new" style="margin-top:12px"><i class="ph ph-plus"></i>납부 항목 추가</button></div>`}
      </section>
      <section class="panel mt">
        <div class="p-head"><h2>시작 잔액</h2><button class="btn ghost" data-act="start-bal">수정</button></div>
        <div class="kv"><span>기록 시작 시점의 잔액</span><b class="num">${won(S.settings.startBalance || 0)}원</b></div>
        <div class="kv" style="color:var(--faint);font-size:12.5px">현재 잔액 = 시작 잔액 + 누적 수입 - 누적 지출</div>
      </section>
    </div>
    <div>
      <section class="panel">
        <div class="p-head"><h2>데이터</h2><span class="sub">${S.txns.length}건 · ${S.goals.length}개 목표</span></div>
        <div style="padding:16px 18px;display:grid;gap:8px">
          <button class="btn line wide" data-act="export"><i class="ph ph-download-simple"></i>JSON 백업 내려받기</button>
          <button class="btn line wide" data-act="export-csv"><i class="ph ph-file-csv"></i>CSV로 내보내기</button>
          <button class="btn line wide" data-act="import"><i class="ph ph-upload-simple"></i>백업 불러오기</button>
          <button class="btn danger wide" data-act="reset"><i class="ph ph-trash"></i>전체 삭제</button>
        </div>
        <div style="padding:0 18px 18px;font-size:12px;color:var(--faint);line-height:1.65">
          기록은 이 브라우저의 저장소에만 남습니다. 서버로 전송되지 않고, 브라우저 데이터를 지우면 함께 사라집니다. 백업 파일을 주기적으로 내려받아 두세요.
        </div>
      </section>
      <section class="panel mt">
        <div class="p-head"><h2>기기 간 동기화</h2><span class="sub">${syncCfg ? syncLabel() : '꺼짐'}</span></div>
        <div class="kv"><span>상태</span>
          <span style="display:flex;gap:10px;align-items:center">
            <b>${syncCfg ? (syncState === 'error' ? '오류' : '연결됨') : '연결 안 됨'}</b>
            <button class="btn ghost" data-act="sync-setup">${syncCfg ? '설정' : '연결'}</button>
          </span></div>
        ${syncCfg ? `<div class="kv"><span>서버</span><b style="font-size:12.5px;color:var(--muted)">${esc(syncCfg.url.replace(/^https?:\/\//,''))}</b></div>
        <div class="kv"><span>마지막 동기화</span>
          <span style="display:flex;gap:10px;align-items:center"><b>${syncLabel()}</b>
          <button class="btn ghost" data-act="sync-now">지금 동기화</button></span></div>
        ${syncErr ? `<div class="kv" style="color:var(--danger);font-size:12.5px">${esc(syncErr.slice(0,120))}</div>` : ''}` : ''}
        <div style="padding:0 18px 16px;font-size:12px;color:var(--faint);line-height:1.65">
          ${syncCfg ? '다른 기기에서는 설정 화면의 <b>설정 복사</b>로 얻은 한 줄을 붙여넣으면 바로 연결됩니다.'
                    : 'Supabase 무료 프로젝트를 만들고 저장소의 <b>supabase.sql</b>을 SQL Editor에서 한 번 실행한 뒤, Project URL과 anon key를 넣으면 폰과 데스크톱이 같은 기록을 봅니다.'}
        </div>
      </section>
      <section class="panel mt">
        <div class="p-head"><h2>안전장치</h2><span class="sub">${FS_OK ? (backupHandle ? (backupState === 'ready' ? '자동 백업 켜짐' : '권한 필요') : '자동 백업 꺼짐') : '이 브라우저 미지원'}</span></div>
        <div class="kv"><span>자동 백업 파일</span>
          <span style="display:flex;gap:10px;align-items:center">
            <b>${backupHandle ? esc(backupHandle.name || 'tikkeul-backup.json') : '연결 안 됨'}</b>
            <button class="btn ghost" data-act="backup-connect">${backupHandle ? '변경' : '연결'}</button>
          </span></div>
        <div class="kv"><span>마지막 자동 백업</span><b>${lastBackupLabel()}</b></div>
        ${snapshots().length ? snapshots().slice(0,3).map(x => `<div class="kv"><span>${x.date} 스냅샷</span>
          <span style="display:flex;gap:10px;align-items:center"><b class="num">${x.count}건</b>
          <button class="btn ghost" data-snap="${x.key}">되돌리기</button></span></div>`).join('')
          : '<div class="kv" style="color:var(--faint);font-size:12.5px">저장할 때마다 하루 한 개씩 스냅샷을 남깁니다.</div>'}
        <div style="padding:0 18px 16px;font-size:12px;color:var(--faint);line-height:1.65">
          기록은 지금 보고 있는 주소(<b>${esc(location.host)}</b>)의 브라우저 저장소에만 남습니다. 다른 기기, 다른 브라우저, 시크릿 창은 저장소가 서로 분리돼 있어 기록이 보이지 않습니다. 파일 백업을 연결해 두면 브라우저 데이터가 지워져도 파일에서 되살릴 수 있습니다.
        </div>
      </section>
      <section class="panel mt">
        <div class="p-head"><h2>단축키</h2></div>
        <div class="kv"><span>새 거래</span><kbd>N</kbd></div>
        <div class="kv"><span>검색</span><kbd>/</kbd></div>
        <div class="kv"><span>화면 이동</span><span><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd> <kbd>5</kbd></span></div>
        <div class="kv"><span>닫기</span><kbd>Esc</kbd></div>
      </section>
    </div>
  </div>`;
}

function lastBackupLabel(){
  const t = localStorage.getItem(LAST_BK);
  if(!t) return '없음';
  const d = new Date(t), diff = (Date.now() - d.getTime())/60000;
  if(diff < 1) return '방금';
  if(diff < 60) return `${Math.round(diff)}분 전`;
  if(diff < 1440) return `${Math.round(diff/60)}시간 전`;
  return `${d.getFullYear()}. ${d.getMonth()+1}. ${d.getDate()}.`;
}

/* ---------- 안전장치 3: 기기 간 동기화 (Supabase RPC) ---------- */
const SYNC_KEY = 'tikkeul.sync';
let syncCfg = null, syncState = 'off', syncTimer = null, syncBusy = false, syncErr = '', syncLastAt = null;

function loadSyncCfg(){ try{ return JSON.parse(localStorage.getItem(SYNC_KEY)); }catch(e){ return null; } }
function saveSyncCfg(c){ syncCfg = c; localStorage.setItem(SYNC_KEY, JSON.stringify(c)); }
const randomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2,'0')).join('');

async function rpc(fn, body){
  const base = syncCfg.url.replace(/\/+$/, '');
  const r = await fetch(`${base}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: syncCfg.key, Authorization: 'Bearer ' + syncCfg.key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if(!r.ok) throw new Error(`${r.status} ${text.slice(0,140)}`);
  return text ? JSON.parse(text) : null;
}

/* 두 기기의 기록을 합친다. 거래·목표는 id 기준 합집합, 나머지는 더 최근 문서 기준 */
function mergeDocs(local, remote){
  const lu = local.updatedAt || '', ru = remote.updatedAt || '';
  const newer = lu >= ru ? local : remote, older = newer === local ? remote : local;
  const dead = new Set([...(local.deleted||[]), ...(remote.deleted||[])].map(x => x.id));
  const byId = list => { const m = new Map(); (list||[]).forEach(x => m.set(x.id, x)); return m; };
  const mergeList = (a, b) => { const m = byId(a); byId(b).forEach((v,k) => m.set(k,v)); return [...m.values()]; };
  return {
    v: 2,
    txns: mergeList(older.txns, newer.txns).filter(t => !dead.has(t.id))
            .sort((a,b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0),
    goals: mergeList(older.goals, newer.goals),
    bills: mergeList(older.bills, newer.bills).filter(b => !dead.has(b.id)),
    budget: newer.budget || older.budget,
    settings: newer.settings || older.settings,
    deleted: [...new Map([...(local.deleted||[]), ...(remote.deleted||[])].map(x => [x.id, x])).values()],
    updatedAt: newer.updatedAt,
  };
}

async function syncNow(manual){
  if(!syncCfg || !syncCfg.url || !syncCfg.key || !syncCfg.code || syncBusy) return;
  syncBusy = true; syncState = 'syncing'; syncErr = ''; paintSyncChip();
  try{
    const remote = await rpc('get_doc', { p_code: syncCfg.code });
    let next = S;
    if(remote && Array.isArray(remote.txns)){
      const merged = mergeDocs(S, remote);
      const changed = JSON.stringify(merged.txns) !== JSON.stringify(S.txns)
                   || JSON.stringify(merged.goals) !== JSON.stringify(S.goals)
                   || JSON.stringify(merged.bills) !== JSON.stringify(S.bills)
                   || JSON.stringify(merged.budget) !== JSON.stringify(S.budget)
                   || JSON.stringify(merged.settings) !== JSON.stringify(S.settings);
      if(changed){
        S = Object.assign(blank(), merged);
        S.updatedAt = new Date().toISOString();
        localStorage.setItem(KEY, JSON.stringify(S));
        takeSnapshot(); scheduleBackup();
        next = S; render();
        if(manual) toast('다른 기기의 기록을 합쳤습니다');
      }
    }
    await rpc('put_doc', { p_code: syncCfg.code, p_data: next });
    syncLastAt = new Date().toISOString();
    localStorage.setItem('tikkeul.lastSync', syncLastAt);
    syncState = 'ok';
    if(manual) toast('동기화했습니다');
  }catch(e){
    syncState = 'error'; syncErr = e.message || String(e);
    if(manual) toast('동기화 실패: ' + syncErr.slice(0,60));
  }finally{ syncBusy = false; paintSyncChip(); }
}
function scheduleSync(){
  if(!syncCfg) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow(false), 2500);
}
function syncLabel(){
  if(!syncCfg) return '동기화 꺼짐';
  if(syncState === 'syncing') return '동기화 중';
  if(syncState === 'error') return '동기화 오류';
  const t = syncLastAt || localStorage.getItem('tikkeul.lastSync');
  if(!t) return '동기화 대기';
  const m = (Date.now() - new Date(t).getTime())/60000;
  return m < 1 ? '방금 동기화' : m < 60 ? `${Math.round(m)}분 전 동기화` : `${Math.round(m/60)}시간 전 동기화`;
}
function paintSyncChip(){
  const el = document.getElementById('sync-chip');
  if(!el) return;
  el.hidden = !syncCfg;
  el.className = 'btn ghost sync-chip ' + syncState;
  el.innerHTML = `<i class="ph ${syncState === 'error' ? 'ph-warning-circle' : syncState === 'syncing' ? 'ph-arrows-clockwise' : 'ph-cloud-check'}"></i>${syncLabel()}`;
  el.title = syncErr || syncLabel();
}

/* 설정 문자열: 다른 기기에 한 줄로 옮기기 */
const packCfg = c => btoa(unescape(encodeURIComponent(JSON.stringify(c))));
const unpackCfg = s => JSON.parse(decodeURIComponent(escape(atob(s.trim()))));

/* ---------- 입력 초안: 타이핑되는 즉시 저장 ---------- */
const DRAFT = 'tikkeul.draft.';
const DRAFT_TTL = 12 * 60 * 60 * 1000;   /* 12시간 지난 초안은 되살리지 않음 */
function draftSave(id, v){
  try{
    /* 날짜처럼 기본값이 있는 칸만 채워진 상태는 초안으로 치지 않는다 */
    const meaningful = ['amount','target','seed','name','memo'];
    const has = meaningful.some(k => v[k] !== undefined && v[k] !== '' && v[k] !== 0 && v[k] != null);
    if(!has) return draftClear(id);
    localStorage.setItem(DRAFT + id, JSON.stringify({ at: Date.now(), v }));
  }catch(e){}
}
function draftLoad(id){
  try{
    const d = JSON.parse(localStorage.getItem(DRAFT + id) || 'null');
    if(!d) return null;
    if(Date.now() - d.at > DRAFT_TTL){ draftClear(id); return null; }
    return d.v;
  }catch(e){ return null; }
}
function draftClear(id){ try{ localStorage.removeItem(DRAFT + id); }catch(e){} }
function draftNote(restored){
  return restored ? `<div class="draft-note" id="draft-note"><i class="ph ph-arrow-counter-clockwise"></i>
    <span>저장하지 않고 닫았던 입력을 되살렸습니다.</span>
    <button type="button" id="draft-reset">새로 쓰기</button></div>` : '';
}
/* 모달 안의 모든 입력에 초안 저장을 걸어 준다 */
function draftStop(root){ if(root) root.dataset.draftOff = '1'; }
function wireDraft(root, id, snap){
  const fire = () => { if(root.dataset.draftOff) return; snap(); };
  root.addEventListener('input', fire);
  root.addEventListener('change', fire);
  root.addEventListener('click', fire);   /* 금액 빠른 버튼 · 칩 선택 */
  return fire;
}

/* ---------- 모달 ---------- */
const modalRoot = document.getElementById('modal-root');
function closeModal(){ modalRoot.innerHTML = ''; }
function openModal(title, body, onMount){
  modalRoot.innerHTML = `<div class="scrim" data-close></div>
    <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <h2>${esc(title)}<button data-close title="닫기"><i class="ph ph-x"></i></button></h2>${body}</div>`;
  modalRoot.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeModal));
  if(onMount) onMount(modalRoot.querySelector('.modal'));
}
const digits = s => Number(String(s).replace(/[^0-9]/g,'')) || 0;
function amountField(label, id){
  return `<div class="field"><label for="${id}">${label}</label>
    <div class="amount-wrap"><input id="${id}" class="num" type="text" inputmode="numeric" placeholder="0" autocomplete="off"><span class="cur">원</span></div>
    <div class="quick">${[10000,50000,100000,500000].map(v => `<button type="button" data-plus="${v}">+${shortWon(v)}</button>`).join('')}
      <button type="button" data-plus="clear">지우기</button></div></div>`;
}
function wireAmount(root, id, init){
  const el = root.querySelector('#'+id);
  if(init) el.value = won(init);
  el.addEventListener('input', () => { const n = digits(el.value); el.value = n ? won(n) : ''; });
  root.querySelectorAll('[data-plus]').forEach(b => b.addEventListener('click', () => {
    el.value = b.dataset.plus === 'clear' ? '' : won(digits(el.value) + Number(b.dataset.plus));
    el.focus();
  }));
  setTimeout(() => { el.focus(); el.select(); }, 60);
  return el;
}

/* 거래 추가 · 수정 */
function modalTx(existing){
  const t = existing || null;
  const dId = 'tx.' + (t ? t.id : 'new');
  const d0 = draftLoad(dId);
  let type = d0?.type || t?.type || 'expense';
  let cat = d0?.cat || t?.cat || 'food';
  let goalId = d0?.goalId || t?.goalId || (S.goals[0]?.id || null);
  openModal(t ? '거래 수정' : '새 거래', `
    ${draftNote(!!d0)}
    <div class="seg" style="width:100%;margin-bottom:14px">
      ${[['expense','지출'],['income','수입'],['save','저축']].map(([v,l]) =>
        `<button data-type="${v}" aria-pressed="${type===v}" style="flex:1">${l}</button>`).join('')}
    </div>
    ${amountField('금액','amt')}
    <div id="type-body"></div>
    <div class="field row2">
      <div><label for="date">날짜</label><input id="date" type="date" value="${d0?.date || t?.date || today()}"></div>
      <div><label for="memo">메모</label><input id="memo" type="text" placeholder="선택 입력" value="${esc(d0?.memo ?? t?.memo ?? '')}" autocomplete="off"></div>
    </div>
    <div class="foot">
      <button class="btn line" data-close>취소</button>
      <button class="btn primary" id="submit">${t ? '저장' : '기록'}</button>
    </div>`, root => {
    const amt = wireAmount(root, 'amt', d0?.amount || t?.amount);
    const body = root.querySelector('#type-body');
    const snap = () => draftSave(dId, {
      type, cat, goalId,
      amount: digits(amt.value),
      date: root.querySelector('#date').value,
      memo: root.querySelector('#memo').value,
    });
    wireDraft(root, dId, snap);
    root.querySelector('#draft-reset')?.addEventListener('click', () => {
      draftStop(root), draftClear(dId); closeModal(); modalTx(existing);
    });
    const paint = () => {
      if(type === 'save'){
        body.innerHTML = S.goals.length
          ? `<div class="field"><label>어느 목표에</label><div class="chips">${S.goals.map(g =>
              `<button type="button" class="chip" data-goal="${g.id}" aria-pressed="${g.id===goalId}"><i class="ph ph-target"></i>${esc(g.name)}</button>`).join('')}</div></div>`
          : `<div class="field"><div class="hint">아직 목표가 없습니다. 저축 기록은 남고, 목표를 만들면 그때부터 진척도가 함께 계산됩니다.</div></div>`;
      }else{
        const list = catsFor(type);
        if(!list.some(c => c.id === cat)) cat = list[0].id;
        body.innerHTML = `<div class="field"><label>분류</label><div class="chips">${list.map(c =>
          `<button type="button" class="chip" data-cat="${c.id}" aria-pressed="${c.id===cat}"><i class="ph ${c.icon}"></i>${c.name}</button>`).join('')}</div></div>`;
      }
      body.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => { cat = b.dataset.cat; snap(); paint(); }));
      body.querySelectorAll('[data-goal]').forEach(b => b.addEventListener('click', () => { goalId = b.dataset.goal; snap(); paint(); }));
    };
    paint();
    root.querySelectorAll('[data-type]').forEach(b => b.addEventListener('click', () => {
      type = b.dataset.type;
      root.querySelectorAll('[data-type]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.type === type)));
      snap(); paint();
    }));
    const submit = () => {
      const v = digits(amt.value);
      if(!v){ amt.focus(); toast('금액을 입력해 주세요'); return; }
      const data = {
        date: root.querySelector('#date').value || today(),
        amount: v, type,
        cat: type === 'save' ? 'save' : cat,
        memo: root.querySelector('#memo').value.trim(),
        goalId: type === 'save' ? goalId : null,
      };
      if(t) Object.assign(t, data);
      else S.txns.push(Object.assign({ id: uid() }, data));
      draftStop(root), draftClear(dId);
      save(); closeModal(); render();
      toast(t ? '수정했습니다' : `${type==='income'?'수입':type==='save'?'저축':'지출'} ${won(v)}원 기록`);
    };
    root.querySelector('#submit').addEventListener('click', submit);
    root.addEventListener('keydown', e => { if(e.key === 'Enter' && e.target.tagName === 'INPUT') submit(); });
  });
}

function modalBudget(){
  const dId = 'budget'; const d0 = draftLoad(dId);
  openModal('월 예산', `${draftNote(!!d0)}${amountField('한 달 지출 예산','amt')}
    <div class="field"><div class="hint">고정비를 등록해 두면 자유롭게 쓸 수 있는 여력을 따로 계산합니다.</div></div>
    <div class="foot">
      ${S.budget.monthly ? `<button class="btn danger" id="bclear">예산 해제</button>` : `<button class="btn line" data-close>취소</button>`}
      <button class="btn primary" id="submit">저장</button>
    </div>`,
    root => {
      const amt = wireAmount(root, 'amt', d0?.amount || S.budget.monthly);
      wireDraft(root, dId, () => draftSave(dId, { amount: digits(amt.value) }));
      root.querySelector('#draft-reset')?.addEventListener('click', () => { draftStop(root), draftClear(dId); closeModal(); modalBudget(); });
      root.querySelector('#submit').addEventListener('click', () => {
        S.budget.monthly = digits(amt.value); draftStop(root), draftClear(dId); save(); closeModal(); render(); toast('예산을 저장했습니다');
      });
      root.querySelector('#bclear')?.addEventListener('click', () => {
        S.budget.monthly = 0; draftStop(root), draftClear(dId); save(); closeModal(); render(); toast('예산을 해제했습니다');
      });
    });
}
function modalStartBalance(){
  const dId = 'startbal'; const d0 = draftLoad(dId);
  openModal('시작 잔액', `${draftNote(!!d0)}${amountField('기록 시작 시점의 잔액','amt')}
    <div class="field"><div class="hint">통장과 현금을 합한 금액을 넣으면 현재 잔액이 실제와 맞춰집니다.</div></div>
    <div class="foot"><button class="btn line" data-close>취소</button><button class="btn primary" id="submit">저장</button></div>`,
    root => {
      const amt = wireAmount(root, 'amt', d0?.amount || S.settings.startBalance);
      wireDraft(root, dId, () => draftSave(dId, { amount: digits(amt.value) }));
      root.querySelector('#draft-reset')?.addEventListener('click', () => { draftStop(root), draftClear(dId); closeModal(); modalStartBalance(); });
      root.querySelector('#submit').addEventListener('click', () => {
        S.settings.startBalance = digits(amt.value); draftStop(root), draftClear(dId); save(); closeModal(); render(); toast('저장했습니다');
      });
    });
}
function modalBill(existing){
  const b = existing || null;
  const dId = 'bill.' + (b ? b.id : 'new');
  const d0 = draftLoad(dId);
  let kind = d0?.kind || (b ? (b.months ? 'plan' : 'fixed') : 'fixed');
  const nowM = thisMonth();
  const day0 = d0?.day || b?.day || 25;
  const cat0 = d0?.cat || b?.cat || 'home';
  openModal(b ? '납부 항목 수정' : '납부 항목 추가', `
    ${draftNote(!!d0)}
    <div class="seg" style="width:100%;margin-bottom:14px">
      <button data-kind="fixed" aria-pressed="${kind==='fixed'}" style="flex:1">고정지출</button>
      <button data-kind="plan" aria-pressed="${kind==='plan'}" style="flex:1">할부</button>
    </div>
    <div class="field"><label for="bname">항목</label>
      <input id="bname" type="text" placeholder="월세, 통신비, 아이폰 할부" value="${esc(d0?.name ?? b?.name ?? '')}" autocomplete="off"></div>
    ${amountField('매달 나가는 금액','amt')}
    <div class="field row2">
      <div><label for="bday">납부일</label>
        <select id="bday">${Array.from({length:31},(_,i)=>i+1).map(n =>
          `<option value="${n}" ${n===day0?'selected':''}>매달 ${n}일</option>`).join('')}</select></div>
      <div><label for="bcat">분류</label>
        <select id="bcat">${EXP_CATS.map(c =>
          `<option value="${c.id}" ${c.id===cat0?'selected':''}>${c.name}</option>`).join('')}</select></div>
    </div>
    <div id="plan-body"></div>
    <div class="foot">
      ${b ? `<button class="btn danger" id="bdel">삭제</button>` : `<button class="btn line" data-close>취소</button>`}
      <button class="btn primary" id="submit">${b ? '저장' : '추가'}</button>
    </div>`, root => {
    const amt = wireAmount(root, 'amt', d0?.amount || b?.amount);
    setTimeout(() => root.querySelector('#bname').focus(), 60);
    const planBody = root.querySelector('#plan-body');
    const paint = () => {
      planBody.innerHTML = kind === 'plan' ? `
        <div class="field row2">
          <div><label for="bmonths">총 회차</label>
            <input id="bmonths" type="number" min="1" max="120" value="${d0?.months || b?.months || 12}"></div>
          <div><label for="bstart">첫 납부 월</label>
            <input id="bstart" type="month" value="${d0?.start || b?.start || nowM}"></div>
        </div>
        <div class="field"><div class="hint">회차를 다 채우면 목록에서 자동으로 빠집니다.</div></div>` : '';
    };
    paint();
    const snap = () => draftSave(dId, {
      kind, name: root.querySelector('#bname').value, amount: digits(amt.value),
      day: Number(root.querySelector('#bday').value), cat: root.querySelector('#bcat').value,
      months: Number(root.querySelector('#bmonths')?.value || 0),
      start: root.querySelector('#bstart')?.value || '',
    });
    wireDraft(root, dId, snap);
    root.querySelector('#draft-reset')?.addEventListener('click', () => {
      draftStop(root), draftClear(dId); closeModal(); modalBill(existing);
    });
    root.querySelectorAll('[data-kind]').forEach(x => x.addEventListener('click', () => {
      kind = x.dataset.kind;
      root.querySelectorAll('[data-kind]').forEach(y => y.setAttribute('aria-pressed', String(y.dataset.kind === kind)));
      paint(); snap();
    }));
    root.querySelector('#submit').addEventListener('click', () => {
      const name = root.querySelector('#bname').value.trim(), v = digits(amt.value);
      if(!name || !v) return toast('항목과 금액을 입력해 주세요');
      const months = kind === 'plan' ? Math.max(1, Number(root.querySelector('#bmonths').value) || 1) : 0;
      const start = kind === 'plan' ? (root.querySelector('#bstart').value || nowM) : (b?.start || nowM);
      const data = { name, amount: v, day: Number(root.querySelector('#bday').value),
        cat: root.querySelector('#bcat').value, months, start };
      if(b) Object.assign(b, data);
      else S.bills.push(Object.assign({ id: uid(), paid: {} }, data));
      draftStop(root), draftClear(dId);
      save(); closeModal(); tab = 'bills'; render();
      toast(b ? '수정했습니다' : '납부 항목을 추가했습니다');
    });
    root.querySelector('#bdel')?.addEventListener('click', () => {
      if(!confirm(`"${b.name}"을(를) 목록에서 지울까요? 이미 납부로 기록한 거래는 그대로 남습니다.`)) return;
      S.bills = S.bills.filter(x => x.id !== b.id); tombstone(b.id);
      draftStop(root), draftClear(dId);
      save(); closeModal(); render(); toast('삭제했습니다');
    });
  });
}

function modalGoal(g){
  const d = new Date(); d.setMonth(d.getMonth()+12);
  const dId = 'goal.' + (g ? g.id : 'new'); const d0 = draftLoad(dId);
  const defDue = d0?.due || g?.due || monthKey(d);
  openModal(g ? '목표 수정' : '목돈 목표', `
    ${draftNote(!!d0)}
    <div class="field"><label for="gname">목표 이름</label><input id="gname" type="text" placeholder="비상금, 이사 자금, 전세 보증금" value="${esc(d0?.name ?? g?.name ?? '')}" autocomplete="off"></div>
    ${amountField('목표 금액','amt')}
    <div class="field row2">
      <div><label for="gdue">언제까지</label><input id="gdue" type="month" value="${defDue}"></div>
      <div><label for="gseed">이미 모아둔 금액</label><input id="gseed" class="num" type="text" inputmode="numeric" placeholder="0" value="${(d0?.seed || g?.seed) ? won(d0?.seed || g.seed) : ''}" autocomplete="off"></div>
    </div>
    <div class="foot">
      ${g ? `<button class="btn danger" id="gdel">삭제</button>` : `<button class="btn line" data-close>취소</button>`}
      <button class="btn primary" id="submit">${g ? '저장' : '만들기'}</button>
    </div>`, root => {
    const amt = wireAmount(root, 'amt', d0?.target || g?.target);
    setTimeout(() => root.querySelector('#gname').focus(), 60);
    const seed = root.querySelector('#gseed');
    seed.addEventListener('input', () => { const n = digits(seed.value); seed.value = n ? won(n) : ''; });
    wireDraft(root, dId, () => draftSave(dId, {
      name: root.querySelector('#gname').value, target: digits(amt.value),
      due: root.querySelector('#gdue').value, seed: digits(seed.value),
    }));
    root.querySelector('#draft-reset')?.addEventListener('click', () => { draftStop(root), draftClear(dId); closeModal(); modalGoal(g); });
    root.querySelector('#submit').addEventListener('click', () => {
      const target = digits(amt.value);
      if(!target) return toast('목표 금액을 입력해 주세요');
      const data = { name: root.querySelector('#gname').value.trim() || '목돈 목표', target,
        due: root.querySelector('#gdue').value, seed: digits(seed.value) };
      if(g) Object.assign(g, data); else S.goals.push(Object.assign({ id: uid() }, data));
      draftStop(root), draftClear(dId);
      save(); closeModal(); tab = 'goals'; render(); toast(g ? '수정했습니다' : '목표를 만들었습니다');
    });
    root.querySelector('#gdel')?.addEventListener('click', () => {
      if(!confirm(`"${g.name}" 목표를 삭제할까요? 저축 기록은 그대로 남습니다.`)) return;
      S.goals = S.goals.filter(x => x.id !== g.id); save(); closeModal(); render(); toast('삭제했습니다');
    });
  });
}
function modalDeposit(gid){
  const g = S.goals.find(x => x.id === gid); if(!g) return;
  const rest = Math.max(0, g.target - goalSaved(g));
  const dId = 'deposit.' + gid; const d0 = draftLoad(dId);
  openModal(`${g.name} 저축`, `${draftNote(!!d0)}${amountField('저축할 금액','amt')}
    <div class="field"><div class="hint">목표까지 ${won(rest)}원 남았습니다.</div></div>
    <div class="field"><label for="date">날짜</label><input id="date" type="date" value="${d0?.date || today()}"></div>
    <div class="foot"><button class="btn line" data-close>취소</button><button class="btn primary" id="submit">기록</button></div>`,
    root => {
      const amt = wireAmount(root, 'amt', d0?.amount);
      wireDraft(root, dId, () => draftSave(dId, { amount: digits(amt.value), date: root.querySelector('#date').value }));
      root.querySelector('#draft-reset')?.addEventListener('click', () => { draftStop(root), draftClear(dId); closeModal(); modalDeposit(gid); });
      root.querySelector('#submit').addEventListener('click', () => {
        const v = digits(amt.value); if(!v) return toast('금액을 입력해 주세요');
        S.txns.push({ id: uid(), date: root.querySelector('#date').value || today(), amount: v, type:'save', cat:'save', memo:'', goalId: gid });
        draftStop(root), draftClear(dId); save(); closeModal(); render(); toast(`${won(v)}원 저축했습니다`);
      });
    });
}

function modalSync(){
  const c = syncCfg || { url:'', key:'', code: randomCode() };
  openModal('기기 간 동기화', `
    <div class="field"><div class="hint" style="line-height:1.7">
      Supabase 무료 프로젝트 하나면 폰과 데스크톱이 같은 기록을 봅니다.
      프로젝트의 <b>Project URL</b>과 <b>anon public key</b>를 넣으세요.
      (Supabase 대시보드 → Project Settings → API)
    </div></div>
    <div class="field"><label for="s-url">Project URL</label>
      <input id="s-url" type="url" placeholder="https://xxxx.supabase.co" value="${esc(c.url)}" autocomplete="off"></div>
    <div class="field"><label for="s-key">anon public key</label>
      <input id="s-key" type="text" placeholder="eyJhbGciOi..." value="${esc(c.key)}" autocomplete="off"></div>
    <div class="field"><label for="s-code">동기화 코드</label>
      <input id="s-code" type="text" value="${esc(c.code)}" autocomplete="off">
      <div class="hint">이 코드를 아는 기기끼리만 기록이 오갑니다. 남에게 공유하지 마세요.</div></div>
    <div class="field"><label for="s-paste">다른 기기 설정 붙여넣기</label>
      <input id="s-paste" type="text" placeholder="복사한 설정 문자열" autocomplete="off">
      <div class="hint">위 세 칸을 채우는 대신, 다른 기기에서 복사한 한 줄을 넣어도 됩니다.</div></div>
    <div class="foot">
      ${syncCfg ? `<button class="btn line" id="s-copy"><i class="ph ph-copy"></i>설정 복사</button>` : `<button class="btn line" data-close>취소</button>`}
      <button class="btn primary" id="submit">연결하고 동기화</button>
    </div>
    ${syncCfg ? `<button class="btn danger wide" id="s-off" style="margin-top:8px">동기화 끄기</button>` : ''}
  `, root => {
    setTimeout(() => root.querySelector('#s-url').focus(), 60);
    root.querySelector('#s-paste').addEventListener('input', e => {
      const v = e.target.value.trim(); if(!v) return;
      try{
        const d = unpackCfg(v);
        if(d.url && d.key && d.code){
          root.querySelector('#s-url').value = d.url;
          root.querySelector('#s-key').value = d.key;
          root.querySelector('#s-code').value = d.code;
          e.target.value = ''; toast('설정을 채웠습니다');
        }
      }catch(err){ /* 아직 붙여넣는 중일 수 있다 */ }
    });
    root.querySelector('#s-copy')?.addEventListener('click', async () => {
      try{ await navigator.clipboard.writeText(packCfg(syncCfg)); toast('설정 문자열을 복사했습니다'); }
      catch(e){ toast('복사하지 못했습니다'); }
    });
    root.querySelector('#s-off')?.addEventListener('click', () => {
      if(!confirm('이 기기에서 동기화를 끕니다. 기록은 그대로 남습니다. 계속할까요?')) return;
      localStorage.removeItem(SYNC_KEY); syncCfg = null; syncState = 'off';
      closeModal(); render(); paintSyncChip(); toast('동기화를 껐습니다');
    });
    root.querySelector('#submit').addEventListener('click', async () => {
      const url = root.querySelector('#s-url').value.trim();
      const key = root.querySelector('#s-key').value.trim();
      const code = root.querySelector('#s-code').value.trim();
      if(!url || !key || code.length < 24) return toast('URL, 키, 24자 이상 코드가 필요합니다');
      const prev = syncCfg;
      syncCfg = { url, key, code };
      try{
        await rpc('get_doc', { p_code: code });
        saveSyncCfg(syncCfg);
        closeModal(); await syncNow(true); render(); paintSyncChip();
      }catch(e){
        syncCfg = prev;
        toast('연결 실패: ' + String(e.message || e).slice(0,70));
      }
    });
  });
}

/* ---------- 데이터 입출력 ---------- */
function download(name, content, mime){
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function exportJSON(){ download(`tikkeul-backup-${today()}.json`, JSON.stringify(S, null, 2), 'application/json'); toast('백업 파일을 내려받았습니다'); }
function exportCSV(){
  const head = ['날짜','구분','분류','내용','금액'];
  const rows = sortTx(S.txns).map(t => [
    t.date,
    t.type === 'income' ? '수입' : t.type === 'save' ? '저축' : '지출',
    catOf(t.type === 'save' ? 'save' : t.cat).name,
    (t.memo || '').replace(/"/g,'""'),
    t.amount,
  ]);
  const csv = '﻿' + [head, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  download(`tikkeul-${today()}.csv`, csv, 'text/csv;charset=utf-8');
  toast('CSV 파일을 내려받았습니다');
}
function importData(){
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'application/json,.json';
  inp.addEventListener('change', () => {
    const f = inp.files[0]; if(!f) return;
    const r = new FileReader();
    r.onload = () => {
      try{
        const d = JSON.parse(r.result);
        if(!Array.isArray(d.txns)) throw new Error('bad');
        if(!confirm(`기록 ${d.txns.length}건을 불러옵니다. 현재 데이터는 덮어씌워집니다.`)) return;
        S = Object.assign(blank(), d, {
          budget: Object.assign({monthly:0,fixed:[]}, d.budget),
          settings: Object.assign({startBalance:0}, d.settings),
        });
        save(); render(); toast('불러왔습니다');
      }catch(e){ toast('파일을 읽지 못했습니다'); }
    };
    r.readAsText(f);
  });
  inp.click();
}

/* ---------- 토스트 ---------- */
let toastTimer;
function toast(msg){
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg; el.setAttribute('role','status');
  document.body.appendChild(el);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.remove(), 2200);
}

/* ---------- 이벤트 ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-tab],[data-tab-go],[data-act],[data-del],[data-edit],[data-goal-save],[data-goal-edit],[data-bill-pay],[data-bill-unpay],[data-bill-edit],[data-snap],[data-ftype],[data-rank],[data-months]');
  if(!t) return;
  if(t.dataset.tab){ tab = t.dataset.tab; return render(); }
  if(t.dataset.tabGo){ tab = t.dataset.tabGo; return render(); }
  if(t.dataset.ftype){ filt.type = t.dataset.ftype; filt.limit = 60; return render(); }
  if(t.dataset.rank){ rankMode = t.dataset.rank; return render(); }
  if(t.dataset.months){ statMonths = Number(t.dataset.months); return render(); }
  if(t.dataset.edit) return modalTx(S.txns.find(x => x.id === t.dataset.edit));
  if(t.dataset.goalSave) return modalDeposit(t.dataset.goalSave);
  if(t.dataset.goalEdit) return modalGoal(S.goals.find(g => g.id === t.dataset.goalEdit));
  if(t.dataset.snap){
    if(confirm('이 스냅샷 시점으로 되돌립니다. 현재 기록은 덮어씌워집니다. 계속할까요?')){
      try{ S = JSON.parse(localStorage.getItem(t.dataset.snap)); save(); render(); toast('되돌렸습니다'); }
      catch(e){ toast('스냅샷을 읽지 못했습니다'); }
    }
    return;
  }
  if(t.dataset.billPay) return payBill(t.dataset.billPay, thisMonth());
  if(t.dataset.billUnpay) return unpayBill(t.dataset.billUnpay, thisMonth());
  if(t.dataset.billEdit) return modalBill(S.bills.find(x => x.id === t.dataset.billEdit));
  if(t.dataset.del){
    const tx = S.txns.find(x => x.id === t.dataset.del);
    if(tx && confirm(`${won(tx.amount)}원 기록을 삭제할까요?`)){ S.txns = S.txns.filter(x => x.id !== tx.id); tombstone(tx.id); save(); render(); }
    return;
  }
  switch(t.dataset.act){
    case 'new': return modalTx(null);
    case 'backup-connect': return connectBackupFile();
    case 'sync-setup': return modalSync();
    case 'sync-now': return syncNow(true);
    case 'backup-permit': return writeBackup(true).then(render);
    case 'recover':
      if(recoverOffer){ recoverOffer.apply(); recoverOffer = null; render(); toast('복구했습니다'); }
      return;
    case 'recover-dismiss': recoverOffer = null; return render();
    case 'budget': return modalBudget();
    case 'start-bal': return modalStartBalance();
    case 'bill-new': return modalBill(null);
    case 'goal-new': return modalGoal(null);
    case 'export': return exportJSON();
    case 'export-csv': return exportCSV();
    case 'import': case 'import-quick': return importData();
    case 'more': filt.limit += 60; return render();
    case 'reset-filter': filt = { month:'all', type:'all', cat:'all', q:'', limit:60 }; return render();
    case 'reset':
      if(confirm('모든 기록과 설정을 삭제합니다. 되돌릴 수 없습니다. 계속할까요?')){
        S = blank(); save(); tab = 'dash'; render(); toast('초기화했습니다');
      }
      return;
  }
});
document.addEventListener('change', e => {
  if(e.target.id === 'f-month'){ filt.month = e.target.value; filt.limit = 60; render(); }
  if(e.target.id === 'f-cat'){ filt.cat = e.target.value; filt.limit = 60; render(); }
  if(e.target.id === 's-month'){ statMonth = e.target.value; render(); }
});
let qTimer;
document.addEventListener('input', e => {
  if(e.target.id !== 'f-q') return;
  clearTimeout(qTimer);
  const v = e.target.value, pos = e.target.selectionStart;
  qTimer = setTimeout(() => {
    filt.q = v; filt.limit = 60; render();
    const el = document.getElementById('f-q');
    if(el){ el.focus(); el.setSelectionRange(pos, pos); }
  }, 220);
});
document.addEventListener('keydown', e => {
  if(e.key === 'Escape') return closeModal();
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
  if(typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if(e.key === 'n' || e.key === 'N'){ e.preventDefault(); return modalTx(null); }
  if(e.key === '/'){
    e.preventDefault();
    if(tab !== 'txns'){ tab = 'txns'; render(); }
    return document.getElementById('f-q')?.focus();
  }
  const map = { '1':'dash','2':'txns','3':'stats','4':'bills','5':'goals','6':'settings' };
  if(map[e.key]){ tab = map[e.key]; render(); }
});

syncCfg = loadSyncCfg();
syncLastAt = localStorage.getItem('tikkeul.lastSync');
render();
paintSyncChip();
initBackup();
checkRecovery();
if(syncCfg) syncNow(false);
let lastPull = Date.now();
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState !== 'visible' || !syncCfg) return;
  if(Date.now() - lastPull < 60000) return;
  lastPull = Date.now(); syncNow(false);
});
if('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(()=>{}));
