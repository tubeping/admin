"use client";

import { useState, useEffect } from "react";

interface Store {
  id: string;
  mall_id: string;
  name: string;
  status: string;
  channel: string | null;
  store_url: string | null;
  last_sync_at: string | null;
  created_at: string;
  influencer_rate: number;
  company_rate: number;
  settlement_type: string;
  pg_fee_rate: number;
  tpl_cost: number;
  other_cost: number;
  other_cost_label: string;
  bank_name: string;
  bank_account: string;
  bank_holder: string;
  business_no: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  order_count?: number;
  total_amount?: number;
}

export default function SellersPage() {
  const [sellers, setSellers] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", mall_id: "", channel: "", store_url: "" });
  const [editId, setEditId] = useState<string | null>(null);
  const [config, setConfig] = useState({
    influencer_rate: 70, company_rate: 30, settlement_type: "사업자", pg_fee_rate: 3.74,
    tpl_cost: 0, other_cost: 0, other_cost_label: "기타비용",
    bank_name: "", bank_account: "", bank_holder: "", business_no: "",
    contact_name: "", contact_email: "", contact_phone: "",
  });
  const [saving, setSaving] = useState(false);

  const fetchSellers = async () => {
    setLoading(true);
    const res = await fetch("/admin/api/stores");
    const data = await res.json();
    const stores: Store[] = data.stores || [];

    const orderRes = await fetch("/admin/api/orders?limit=9999");
    const orderData = await orderRes.json();
    const orders = orderData.orders || [];

    const countMap: Record<string, { count: number; amount: number }> = {};
    for (const o of orders) {
      const sid = o.store_id;
      if (!countMap[sid]) countMap[sid] = { count: 0, amount: 0 };
      countMap[sid].count++;
      countMap[sid].amount += o.order_amount || 0;
    }

    setSellers(stores.map((s) => ({
      ...s,
      order_count: countMap[s.id]?.count || 0,
      total_amount: countMap[s.id]?.amount || 0,
    })));
    setLoading(false);
  };

  useEffect(() => { fetchSellers(); }, []);

  const handleAdd = async () => {
    if (!form.name) return;
    await fetch("/admin/api/stores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mall_id: form.mall_id || "manual_" + Date.now(),
        name: form.name, channel: form.channel || null, store_url: form.store_url || null,
      }),
    });
    setForm({ name: "", mall_id: "", channel: "", store_url: "" });
    setShowForm(false);
    fetchSellers();
  };

  const openConfig = (seller: Store) => {
    setEditId(seller.id);
    setConfig({
      influencer_rate: seller.influencer_rate ?? 70, company_rate: seller.company_rate ?? 30,
      settlement_type: seller.settlement_type || "사업자", pg_fee_rate: seller.pg_fee_rate ?? 3.74,
      tpl_cost: seller.tpl_cost ?? 0, other_cost: seller.other_cost ?? 0,
      other_cost_label: seller.other_cost_label || "기타비용",
      bank_name: seller.bank_name || "", bank_account: seller.bank_account || "",
      bank_holder: seller.bank_holder || "", business_no: seller.business_no || "",
      contact_name: seller.contact_name || "", contact_email: seller.contact_email || "",
      contact_phone: seller.contact_phone || "",
    });
  };

  const saveConfig = async () => {
    if (!editId) return;
    setSaving(true);
    await fetch("/admin/api/stores/settlement-config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store_id: editId, ...config }),
    });
    setSaving(false);
    setEditId(null);
    fetchSellers();
  };

  const totalOrders = sellers.reduce((s, v) => s + (v.order_count || 0), 0);
  const totalAmount = sellers.reduce((s, v) => s + (v.total_amount || 0), 0);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">판매자 관리</h1>
          <p className="text-sm text-gray-500 mt-1">판매채널(스토어)별 정산 조건 및 현황 관리</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="px-4 py-2.5 bg-[#C41E1E] text-white text-sm font-medium rounded-lg hover:bg-[#A01818] transition-colors cursor-pointer">+ 판매자 추가</button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {[
          { label: "전체 판매자", value: `${sellers.length}개` },
          { label: "총 주문", value: `${totalOrders.toLocaleString()}건` },
          { label: "총 매출", value: `₩${totalAmount.toLocaleString()}` },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500">{s.label}</p>
            <p className="text-lg font-bold text-gray-900 mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {/* 추가 폼 */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">새 판매자 등록</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { key: "name", label: "판매자명 *", ph: "완선몰" },
              { key: "mall_id", label: "카페24 Mall ID", ph: "shinsan006" },
              { key: "channel", label: "채널", ph: "유튜브, 인스타 등" },
              { key: "store_url", label: "스토어 URL", ph: "https://..." },
            ].map((f) => (
              <div key={f.key}>
                <label className="text-xs text-gray-500 block mb-1">{f.label}</label>
                <input value={form[f.key as keyof typeof form]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder={f.ph} />
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={handleAdd} className="px-4 py-2 bg-[#C41E1E] text-white text-sm rounded-lg hover:bg-[#A01818] cursor-pointer">등록</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 border border-gray-300 text-sm rounded-lg hover:bg-gray-50 cursor-pointer">취소</button>
          </div>
        </div>
      )}

      {/* 목록 */}
      <div className="bg-white rounded-xl border border-gray-200">
        {loading ? (
          <div className="p-12 text-center text-gray-400">불러오는 중...</div>
        ) : sellers.length === 0 ? (
          <div className="p-12 text-center text-gray-400">등록된 판매자가 없습니다. 위의 &quot;+ 판매자 추가&quot; 버튼으로 추가하세요.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-100">
                <th className="text-left px-6 py-3 font-medium">판매자명</th>
                <th className="text-left px-3 py-3 font-medium">Mall ID</th>
                <th className="text-center px-3 py-3 font-medium">분배 비율</th>
                <th className="text-center px-3 py-3 font-medium">정산방식</th>
                <th className="text-right px-3 py-3 font-medium">주문 수</th>
                <th className="text-right px-3 py-3 font-medium">총 매출</th>
                <th className="text-center px-6 py-3 font-medium">설정</th>
              </tr>
            </thead>
            <tbody>
              {sellers.map((s) => (
                <tr key={s.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                  <td className="px-6 py-3.5 text-sm font-medium text-gray-900">{s.name}</td>
                  <td className="px-3 py-3.5"><code className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">{s.mall_id}</code></td>
                  <td className="px-3 py-3.5 text-center"><span className="text-xs font-medium text-blue-600">{s.influencer_rate ?? 70}:{s.company_rate ?? 30}</span></td>
                  <td className="px-3 py-3.5 text-center">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.settlement_type === "프리랜서" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
                      {s.settlement_type || "사업자"}
                    </span>
                  </td>
                  <td className="px-3 py-3.5 text-sm text-gray-700 text-right font-medium">{(s.order_count || 0).toLocaleString()}건</td>
                  <td className="px-3 py-3.5 text-sm text-gray-700 text-right">₩{(s.total_amount || 0).toLocaleString()}</td>
                  <td className="px-6 py-3.5 text-center">
                    <button onClick={() => openConfig(s)} className="text-xs text-[#C41E1E] hover:underline cursor-pointer font-medium">정산설정</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 정산조건 설정 모달 */}
      {editId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setEditId(null)}>
          <div className="bg-white rounded-2xl w-[640px] max-h-[90vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">정산 조건 설정</h2>
              <p className="text-xs text-gray-500 mt-1">{sellers.find((s) => s.id === editId)?.name} — 정산 비율, 비용, 계좌 정보</p>
            </div>
            <div className="p-6 space-y-6">
              {/* 수익 분배 */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">수익 분배</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">인플루언서 비율 (%)</label>
                    <input type="number" min={0} max={100} value={config.influencer_rate}
                      onChange={(e) => { const v = Number(e.target.value); setConfig({ ...config, influencer_rate: v, company_rate: 100 - v }); }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">회사 비율 (%)</label>
                    <input type="number" min={0} max={100} value={config.company_rate}
                      onChange={(e) => { const v = Number(e.target.value); setConfig({ ...config, company_rate: v, influencer_rate: 100 - v }); }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">정산방식</label>
                    <select value={config.settlement_type} onChange={(e) => setConfig({ ...config, settlement_type: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                      <option value="사업자">사업자</option>
                      <option value="프리랜서">프리랜서</option>
                    </select>
                  </div>
                </div>
              </div>
              {/* 수수료/비용 */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">수수료 및 비용</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">PG수수료율 (%)</label>
                    <input type="number" step={0.01} value={config.pg_fee_rate} onChange={(e) => setConfig({ ...config, pg_fee_rate: Number(e.target.value) })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">3PL 물류비 (월/원)</label>
                    <input type="number" value={config.tpl_cost} onChange={(e) => setConfig({ ...config, tpl_cost: Number(e.target.value) })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">{config.other_cost_label} (월/원)</label>
                    <input type="number" value={config.other_cost} onChange={(e) => setConfig({ ...config, other_cost: Number(e.target.value) })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>
              </div>
              {/* 사업자/계좌 */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">사업자 / 계좌 정보</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="text-xs text-gray-500 block mb-1">사업자등록번호</label><input value={config.business_no} onChange={(e) => setConfig({ ...config, business_no: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="000-00-00000" /></div>
                  <div><label className="text-xs text-gray-500 block mb-1">담당자명</label><input value={config.contact_name} onChange={(e) => setConfig({ ...config, contact_name: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" /></div>
                  <div><label className="text-xs text-gray-500 block mb-1">이메일</label><input value={config.contact_email} onChange={(e) => setConfig({ ...config, contact_email: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" /></div>
                  <div><label className="text-xs text-gray-500 block mb-1">연락처</label><input value={config.contact_phone} onChange={(e) => setConfig({ ...config, contact_phone: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" /></div>
                </div>
                <div className="grid grid-cols-3 gap-4 mt-4">
                  <div><label className="text-xs text-gray-500 block mb-1">은행명</label><input value={config.bank_name} onChange={(e) => setConfig({ ...config, bank_name: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="국민은행" /></div>
                  <div><label className="text-xs text-gray-500 block mb-1">계좌번호</label><input value={config.bank_account} onChange={(e) => setConfig({ ...config, bank_account: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" /></div>
                  <div><label className="text-xs text-gray-500 block mb-1">예금주</label><input value={config.bank_holder} onChange={(e) => setConfig({ ...config, bank_holder: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" /></div>
                </div>
              </div>
            </div>
            <div className="p-6 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setEditId(null)} className="px-4 py-2.5 border border-gray-300 text-sm rounded-lg hover:bg-gray-50 cursor-pointer">취소</button>
              <button onClick={saveConfig} disabled={saving} className="px-6 py-2.5 bg-[#C41E1E] text-white text-sm font-medium rounded-lg hover:bg-[#A01818] disabled:opacity-50 cursor-pointer">
                {saving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
