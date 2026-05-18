"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";

interface InvoiceOrder {
  id: string;
  order_number: string;
  order_date: string;
  product_name: string;
  option_text: string | null;
  quantity: number;
  purchase_price: number;
  supply_price: number;
  total_amount: number;
  shipping_cost: number;
  memo: string | null;
  offline_clients: { id: string; name: string; contact_name: string | null; phone: string | null; address: string | null; business_no: string | null } | null;
}

interface GroupedInvoice {
  client: InvoiceOrder["offline_clients"];
  orders: InvoiceOrder[];
  totalQty: number;
  totalAmount: number;
  totalShipping: number;
  grandTotal: number;
}

export default function InvoicePage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-gray-400">로딩 중...</div>}>
      <InvoiceContent />
    </Suspense>
  );
}

function InvoiceContent() {
  const searchParams = useSearchParams();
  const ids = searchParams.get("ids")?.split(",") || [];
  const [groups, setGroups] = useState<GroupedInvoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (ids.length === 0) { setLoading(false); return; }
    (async () => {
      const res = await fetch(`/admin/api/offline-orders?limit=500`);
      if (!res.ok) { setLoading(false); return; }
      const data = await res.json();
      const allOrders: InvoiceOrder[] = data.orders || [];
      const filtered = allOrders.filter((o) => ids.includes(o.id));

      // 전체를 하나의 명세서로 (공급받는자: 제이드상사 고정)
      const group: GroupedInvoice = { client: null, orders: filtered, totalQty: 0, totalAmount: 0, totalShipping: 0, grandTotal: 0 };
      for (const o of filtered) {
        group.totalQty += o.quantity;
        group.totalAmount += o.purchase_price * o.quantity; // 매입가 기준
        group.totalShipping += o.shipping_cost;
        group.grandTotal += o.purchase_price * o.quantity + o.shipping_cost;
      }
      setGroups([group]);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="p-10 text-center text-gray-400">로딩 중...</div>;
  if (groups.length === 0) return <div className="p-10 text-center text-gray-400">선택된 주문이 없습니다</div>;

  const today = new Date();
  const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;

  return (
    <>
      <style>{`
        @media print {
          body { margin: 0; padding: 0; }
          .no-print { display: none !important; }
          .invoice-page { page-break-after: always; }
          .invoice-page:last-child { page-break-after: auto; }
        }
        @page { size: A4; margin: 15mm; }
      `}</style>

      <div className="no-print fixed top-4 right-4 z-50 flex gap-2">
        <button onClick={() => window.print()}
          className="px-4 py-2 bg-[#C41E1E] text-white text-sm font-medium rounded-lg hover:bg-[#A01818] cursor-pointer shadow-lg">
          인쇄하기
        </button>
        <button onClick={() => window.close()}
          className="px-4 py-2 bg-gray-600 text-white text-sm font-medium rounded-lg hover:bg-gray-700 cursor-pointer shadow-lg">
          닫기
        </button>
      </div>

      {groups.map((g, gi) => (
        <div key={gi} className="invoice-page max-w-[210mm] mx-auto bg-white p-8" style={{ fontFamily: "'Noto Sans KR', 'Malgun Gothic', sans-serif" }}>
          {/* 제목 */}
          <h1 className="text-center text-2xl font-bold tracking-widest border-b-2 border-gray-800 pb-3 mb-6">
            거 래 명 세 서
          </h1>

          {/* 상단 정보 */}
          <div className="flex justify-between mb-6">
            {/* 공급받는자 */}
            <div className="w-[48%]">
              <div className="text-sm font-bold mb-2 bg-gray-100 px-2 py-1">공급받는자</div>
              <table className="w-full text-sm border border-gray-300">
                <tbody>
                  <tr>
                    <td className="border border-gray-300 bg-gray-50 px-2 py-1.5 w-20 font-medium">상 호</td>
                    <td className="border border-gray-300 px-2 py-1.5 font-bold">제이드상사</td>
                  </tr>
                  <tr>
                    <td className="border border-gray-300 bg-gray-50 px-2 py-1.5 font-medium">대표자</td>
                    <td className="border border-gray-300 px-2 py-1.5">엄정호</td>
                  </tr>
                  <tr>
                    <td className="border border-gray-300 bg-gray-50 px-2 py-1.5 font-medium">사업자번호</td>
                    <td className="border border-gray-300 px-2 py-1.5">607-18-66827</td>
                  </tr>
                  <tr>
                    <td className="border border-gray-300 bg-gray-50 px-2 py-1.5 font-medium">주 소</td>
                    <td className="border border-gray-300 px-2 py-1.5 text-xs">부산광역시 동래구 충렬대로95번길 18(온천동)</td>
                  </tr>
                  <tr>
                    <td className="border border-gray-300 bg-gray-50 px-2 py-1.5 font-medium">업 태</td>
                    <td className="border border-gray-300 px-2 py-1.5">도소매 / 전자상거래업</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* 공급자 */}
            <div className="w-[48%]">
              <div className="text-sm font-bold mb-2 bg-gray-100 px-2 py-1">공급자</div>
              <table className="w-full text-sm border border-gray-300">
                <tbody>
                  <tr>
                    <td className="border border-gray-300 bg-gray-50 px-2 py-1.5 w-20 font-medium">상 호</td>
                    <td className="border border-gray-300 px-2 py-1.5 font-bold">(주)신산애널리틱스</td>
                  </tr>
                  <tr>
                    <td className="border border-gray-300 bg-gray-50 px-2 py-1.5 font-medium">대표자</td>
                    <td className="border border-gray-300 px-2 py-1.5">최준</td>
                  </tr>
                  <tr>
                    <td className="border border-gray-300 bg-gray-50 px-2 py-1.5 font-medium">사업자번호</td>
                    <td className="border border-gray-300 px-2 py-1.5">352-81-03270</td>
                  </tr>
                  <tr>
                    <td className="border border-gray-300 bg-gray-50 px-2 py-1.5 font-medium">주 소</td>
                    <td className="border border-gray-300 px-2 py-1.5 text-xs">서울특별시 마포구 마포대로 127, 1826호</td>
                  </tr>
                  <tr>
                    <td className="border border-gray-300 bg-gray-50 px-2 py-1.5 font-medium">업 태</td>
                    <td className="border border-gray-300 px-2 py-1.5">도매 및 소매업 / 전자상거래 소매업</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* 날짜 & 합계 */}
          <div className="flex justify-between items-center mb-4">
            <div className="text-sm text-gray-600">거래일자: <span className="font-medium text-gray-900">{dateStr}</span></div>
            <div className="text-right">
              <span className="text-sm text-gray-600 mr-2">합계금액</span>
              <span className="text-xl font-bold text-gray-900">₩{g.grandTotal.toLocaleString()}</span>
            </div>
          </div>

          {/* 품목 테이블 */}
          <table className="w-full text-sm border-collapse border border-gray-400 mb-4">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-gray-400 px-2 py-2 w-8">No</th>
                <th className="border border-gray-400 px-2 py-2">품 명</th>
                <th className="border border-gray-400 px-2 py-2 w-16">수량</th>
                <th className="border border-gray-400 px-2 py-2 w-24">단 가</th>
                <th className="border border-gray-400 px-2 py-2 w-28">공급가액</th>
                <th className="border border-gray-400 px-2 py-2 w-20">비 고</th>
              </tr>
            </thead>
            <tbody>
              {g.orders.map((o, oi) => (
                <tr key={o.id}>
                  <td className="border border-gray-300 px-2 py-1.5 text-center">{oi + 1}</td>
                  <td className="border border-gray-300 px-2 py-1.5">
                    {o.product_name}
                    {o.option_text && <span className="text-gray-400 text-xs ml-1">({o.option_text})</span>}
                  </td>
                  <td className="border border-gray-300 px-2 py-1.5 text-right">{o.quantity}</td>
                  <td className="border border-gray-300 px-2 py-1.5 text-right">₩{o.purchase_price.toLocaleString()}</td>
                  <td className="border border-gray-300 px-2 py-1.5 text-right font-medium">₩{(o.purchase_price * o.quantity).toLocaleString()}</td>
                  <td className="border border-gray-300 px-2 py-1.5 text-xs text-center">{o.offline_clients?.name || ""}{o.memo ? ` / ${o.memo}` : ""}</td>
                </tr>
              ))}
              {/* 배송비 행 */}
              {g.totalShipping > 0 && (
                <tr>
                  <td className="border border-gray-300 px-2 py-1.5 text-center">{g.orders.length + 1}</td>
                  <td className="border border-gray-300 px-2 py-1.5">배송비</td>
                  <td className="border border-gray-300 px-2 py-1.5 text-right">1</td>
                  <td className="border border-gray-300 px-2 py-1.5 text-right">₩{g.totalShipping.toLocaleString()}</td>
                  <td className="border border-gray-300 px-2 py-1.5 text-right font-medium">₩{g.totalShipping.toLocaleString()}</td>
                  <td className="border border-gray-300 px-2 py-1.5"></td>
                </tr>
              )}
              {/* 빈 행 채우기 (최소 10행) */}
              {Array.from({ length: Math.max(0, 10 - g.orders.length - (g.totalShipping > 0 ? 1 : 0)) }).map((_, i) => (
                <tr key={`empty-${i}`}>
                  <td className="border border-gray-300 px-2 py-1.5">&nbsp;</td>
                  <td className="border border-gray-300 px-2 py-1.5"></td>
                  <td className="border border-gray-300 px-2 py-1.5"></td>
                  <td className="border border-gray-300 px-2 py-1.5"></td>
                  <td className="border border-gray-300 px-2 py-1.5"></td>
                  <td className="border border-gray-300 px-2 py-1.5"></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 font-bold">
                <td colSpan={2} className="border border-gray-400 px-2 py-2 text-center">합 계</td>
                <td className="border border-gray-400 px-2 py-2 text-right">{g.totalQty}</td>
                <td className="border border-gray-400 px-2 py-2"></td>
                <td className="border border-gray-400 px-2 py-2 text-right">₩{g.grandTotal.toLocaleString()}</td>
                <td className="border border-gray-400 px-2 py-2"></td>
              </tr>
            </tfoot>
          </table>

          {/* 하단 안내 */}
          <div className="text-xs text-gray-500 text-center mt-6">
            위와 같이 거래하였음을 확인합니다.
          </div>
          <div className="text-xs text-gray-400 text-center mt-2">
            {dateStr} &nbsp;|&nbsp; (주)신산애널리틱스
          </div>
        </div>
      ))}
    </>
  );
}
