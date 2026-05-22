"use client";

import { useState, useCallback, useRef } from "react";

// ── 타입 ──
interface BankRow {
  datetime: string;
  depositor: string;
  amount: number;
  content: string;
  raw: string;
}

interface PhoneOrder {
  id: string;
  order_number: string;
  order_date: string;
  product_name: string;
  quantity: number;
  total_amount: number;
  depositor_name: string;
  recipient_name: string;
  client_name: string;
}

interface MatchResult {
  bank: BankRow;
  orders: PhoneOrder[];
}

// ── 뱅크다A 테이블 파싱 ──
// 복사 시 탭 구분: 입금일시 | 계좌 | 적요(입금자) | 내용 | 입금액 | 출금액 | 잔액 | 메모
function parseBankdaRows(text: string): BankRow[] {
  const lines = text.trim().split("\n").filter((l) => l.trim());
  const results: BankRow[] = [];

  for (const line of lines) {
    const cols = line.split("\t").map((c) => c.trim());
    if (cols.length < 6) continue;

    const datetime = cols[0];
    // 날짜 형식 확인 (2026-05-22 10:38:06)
    if (!/^\d{4}-\d{2}-\d{2}/.test(datetime)) continue;

    const depositor = cols[2];
    const content = cols[3] || "";
    const depositAmt = parseInt((cols[4] || "0").replace(/,/g, ""), 10) || 0;
    const withdrawAmt = parseInt((cols[5] || "0").replace(/,/g, ""), 10) || 0;

    // 입금 건만 (입금액 > 0, 출금액 = 0)
    if (depositAmt <= 0 || withdrawAmt > 0) continue;
    // 입금자명이 있어야 함
    if (!depositor || depositor.length < 2) continue;

    results.push({
      datetime,
      depositor,
      amount: depositAmt,
      content,
      raw: line,
    });
  }

  return results;
}

// ── 은행 문자 파싱 (단건) ──
function parseBankSms(text: string): { name: string; amount: number } | null {
  const cleaned = text.trim();
  if (!cleaned) return null;
  const lines = cleaned.split("\n").map((l) => l.trim()).filter((l) => l);
  let amount = 0;
  let name = "";
  const skipPatterns = [/^1577/, /^\[?web/i, /^\[?신한/i, /요일/, /오전|오후/, /^\d{2,3}-\d{3,4}-\d{4,}/, /^잔액/];
  const isSkip = (line: string) => skipPatterns.some((p) => p.test(line));
  for (const line of lines) {
    const m = line.match(/입금\s+([\d,]+)/);
    if (m) { amount = parseInt(m[1].replace(/,/g, ""), 10) || 0; continue; }
    if (/^잔액/.test(line)) continue;
    if (isSkip(line)) continue;
    if (/^[\d,]+원?$/.test(line.replace(/\s/g, ""))) continue;
    if (!name && line.length >= 2) name = line;
  }
  if (!name) { const p = cleaned.match(/입금\s*[\d,]+\s*원?\s+([가-힣a-zA-Z0-9]{2,})/); if (p) name = p[1]; }
  if (!amount) { const am = cleaned.match(/([\d,]+)\s*원/); if (am) amount = parseInt(am[1].replace(/,/g, ""), 10) || 0; }
  if (!name) {
    const exclude = ["신한", "은행", "입금", "출금", "잔액", "국민", "우리", "하나", "농협", "기업", "발신"];
    const names = cleaned.match(/[가-힣]{2,4}/g) || [];
    name = names.find((n) => !exclude.some((ex) => n.includes(ex))) || "";
  }
  return name ? { name, amount } : null;
}

export default function PaymentPage() {
  const [mode, setMode] = useState<"bankda" | "sms">("bankda");

  // ── 뱅크다 모드 ──
  const [bankInput, setBankInput] = useState("");
  const [bankRows, setBankRows] = useState<BankRow[]>([]);
  const [matchResults, setMatchResults] = useState<MatchResult[]>([]);
  const [unmatchedRows, setUnmatchedRows] = useState<BankRow[]>([]);
  const [allUnpaidOrders, setAllUnpaidOrders] = useState<PhoneOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<Array<{ depositor: string; amount: number; orderNumber: string; time: string }>>([]);

  // ── SMS 모드 ──
  const [smsInput, setSmsInput] = useState("");
  const [smsParsed, setSmsParsed] = useState<{ name: string; amount: number } | null>(null);
  const [smsMatches, setSmsMatches] = useState<PhoneOrder[]>([]);
  const [smsSearching, setSmsSearching] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── 뱅크다: 붙여넣기 → 파싱 → 미입금 전화주문 매칭 ──
  const handleBankdaPaste = useCallback(async (text: string) => {
    setBankInput(text);
    const rows = parseBankdaRows(text);
    setBankRows(rows);

    if (rows.length === 0) {
      setMatchResults([]);
      setUnmatchedRows([]);
      return;
    }

    setLoading(true);
    try {
      // 미입금 전화주문 전체 조회
      const res = await fetch(`/admin/api/phone-orders?${new URLSearchParams({ payment_status: "unpaid", limit: "999" })}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const unpaidOrders: PhoneOrder[] = (data.orders || []).map((o: Record<string, unknown>) => ({
        id: o.id as string,
        order_number: o.order_number as string,
        order_date: ((o.order_date as string) || "").slice(0, 10),
        product_name: (o.product_name as string) || "",
        quantity: (o.quantity as number) || 0,
        total_amount: (o.total_amount as number) || 0,
        depositor_name: (o.depositor_name as string) || "",
        recipient_name: (o.recipient_name as string) || "",
        client_name: ((o.phone_order_clients as Record<string, string>)?.name) || "-",
      }));
      setAllUnpaidOrders(unpaidOrders);

      // 매칭
      const matched: MatchResult[] = [];
      const unmatched: BankRow[] = [];
      const usedOrderIds = new Set<string>();

      for (const row of rows) {
        const depositorLower = row.depositor.toLowerCase().replace(/\s/g, "");
        const matchingOrders = unpaidOrders.filter((o) => {
          if (usedOrderIds.has(o.id)) return false;
          const dn = (o.depositor_name || "").toLowerCase().replace(/\s/g, "");
          const rn = (o.recipient_name || "").toLowerCase().replace(/\s/g, "");
          return (
            dn === depositorLower ||
            rn === depositorLower ||
            (dn.length >= 2 && depositorLower.includes(dn)) ||
            (depositorLower.length >= 2 && dn.includes(depositorLower)) ||
            (rn.length >= 2 && depositorLower.includes(rn)) ||
            (depositorLower.length >= 2 && rn.includes(depositorLower))
          );
        });

        if (matchingOrders.length > 0) {
          matched.push({ bank: row, orders: matchingOrders });
          matchingOrders.forEach((o) => usedOrderIds.add(o.id));
        } else {
          unmatched.push(row);
        }
      }

      setMatchResults(matched);
      setUnmatchedRows(unmatched);
    } catch {
      setMatchResults([]);
      setUnmatchedRows(rows);
    }
    setLoading(false);
  }, []);

  // ── 뱅크다: 개별 입금확인 ──
  const confirmOrder = async (order: PhoneOrder, bankRow: BankRow) => {
    setConfirming(true);
    try {
      await fetch("/admin/api/phone-orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: [order.id],
          updates: { payment_status: "paid", paid_at: new Date().toISOString() },
        }),
      });
      setConfirmedIds((prev) => new Set([...prev, order.id]));
      setHistory((prev) => [{
        depositor: bankRow.depositor,
        amount: bankRow.amount,
        orderNumber: order.order_number,
        time: new Date().toLocaleTimeString("ko"),
      }, ...prev]);
    } catch { /* ignore */ }
    setConfirming(false);
  };

  // ── 뱅크다: 전체 입금확인 ──
  const confirmAllMatched = async () => {
    const ids: string[] = [];
    const items: { depositor: string; amount: number; orderNumber: string }[] = [];

    for (const m of matchResults) {
      for (const o of m.orders) {
        if (!confirmedIds.has(o.id)) {
          ids.push(o.id);
          items.push({ depositor: m.bank.depositor, amount: m.bank.amount, orderNumber: o.order_number });
        }
      }
    }
    if (ids.length === 0) return;

    setConfirming(true);
    try {
      await fetch("/admin/api/phone-orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids,
          updates: { payment_status: "paid", paid_at: new Date().toISOString() },
        }),
      });
      setConfirmedIds((prev) => new Set([...prev, ...ids]));
      const now = new Date().toLocaleTimeString("ko");
      setHistory((prev) => [
        ...items.map((it) => ({ ...it, time: now })),
        ...prev,
      ]);
    } catch { /* ignore */ }
    setConfirming(false);
  };

  // ── SMS 모드 ──
  const handleSmsInput = useCallback(async (text: string) => {
    setSmsInput(text);
    const result = parseBankSms(text);
    setSmsParsed(result);
    if (!result || result.name.length < 2) { setSmsMatches([]); return; }

    setSmsSearching(true);
    try {
      const res = await fetch(`/admin/api/phone-orders?${new URLSearchParams({ keyword: result.name, payment_status: "unpaid" })}`);
      if (!res.ok) { setSmsMatches([]); return; }
      const data = await res.json();
      const n = result.name.toLowerCase();
      const filtered = (data.orders || []).filter((o: { depositor_name?: string; recipient_name?: string }) => {
        const dn = (o.depositor_name || "").toLowerCase();
        const rn = (o.recipient_name || "").toLowerCase();
        return dn.includes(n) || rn.includes(n) || n.includes(dn) || n.includes(rn);
      }).map((o: Record<string, unknown>) => ({
        id: o.id as string,
        order_number: o.order_number as string,
        order_date: ((o.order_date as string) || "").slice(0, 10),
        product_name: (o.product_name as string) || "",
        quantity: (o.quantity as number) || 0,
        total_amount: (o.total_amount as number) || 0,
        depositor_name: (o.depositor_name as string) || "",
        recipient_name: (o.recipient_name as string) || "",
        client_name: ((o.phone_order_clients as Record<string, string>)?.name) || "-",
      }));
      setSmsMatches(filtered);
    } catch { setSmsMatches([]); }
    setSmsSearching(false);
  }, []);

  const confirmSmsOrder = async (order: PhoneOrder) => {
    setConfirming(true);
    try {
      await fetch("/admin/api/phone-orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: [order.id],
          updates: { payment_status: "paid", paid_at: new Date().toISOString() },
        }),
      });
      setConfirmedIds((prev) => new Set([...prev, order.id]));
      setHistory((prev) => [{
        depositor: smsParsed?.name || "",
        amount: smsParsed?.amount || 0,
        orderNumber: order.order_number,
        time: new Date().toLocaleTimeString("ko"),
      }, ...prev]);
    } catch { /* ignore */ }
    setConfirming(false);
  };

  // ── 초기화 ──
  const handleClear = () => {
    setBankInput("");
    setBankRows([]);
    setMatchResults([]);
    setUnmatchedRows([]);
    setAllUnpaidOrders([]);
    setSmsInput("");
    setSmsParsed(null);
    setSmsMatches([]);
  };

  const totalMatchedOrders = matchResults.reduce((sum, m) => sum + m.orders.length, 0);
  const unconfirmedCount = matchResults.reduce((sum, m) => sum + m.orders.filter((o) => !confirmedIds.has(o.id)).length, 0);

  return (
    <div className="p-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">입금 확인</h1>
        <p className="text-xs text-gray-500 mt-1">
          뱅크다A 입금내역 또는 은행 문자로 미입금 전화주문을 자동 매칭합니다.
        </p>
      </div>

      {/* 모드 탭 */}
      <div className="flex gap-1 mb-5 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setMode("bankda")}
          className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors ${mode === "bankda" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
        >
          뱅크다A 입금내역
        </button>
        <button
          onClick={() => setMode("sms")}
          className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors ${mode === "sms" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
        >
          은행 문자 / 직접 검색
        </button>
      </div>

      {/* ====== 뱅크다 모드 ====== */}
      {mode === "bankda" && (
        <>
          <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5">
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-semibold text-gray-700">
                뱅크다A 계좌 거래내역 붙여넣기
              </label>
              {bankRows.length > 0 && (
                <button onClick={handleClear} className="text-xs text-gray-400 hover:text-gray-600">초기화</button>
              )}
            </div>
            <textarea
              ref={textareaRef}
              value={bankInput}
              onChange={(e) => setBankInput(e.target.value)}
              onPaste={(e) => {
                setTimeout(() => {
                  if (textareaRef.current) handleBankdaPaste(textareaRef.current.value);
                }, 0);
              }}
              placeholder={"뱅크다A에서 거래내역 테이블을 선택 → 복사(Ctrl+C) → 여기에 붙여넣기(Ctrl+V)\n\n예) 2026-05-22 10:01:54\t신산애널리틱스\t조종우\t타행IB (기업)\t813,873\t0\t1019,514"}
              rows={4}
              className="w-full border border-gray-200 rounded-lg px-4 py-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 placeholder:font-sans placeholder:text-gray-400"
            />

            {/* 파싱 결과 요약 */}
            {bankRows.length > 0 && (
              <div className="flex items-center gap-4 mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-blue-600 font-medium">입금 건수</span>
                  <span className="text-sm font-bold text-blue-900">{bankRows.length}건</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-blue-600 font-medium">총 입금액</span>
                  <span className="text-sm font-bold text-blue-900">{bankRows.reduce((s, r) => s + r.amount, 0).toLocaleString()}원</span>
                </div>
                <div className="w-px h-4 bg-blue-200" />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-green-600 font-medium">매칭</span>
                  <span className="text-sm font-bold text-green-700">{matchResults.length}건 ({totalMatchedOrders}주문)</span>
                </div>
                {unmatchedRows.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 font-medium">미매칭</span>
                    <span className="text-sm font-bold text-gray-500">{unmatchedRows.length}건</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {loading && (
            <div className="flex items-center gap-2 mb-5 text-sm text-gray-500">
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              미입금 전화주문과 매칭 중...
            </div>
          )}

          {/* 매칭 결과 */}
          {matchResults.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl mb-5">
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-gray-700">매칭 결과</span>
                  <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full font-medium">
                    {totalMatchedOrders}건 매칭
                  </span>
                </div>
                {unconfirmedCount > 0 && (
                  <button
                    onClick={confirmAllMatched}
                    disabled={confirming}
                    className="px-4 py-1.5 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 cursor-pointer disabled:opacity-50 transition-colors"
                  >
                    전체 입금확인 ({unconfirmedCount}건)
                  </button>
                )}
              </div>

              <div className="divide-y divide-gray-100">
                {matchResults.map((m, idx) => (
                  <div key={idx} className="px-5 py-3">
                    {/* 은행 입금 정보 */}
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">입금</span>
                      <span className="text-xs text-gray-500">{m.bank.datetime}</span>
                      <span className="text-xs font-bold text-gray-900">{m.bank.depositor}</span>
                      <span className="text-xs font-bold text-blue-700">{m.bank.amount.toLocaleString()}원</span>
                      {m.bank.content && <span className="text-[10px] text-gray-400">{m.bank.content}</span>}
                    </div>

                    {/* 매칭된 전화주문 */}
                    {m.orders.map((o) => (
                      <div
                        key={o.id}
                        className={`flex items-center gap-3 ml-6 py-1.5 ${confirmedIds.has(o.id) ? "opacity-60" : ""}`}
                      >
                        <svg className="w-3.5 h-3.5 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">전화주문</span>
                        <span className="text-xs font-mono text-gray-600">{o.order_number}</span>
                        <span className="text-xs text-gray-500">{o.client_name}</span>
                        <span className="text-xs text-gray-700 truncate max-w-[180px]">{o.product_name}</span>
                        <span className="text-xs text-gray-500">x{o.quantity}</span>
                        {o.total_amount > 0 && (
                          <span className="text-xs font-medium text-gray-700">{o.total_amount.toLocaleString()}원</span>
                        )}
                        <span className="text-xs text-gray-500">입금자: {o.depositor_name || "-"}</span>
                        <span className="text-xs text-gray-500">수령인: {o.recipient_name}</span>
                        <div className="flex-1" />
                        {confirmedIds.has(o.id) ? (
                          <span className="text-xs font-bold text-green-600">확인완료</span>
                        ) : (
                          <button
                            onClick={() => confirmOrder(o, m.bank)}
                            disabled={confirming}
                            className="px-2.5 py-1 bg-green-600 text-white text-[11px] font-medium rounded hover:bg-green-700 cursor-pointer disabled:opacity-50"
                          >
                            입금확인
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 미매칭 입금 건 */}
          {unmatchedRows.length > 0 && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl mb-5">
              <div className="px-5 py-3 border-b border-gray-100">
                <span className="text-sm font-semibold text-gray-500">미매칭 입금 ({unmatchedRows.length}건)</span>
                <span className="text-xs text-gray-400 ml-2">미입금 전화주문과 입금자명이 일치하지 않는 건</span>
              </div>
              <div className="divide-y divide-gray-100">
                {unmatchedRows.map((r, idx) => (
                  <div key={idx} className="px-5 py-2.5 flex items-center gap-3">
                    <span className="text-xs text-gray-400">{r.datetime}</span>
                    <span className="text-xs font-medium text-gray-700">{r.depositor}</span>
                    <span className="text-xs font-medium text-gray-900">{r.amount.toLocaleString()}원</span>
                    {r.content && <span className="text-[10px] text-gray-400">{r.content}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 미입금 전화주문 현황 (참고) */}
          {allUnpaidOrders.length > 0 && matchResults.length > 0 && (
            <details className="bg-white border border-gray-200 rounded-xl mb-5">
              <summary className="px-5 py-3 text-sm font-semibold text-gray-500 cursor-pointer hover:text-gray-700">
                전체 미입금 전화주문 ({allUnpaidOrders.length}건)
              </summary>
              <div className="px-5 pb-3">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-400 border-b border-gray-100">
                      <th className="text-left py-2 font-medium">주문번호</th>
                      <th className="text-left py-2 font-medium">판매처</th>
                      <th className="text-left py-2 font-medium">상품</th>
                      <th className="text-left py-2 font-medium">입금자</th>
                      <th className="text-left py-2 font-medium">수령인</th>
                      <th className="text-right py-2 font-medium">금액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allUnpaidOrders.map((o) => (
                      <tr key={o.id} className={`border-b border-gray-50 ${confirmedIds.has(o.id) ? "bg-green-50/50 line-through opacity-50" : ""}`}>
                        <td className="py-1.5 font-mono text-gray-600">{o.order_number}</td>
                        <td className="py-1.5 text-gray-500">{o.client_name}</td>
                        <td className="py-1.5 text-gray-700 max-w-[200px] truncate">{o.product_name}</td>
                        <td className="py-1.5 font-medium text-blue-700">{o.depositor_name || "-"}</td>
                        <td className="py-1.5 text-gray-600">{o.recipient_name}</td>
                        <td className="py-1.5 text-right text-gray-900">{o.total_amount > 0 ? `${o.total_amount.toLocaleString()}원` : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}

      {/* ====== SMS / 직접 검색 모드 ====== */}
      {mode === "sms" && (
        <>
          <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5">
            <label className="block text-sm font-semibold text-gray-700 mb-2">은행 입금 문자 붙여넣기</label>
            <textarea
              value={smsInput}
              onChange={(e) => handleSmsInput(e.target.value)}
              onPaste={(e) => { setTimeout(() => handleSmsInput((e.target as HTMLTextAreaElement).value), 0); }}
              placeholder="[신한은행] 입금 50,000원 홍길동 잔액 1,234,567원"
              rows={2}
              className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
            {smsParsed && (
              <div className="flex items-center gap-4 mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-blue-600 font-medium">입금자</span>
                  <span className="text-sm font-bold text-blue-900">{smsParsed.name}</span>
                </div>
                {smsParsed.amount > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-blue-600 font-medium">금액</span>
                    <span className="text-sm font-bold text-blue-900">{smsParsed.amount.toLocaleString()}원</span>
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-2 mt-3">
              <input
                type="text"
                placeholder="입금자명 직접 입력 후 Enter"
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const val = (e.target as HTMLInputElement).value.trim();
                    if (val.length >= 2) {
                      setSmsParsed({ name: val, amount: 0 });
                      handleSmsInput(val);
                    }
                  }
                }}
              />
              <span className="text-[10px] text-gray-400 self-center">Enter로 검색</span>
            </div>
          </div>

          {smsSearching && <p className="text-sm text-gray-400 mb-4">검색 중...</p>}
          {smsParsed && !smsSearching && smsMatches.length === 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-5">
              <p className="text-sm text-yellow-800 font-medium">&quot;{smsParsed.name}&quot; 이름으로 미입금 주문을 찾을 수 없습니다.</p>
            </div>
          )}
          {smsMatches.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl mb-5">
              <div className="px-5 py-3 border-b border-gray-100">
                <span className="text-sm font-semibold text-gray-700">매칭된 전화주문 ({smsMatches.length}건)</span>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-100">
                    <th className="text-left px-5 py-2 font-medium">주문번호</th>
                    <th className="text-left px-3 py-2 font-medium">판매처</th>
                    <th className="text-left px-3 py-2 font-medium">상품</th>
                    <th className="text-right px-3 py-2 font-medium">금액</th>
                    <th className="text-left px-3 py-2 font-medium">입금자</th>
                    <th className="text-left px-3 py-2 font-medium">수령인</th>
                    <th className="text-center px-5 py-2 font-medium">확인</th>
                  </tr>
                </thead>
                <tbody>
                  {smsMatches.map((o) => (
                    <tr key={o.id} className={`border-b border-gray-50 ${confirmedIds.has(o.id) ? "bg-green-50/50" : ""}`}>
                      <td className="px-5 py-2.5 text-xs font-mono text-gray-700">{o.order_number}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-600">{o.client_name}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-700 max-w-[200px] truncate">{o.product_name}</td>
                      <td className="px-3 py-2.5 text-xs text-right font-medium">{o.total_amount > 0 ? `${o.total_amount.toLocaleString()}원` : "-"}</td>
                      <td className="px-3 py-2.5 text-xs font-medium text-blue-700">{o.depositor_name || "-"}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-600">{o.recipient_name}</td>
                      <td className="px-5 py-2.5 text-center">
                        {confirmedIds.has(o.id) ? (
                          <span className="text-xs font-bold text-green-600">확인완료</span>
                        ) : (
                          <button onClick={() => confirmSmsOrder(o)} disabled={confirming}
                            className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 cursor-pointer disabled:opacity-50">
                            입금확인
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* 오늘 처리 이력 */}
      {history.length > 0 && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-500 mb-2">입금확인 이력 ({history.length}건)</p>
          <div className="space-y-1">
            {history.map((h, i) => (
              <div key={i} className="flex items-center gap-3 text-xs text-gray-600">
                <span className="text-gray-400">{h.time}</span>
                <span className="font-medium text-gray-700">{h.depositor}</span>
                {h.amount > 0 && <span>{h.amount.toLocaleString()}원</span>}
                <span className="font-mono text-gray-500">{h.orderNumber}</span>
                <span className="text-green-600 font-medium">확인완료</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
