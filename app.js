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
const blank = () => ({ v:2, txns:[], budget:{ monthly:0, fixed:[] }, goals:[], settings:{ startBalance:0 } });
let S = load();
function load(){
  try{
    const raw = localStorage.getItem(KEY) || migrateV1();
    if(!raw) return blank();
    const d = JSON.parse(raw);
    return Object.assign(blank(), d, {
      budget: Object.assign({ monthly:0, fixed:[] }, d.budget),
      settings: Object.assign({ startBalance:0 }, d.settings),
    });
  }catch(e){ return blank(); }
}
function migrateV1(){
  const old = localStorage.getItem('tikkeul.v1');
  if(!old) return null;
  try{ const d = JSON.parse(old); d.v = 2; localStorage.setItem(KEY, JSON.stringify(d)); return JSON.stringify(d); }
  catch(e){ return null; }
}
function save(){ try{ localStorage.setItem(KEY, JSON.stringify(S)); }catch(e){ toast('저장 공간이 부족합니다'); } }
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
const fixedTotal = () => S.budget.fixed.reduce((a,b) => a + b.amount, 0);

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
const TITLES = { dash:'대시보드', txns:'거래 내역', stats:'분석', goals:'목돈 목표', settings:'예산 · 설정' };

function render(){
  document.querySelectorAll('.nav button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
  document.getElementById('bar-title').textContent = TITLES[tab];
  document.getElementById('bar-sub').textContent =
    tab === 'dash' ? monthFull(thisMonth()) + ' 기준' :
    tab === 'txns' ? `${S.txns.length}건 기록됨` : '';
  view.innerHTML = ({ dash:vDash, txns:vTxns, stats:vStats, goals:vGoals, settings:vSettings })[tab]();
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
      <div class="p-head"><h2>${monthName(k)} 예산</h2><span class="sub">${daysLeftInMonth()}일 남음</span></div>
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

  const recent = sortTx(S.txns).slice(0,8);
  const recentPanel = `<section class="panel">
    <div class="p-head"><h2>최근 거래</h2><button class="btn ghost" data-tab-go="txns">전체 보기 <i class="ph ph-arrow-right"></i></button></div>
    ${recent.length ? `<div class="tblwrap">${txTable(recent, true)}</div>`
      : `<div class="empty"><i class="ph ph-receipt"></i><p>첫 거래를 기록해 보세요.<br>수입도 지출도 여기에 쌓입니다.</p>
         <button class="btn primary" data-act="new">새 거래 기록</button></div>`}
  </section>`;

  return kpis
    + `<div class="grid g-2 mt">${flow}${budgetPanel}</div>`
    + `<div class="grid g-2 mt">${recentPanel}<div class="stack">${S.goals.length ? goalsMini() : ''}${ranks}</div></div>`;
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
  const f = S.budget.fixed;
  return `<div class="grid g-2">
    <div>
      <section class="panel">
        <div class="p-head"><h2>월 예산</h2><button class="btn ghost" data-act="budget">수정</button></div>
        <div class="kv"><span>한 달 예산</span><b class="num">${won(S.budget.monthly)}원</b></div>
        <div class="kv"><span>고정비 합계</span><b class="num">${won(fixedTotal())}원</b></div>
        <div class="kv"><span>자유 지출 여력</span><b class="num pos">${won(Math.max(0, S.budget.monthly - fixedTotal()))}원</b></div>
      </section>
      <section class="panel mt">
        <div class="p-head"><h2>고정비</h2><button class="btn ghost" data-act="fixed-new"><i class="ph ph-plus"></i>추가</button></div>
        ${f.length ? f.map(x => `<div class="kv"><span>${esc(x.name)}</span>
            <span style="display:flex;gap:12px;align-items:center"><b class="num">${won(x.amount)}원</b>
            <button data-fixed-del="${x.id}" style="color:var(--faint)" title="삭제"><i class="ph ph-x"></i></button></span></div>`).join('')
          : `<div class="empty" style="padding:26px"><p style="margin:0">월세, 구독료처럼 매달 빠져나가는 돈을 등록하면 예산 여력 계산에 반영됩니다.</p></div>`}
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
        <div class="p-head"><h2>단축키</h2></div>
        <div class="kv"><span>새 거래</span><kbd>N</kbd></div>
        <div class="kv"><span>검색</span><kbd>/</kbd></div>
        <div class="kv"><span>화면 이동</span><span><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd> <kbd>5</kbd></span></div>
        <div class="kv"><span>닫기</span><kbd>Esc</kbd></div>
      </section>
    </div>
  </div>`;
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
  let type = t?.type || 'expense';
  let cat = t?.cat || 'food';
  let goalId = t?.goalId || (S.goals[0]?.id || null);
  openModal(t ? '거래 수정' : '새 거래', `
    <div class="seg" style="width:100%;margin-bottom:14px">
      ${[['expense','지출'],['income','수입'],['save','저축']].map(([v,l]) =>
        `<button data-type="${v}" aria-pressed="${type===v}" style="flex:1">${l}</button>`).join('')}
    </div>
    ${amountField('금액','amt')}
    <div id="type-body"></div>
    <div class="field row2">
      <div><label for="date">날짜</label><input id="date" type="date" value="${t?.date || today()}"></div>
      <div><label for="memo">메모</label><input id="memo" type="text" placeholder="선택 입력" value="${esc(t?.memo || '')}" autocomplete="off"></div>
    </div>
    <div class="foot">
      <button class="btn line" data-close>취소</button>
      <button class="btn primary" id="submit">${t ? '저장' : '기록'}</button>
    </div>`, root => {
    const amt = wireAmount(root, 'amt', t?.amount);
    const body = root.querySelector('#type-body');
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
      body.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => { cat = b.dataset.cat; paint(); }));
      body.querySelectorAll('[data-goal]').forEach(b => b.addEventListener('click', () => { goalId = b.dataset.goal; paint(); }));
    };
    paint();
    root.querySelectorAll('[data-type]').forEach(b => b.addEventListener('click', () => {
      type = b.dataset.type;
      root.querySelectorAll('[data-type]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.type === type)));
      paint();
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
      save(); closeModal(); render();
      toast(t ? '수정했습니다' : `${type==='income'?'수입':type==='save'?'저축':'지출'} ${won(v)}원 기록`);
    };
    root.querySelector('#submit').addEventListener('click', submit);
    root.addEventListener('keydown', e => { if(e.key === 'Enter' && e.target.tagName === 'INPUT') submit(); });
  });
}

function modalBudget(){
  openModal('월 예산', `${amountField('한 달 지출 예산','amt')}
    <div class="field"><div class="hint">고정비를 등록해 두면 자유롭게 쓸 수 있는 여력을 따로 계산합니다.</div></div>
    <div class="foot"><button class="btn line" data-close>취소</button><button class="btn primary" id="submit">저장</button></div>`,
    root => {
      const amt = wireAmount(root, 'amt', S.budget.monthly);
      root.querySelector('#submit').addEventListener('click', () => {
        S.budget.monthly = digits(amt.value); save(); closeModal(); render(); toast('예산을 저장했습니다');
      });
    });
}
function modalStartBalance(){
  openModal('시작 잔액', `${amountField('기록 시작 시점의 잔액','amt')}
    <div class="field"><div class="hint">통장과 현금을 합한 금액을 넣으면 현재 잔액이 실제와 맞춰집니다.</div></div>
    <div class="foot"><button class="btn line" data-close>취소</button><button class="btn primary" id="submit">저장</button></div>`,
    root => {
      const amt = wireAmount(root, 'amt', S.settings.startBalance);
      root.querySelector('#submit').addEventListener('click', () => {
        S.settings.startBalance = digits(amt.value); save(); closeModal(); render(); toast('저장했습니다');
      });
    });
}
function modalFixed(){
  openModal('고정비 추가', `
    <div class="field"><label for="fname">항목</label><input id="fname" type="text" placeholder="월세, 통신비, 구독료" autocomplete="off"></div>
    ${amountField('매달 나가는 금액','amt')}
    <div class="foot"><button class="btn line" data-close>취소</button><button class="btn primary" id="submit">추가</button></div>`,
    root => {
      const amt = wireAmount(root, 'amt');
      setTimeout(() => root.querySelector('#fname').focus(), 60);
      root.querySelector('#submit').addEventListener('click', () => {
        const name = root.querySelector('#fname').value.trim(), v = digits(amt.value);
        if(!name || !v) return toast('항목과 금액을 입력해 주세요');
        S.budget.fixed.push({ id: uid(), name, amount: v }); save(); closeModal(); render(); toast('고정비를 추가했습니다');
      });
    });
}
function modalGoal(g){
  const d = new Date(); d.setMonth(d.getMonth()+12);
  const defDue = g?.due || monthKey(d);
  openModal(g ? '목표 수정' : '목돈 목표', `
    <div class="field"><label for="gname">목표 이름</label><input id="gname" type="text" placeholder="비상금, 이사 자금, 전세 보증금" value="${esc(g?.name || '')}" autocomplete="off"></div>
    ${amountField('목표 금액','amt')}
    <div class="field row2">
      <div><label for="gdue">언제까지</label><input id="gdue" type="month" value="${defDue}"></div>
      <div><label for="gseed">이미 모아둔 금액</label><input id="gseed" class="num" type="text" inputmode="numeric" placeholder="0" value="${g?.seed ? won(g.seed) : ''}" autocomplete="off"></div>
    </div>
    <div class="foot">
      ${g ? `<button class="btn danger" id="gdel">삭제</button>` : `<button class="btn line" data-close>취소</button>`}
      <button class="btn primary" id="submit">${g ? '저장' : '만들기'}</button>
    </div>`, root => {
    const amt = wireAmount(root, 'amt', g?.target);
    setTimeout(() => root.querySelector('#gname').focus(), 60);
    const seed = root.querySelector('#gseed');
    seed.addEventListener('input', () => { const n = digits(seed.value); seed.value = n ? won(n) : ''; });
    root.querySelector('#submit').addEventListener('click', () => {
      const target = digits(amt.value);
      if(!target) return toast('목표 금액을 입력해 주세요');
      const data = { name: root.querySelector('#gname').value.trim() || '목돈 목표', target,
        due: root.querySelector('#gdue').value, seed: digits(seed.value) };
      if(g) Object.assign(g, data); else S.goals.push(Object.assign({ id: uid() }, data));
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
  openModal(`${g.name} 저축`, `${amountField('저축할 금액','amt')}
    <div class="field"><div class="hint">목표까지 ${won(rest)}원 남았습니다.</div></div>
    <div class="field"><label for="date">날짜</label><input id="date" type="date" value="${today()}"></div>
    <div class="foot"><button class="btn line" data-close>취소</button><button class="btn primary" id="submit">기록</button></div>`,
    root => {
      const amt = wireAmount(root, 'amt');
      root.querySelector('#submit').addEventListener('click', () => {
        const v = digits(amt.value); if(!v) return toast('금액을 입력해 주세요');
        S.txns.push({ id: uid(), date: root.querySelector('#date').value || today(), amount: v, type:'save', cat:'save', memo:'', goalId: gid });
        save(); closeModal(); render(); toast(`${won(v)}원 저축했습니다`);
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
  const t = e.target.closest('[data-tab],[data-tab-go],[data-act],[data-del],[data-edit],[data-goal-save],[data-goal-edit],[data-fixed-del],[data-ftype],[data-rank],[data-months]');
  if(!t) return;
  if(t.dataset.tab){ tab = t.dataset.tab; return render(); }
  if(t.dataset.tabGo){ tab = t.dataset.tabGo; return render(); }
  if(t.dataset.ftype){ filt.type = t.dataset.ftype; filt.limit = 60; return render(); }
  if(t.dataset.rank){ rankMode = t.dataset.rank; return render(); }
  if(t.dataset.months){ statMonths = Number(t.dataset.months); return render(); }
  if(t.dataset.edit) return modalTx(S.txns.find(x => x.id === t.dataset.edit));
  if(t.dataset.goalSave) return modalDeposit(t.dataset.goalSave);
  if(t.dataset.goalEdit) return modalGoal(S.goals.find(g => g.id === t.dataset.goalEdit));
  if(t.dataset.fixedDel){ S.budget.fixed = S.budget.fixed.filter(x => x.id !== t.dataset.fixedDel); save(); return render(); }
  if(t.dataset.del){
    const tx = S.txns.find(x => x.id === t.dataset.del);
    if(tx && confirm(`${won(tx.amount)}원 기록을 삭제할까요?`)){ S.txns = S.txns.filter(x => x.id !== tx.id); save(); render(); }
    return;
  }
  switch(t.dataset.act){
    case 'new': return modalTx(null);
    case 'budget': return modalBudget();
    case 'start-bal': return modalStartBalance();
    case 'fixed-new': return modalFixed();
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
  const map = { '1':'dash','2':'txns','3':'stats','4':'goals','5':'settings' };
  if(map[e.key]){ tab = map[e.key]; render(); }
});

render();
if('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(()=>{}));
