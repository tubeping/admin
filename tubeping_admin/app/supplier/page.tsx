"use client";

import { useState } from "react";
import * as XLSX from "xlsx";

interface OrderItem {
  id: string;
  cafe24_order_id: string;
  cafe24_order_item_code: string;
  product_name: string;
  option_text: string;
  quantity: number;
  product_price: number;
  order_amount: number;
  receiver_name: string;
  receiver_address: string;
  receiver_zipcode: string;
  shipping_company: string;
  tracking_number: string;
  shipping_status: string;
}

interface POInfo {
  id: string;
  po_number: string;
  order_date: string;
  supplier_name: string;
  total_items: number;
  total_amount: number;
  status: string;
}

const SHIPPING_COMPANIES = [
  "CJ대한통운",
  "한진택배",
  "롯데택배",
  "우체국택배",
  "로젠택배",
  "경동택배",
  "대신택배",
  "일양로지스",
  "GS편의점택배",
  "CU편의점택배",
];

export default function SupplierPortal() {
  const [step, setStep] = useState<"login" | "orders" | "upload">("login");
  const [poNumber, setPoNumber] = useState("");
  const [password, setPassword] = useState(["", "", "", ""]);
  const [po, setPo] = useState<POInfo | null>(null);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [shipments, setShipments] = useState<
    Record<string, { shipping_company: string; tracking_number: string }>
  >({});
  const [submitting, setSubmitting] = useState(false);
  const [loginError, setLoginError] = useState("");

  // 4자리 비밀번호 입력
  const handlePasswordInput = (index: number, value: string) => {
    if (value.length > 1) value = value.slice(-1);
    if (!/^\d*$/.test(value)) return;

    const next = [...password];
    next[index] = value;
    setPassword(next);

    // 자동 포커스 이동
    if (value && index < 3) {
      const nextInput = document.getElementById(`pin-${index + 1}`);
      nextInput?.focus();
    }
  };

  const handleLogin = async () => {
    const pw = password.join("");
    if (pw.length !== 4) return;

    setLoginError("");
    const res = await fetch("/admin/api/supplier-portal/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });

    const data = await res.json();
    if (!res.ok) {
      setLoginError(data.error || "로그인 실패");
      return;
    }

    setPo(data.purchase_order);
    setOrders(data.orders);
    setPoNumber(data.purchase_order.po_number);

    // 기존 송장 정보 로드
    const initial: Record<string, { shipping_company: string; tracking_number: string }> = {};
    for (const o of data.orders) {
      initial[o.id] = {
        shipping_company: o.shipping_company || "CJ대한통운",
        tracking_number: o.tracking_number || "",
      };
    }
    setShipments(initial);
    setStep("orders");
  };

  const handleDownload = () => {
    const pw = password.join("");
    window.open(
      `/admin/api/supplier-portal/download?po_number=${poNumber}&password=${pw}`,
      "_blank"
    );
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 파일 타입 감지 (.xlsx / .xls / .csv)
    const fname = file.name.toLowerCase();
    const isExcel = fname.endsWith(".xlsx") || fname.endsWith(".xls");

    let rows: string[][] = [];
    try {
      if (isExcel) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        if (!sheet) {
          alert("엑셀 시트를 찾을 수 없습니다.");
          return;
        }
        const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
        rows = aoa
          .map((r) => (r as unknown[]).map((c) => (c == null ? "" : String(c).trim())))
          .filter((r) => r.some((c) => c !== ""));
      } else {
        const text = await file.text();
        const lines = text.replace(/^\uFEFF/, "").split("\n").map((l) => l.trim()).filter((l) => l);
        rows = lines.map((l) => {
          // 간단 CSV 파서: 따옴표 안의 쉼표 처리
          const out: string[] = [];
          let cur = "";
          let inQ = false;
          for (let i = 0; i < l.length; i++) {
            const ch = l[i];
            if (ch === '"') inQ = !inQ;
            else if (ch === "," && !inQ) { out.push(cur); cur = ""; }
            else cur += ch;
          }
          out.push(cur);
          return out.map((c) => c.replace(/^"|"$/g, "").trim());
        });
      }
    } catch (err) {
      alert("파일을 읽을 수 없습니다: " + (err instanceof Error ? err.message : String(err)));
      return;
    }

    if (rows.length < 2) {
      alert("데이터가 없습니다.");
      return;
    }

    // 헤더 이름으로 컬럼 위치 찾기 (공급사별 커스텀 양식 지원)
    const header = rows[0].map((h) => h.replace(/\s+/g, "").toLowerCase());
    const findCol = (...candidates: string[]): number => {
      for (const c of candidates) {
        const idx = header.indexOf(c.toLowerCase());
        if (idx >= 0) return idx;
      }
      // 부분 매칭도 허용
      for (const c of candidates) {
        const idx = header.findIndex((h) => h.includes(c.toLowerCase()));
        if (idx >= 0) return idx;
      }
      return -1;
    };

    const orderIdCol = findCol("주문번호", "order_id");
    const itemCodeCol = findCol("주문상품고유번호", "주문상품번호", "상품주문번호", "order_item_code");
    const companyCol = findCol("택배사", "배송사", "shipping_company");
    const trackingCol = findCol("배송번호", "송장번호", "운송장번호", "tracking_number");

    if (orderIdCol < 0 || trackingCol < 0) {
      alert(
        `필수 컬럼을 찾을 수 없습니다.\n헤더: ${rows[0].join(", ")}\n\n"주문번호" / "배송번호" 컬럼이 반드시 있어야 합니다.`
      );
      return;
    }

    const updated = { ...shipments };
    // 중복 매칭 방지: 같은 주문에 여러 옵션이 있으면 item_code로 정확히 구분.
    // 파일에 item_code 컬럼이 없으면 같은 주문의 미등록 항목 순서대로 배정.
    const consumedIds = new Set<string>();
    let matched = 0;
    let skipped = 0;
    for (let i = 1; i < rows.length; i++) {
      const cols = rows[i];
      const orderId = (cols[orderIdCol] || "").trim();
      const itemCode = itemCodeCol >= 0 ? (cols[itemCodeCol] || "").trim() : "";
      const tracking = (cols[trackingCol] || "").trim();
      const company = companyCol >= 0 ? (cols[companyCol] || "").trim() : "";
      if (!orderId || !tracking) { skipped++; continue; }

      let order: OrderItem | undefined;
      if (itemCode) {
        // 정확 매칭: (order_id, item_code)
        order = orders.find(
          (o) => o.cafe24_order_id === orderId && o.cafe24_order_item_code === itemCode
        );
      }
      if (!order) {
        // fallback: 같은 주문번호 중 아직 매칭 안 된 첫 항목
        order = orders.find(
          (o) => o.cafe24_order_id === orderId && !consumedIds.has(o.id)
        );
      }
      if (!order) { skipped++; continue; }

      consumedIds.add(order.id);
      updated[order.id] = {
        shipping_company: company || "CJ대한통운",
        tracking_number: tracking,
      };
      matched++;
    }
    setShipments(updated);
    alert(`${matched}건 반영 (${skipped}건 건너뜀)\n\n아래 "송장번호 등록" 버튼을 눌러 최종 저장하세요.`);
  };

  const handleSubmitShipments = async () => {
    setSubmitting(true);
    const pw = password.join("");

    const shipmentData = orders
      .filter((o) => shipments[o.id]?.tracking_number)
      .map((o) => ({
        cafe24_order_id: o.cafe24_order_id,
        cafe24_order_item_code: o.cafe24_order_item_code,
        shipping_company: shipments[o.id].shipping_company,
        tracking_number: shipments[o.id].tracking_number,
      }));

    if (shipmentData.length === 0) {
      alert("송장번호가 입력된 항목이 없습니다.");
      setSubmitting(false);
      return;
    }

    const res = await fetch("/admin/api/supplier-portal/shipments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        po_number: poNumber,
        password: pw,
        shipments: shipmentData,
      }),
    });

    const data = await res.json();
    if (data.failed && data.failed > 0) {
      alert(`송장 등록 완료: ${data.success}건 성공, ${data.failed}건 실패\n실패한 항목은 다시 확인해주세요.`);
    } else {
      alert("송장 등록이 완료되었습니다.");
    }
    setSubmitting(false);

    // 새로고침
    handleLogin();
  };

  // ========== 로그인 화면 ==========
  if (step === "login") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-lg w-full max-w-md p-8">
          {/* 로고 */}
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold">
              <span className="text-[#C41E1E]">Tube</span>
              <span className="text-[#111]">Ping</span>
              <span className="text-gray-500 text-lg ml-2">공급사 시스템</span>
            </h1>
            <div className="w-full h-px bg-gray-200 mt-4" />
          </div>

          {/* 비밀번호 */}
          <div className="mb-6">
            <p className="text-sm text-gray-600 mb-3">
              메일로 발송된 <span className="text-[#C41E1E] font-semibold">접속 비밀번호</span>를 입력해주세요.
            </p>
            <div className="flex gap-3 justify-center">
              {password.map((digit, i) => (
                <input
                  key={i}
                  id={`pin-${i}`}
                  value={digit}
                  onChange={(e) => handlePasswordInput(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" && !digit && i > 0) {
                      document.getElementById(`pin-${i - 1}`)?.focus();
                    }
                  }}
                  className="w-14 h-14 text-center text-2xl font-bold border-2 border-gray-200 rounded-lg focus:border-[#C41E1E] focus:outline-none"
                  maxLength={1}
                  inputMode="numeric"
                />
              ))}
            </div>
          </div>

          {loginError && (
            <p className="text-sm text-red-500 text-center mb-4">{loginError}</p>
          )}

          <button
            onClick={handleLogin}
            disabled={password.join("").length !== 4}
            className="w-full py-3 bg-[#1a5c3a] text-white font-semibold rounded-lg hover:bg-[#14472d] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            로그인
          </button>
        </div>
      </div>
    );
  }

  // ========== 발주서 확인 + 송장 등록 ==========
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">
            <span className="text-[#C41E1E]">Tube</span>
            <span className="text-[#111]">Ping</span>
            <span className="text-gray-500 text-sm ml-2">송장번호 등록</span>
          </h1>
          <button
            onClick={() => {
              setStep("login");
              setPo(null);
              setOrders([]);
            }}
            className="text-sm text-gray-500 hover:text-gray-700 cursor-pointer"
          >
            로그아웃
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* 발주서 정보 */}
        {po && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <div className="grid grid-cols-5 gap-4 text-sm">
              <div>
                <span className="text-gray-500">발주번호</span>
                <p className="font-semibold mt-1">{po.po_number}</p>
              </div>
              <div>
                <span className="text-gray-500">공급사</span>
                <p className="font-semibold mt-1">{po.supplier_name}</p>
              </div>
              <div>
                <span className="text-gray-500">발주일</span>
                <p className="font-semibold mt-1">{po.order_date}</p>
              </div>
              <div>
                <span className="text-gray-500">총 상품수</span>
                <p className="font-semibold mt-1">{po.total_items}건</p>
              </div>
            </div>
          </div>
        )}

        {/* 안내 + 버튼 */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <p className="text-sm font-semibold text-amber-800 mb-2">
            송장번호를 등록해주세요.
          </p>
          <ol className="text-xs text-amber-700 space-y-1 mb-2 list-decimal list-inside">
            <li>
              <span className="font-semibold">[발주서 다운로드]</span> 버튼으로 주문 목록 엑셀을 받습니다.
            </li>
            <li>
              엑셀의 <span className="text-red-600 font-medium">택배사 · 배송번호</span> 열을 채워서 저장합니다.
            </li>
            <li>
              <span className="font-semibold">[엑셀송장등록]</span> 버튼으로 파일을 업로드하면 아래 표에 값이 자동으로 채워집니다.
            </li>
            <li>
              표 내용을 확인한 뒤 <span className="font-semibold">[송장번호 등록]</span> 버튼을 눌러 최종 저장하세요.
            </li>
          </ol>
          <ul className="text-[11px] text-amber-600 space-y-0.5 pt-2 border-t border-amber-200">
            <li>· 엑셀 첫행(헤더) 제목은 변경하면 인식되지 않습니다.</li>
            <li>· 필수 컬럼: <span className="font-medium">주문번호, 택배사, 배송번호</span></li>
            <li>· 이미 등록한 송장번호가 있으면 새로 등록한 값으로 업데이트됩니다.</li>
          </ul>
        </div>

        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={handleDownload}
            className="px-4 py-2.5 bg-white border border-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 cursor-pointer"
          >
            발주서 다운로드 (CSV)
          </button>
          <label className="px-4 py-2.5 bg-[#1a5c3a] text-white text-sm font-medium rounded-lg hover:bg-[#14472d] cursor-pointer">
            엑셀송장등록
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
          <button
            onClick={handleSubmitShipments}
            disabled={submitting}
            className="px-4 py-2.5 bg-[#111] text-white text-sm font-medium rounded-lg hover:bg-[#333] cursor-pointer disabled:opacity-50"
          >
            {submitting ? "등록 중..." : "송장번호 등록"}
          </button>
          <span className="text-xs text-gray-400 ml-2">
            여러 파일을 한번에 업로드할 수 있습니다.
          </span>
        </div>

        {/* 주문 목록 + 송장 입력 */}
        <div className="bg-white rounded-xl border border-gray-200">
          <table className="w-full">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-100">
                <th className="text-left px-6 py-3 font-medium">주문번호</th>
                <th className="text-left px-3 py-3 font-medium">상품명</th>
                <th className="text-left px-3 py-3 font-medium">옵션</th>
                <th className="text-right px-3 py-3 font-medium">수량</th>
                <th className="text-left px-3 py-3 font-medium">수령자</th>
                <th className="text-left px-3 py-3 font-medium">택배사</th>
                <th className="text-left px-3 py-3 font-medium">송장번호</th>
                <th className="text-center px-3 py-3 font-medium">상태</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-gray-50 last:border-0">
                  <td className="px-6 py-3 text-sm font-medium text-gray-900">
                    {o.cafe24_order_id}
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-700">{o.product_name}</td>
                  <td className="px-3 py-3 text-sm text-gray-500">{o.option_text || "-"}</td>
                  <td className="px-3 py-3 text-sm text-gray-700 text-right">{o.quantity}</td>
                  <td className="px-3 py-3 text-sm text-gray-700">{o.receiver_name}</td>
                  <td className="px-3 py-3">
                    <select
                      value={shipments[o.id]?.shipping_company || "CJ대한통운"}
                      onChange={(e) =>
                        setShipments({
                          ...shipments,
                          [o.id]: { ...shipments[o.id], shipping_company: e.target.value },
                        })
                      }
                      className="text-xs border border-gray-200 rounded px-2 py-1.5 w-28"
                      disabled={o.shipping_status === "shipping" || o.shipping_status === "delivered"}
                    >
                      {SHIPPING_COMPANIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-3">
                    <input
                      value={shipments[o.id]?.tracking_number || ""}
                      onChange={(e) =>
                        setShipments({
                          ...shipments,
                          [o.id]: { ...shipments[o.id], tracking_number: e.target.value },
                        })
                      }
                      className="text-xs border border-gray-200 rounded px-2 py-1.5 w-36"
                      placeholder="송장번호 입력"
                      disabled={o.shipping_status === "delivered"}
                    />
                  </td>
                  <td className="px-3 py-3 text-center">
                    {o.tracking_number ? (
                      <span className="text-xs text-green-600 font-medium">등록완료</span>
                    ) : (
                      <span className="text-xs text-gray-400">미등록</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
