/* eslint-disable */
// 신산 재무 허브(hub.eumlogics.kr/shinsan)의 원본 렌더 로직을 그대로 이식.
// 데이터 소스만 localStorage → Supabase(/api/finance/all)로 교체.
// 원본: dashboard/public/{pages.js, financial.js, data.js} — 수치 일치를 위해 로직 변경 없음.

let _S = null;
const db = () => _S;
function fmt(n) { if (n === null || n === undefined || isNaN(n)) return '0'; return Math.round(n).toLocaleString('ko-KR'); }
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function tm() { return new Date().toISOString().slice(0,7); }
function getAllMonths() {
  const s = db(); const ms = new Set();
  s.sales.forEach(x => { if(x.date) ms.add(x.date.slice(0,7)); });
  s.purchases.forEach(x => { if(x.date) ms.add(x.date.slice(0,7)); });
  s.bankIn.forEach(x => { if(x.date) ms.add(x.date.slice(0,7)); });
  s.bankOut.forEach(x => { if(x.date) ms.add(x.date.slice(0,7)); });
  s.cardTx.forEach(x => { if(x.date) ms.add(x.date.slice(0,7)); });
  return [...ms].sort();
}
function getMonthlyData(month) {
  const s = db();
  const salesAmt = s.sales.filter(x => x.date?.startsWith(month)).reduce((t,x) => t + (x.amount||0), 0);
  const salesSupply = s.sales.filter(x => x.date?.startsWith(month)).reduce((t,x) => t + (x.supply||0), 0);
  const salesTax = s.sales.filter(x => x.date?.startsWith(month)).reduce((t,x) => t + (x.tax||0), 0);
  const purchAmt = s.purchases.filter(x => x.date?.startsWith(month)).reduce((t,x) => t + (x.amount||0), 0);
  const purchSupply = s.purchases.filter(x => x.date?.startsWith(month)).reduce((t,x) => t + (x.supply||0), 0);
  const purchTax = s.purchases.filter(x => x.date?.startsWith(month)).reduce((t,x) => t + (x.tax||0), 0);
  const cardAmt = s.cardTx.filter(x => x.date?.startsWith(month)).reduce((t,x) => t + (x.amount||0), 0);
  const bIn = s.bankIn.filter(x => x.date?.startsWith(month)).reduce((t,x) => t + (x.amount||0), 0);
  const bOut = s.bankOut.filter(x => x.date?.startsWith(month)).reduce((t,x) => t + (x.amount||0), 0);
  const profit = salesSupply - purchSupply - cardAmt;
  return { salesAmt, salesSupply, salesTax, purchAmt, purchSupply, purchTax, cardAmt, bankIn: bIn, bankOut: bOut, profit };
}
// 홈택스 발행 이력은 신산 Supabase에 없음 → 발행상태는 미연동(빈 맵). 발행 액션은 안내로 대체.
const ShinsanIssue = { clearSelected(){}, buildIssuedMap(){ return {}; } };

const PAGES = {};

// ─────────────────────────────────────────── 재무 대시보드
PAGES['dashboard'] = function() {
  const s = db();
  const CY = '2026'; const PY = '2025';
  const salesCY = s.sales.filter(x => x.date?.startsWith(CY));
  const purchCY = s.purchases.filter(x => x.date?.startsWith(CY));
  const cardCY = s.cardTx.filter(x => x.date?.startsWith(CY));
  const bankInCY = s.bankIn.filter(x => x.date?.startsWith(CY));
  const bankOutCY = s.bankOut.filter(x => x.date?.startsWith(CY));
  const salesPY = s.sales.filter(x => x.date?.startsWith(PY));
  const purchPY = s.purchases.filter(x => x.date?.startsWith(PY));
  const cardPY = s.cardTx.filter(x => x.date?.startsWith(PY));
  const bankInPY = s.bankIn.filter(x => x.date?.startsWith(PY));
  const bankOutPY = s.bankOut.filter(x => x.date?.startsWith(PY));
  const totalSales = salesCY.reduce((t,x) => t + (x.amount || 0), 0);
  const totalPurch = purchCY.reduce((t,x) => t + (x.amount || 0), 0);
  const totalCard = cardCY.reduce((t,x) => t + (x.amount || 0), 0);
  const totalProfit = salesCY.reduce((t,x) => t + (x.supply || 0), 0) - purchCY.reduce((t,x) => t + (x.supply || 0), 0) - totalCard;
  const totalBankBal = bankInCY.reduce((t,x) => t + (x.amount || 0), 0) - bankOutCY.reduce((t,x) => t + (x.amount || 0), 0);
  const totalSalesPY = salesPY.reduce((t,x) => t + (x.amount || 0), 0);
  const totalPurchPY = purchPY.reduce((t,x) => t + (x.amount || 0), 0);
  const totalCardPY = cardPY.reduce((t,x) => t + (x.amount || 0), 0);
  const totalProfitPY = salesPY.reduce((t,x) => t + (x.supply || 0), 0) - purchPY.reduce((t,x) => t + (x.supply || 0), 0) - totalCardPY;
  const totalBankBalPY = bankInPY.reduce((t,x) => t + (x.amount || 0), 0) - bankOutPY.reduce((t,x) => t + (x.amount || 0), 0);
  function getLatestBalance(year) {
    const all = [...s.bankIn, ...s.bankOut].filter(x => x.date?.startsWith(year) && x.balance);
    if (!all.length) return null;
    all.sort((a,b) => (b.date||'').localeCompare(a.date||''));
    return { date: all[0].date, balance: all[0].balance };
  }
  const actualBalCY = getLatestBalance(CY);
  const actualBalPY = getLatestBalance(PY);
  const months = [];
  for (let m = 1; m <= 12; m++) months.push(CY + '-' + String(m).padStart(2,'0'));
  const recent12 = months;
  const monthlyData = {};
  salesCY.forEach(x => { const m = x.date?.slice(0,7); if(m) { if(!monthlyData[m]) monthlyData[m]={s:0,p:0,c:0}; monthlyData[m].s += (x.supply||0); }});
  purchCY.forEach(x => { const m = x.date?.slice(0,7); if(m) { if(!monthlyData[m]) monthlyData[m]={s:0,p:0,c:0}; monthlyData[m].p += (x.supply||0); }});
  cardCY.forEach(x => { const m = x.date?.slice(0,7); if(m) { if(!monthlyData[m]) monthlyData[m]={s:0,p:0,c:0}; monthlyData[m].c += (x.amount||0); }});
  const trendMonths = recent12.filter(m => monthlyData[m]);
  const maxTrend = Math.max(...trendMonths.map(m => { const d=monthlyData[m]; return Math.max(d.s, d.p+d.c, Math.abs(d.s-d.p-d.c)); }), 1);
  const trendBars = trendMonths.map(m => {
    const d = monthlyData[m]; const profit = d.s - d.p - d.c;
    const pH = Math.max(2, Math.round(Math.abs(profit) / maxTrend * 80));
    const color = profit >= 0 ? 'var(--success)' : 'var(--danger)';
    return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px"><div style="font-size:10px;font-weight:700;color:${color}">${fmt(profit)}</div><div style="width:100%;max-width:30px;height:${pH}px;background:${color};border-radius:3px 3px 0 0;opacity:0.7"></div><div style="font-size:9px;color:var(--gray-400);transform:rotate(-45deg);white-space:nowrap">${m.slice(2)}</div></div>`;
  }).join('');
  const monthBars = trendMonths.map(m => {
    const d = monthlyData[m];
    const maxAmt = Math.max(...trendMonths.map(mm => { const dd=monthlyData[mm]; return Math.max(dd.s, dd.p); }), 1);
    const sW = Math.round(d.s / maxAmt * 100); const pW = Math.round(d.p / maxAmt * 100);
    return `<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px"><span style="font-weight:700;color:var(--gray-700)">${m}</span><span style="color:var(--gray-400)">매출 ${fmt(d.s)} / 매입 ${fmt(d.p)}</span></div><div style="display:flex;gap:2px;height:12px"><div style="width:${sW}%;background:var(--primary);border-radius:3px;min-width:${sW>0?'2px':'0'}"></div><div style="width:${pW}%;background:var(--danger);opacity:0.4;border-radius:3px;min-width:${pW>0?'2px':'0'}"></div></div></div>`;
  }).join('');
  const salesByPartner = {};
  salesCY.forEach(x => { const p = x.partner || '미분류'; salesByPartner[p] = (salesByPartner[p]||0) + (x.amount||0); });
  const salesTop = Object.entries(salesByPartner).sort((a,b) => b[1]-a[1]).slice(0,5);
  const purchByPartner = {};
  purchCY.forEach(x => { const p = x.partner || '미분류'; purchByPartner[p] = (purchByPartner[p]||0) + (x.amount||0); });
  const purchTop = Object.entries(purchByPartner).sort((a,b) => b[1]-a[1]).slice(0,5);
  const cardByCategory = {};
  cardCY.forEach(x => { const c = x.category || '기타'; cardByCategory[c] = (cardByCategory[c]||0) + (x.amount||0); });
  const cardCats = Object.entries(cardByCategory).sort((a,b) => b[1]-a[1]);
  return `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
    <div style="font-size:18px;font-weight:700">${CY} 핵심 지표</div>
  </div>
  <div class="stat-grid">
    <div class="stat-card"><div class="stat-label">${CY} 매출</div><div class="stat-value" style="color:var(--primary)">${fmt(totalSales)}</div><div class="stat-sub">${salesCY.length}건</div></div>
    <div class="stat-card"><div class="stat-label">${CY} 매입</div><div class="stat-value" style="color:var(--danger)">${fmt(totalPurch)}</div><div class="stat-sub">${purchCY.length}건</div></div>
    <div class="stat-card"><div class="stat-label">${CY} 순손익</div><div class="stat-value" style="color:${totalProfit>=0?'var(--success)':'var(--danger)'}"> ${fmt(totalProfit)}</div><div class="stat-sub">매출-매입-카드경비</div></div>
    <div class="stat-card"><div class="stat-label">${CY} 예금잔액 ${actualBalCY ? '('+actualBalCY.date+')' : ''}</div><div class="stat-value" style="color:${(actualBalCY?.balance ?? 0)>=0?'var(--primary)':'var(--danger)'}">${actualBalCY ? fmt(actualBalCY.balance) : '-'}</div><div class="stat-sub">당기 현금흐름 ${fmt(totalBankBal)}</div></div>
  </div>
  <div style="display:flex;align-items:center;justify-content:space-between;margin:32px 0 20px">
    <div style="font-size:18px;font-weight:700">${PY} 결산 (확정)</div>
    <span style="font-size:12px;color:var(--text-sub)">세무대리인 결산자료 + 홈택스 기준</span>
  </div>
  <div class="stat-grid">
    <div class="stat-card"><div class="stat-label">${PY} 매출</div><div class="stat-value" style="color:var(--primary)">${fmt(totalSalesPY)}</div><div class="stat-sub">${salesPY.length}건</div></div>
    <div class="stat-card"><div class="stat-label">${PY} 매입</div><div class="stat-value" style="color:var(--danger)">${fmt(totalPurchPY)}</div><div class="stat-sub">${purchPY.length}건</div></div>
    <div class="stat-card"><div class="stat-label">${PY} 순손익</div><div class="stat-value" style="color:${totalProfitPY>=0?'var(--success)':'var(--danger)'}"> ${fmt(totalProfitPY)}</div><div class="stat-sub">매출-매입-카드경비</div></div>
    <div class="stat-card"><div class="stat-label">${PY} 연말 예금잔액</div><div class="stat-value" style="color:${(actualBalPY?.balance ?? 0)>=0?'var(--primary)':'var(--danger)'}">${actualBalPY ? fmt(actualBalPY.balance) : '-'}</div><div class="stat-sub">${actualBalPY ? actualBalPY.date + ' 기준' : ''}</div></div>
  </div>
  <div style="margin:32px 0 12px;font-size:15px;font-weight:700;color:var(--text-sub)">${CY} 상세 분석</div>
  <div class="dash-grid">
    <div class="card"><div class="card-title">월별 매출/매입 비교</div><div style="font-size:11px;color:var(--gray-400);margin-bottom:8px">파란색: 매출 / 빨간색: 매입</div>${monthBars || '<div class="empty-state">데이터 없음</div>'}</div>
    <div class="card"><div class="card-title">월별 손익 추이</div><div style="display:flex;align-items:flex-end;gap:2px;min-height:120px;padding-top:10px">${trendBars || '<div class="empty-state">데이터 없음</div>'}</div></div>
  </div>
  <div class="dash-grid">
    <div class="card"><div class="card-title" style="color:var(--primary)">매출 거래처 TOP 5</div>${salesTop.map(([name,amt]) => `<div class="dash-row"><span>${name}</span><span style="color:var(--primary);font-weight:700">${fmt(amt)}</span></div>`).join('') || '<div class="empty-state">데이터 없음</div>'}</div>
    <div class="card"><div class="card-title" style="color:var(--danger)">매입 거래처 TOP 5</div>${purchTop.map(([name,amt]) => `<div class="dash-row"><span>${name}</span><span style="color:var(--danger);font-weight:700">${fmt(amt)}</span></div>`).join('') || '<div class="empty-state">데이터 없음</div>'}</div>
  </div>
  <div class="dash-grid">
    <div class="card"><div class="card-title">${CY} 카드 비용</div>${cardCats.map(([cat,amt]) => `<div class="dash-row"><span>${cat}</span><span style="font-weight:700">${fmt(amt)}</span></div>`).join('') || '<div class="empty-state">카드내역 없음</div>'}<div style="margin-top:8px;padding-top:8px;border-top:2px solid var(--gray-200);display:flex;justify-content:space-between;font-weight:800"><span>카드 합계</span><span>${fmt(totalCard)}</span></div></div>
    <div class="card"><div class="card-title">${CY} 자금 현황</div><div class="dash-row"><span>총 입금</span><span style="color:var(--success);font-weight:700">${fmt(bankInCY.reduce((t,x)=>t+(x.amount||0),0))}</span></div><div class="dash-row"><span>총 출금</span><span style="color:var(--danger);font-weight:700">${fmt(bankOutCY.reduce((t,x)=>t+(x.amount||0),0))}</span></div><div style="margin-top:8px;padding-top:8px;border-top:2px solid var(--gray-200);display:flex;justify-content:space-between;font-weight:800"><span>잔액</span><span style="color:var(--primary)">${fmt(totalBankBal)}</span></div></div>
  </div>`;
};

// ─────────────────────────────────────────── 매출관리
PAGES['sales_invoice'] = function() {
  ShinsanIssue.clearSelected();
  const s = db();
  const sales = s.sales || [];
  const bankIn = s.bankIn || [];
  const _salesMonthSet = new Set(sales.map(x => x.date?.slice(0,7)).filter(Boolean));
  const _salesY = new Date().getFullYear();
  for (let _m = 1; _m <= 12; _m++) _salesMonthSet.add(_salesY + "-" + String(_m).padStart(2,"0"));
  const months = [..._salesMonthSet].sort().reverse();
  const _salesDataMonths = sales.map(x => x.date?.slice(0,7)).filter(Boolean).sort();
  const _latestDataMonth = _salesDataMonths.length ? _salesDataMonths[_salesDataMonths.length-1] : null;
  const curMonth = window._salesInvMonth || _latestDataMonth || tm();
  const filtered = sales.filter(x => x.date?.startsWith(curMonth));
  const issuedMap = ShinsanIssue.buildIssuedMap();
  const _norm = (v) => String(v||'').replace(/\s+/g,'').toLowerCase();
  filtered.forEach(x => { if (!x.ntsConfirmNum) { const k = `${x.date||''}|${_norm(x.partner)}|${x.supply||0}`; if (issuedMap[k]) x.ntsConfirmNum = issuedMap[k]; } });
  const [cy, cm] = curMonth.split('-').map(Number);
  const rangeStart = new Date(cy, cm-4, 1).toISOString().slice(0,10);
  const rangeEnd = new Date(cy, cm+3, 0).toISOString().slice(0,10);
  const bankPool = bankIn.filter(x => x.date && x.date >= rangeStart && x.date <= rangeEnd).map(x => ({...x}));
  const normalize = (str) => (str||'').replace(/\s/g,'').replace(/\(주\)|㈜|주식회사/g,'').toLowerCase();
  function coreTokens(name) { const norm = normalize(name); if (!norm) return []; return norm.split(/[\(\)\[\]\{\}\,\/\.-]/).filter(p => p.length >= 2); }
  function nameMatch(saleName, txText) { const saleTokens = coreTokens(saleName); const txNorm = normalize(txText); if (!saleTokens.length || !txNorm) return false; return saleTokens.some(tok => txNorm.includes(tok)); }
  function matchDeposit(sale) {
    if (sale.type === '현영') return { _pseudo: true, method: '현금/PG' };
    const saleName = sale.partner || ''; if (!saleName) return null;
    const saleAmount = sale.amount || 0;
    for (const tx of bankPool) { if (tx._matched) continue; const txText = (tx.partner||'') + ' ' + (tx.desc||''); if (nameMatch(saleName, txText) && Math.abs(tx.amount - saleAmount) < 100) { tx._matched = true; return tx; } }
    for (const tx of bankPool) { if (tx._matched) continue; if (Math.abs(tx.amount - saleAmount) < 100) { tx._matched = true; return tx; } }
    for (const tx of bankPool) { const txText = (tx.partner||'') + ' ' + (tx.desc||''); if (nameMatch(saleName, txText)) { return { _partial: true, date: tx.date, amount: tx.amount, partner: tx.partner }; } }
    return null;
  }
  let matchedCount = 0, cashCount = 0, partialCount = 0, unmatchedCount = 0, totalAmount = 0, totalSupply = 0, totalTax = 0;
  const rowData = filtered.sort((a,b) => (a.date||'').localeCompare(b.date||'')).map((x, idx) => {
    const m = matchDeposit(x); let matchStatus;
    if (!m) matchStatus = 'unmatched'; else if (m._pseudo) matchStatus = 'cash'; else if (m._partial) matchStatus = 'partial'; else matchStatus = 'matched';
    if (matchStatus === 'matched') matchedCount++; else if (matchStatus === 'cash') cashCount++; else if (matchStatus === 'partial') partialCount++; else unmatchedCount++;
    totalAmount += (x.amount || 0); totalSupply += (x.supply || 0); totalTax += (x.tax || 0);
    return { ...x, matchStatus, _match: m, seqNo: 'INV-' + curMonth.replace('-','') + '-' + String(idx+1).padStart(3,'0') };
  });
  function typeLabel(t) { if (t === '세계') return '세금계산서'; if (t === '계') return '계산서'; if (t === '현영') return '현금영수증'; return t || ''; }
  function statusBadge(status) { if (status === 'matched') return '<span class="badge badge-green">입금완료</span>'; if (status === 'cash') return '<span class="badge badge-blue">현금/PG결제</span>'; if (status === 'partial') return '<span class="badge badge-yellow">입금 확인 필요</span>'; return '<span class="badge badge-red">미입금</span>'; }
  const rows = rowData.map(x => '<tr>' +
    '<td style="color:var(--text-sub);font-size:11px;font-family:monospace">' + x.seqNo + '</td>' +
    '<td>' + (x.date||'') + '</td>' +
    '<td style="font-weight:600">' + esc(x.partner||'') + '</td>' +
    '<td style="font-size:12px;color:var(--text-sub)">' + typeLabel(x.type) + (x.desc ? ' — ' + esc(x.desc) : '') + '</td>' +
    '<td class="right">' + fmt(x.supply||0) + '</td>' +
    '<td class="right" style="color:var(--text-sub)">' + fmt(x.tax||0) + '</td>' +
    '<td class="right bold">' + fmt(x.amount||0) + '</td>' +
    '<td class="center">' + statusBadge(x.matchStatus) + '</td>' +
    '</tr>').join('');
  const byPartner = {};
  rowData.forEach(x => {
    const p = x.partner || '(미지정)';
    if (!byPartner[p]) byPartner[p] = {sales:0, count:0, deposited:0};
    byPartner[p].count++; byPartner[p].sales += (x.amount||0);
    if (x.matchStatus === 'matched' || x.matchStatus === 'cash') { byPartner[p].deposited += (x.amount||0); }
    else if (x.matchStatus === 'partial' && x._match) { byPartner[p].deposited += Math.min(x._match.amount||0, x.amount||0); }
  });
  const partnerList = Object.entries(byPartner).sort((a,b) => b[1].sales - a[1].sales);
  const totalDeposited = partnerList.reduce((t,[,v]) => t + v.deposited, 0);
  const partnerRows = partnerList.map(([name,v]) => { const bal=v.sales-v.deposited; const bw=v.sales>0?Math.round(v.deposited/v.sales*100):0; return '<tr><td style="font-weight:600">'+esc(name)+'</td><td style="text-align:right">'+v.count+'건</td><td style="text-align:right">'+fmt(v.sales)+'</td><td style="text-align:right;color:var(--green)">'+fmt(v.deposited)+'</td><td style="text-align:right;font-weight:700;color:'+(bal>0?'var(--red)':'var(--green)')+'">'+fmt(bal)+'</td><td style="width:120px"><div style="background:var(--gray-200);border-radius:4px;height:8px;overflow:hidden"><div style="width:'+Math.min(bw,100)+'%;height:100%;background:'+(bw>=100?'var(--green)':'var(--orange)')+';border-radius:4px"></div></div></td></tr>'; }).join('');
  return `
  <div class="fin-note">⚠️ 홈택스 <b>세금계산서 발행</b> 기능은 신산 자체 홈택스 연동이 준비되면 추가됩니다. 현재는 매출 현황 + 은행 입금매칭 조회만 제공합니다.</div>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
    <div style="display:flex;align-items:center;gap:8px">
      <select class="form-input" style="width:130px" onchange="window._salesInvMonth=this.value;navigate('sales_invoice')">${months.slice(0,24).map(m=>'<option value="'+m+'"'+(m===curMonth?' selected':'')+'>'+m+'</option>').join('')}</select>
      <span style="font-size:12px;color:var(--text-sub)">매출 현황 + 입금매칭</span>
    </div>
  </div>
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-icon blue"></div><div class="kpi-label">총 명세서 (${+curMonth.slice(5)}월)</div><div class="kpi-value">${filtered.length}</div><div class="kpi-sub">${fmt(totalAmount)}원</div></div>
    <div class="kpi-card"><div class="kpi-icon green"></div><div class="kpi-label">공급가 합계</div><div class="kpi-value" style="font-size:20px">${fmt(totalSupply)}</div><div class="kpi-sub">부가세 ${fmt(totalTax)}</div></div>
    <div class="kpi-card"><div class="kpi-icon green"></div><div class="kpi-label">입금완료</div><div class="kpi-value" style="color:var(--green)">${matchedCount + cashCount}</div><div class="kpi-sub">은행매칭 ${matchedCount} + 현금/PG ${cashCount}${partialCount ? ` · 확인필요 ${partialCount}` : ''}</div></div>
    <div class="kpi-card"><div class="kpi-icon red"></div><div class="kpi-label">미입금</div><div class="kpi-value" style="color:var(--red)">${unmatchedCount}</div><div class="kpi-sub">세금계산서/계산서 매출</div></div>
  </div>
  <div class="tab-group">
    <div class="tab-item active" onclick="this.parentElement.querySelectorAll('.tab-item').forEach(t=>t.classList.remove('active'));this.classList.add('active');document.getElementById('sales-list').style.display='';document.getElementById('sales-partner').style.display='none'">매출 목록</div>
    <div class="tab-item" onclick="this.parentElement.querySelectorAll('.tab-item').forEach(t=>t.classList.remove('active'));this.classList.add('active');document.getElementById('sales-list').style.display='none';document.getElementById('sales-partner').style.display=''">거래처별 매출/수금</div>
  </div>
  <div id="sales-list">
    <div class="panel">
      <div class="panel-header"><span>매출 목록</span><div class="filter-group"><input class="search-input" placeholder="거래처/품목 검색..." style="width:200px" onkeyup="document.querySelectorAll('#salesTbl tbody tr').forEach(r=>{r.style.display=r.textContent.toLowerCase().includes(this.value.toLowerCase())?'':'none'})"></div></div>
      <div class="panel-body" style="overflow-x:auto;padding:0">
        <table id="salesTbl"><thead><tr><th>명세서번호</th><th>일자</th><th>거래처</th><th>적요</th><th class="right">공급가액</th><th class="right">부가세</th><th class="right">합계</th><th class="center">입금상태</th></tr></thead>
        <tbody>${rows||'<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-sub)">데이터 없음</td></tr>'}</tbody></table>
      </div>
    </div>
  </div>
  <div id="sales-partner" style="display:none">
    <div class="panel">
      <div class="panel-header"><span>거래처별 매출/수금 현황 (${curMonth})</span></div>
      <div class="panel-body" style="overflow-x:auto;padding:0">
        <table><thead><tr><th>거래처</th><th class="right">건수</th><th class="right">매출액</th><th class="right">입금액</th><th class="right">미수잔액</th><th>수금율</th></tr></thead>
        <tbody>${partnerRows}<tr style="font-weight:700;background:var(--gray-50);border-top:2px solid var(--border)"><td>합계</td><td class="right">${filtered.length}건</td><td class="right">${fmt(totalAmount)}</td><td class="right" style="color:var(--green)">${fmt(totalDeposited)}</td><td class="right" style="color:var(--red)">${fmt(totalAmount-totalDeposited)}</td><td></td></tr></tbody></table>
      </div>
    </div>
  </div>`;
};

// ─────────────────────────────────────────── 매입/원가
PAGES['purchase_invoice'] = function() {
  const s = db();
  const purchases = s.purchases || [];
  const cardTx = s.cardTx || [];
  const bankOut = s.bankOut || [];
  const _purchMonthSet = new Set(purchases.map(x => x.date?.slice(0,7)).filter(Boolean));
  const _purchY = new Date().getFullYear();
  for (let _m = 1; _m <= 12; _m++) _purchMonthSet.add(_purchY + "-" + String(_m).padStart(2,"0"));
  const months = [..._purchMonthSet].sort().reverse();
  const _purchDataMonths = purchases.map(x => x.date?.slice(0,7)).filter(Boolean).sort();
  const _latestPurchMonth = _purchDataMonths.length ? _purchDataMonths[_purchDataMonths.length-1] : null;
  const curMonth = window._purchInvMonth || _latestPurchMonth || tm();
  const filtered = purchases.filter(x => x.date?.startsWith(curMonth));
  const filteredCard = cardTx.filter(x => x.date?.startsWith(curMonth));
  const [pcy, pcm] = curMonth.split('-').map(Number);
  const pRangeStart = new Date(pcy, pcm-4, 1).toISOString().slice(0,10);
  const pRangeEnd = new Date(pcy, pcm+3, 0).toISOString().slice(0,10);
  const bankPool = bankOut.filter(x => x.date && x.date >= pRangeStart && x.date <= pRangeEnd).map(x => ({...x}));
  const normP = (str) => (str||'').replace(/\s/g,'').replace(/\(주\)|㈜|주식회사/g,'').toLowerCase();
  const coreTokensP = (name) => { const n = normP(name); if (!n) return []; return n.split(/[\(\)\[\]\{\}\,\/\.-]/).filter(p => p.length >= 2); };
  const nameMatchP = (purchName, txText) => { const toks = coreTokensP(purchName); const txN = normP(txText); return toks.length && txN && toks.some(t => txN.includes(t)); };
  function matchPayment(purch) {
    if (purch.type === '현영') return { _pseudo: true, method: '현금결제' };
    if (!purch.partner) return null;
    for (const tx of bankPool) { if (tx._matched) continue; const txText = (tx.partner||'')+' '+(tx.desc||''); if (nameMatchP(purch.partner, txText) && Math.abs(tx.amount - purch.amount) < 100) { tx._matched = true; return tx; } }
    for (const tx of bankPool) { if (tx._matched) continue; if (Math.abs(tx.amount - purch.amount) < 100) { tx._matched = true; return tx; } }
    for (const tx of bankPool) { const txText = (tx.partner||'')+' '+(tx.desc||''); if (nameMatchP(purch.partner, txText)) { return { _partial: true, date: tx.date, amount: tx.amount }; } }
    return null;
  }
  let matchedCount = 0, cashPCount = 0, partialPCount = 0, unmatchedCount = 0, totalAmount = 0;
  const byPartner = {};
  const purchResults = filtered.sort((a,b) => (b.date||'').localeCompare(a.date||'')).map(x => ({...x, _match: matchPayment(x)}));
  purchResults.forEach(x => {
    const p = x.partner||'(미지정)'; if(!byPartner[p]) byPartner[p]={count:0,amount:0,paid:0};
    byPartner[p].count++; byPartner[p].amount += (x.amount||0);
    if (x._match && !x._match._partial) { byPartner[p].paid += (x.amount||0); }
    else if (x._match && x._match._partial) { byPartner[p].paid += Math.min(x._match.amount||0, x.amount||0); }
  });
  filteredCard.forEach(x => { const p = x.partner||x.category||'(카드)'; if(!byPartner[p]) byPartner[p]={count:0,amount:0,paid:0}; byPartner[p].count++; byPartner[p].amount += (x.amount||0); byPartner[p].paid += (x.amount||0); });
  const typeLabelP = (t) => t==='세계'?'세금계산서':t==='계'?'계산서':t==='현영'?'현금영수증':(t||'');
  const statusBadgeP = (m) => !m ? '<span class="badge badge-red">미지급</span>' : m._pseudo ? '<span class="badge badge-blue">현금결제</span>' : m._partial ? '<span class="badge badge-yellow">지급 확인 필요</span>' : '<span class="badge badge-green">지급완료</span>';
  const detailRows = purchResults.map(x => {
    const m = x._match;
    if (!m) unmatchedCount++; else if (m._pseudo) cashPCount++; else if (m._partial) partialPCount++; else matchedCount++;
    totalAmount += (x.amount || 0);
    return '<tr><td>'+(x.date||'')+'</td><td style="font-weight:600">'+esc(x.partner||'')+'</td><td style="font-size:12px;color:var(--text-sub)">'+typeLabelP(x.type)+(x.desc?' — '+esc(x.desc):'')+'</td><td class="right">'+fmt(x.supply||0)+'</td><td class="right" style="color:var(--text-sub)">'+fmt(x.tax||0)+'</td><td class="right bold">'+fmt(x.amount||0)+'</td><td class="center">'+statusBadgeP(m)+'</td><td class="center"><span class="badge '+(x.type==='세계'?'blue':x.type==='계'?'yellow':'gray')+'">'+typeLabelP(x.type)+'</span></td></tr>';
  }).join('');
  const allPartners = Object.entries(byPartner).sort((a,b) => b[1].amount - a[1].amount);
  const totalPurchAmt = allPartners.reduce((t,[,v]) => t + v.amount, 0);
  const totalPaid = allPartners.reduce((t,[,v]) => t + v.paid, 0);
  const partnerPayRows = allPartners.map(([name,v]) => { const bal=v.amount-v.paid; const bw=v.amount>0?Math.round(v.paid/v.amount*100):0; return '<tr><td style="font-weight:600">'+esc(name)+'</td><td style="text-align:right">'+v.count+'건</td><td style="text-align:right">'+fmt(v.amount)+'</td><td style="text-align:right;color:var(--green)">'+fmt(v.paid)+'</td><td style="text-align:right;font-weight:700;color:'+(bal>0?'var(--red)':'var(--green)')+'">'+fmt(bal)+'</td><td style="width:120px"><div style="background:var(--gray-200);border-radius:4px;height:8px;overflow:hidden"><div style="width:'+Math.min(bw,100)+'%;height:100%;background:'+(bw>=100?'var(--green)':'var(--orange)')+';border-radius:4px"></div></div></td></tr>'; }).join('');
  const cardDetailRows = filteredCard.sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(c => '<tr><td>' + (c.date||'') + '</td><td style="font-weight:600">' + esc(c.partner || '(가맹점미상)') + '</td><td style="font-size:12px;color:var(--text-sub)">' + esc(c.category || c.desc || '') + '</td><td class="right bold">' + fmt(c.amount||0) + '</td><td class="center"><span class="badge" style="background:#f5f3ff;color:#7c3aed">법인카드</span></td></tr>').join('');
  const evidenceCount = { '세계': 0, '계': 0, '현영': 0, '기타': 0 };
  filtered.forEach(x => { if (x.type === '세계') evidenceCount['세계']++; else if (x.type === '계') evidenceCount['계']++; else if (x.type === '현영') evidenceCount['현영']++; else evidenceCount['기타']++; });
  return `
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
    <div style="display:flex;align-items:center;gap:8px">
      <select class="form-input" style="width:130px" onchange="window._purchInvMonth=this.value;navigate('purchase_invoice')">${months.slice(0,24).map(m=>'<option value="'+m+'"'+(m===curMonth?' selected':'')+'>'+m+'</option>').join('')}</select>
      <span style="font-size:12px;color:var(--text-sub)">매입은 거래처 발행 세금계산서/계산서 + 법인카드 자료 기준</span>
    </div>
  </div>
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-icon blue"></div><div class="kpi-label">총 매입 (${+curMonth.slice(5)}월)</div><div class="kpi-value">${filtered.length+filteredCard.length}</div><div class="kpi-sub">세계 ${evidenceCount['세계']} · 계 ${evidenceCount['계']} · 카드 ${filteredCard.length}</div></div>
    <div class="kpi-card"><div class="kpi-icon green"></div><div class="kpi-label">지급완료</div><div class="kpi-value" style="color:var(--green)">${matchedCount + cashPCount}</div><div class="kpi-sub">은행매칭 ${matchedCount} + 카드 ${cashPCount}${partialPCount ? ` · 확인필요 ${partialPCount}` : ''}</div></div>
    <div class="kpi-card"><div class="kpi-icon red"></div><div class="kpi-label">미지급</div><div class="kpi-value" style="color:var(--red)">${unmatchedCount}</div><div class="kpi-sub">세금계산서/계산서 매입</div></div>
    <div class="kpi-card"><div class="kpi-icon orange"></div><div class="kpi-label">총 거래액</div><div class="kpi-value" style="font-size:22px">${fmt(totalAmount)}</div></div>
  </div>
  <div class="tab-group">
    <div class="tab-item active" onclick="this.parentElement.querySelectorAll('.tab-item').forEach(t=>t.classList.remove('active'));this.classList.add('active');document.getElementById('purch-list').style.display='';document.getElementById('purch-card').style.display='none';document.getElementById('purch-partner').style.display='none'">매입 목록</div>
    <div class="tab-item" onclick="this.parentElement.querySelectorAll('.tab-item').forEach(t=>t.classList.remove('active'));this.classList.add('active');document.getElementById('purch-list').style.display='none';document.getElementById('purch-card').style.display='';document.getElementById('purch-partner').style.display='none'">법인카드 (${filteredCard.length})</div>
    <div class="tab-item" onclick="this.parentElement.querySelectorAll('.tab-item').forEach(t=>t.classList.remove('active'));this.classList.add('active');document.getElementById('purch-list').style.display='none';document.getElementById('purch-card').style.display='none';document.getElementById('purch-partner').style.display=''">거래처별 매입/지급</div>
  </div>
  <div id="purch-list">
    <div class="panel">
      <div class="panel-header"><span>매입 목록</span><div class="filter-group"><input class="search-input" placeholder="거래처/품목 검색..." style="width:200px" onkeyup="document.querySelectorAll('#purchTbl tbody tr').forEach(r=>{r.style.display=r.textContent.toLowerCase().includes(this.value.toLowerCase())?'':'none'})"></div></div>
      <div class="panel-body" style="overflow-x:auto;padding:0">
        <table id="purchTbl"><thead><tr><th>일자</th><th>거래처</th><th>적요</th><th class="right">공급가액</th><th class="right">부가세</th><th class="right">합계</th><th class="center">지급상태</th><th class="center">증빙</th></tr></thead>
        <tbody>${detailRows||'<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-sub)">매입 자료 없음</td></tr>'}</tbody></table>
      </div>
    </div>
  </div>
  <div id="purch-card" style="display:none">
    <div class="panel">
      <div class="panel-header"><span>법인카드 매입 — ${curMonth}</span></div>
      <div class="panel-body" style="overflow-x:auto;padding:0">
        <table><thead><tr><th>일자</th><th>가맹점</th><th>적요</th><th class="right">금액</th><th class="center">결제수단</th></tr></thead>
        <tbody>${cardDetailRows||'<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text-sub)">법인카드 매입 없음</td></tr>'}</tbody></table>
      </div>
    </div>
  </div>
  <div id="purch-partner" style="display:none">
    <div class="panel">
      <div class="panel-header"><span>거래처별 매입/지급 현황 (${curMonth})</span></div>
      <div class="panel-body" style="overflow-x:auto;padding:0">
        <table><thead><tr><th>거래처</th><th class="right">건수</th><th class="right">매입액</th><th class="right">지급액</th><th class="right">미지급</th><th>지급율</th></tr></thead>
        <tbody>${partnerPayRows}<tr style="font-weight:700;background:var(--gray-50);border-top:2px solid var(--border)"><td>합계</td><td class="right">${filtered.length+filteredCard.length}건</td><td class="right">${fmt(totalPurchAmt)}</td><td class="right" style="color:var(--green)">${fmt(totalPaid)}</td><td class="right" style="color:var(--red)">${fmt(totalPurchAmt-totalPaid)}</td><td></td></tr></tbody></table>
      </div>
    </div>
  </div>`;
};

// ─────────────────────────────────────────── 손익분석
PAGES['report_pnl'] = function() {
  const months = getAllMonths();
  const rows = months.map(m => {
    const d = getMonthlyData(m);
    if (d.salesAmt === 0 && d.purchAmt === 0 && d.cardAmt === 0) return '';
    const margin = d.salesSupply ? Math.round(d.profit / d.salesSupply * 100) : 0;
    return `<tr><td style="font-weight:700">${m}</td><td class="tar amount positive">${fmt(d.salesSupply)}</td><td class="tar amount">${fmt(d.salesTax)}</td><td class="tar amount negative">${fmt(d.purchSupply)}</td><td class="tar amount">${fmt(d.purchTax)}</td><td class="tar amount">${fmt(d.cardAmt)}</td><td class="tar amount" style="color:var(--success)">${fmt(d.bankIn)}</td><td class="tar amount">${fmt(d.bankOut)}</td><td class="tar amount" style="font-weight:800;color:${d.profit>=0?'var(--success)':'var(--danger)'}"> ${fmt(d.profit)}</td><td class="tar" style="font-weight:700;color:${margin>=0?'var(--success)':'var(--danger)'}"> ${margin}%</td></tr>`;
  }).filter(Boolean).join('');
  const total = months.reduce((t,m) => { const d = getMonthlyData(m); t.salesSupply += d.salesSupply; t.salesTax += d.salesTax; t.purchSupply += d.purchSupply; t.purchTax += d.purchTax; t.card += d.cardAmt; t.bankIn += d.bankIn; t.bankOut += d.bankOut; t.profit += d.profit; return t; }, {salesSupply:0,salesTax:0,purchSupply:0,purchTax:0,card:0,bankIn:0,bankOut:0,profit:0});
  const totalMargin = total.salesSupply ? Math.round(total.profit / total.salesSupply * 100) : 0;
  return `
  <div class="card">
    <div class="tbl-wrap tbl-scroll"><table>
      <thead><tr><th>월</th><th class="tar">매출(공급가)</th><th class="tar">매출세액</th><th class="tar">매입(공급가)</th><th class="tar">매입세액</th><th class="tar">카드경비</th><th class="tar">입금</th><th class="tar">출금</th><th class="tar">손익</th><th class="tar">이익률</th></tr></thead>
      <tbody>${rows}
        <tr style="background:var(--gray-100);font-weight:800;border-top:2px solid var(--gray-800)"><td>합계</td><td class="tar amount positive">${fmt(total.salesSupply)}</td><td class="tar amount">${fmt(total.salesTax)}</td><td class="tar amount negative">${fmt(total.purchSupply)}</td><td class="tar amount">${fmt(total.purchTax)}</td><td class="tar amount">${fmt(total.card)}</td><td class="tar amount" style="color:var(--success)">${fmt(total.bankIn)}</td><td class="tar amount">${fmt(total.bankOut)}</td><td class="tar amount" style="color:${total.profit>=0?'var(--success)':'var(--danger)'}"> ${fmt(total.profit)}</td><td class="tar" style="color:${totalMargin>=0?'var(--success)':'var(--danger)'}"> ${totalMargin}%</td></tr>
      </tbody>
    </table></div>
  </div>`;
};

export function renderPage(hash, data) {
  _S = data;
  const fn = PAGES[hash];
  if (!fn) return '<div class="empty-state">알 수 없는 페이지: ' + hash + '</div>';
  try { return fn(); } catch (e) { return '<div class="empty-state">렌더 오류: ' + (e && e.message) + '</div>'; }
}
