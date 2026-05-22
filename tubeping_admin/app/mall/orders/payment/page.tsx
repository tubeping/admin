"use client";

import { useState, useCallback } from "react";

interface MatchedOrder {
  id: string;
  type: "order" | "phone";
  order_id: string;
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
function parseBankSms(text: string): ParsedDeposit | null {
  const cleaned = text.trim();
  if (!cleaned) return null;

  const lines = cleaned.split("\n").map((l) => l.trim()).filter((l) => l);
  let amount = 0;
  let name = "";

  const skipPatterns = [/^1577/, /^\[?web/i, /^\[?신한/i, /요일/, /오전|오후/, /^\d{2,3}-\d{3,4}-\d{4,}/, /^잔액/];
  const isSkip = (line: string) => skipPatterns.some((p) => p.test(line));

  for (const line of lines) {
    const depositMatch = line.match(/입금\s+([\d,]+)/);
    if (depositMatch) {
      amount = parseInt(depositMatch[1].replace(/,/g, ""), 10) || 0;
      continue;
    }
    if (/^잔액/.test(line)) continue;
    if (isSkip(line)) continue;
    if (/^[\d,]+원?$/.test(line.replace(/\s/g, ""))) continue;
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
  const [history, setHistory] = useState<Array<{ name: string; amount: number; orderId: string; type: string; time: string }>>([]);

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
      // 일반 주문 + 전화주문 동시 검색
      const [ordersRes, phoneRes] = await Promise.all([
        fetch(`/admin/api/orders?${new URLSearchParams({ keyword: name, shipping_status: "pending", limit: "50" })}`),
        fetch(`/admin/api/phone-orders?${new URLSearchParams({ keyword: name, payment_status: "unpaid" })}`),
      ]);

      const results: MatchedOrder[] = [];

      // 일반 주문 매칭
      if (ordersRes.ok) {
        const data = await ordersRes.json();
        const orders = (data.orders || []).filter((o: { buyer_name?: string; receiver_name?: string }) => {
          const bn = (o.buyer_name || "").toLowerCase();
          const rn = (o.receiver_name || "").toLowerCase();
          const n = name.toLowerCase();
          return bn.includes(n) || rn.includes(n) || n.includes(bn) || n.includes(rn);
        });
        for (const o of orders) {
          results.push({
            id: o.id,
            type: "order",
            order_id: o.cafe24_order_id,
            order_date: o.order_date?.slice(0, 10) || "",
            product_name: o.product_name || "",
            quantity: o.quantity || 0,
            order_amount: o.order_amount || 0,
            buyer_name: o.buyer_name || "",
            receiver_name: o.receiver_name || "",
            store_name: (Array.isArray(o.stores) ? o.stores[0]?.name : o.stores?.name) || "",
          });
        }
      }

      // 전화주문 매칭 (입금자명 기준)
      if (phoneRes.ok) {
        const data = await phoneRes.json();
        const phoneOrders = (data.orders || []).filter((o: { depositor_name?: string; recipient_name?: string }) => {
          const dn = (o.depositor_name || "").toLowerCase();
          const rn = (o.recipient_name || "").toLowerCase();
          const n = name.toLowerCase();
          return dn.includes(n) || rn.includes(n) || n.includes(dn) || n.includes(rn);
        });
        for (const o of phoneOrders) {
          results.push({
            id: o.id,
            type: "phone",
            order_id: o.order_number,
            order_date: o.order_date?.slice(0, 10) || "",
            product_name: o.product_name || "",
            quantity: o.quantity || 0,
            order_amount: o.total_amount || 0,
            buyer_name: o.depositor_name || "-",
            receiver_name: o.recipient_name || "",
            store_name: o.phone_order_clients?.name || "-",
          });
        }
      }

      setMatches(results);
    } catch { setMatches([]); }
    finally { setSearching(false); }
  }, []);

  const processConfirm = async (items: MatchedOrder[]) => {
    setConfirming(true);
    try {
      // 일반 주문과 전화주문 분리
      const orderIds = items.filter((m) => m.type === "order").map((m) => m.id);
      const phoneIds = items.filter((m) => m.type === "phone").map((m) => m.id);

      const promises: Promise<void>[] = [];

      // 일반 주문 입금확인
      if (orderIds.length > 0) {
        promises.push(
          fetch("/admin/api/orders/payment-confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ order_ids: orderIds }),
          }).then(async (res) => {
            const data = await res.json();
            if (data.confirmed > 0) {
              const c = data.cafe24 || { success: 0, failed: 0, errors: [] };
              if (c.failed > 0 && c.errors?.length) {
                alert(`카페24 전환 실패 ${c.failed}건: ${c.errors.join(", ")}`);
              }
            }
          })
        );
      }

      // 전화주문 입금확인
      if (phoneIds.length > 0) {
        promises.push(
          fetch("/admin/api/phone-orders", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ids: phoneIds,
              updates: { payment_status: "paid", paid_at: new Date().toISOString() },
            }),
          }).then(() => {})
        );
      }

      await Promise.all(promises);

      // 확인 완료 표시
      const allIds = items.map((m) => m.id);
      setConfirmed((prev) => new Set([...prev, ...allIds]));
      for (const item of items) {
        setHistory((prev) => [{
          name: parsed?.name || "",
          amount: parsed?.amount || 0,
          orderId: item.order_id,
          type: item.type === "phone" ? "전화" : "일반",
          time: new Date().toLocaleTimeString("ko"),
        }, ...prev]);
      }
    } catch { /* ignore */ }
    setConfirming(false);
  };

  const handleConfirm = async (item: MatchedOrder) => processConfirm([item]);

  const handleConfirmAll = async () => {
    const items = matches.filter((m) => !confirmed.has(m.id));
    if (items.length === 0) return;
    await processConfirm(items);
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
          은행 문자를 붙여넣으면 입금자명으로 일반주문 + 전화주문을 자동 매칭합니다.
        </p>
      </div>

      {/* 문자 입력 */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5">
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          은행 입금 문자 붙여넣기
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
                <span className="text-sm font-bold text-blue-900">{parsed.amount.toLocaleString()}원</span>
              </div>
            )}
            <div className="flex-1" />
            <button onClick={handleClear} className="text-xs text-gray-500 hover:text-gray-700 cursor-pointer">초기화</button>
          </div>
        )}

        {!parsed && smsInput.trim() && (
          <p className="mt-2 text-xs text-red-500">문자 형식을 인식하지 못했습니다. 아래에서 직접 검색하세요.</p>
        )}

        {/* 직접 검색 */}
        <div className="flex gap-2 mt-3">
          <input
            type="text"
            placeholder="입금자명 직접 입력 후 Enter"
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
            &quot;{parsed.name}&quot; 이름으로 미입금 주문을 찾을 수 없습니다.
          </p>
          <p className="text-xs text-yellow-600 mt-1">이미 입금확인 된 건이거나, 입금자명이 다를 수 있습니다.</p>
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
                <th className="text-left px-5 py-2 font-medium">구분</th>
                <th className="text-left px-3 py-2 font-medium">주문번호</th>
                <th className="text-left px-3 py-2 font-medium">판매처</th>
                <th className="text-left px-3 py-2 font-medium">상품</th>
                <th className="text-right px-3 py-2 font-medium">수량</th>
                <th className="text-right px-3 py-2 font-medium">금액</th>
                <th className="text-left px-3 py-2 font-medium">입금자/구매자</th>
                <th className="text-left px-3 py-2 font-medium">수령인</th>
                <th className="text-center px-5 py-2 font-medium">확인</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m) => (
                <tr key={`${m.type}-${m.id}`} className={`border-b border-gray-50 ${confirmed.has(m.id) ? "bg-green-50/50" : ""}`}>
                  <td className="px-5 py-2.5">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${m.type === "phone" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
                      {m.type === "phone" ? "전화" : "일반"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs font-mono text-gray-700">{m.order_id}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-600">{m.store_name}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-700 max-w-[200px] truncate">{m.product_name}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-700 text-right">{m.quantity}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-900 text-right font-medium">{m.order_amount > 0 ? `${m.order_amount.toLocaleString()}원` : "-"}</td>
                  <td className="px-3 py-2.5 text-xs font-medium text-blue-700">{m.buyer_name}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-600">{m.receiver_name}</td>
                  <td className="px-5 py-2.5 text-center">
                    {confirmed.has(m.id) ? (
                      <span className="text-xs font-bold text-green-600">확인완료</span>
                    ) : (
                      <button
                        onClick={() => handleConfirm(m)}
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
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${h.type === "전화" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>{h.type}</span>
                <span className="font-medium text-gray-700">{h.name}</span>
                {h.amount > 0 && <span>{h.amount.toLocaleString()}원</span>}
                <span className="font-mono text-gray-500">{h.orderId}</span>
                <span className="text-green-600 font-medium">확인완료</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
