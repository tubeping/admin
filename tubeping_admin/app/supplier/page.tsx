"use client";

import { useState } from "react";

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
    if (!poNumber || pw.length !== 4) return;

    setLoginError("");
    const res = await fetch("/admin/api/supplier-portal/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ po_number: poNumber, password: pw }),
    });

    const data = await res.json();
    if (!res.ok) {
      setLoginError(data.error || "로그인 실패");
      return;
    }

    setPo(data.purchase_order);
    setOrders(data.orders);

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

    // CSV 파싱
    const text = await file.text();
    const lines = text.split("\n").filter((l) => l.trim());
    if (lines.length < 2) return;

    const updated = { ...shipments };
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.replace(/"/g, "").trim());
      // 컬럼: 주문번호, 주문상품고유번호, 상품코드, 상품명, 옵션, 수량, 수령자, 배송지, 우편번호, 택배사, 배송번호
      const orderId = cols[0];
      const company = cols[9] || "";
      const tracking = cols[10] || "";

      if (orderId && tracking) {
        // 매칭되는 주문 찾기
        const order = orders.find((o) => o.cafe24_order_id === orderId);
        if (order) {
          updated[order.id] = {
            shipping_company: company || "CJ대한통운",
            tracking_number: tracking,
          };
        }
      }
    }
    setShipments(updated);
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
    alert(`송장 등록 완료: ${data.success}건 성공, ${data.failed}건 실패`);
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
              <div>
                <span className="text-gray-500">총 금액</span>
                <p className="font-semibold mt-1">₩{po.total_amount.toLocaleString()}</p>
              </div>
            </div>
          </div>
        )}

        {/* 안내 + 버튼 */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <p className="text-sm font-semibold text-amber-800 mb-2">
            거래처에서 전달 받은 엑셀 파일로 송장번호를 등록합니다.
          </p>
          <ul className="text-xs text-amber-700 space-y-1">
            <li>· 엑셀 첫행의 제목은 변경하실 수 없습니다.</li>
            <li>
              · 엑셀의 <span className="text-red-600 font-medium">주문번호, 주문상품고유번호, 상품코드, 택배사, 배송번호</span> 열은 반드시 존재해야 합니다.
            </li>
            <li>· 이미 등록하신 송장번호가 있으면 새로 등록한 송장번호로 업데이트 됩니다.</li>
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
            엑셀파일 찾기
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
