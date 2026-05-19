"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import * as XLSX from "xlsx";

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
  shipping_method: string;
  shipping_company: string | null;
  tracking_number: string | null;
  status: string;
  payment_status: string;
  memo: string | null;
  offline_clients: { id: string; name: string; contact_name: string | null; phone: string | null; address: string | null; business_no: string | null } | null;
}

interface GroupedInvoice {
  client: InvoiceOrder["offline_clients"];
  orders: InvoiceOrder[];
  totalQty: number;
  totalAmount: number;
  totalSales: number;
  totalMargin: number;
  totalShipping: number;
  grandTotal: number;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "대기", confirmed: "확정", shipped: "출고", delivered: "납품완료", cancelled: "취소",
};
const STATUS_STYLE: Record<string, string> = {
  pending: "text-gray-600", confirmed: "text-blue-700", shipped: "text-yellow-700",
  delivered: "text-green-700", cancelled: "text-red-600",
};
const PAYMENT_LABEL: Record<string, string> = { unpaid: "미입금", paid: "입금완료" };
const SHIPPING_LABEL: Record<string, string> = { courier: "택배", freight: "용달" };

export default function InvoicePage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-gray-400">로딩 중...</div>}>
      <InvoiceContent />
    </Suspense>
  );
}

function calcMargin(o: InvoiceOrder) {
  return ((o.supply_price - o.purchase_price) * o.quantity - o.shipping_cost) / 2;
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

      const group: GroupedInvoice = { client: null, orders: filtered, totalQty: 0, totalAmount: 0, totalSales: 0, totalMargin: 0, totalShipping: 0, grandTotal: 0 };
      for (const o of filtered) {
        const margin = calcMargin(o);
        group.totalQty += o.quantity;
        group.totalAmount += o.purchase_price * o.quantity;
        group.totalSales += o.supply_price * o.quantity;
        group.totalMargin += margin;
        group.totalShipping += o.shipping_cost;
      }
      group.grandTotal = group.totalAmount + group.totalMargin;
      setGroups([group]);
      setLoading(false);
    })();
  }, []);

  const downloadExcel = (g: GroupedInvoice) => {
    const wb = XLSX.utils.book_new();
    const rows: (string | number)[][] = [];
    const merges: XLSX.Range[] = [];
    const todayStr = new Date().toISOString().slice(0, 10);

    // Row 0: 제목 (A~P 병합)
    rows.push(["거 래 명 세 서", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
    merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 15 } });

    // Row 1: 빈 행
    rows.push([]);

    // Row 2~6: 공급받는자 (A~G) / 공급자 (I~O) 나란히
    // A=라벨, B~G=값 / I=라벨, J~O=값
    rows.push(["[공급받는자]", "", "", "", "", "", "", "", "[공급자]", "", "", "", "", "", "", ""]);
    merges.push({ s: { r: 2, c: 0 }, e: { r: 2, c: 7 } });
    merges.push({ s: { r: 2, c: 8 }, e: { r: 2, c: 15 } });

    rows.push(["상 호", "제이드상사", "", "", "", "", "", "", "상 호", "(주)신산애널리틱스", "", "", "", "", "", ""]);
    merges.push({ s: { r: 3, c: 1 }, e: { r: 3, c: 7 } });
    merges.push({ s: { r: 3, c: 9 }, e: { r: 3, c: 15 } });

    rows.push(["대표자", "엄정호", "", "", "", "", "", "", "대표자", "최준", "", "", "", "", "", ""]);
    merges.push({ s: { r: 4, c: 1 }, e: { r: 4, c: 7 } });
    merges.push({ s: { r: 4, c: 9 }, e: { r: 4, c: 15 } });

    rows.push(["사업자번호", "607-18-66827", "", "", "", "", "", "", "사업자번호", "352-81-03270", "", "", "", "", "", ""]);
    merges.push({ s: { r: 5, c: 1 }, e: { r: 5, c: 7 } });
    merges.push({ s: { r: 5, c: 9 }, e: { r: 5, c: 15 } });

    rows.push(["주 소", "부산광역시 동래구 충렬대로95번길 18(온천동)", "", "", "", "", "", "", "주 소", "서울특별시 마포구 마포대로 127, 1826호", "", "", "", "", "", ""]);
    merges.push({ s: { r: 6, c: 1 }, e: { r: 6, c: 7 } });
    merges.push({ s: { r: 6, c: 9 }, e: { r: 6, c: 15 } });

    rows.push(["업 태", "도소매 / 전자상거래업", "", "", "", "", "", "", "업 태", "도매 및 소매업 / 전자상거래 소매업", "", "", "", "", "", ""]);
    merges.push({ s: { r: 7, c: 1 }, e: { r: 7, c: 7 } });
    merges.push({ s: { r: 7, c: 9 }, e: { r: 7, c: 15 } });

    // Row 8: 빈 행
    rows.push([]);

    // Row 9: 거래일자 & 합계금액
    rows.push(["거래일자:", todayStr, "", "", "", "", "", "", "", "", "", "", "합계금액:", "", `₩${Math.round(g.grandTotal).toLocaleString()}`, ""]);
    merges.push({ s: { r: 9, c: 14 }, e: { r: 9, c: 15 } });

    // Row 10: 빈 행
    rows.push([]);

    // Row 11: 품목 헤더
    rows.push(["No", "납품번호", "거래처", "실제납품처", "상품정보", "수량", "공급가", "판매가", "납품금액", "마진", "마진율", "택배비", "배송", "상태", "입금", "납품일"]);

    // 품목 데이터
    g.orders.forEach((o, i) => {
      const margin = Math.round(calcMargin(o));
      const marginRate = o.supply_price > 0 ? ((margin / (o.supply_price * o.quantity)) * 100).toFixed(1) + "%" : "0%";
      rows.push([
        i + 1,
        o.order_number,
        "제이드상사",
        o.offline_clients?.name || "-",
        o.product_name + (o.option_text ? ` (${o.option_text})` : ""),
        o.quantity,
        o.purchase_price,
        o.supply_price,
        o.purchase_price * o.quantity,
        margin,
        marginRate,
        o.shipping_cost,
        SHIPPING_LABEL[o.shipping_method] || o.shipping_method,
        STATUS_LABEL[o.status] || o.status,
        PAYMENT_LABEL[o.payment_status] || o.payment_status,
        o.order_date,
      ]);
    });

    // 합계 행
    rows.push(["", "", "", "", "합 계", g.totalQty, "", "", g.totalAmount, Math.round(g.totalMargin), "", g.totalShipping, "", "", "", ""]);
    const totalRowIdx = rows.length - 1;
    merges.push({ s: { r: totalRowIdx, c: 0 }, e: { r: totalRowIdx, c: 3 } });

    // 빈 행
    rows.push([]);

    // 입금계좌
    rows.push(["입금계좌: 신한은행 140-014-420770 (주)신산애널리틱스", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
    merges.push({ s: { r: rows.length - 1, c: 0 }, e: { r: rows.length - 1, c: 15 } });

    // 안내문
    rows.push(["위와 같이 거래하였음을 확인합니다.", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
    merges.push({ s: { r: rows.length - 1, c: 0 }, e: { r: rows.length - 1, c: 15 } });

    rows.push([`${todayStr}  |  (주)신산애널리틱스`, "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
    merges.push({ s: { r: rows.length - 1, c: 0 }, e: { r: rows.length - 1, c: 15 } });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!merges"] = merges;

    // 열 너비
    ws["!cols"] = [
      { wch: 5 },  // No
      { wch: 20 }, // 납품번호
      { wch: 12 }, // 거래처
      { wch: 18 }, // 실제납품처
      { wch: 26 }, // 상품정보
      { wch: 6 },  // 수량
      { wch: 10 }, // 공급가
      { wch: 10 }, // 판매가
      { wch: 14 }, // 납품금액
      { wch: 12 }, // 마진
      { wch: 8 },  // 마진율
      { wch: 10 }, // 택배비
      { wch: 8 },  // 배송
      { wch: 10 }, // 상태
      { wch: 10 }, // 입금
      { wch: 12 }, // 납품일
    ];

    XLSX.utils.book_append_sheet(wb, ws, "거래명세서");
    XLSX.writeFile(wb, `거래명세서_${todayStr}.xlsx`);
  };

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
          aside, nav, [data-sidebar] { display: none !important; }
          main { margin-left: 0 !important; }
        }
        @page { size: A4 landscape; margin: 10mm; }
      `}</style>

      <div className="no-print fixed top-4 right-4 z-50 flex gap-2">
        <button onClick={() => groups[0] && downloadExcel(groups[0])}
          className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 cursor-pointer shadow-lg">
          엑셀 다운로드
        </button>
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
        <div key={gi} className="invoice-page max-w-[297mm] mx-auto bg-white p-8" style={{ fontFamily: "'Noto Sans KR', 'Malgun Gothic', sans-serif" }}>
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
              <span className="text-xl font-bold text-gray-900">₩{Math.round(g.grandTotal).toLocaleString()}</span>
            </div>
          </div>

          {/* 품목 테이블 */}
          <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse border border-gray-400 mb-4">
            <thead>
              <tr className="bg-gray-100 text-[11px]">
                <th className="border border-gray-400 px-1.5 py-2 w-7">No</th>
                <th className="border border-gray-400 px-1.5 py-2">납품번호</th>
                <th className="border border-gray-400 px-1.5 py-2">거래처</th>
                <th className="border border-gray-400 px-1.5 py-2">실제납품처</th>
                <th className="border border-gray-400 px-1.5 py-2">상품정보</th>
                <th className="border border-gray-400 px-1.5 py-2 w-12 text-right">수량</th>
                <th className="border border-gray-400 px-1.5 py-2 text-right">공급가</th>
                <th className="border border-gray-400 px-1.5 py-2 text-right">판매가</th>
                <th className="border border-gray-400 px-1.5 py-2 text-right">납품금액</th>
                <th className="border border-gray-400 px-1.5 py-2 text-right">마진</th>
                <th className="border border-gray-400 px-1.5 py-2 text-right">택배비</th>
                <th className="border border-gray-400 px-1.5 py-2 text-center">배송</th>
                <th className="border border-gray-400 px-1.5 py-2 text-center">상태</th>
                <th className="border border-gray-400 px-1.5 py-2 text-center">입금</th>
                <th className="border border-gray-400 px-1.5 py-2">납품일</th>
              </tr>
            </thead>
            <tbody>
              {g.orders.map((o, oi) => {
                const margin = calcMargin(o);
                const marginRate = o.supply_price > 0 ? ((margin / (o.supply_price * o.quantity)) * 100).toFixed(1) : "0";
                return (
                <tr key={o.id}>
                  <td className="border border-gray-300 px-1.5 py-1.5 text-center">{oi + 1}</td>
                  <td className="border border-gray-300 px-1.5 py-1.5 whitespace-nowrap">
                    {o.order_number}
                    <div className="text-[9px] text-gray-400">{o.order_date}</div>
                  </td>
                  <td className="border border-gray-300 px-1.5 py-1.5 font-medium">제이드상사</td>
                  <td className="border border-gray-300 px-1.5 py-1.5">{o.offline_clients?.name || "-"}</td>
                  <td className="border border-gray-300 px-1.5 py-1.5">
                    {o.product_name}
                    {o.option_text && <div className="text-[9px] text-gray-400">{o.option_text}</div>}
                  </td>
                  <td className="border border-gray-300 px-1.5 py-1.5 text-right">{o.quantity}</td>
                  <td className="border border-gray-300 px-1.5 py-1.5 text-right whitespace-nowrap">₩{o.purchase_price.toLocaleString()}</td>
                  <td className="border border-gray-300 px-1.5 py-1.5 text-right whitespace-nowrap">₩{o.supply_price.toLocaleString()}</td>
                  <td className="border border-gray-300 px-1.5 py-1.5 text-right font-medium whitespace-nowrap">₩{(o.purchase_price * o.quantity).toLocaleString()}</td>
                  <td className="border border-gray-300 px-1.5 py-1.5 text-right whitespace-nowrap">
                    <span className={margin >= 0 ? "text-green-600" : "text-red-500"}>₩{Math.round(margin).toLocaleString()}</span>
                    <div className="text-[9px] text-gray-400">{marginRate}%</div>
                  </td>
                  <td className="border border-gray-300 px-1.5 py-1.5 text-right">{o.shipping_cost.toLocaleString()}</td>
                  <td className="border border-gray-300 px-1.5 py-1.5 text-center">
                    <span className={`px-1 py-0.5 rounded ${o.shipping_method === "freight" ? "bg-orange-100 text-orange-700" : "bg-gray-100 text-gray-600"}`}>
                      {SHIPPING_LABEL[o.shipping_method] || o.shipping_method}
                    </span>
                    {o.tracking_number && <div className="text-[9px] text-gray-400 mt-0.5">{o.tracking_number}</div>}
                  </td>
                  <td className="border border-gray-300 px-1.5 py-1.5 text-center">
                    <span className={`font-medium ${STATUS_STYLE[o.status] || ""}`}>{STATUS_LABEL[o.status] || o.status}</span>
                  </td>
                  <td className="border border-gray-300 px-1.5 py-1.5 text-center">
                    <span className={`font-medium ${o.payment_status === "paid" ? "text-green-600" : "text-red-500"}`}>
                      {PAYMENT_LABEL[o.payment_status] || o.payment_status}
                    </span>
                  </td>
                  <td className="border border-gray-300 px-1.5 py-1.5 whitespace-nowrap">{o.order_date}</td>
                </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 font-bold text-[11px]">
                <td colSpan={5} className="border border-gray-400 px-1.5 py-2 text-center">합 계</td>
                <td className="border border-gray-400 px-1.5 py-2 text-right">{g.totalQty}</td>
                <td className="border border-gray-400 px-1.5 py-2"></td>
                <td className="border border-gray-400 px-1.5 py-2"></td>
                <td className="border border-gray-400 px-1.5 py-2 text-right">₩{g.totalAmount.toLocaleString()}</td>
                <td className="border border-gray-400 px-1.5 py-2 text-right">₩{Math.round(g.totalMargin).toLocaleString()}</td>
                <td className="border border-gray-400 px-1.5 py-2 text-right">{g.totalShipping.toLocaleString()}</td>
                <td colSpan={4} className="border border-gray-400 px-1.5 py-2"></td>
              </tr>
            </tfoot>
          </table>
          </div>

          {/* 입금 계좌 */}
          <div className="mt-6 border border-gray-300 rounded px-4 py-3 bg-gray-50">
            <div className="text-sm font-bold text-gray-700 mb-1">입금 계좌</div>
            <div className="text-sm text-gray-900">신한은행 140-014-420770 (주)신산애널리틱스</div>
          </div>

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
