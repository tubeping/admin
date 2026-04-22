"use client";

import { useState, useEffect, useCallback } from "react";

interface MatchedOrder {
  id: string;
  cafe24_order_id: string;
  order_date: string;
  product_name: string;
  quantity: number;
  order_amount: number;
  buyer_name: string;
  receiver_name: string;
  store_name: string;
}

interface ParsedDeposit {
  name: string;
  amount: number;
  raw: string;
}

// 신한은행 문자 파싱
// 실제 형식:
//   신한04/15 09:18
//   140-014-420770
//   입금         378
//   잔액    868,227
//    카페24페이먼
//
// 또는 한 줄 형식:
//   [신한은행] 입금 50,000원 홍길동 잔액 1,234,567원
function parseBankSms(text: string): ParsedDeposit | null {
  const cleaned = text.trim();
  if (!cleaned) return null;

  const lines = cleaned.split("\n").map((l) => l.trim()).filter((l) => l);
  let amount = 0;
  let name = "";

  // 멀티라인 형식 (신한 실제 SMS)
  const skipPatterns = [/^1577/, /^\[?web/i, /^\[?신한/i, /요일/, /오전|오후/, /^\d{2,3}-\d{3,4}-\d{4,}/, /^잔액/];
  const isSkip = (line: string) => skipPatterns.some((p) => p.test(line));

  for (const line of lines) {
    // 입금 금액 추출
    const depositMatch = line.match(/입금\s+([\d,]+)/);
    if (depositMatch) {
      amount = parseInt(depositMatch[1].replace(/,/g, ""), 10) || 0;
      continue;
    }
    // 잔액 라인은 건너뛰기
    if (/^잔액/.test(line)) continue;
    // 스킵 패턴
    if (isSkip(line)) continue;
    // "원" 포함 금액 라인
    if (/^[\d,]+원?$/.test(line.replace(/\s/g, ""))) continue;
    // 남은 라인이 입금자명
    if (!name && line.length >= 2) {
      name = line;
    }
  }

  // 한 줄 형식 fallback
  if (!name) {
    const p1 = cleaned.match(/입금\s*[\d,]+\s*원?\s+([가-힣a-zA-Z0-9]{2,})/);
    if (p1) name = p1[1];
  }
  if (!amount) {
    const amountMatch = cleaned.match(/([\d,]+)\s*원/);
    if (amountMatch) amount = parseInt(amountMatch[1].replace(/,/g, ""), 10) || 0;
  }
  // 최후 수단: 한글 이름 추출
  if (!name) {
    const exclude = ["신한", "은행", "입금", "출금", "잔액", "국민", "우리", "하나", "농협", "기업", "발신"];
    const names = cleaned.match(/[가-힣]{2,4}/g) || [];
    name = names.find((n) => !exclude.some((ex) => n.includes(ex))) || "";
  }

  if (!name) return null;

  return { name, amount, raw: cleaned };
}

export default function PaymentPage() {
  const [smsInput, setSmsInput] = useState("");
  const [parsed, setParsed] = useState<ParsedDeposit | null>(null);
  const [matches, setMatches] = useState<MatchedOrder[]>([]);
  const [searching, setSearching] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<Array<{ name: string; amount: number; orderId: string; time: string }>>([]);

  // 문자 붙여넣기 시 자동 파싱
  const handleInput = (text: string) => {
    setSmsInput(text);
    const result = parseBankSms(text);
    setParsed(result);
    if (result) {
      searchOrders(result.name);
    } else {
      setMatches([]);
    }
  };

  const searchOrders = useCallback(async (name: string) => {
    if (!name || name.length < 2) return;
    setSearching(true);
    try {
      const params = new URLSearchParams({
        keyword: name,
        shipping_status: "pending",
        limit: "50",
      });
      const res = await fetch(`/admin/api/orders?${params}`);
      if (!res.ok) { setMatches([]); return; }
      const data = await res.json();
      const orders = (data.orders || []).filter((o: { buyer_name?: string; receiver_name?: string }) => {
        const bn = (o.buyer_name || "").toLowerCase();
        const rn = (o.receiver_name || "").toLowerCase();
        const n = name.toLowerCase();
        return bn.includes(n) || rn.includes(n) || n.includes(bn) || n.includes(rn);
      });
      setMatches(orders.map((o: {
        id: string; cafe24_order_id: string; order_date: string;
        product_name: string; quantity: number; order_amount: number;
        buyer_name: string; receiver_name: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        stores: any;
      }) => ({
        id: o.id,
        cafe24_order_id: o.cafe24_order_id,
        order_date: o.order_date?.slice(0, 10) || "",
        product_name: o.product_name || "",
        quantity: o.quantity || 0,
        order_amount: o.order_amount || 0,
        buyer_name: o.buyer_name || "",
        receiver_name: o.receiver_name || "",
        store_name: (Array.isArray(o.stores) ? o.stores[0]?.name : o.stores?.name) || "",
      })));
    } catch { setMatches([]); }
    finally { setSearching(false); }
  }, []);

  const processConfirm = async (ids: string[]) => {
    setConfirming(true);
    try {
      const res = await fetch("/admin/api/orders/payment-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_ids: ids }),
      });
      const data = await res.json();
      if (data.confirmed > 0) {
        setConfirmed((prev) => new Set([...prev, ...ids]));
        for (const id of ids) {
          setHistory((prev) => [{
            name: parsed?.name || "",
            amount: parsed?.amount || 0,
            orderId: id,
            time: new Date().toLocaleTimeString("ko"),
          }, ...prev]);
        }
        // 카페24 결과 알림
        const c = data.cafe24 || { success: 0, failed: 0, errors: [] };
        if (c.success > 0 || c.failed > 0) {
          let msg = `입금확인 ${data.confirmed}건 완료`;
          msg += `\n카페24 상품준비중 전환: ${c.success}건 성공`;
          if (c.failed > 0) {
            msg += `, ${c.failed}건 실패`;
            if (c.errors?.length) msg += `\n${c.errors.join("\n")}`;
          }
          alert(msg);
        }
      }
    } catch { /* ignore */ }
    setConfirming(false);
  };

  const handleConfirm = async (orderId: string) => processConfirm([orderId]);

  const handleConfirmAll = async () => {
    const ids = matches.filter((m) => !confirmed.has(m.id)).map((m) => m.id);
    if (ids.length === 0) return;
    await processConfirm(ids);
  };

  const handleClear = () => {
    setSmsInput("");
    setParsed(null);
    setMatches([]);
  };

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">입금 확인</h1>
        <p className="text-xs text-gray-500 mt-1">
          은행 문자를 붙여넣으면 고객명으로 주문을 자동 매칭합니다.
        </p>
      </div>

      {/* 문자 입력 */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5">
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          신한은행 입금 문자 붙여넣기
        </label>
        <textarea
          value={smsInput}
          onChange={(e) => handleInput(e.target.value)}
          onPaste={(e) => {
            setTimeout(() => handleInput((e.target as HTMLTextAreaElement).value), 0);
          }}
          placeholder="[신한은행] 입금 50,000원 홍길동 잔액 1,234,567원"
          rows={2}
          className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
        />

        {parsed && (
          <div className="flex items-center gap-4 mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center gap-2">
              <span className="text-xs text-blue-600 font-medium">입금자</span>
              <span className="text-sm font-bold text-blue-900">{parsed.name}</span>
            </div>
            {parsed.amount > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-blue-600 font-medium">금액</span>
                <span className="text-sm font-bold text-blue-900">₩{parsed.amount.toLocaleString()}</span>
              </div>
            )}
            <div className="flex-1" />
            <button onClick={handleClear} className="text-xs text-gray-500 hover:text-gray-700 cursor-pointer">초기화</button>
          </div>
        )}

        {!parsed && smsInput.trim() && (
          <p className="mt-2 text-xs text-red-500">문자 형식을 인식하지 못했습니다. 입금자명을 직접 검색하세요.</p>
        )}

        {/* 직접 검색 */}
        <div className="flex gap-2 mt-3">
          <input
            type="text"
            placeholder="고객명 직접 입력"
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const val = (e.target as HTMLInputElement).value.trim();
                if (val.length >= 2) {
                  setParsed({ name: val, amount: 0, raw: val });
                  searchOrders(val);
                }
              }
            }}
          />
          <span className="text-[10px] text-gray-400 self-center">Enter로 검색</span>
        </div>
      </div>

      {/* 매칭 결과 */}
      {searching && <p className="text-sm text-gray-400 mb-4">검색 중...</p>}

      {parsed && !searching && matches.length === 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-5">
          <p className="text-sm text-yellow-800 font-medium">
            &quot;{parsed.name}&quot; 이름으로 대기 중인 주문을 찾을 수 없습니다.
          </p>
          <p className="text-xs text-yellow-600 mt-1">이미 입금확인 된 건이거나, 주문자명이 다를 수 있습니다.</p>
        </div>
      )}

      {matches.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl mb-5">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <span className="text-sm font-semibold text-gray-700">매칭된 주문 ({matches.length}건)</span>
            {matches.filter((m) => !confirmed.has(m.id)).length > 1 && (
              <button
                onClick={handleConfirmAll}
                disabled={confirming}
                className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 cursor-pointer disabled:opacity-50"
              >
                전체 입금확인
              </button>
            )}
          </div>
          <table className="w-full">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-100">
                <th className="text-left px-5 py-2 font-medium">주문번호</th>
                <th className="text-left px-3 py-2 font-medium">판매처</th>
                <th className="text-left px-3 py-2 font-medium">상품</th>
                <th className="text-right px-3 py-2 font-medium">수량</th>
                <th className="text-right px-3 py-2 font-medium">금액</th>
                <th className="text-left px-3 py-2 font-medium">구매자</th>
                <th className="text-left px-3 py-2 font-medium">수령인</th>
                <th className="text-center px-5 py-2 font-medium">확인</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m) => (
                <tr key={m.id} className={`border-b border-gray-50 ${confirmed.has(m.id) ? "bg-green-50/50" : ""}`}>
                  <td className="px-5 py-2.5 text-xs font-mono text-gray-700">{m.cafe24_order_id}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-600">{m.store_name}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-700 max-w-[200px] truncate">{m.product_name}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-700 text-right">{m.quantity}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-900 text-right font-medium">₩{m.order_amount.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-xs font-medium text-blue-700">{m.buyer_name}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-600">{m.receiver_name}</td>
                  <td className="px-5 py-2.5 text-center">
                    {confirmed.has(m.id) ? (
                      <span className="text-xs font-bold text-green-600">확인완료</span>
                    ) : (
                      <button
                        onClick={() => handleConfirm(m.id)}
                        disabled={confirming}
                        className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 cursor-pointer disabled:opacity-50"
                      >
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

      {/* 오늘 처리 이력 */}
      {history.length > 0 && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-500 mb-2">오늘 입금확인 이력 ({history.length}건)</p>
          <div className="space-y-1">
            {history.map((h, i) => (
              <div key={i} className="flex items-center gap-3 text-xs text-gray-600">
                <span className="text-gray-400">{h.time}</span>
                <span className="font-medium text-gray-700">{h.name}</span>
                {h.amount > 0 && <span>₩{h.amount.toLocaleString()}</span>}
                <span className="text-green-600 font-medium">확인완료</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
