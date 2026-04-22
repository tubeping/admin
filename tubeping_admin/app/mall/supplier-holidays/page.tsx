"use client";

import { useState, useEffect, useCallback } from "react";

interface Holiday {
  id: string;
  supplier_id: string | null;
  supplier_name: string;
  date_from: string;
  date_to: string;
  type: string;
  title: string;
  detail: string;
  source: string;
}

interface Supplier {
  id: string;
  name: string;
}

const TYPE_COLOR: Record<string, string> = {
  holiday: "bg-red-100 text-red-700 border-red-200",
  delay: "bg-yellow-100 text-yellow-700 border-yellow-200",
  notice: "bg-blue-100 text-blue-700 border-blue-200",
};
const TYPE_LABEL: Record<string, string> = {
  holiday: "휴무",
  delay: "지연",
  notice: "공지",
};

export default function SupplierHolidaysPage() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    supplier_id: "",
    date_from: new Date().toISOString().slice(0, 10),
    date_to: new Date().toISOString().slice(0, 10),
    type: "holiday",
    title: "",
    detail: "",
  });

  const fetchHolidays = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/admin/api/supplier-holidays?month=${month}`);
    const data = await res.json();
    setHolidays(data.holidays || []);
    setLoading(false);
  }, [month]);

  useEffect(() => {
    fetchHolidays();
    fetch("/admin/api/suppliers?status=active").then((r) => r.json()).then((d) => setSuppliers(d.suppliers || []));
  }, [fetchHolidays]);

  const handleAdd = async () => {
    if (!form.title.trim()) { alert("제목 입력"); return; }
    const sup = suppliers.find((s) => s.id === form.supplier_id);
    const res = await fetch("/admin/api/supplier-holidays", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, supplier_name: sup?.name || "" }),
    });
    if (res.ok) {
      setShowAdd(false);
      setForm({ supplier_id: "", date_from: new Date().toISOString().slice(0, 10), date_to: new Date().toISOString().slice(0, 10), type: "holiday", title: "", detail: "" });
      fetchHolidays();
    } else {
      const d = await res.json();
      alert(`실패: ${d.error}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("삭제하시겠습니까?")) return;
    await fetch("/admin/api/supplier-holidays", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchHolidays();
  };

  // 캘린더 셀 생성
  const [y, m] = month.split("-").map(Number);
  const firstDay = new Date(y, m - 1, 1);
  const lastDay = new Date(y, m, 0);
  const daysInMonth = lastDay.getDate();
  const startDayOfWeek = firstDay.getDay();

  const today = new Date().toISOString().slice(0, 10);

  // 날짜별 휴무 매핑
  const holidaysByDate: Record<string, Holiday[]> = {};
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    holidaysByDate[dateStr] = holidays.filter((h) => h.date_from <= dateStr && h.date_to >= dateStr);
  }

  // KST에서 new Date(y, m, 1).toISOString()은 UTC로 하루 밀리면서 월도 바뀌지 않음.
  // 타임존 안 타게 로컬 년/월 그대로 산술.
  const prevMonth = () => {
    const nm = m === 1 ? 12 : m - 1;
    const ny = m === 1 ? y - 1 : y;
    setMonth(`${ny}-${String(nm).padStart(2, "0")}`);
  };
  const nextMonth = () => {
    const nm = m === 12 ? 1 : m + 1;
    const ny = m === 12 ? y + 1 : y;
    setMonth(`${ny}-${String(nm).padStart(2, "0")}`);
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">공급사 휴무 캘린더</h1>
          <p className="text-xs text-gray-500 mt-1">공급사 배송 휴무·지연 일정 관리</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowAdd(true)} className="px-4 py-2 bg-[#C41E1E] text-white text-sm rounded-lg hover:bg-[#A01818]">+ 휴무 등록</button>
        </div>
      </div>

      {/* 월 네비 */}
      <div className="relative flex items-center justify-between mb-4 bg-white p-4 rounded-xl border z-10">
        <button type="button" onClick={prevMonth} className="relative z-10 px-3 py-1.5 border rounded hover:bg-gray-50 cursor-pointer">◀</button>
        <div className="text-lg font-bold">{y}년 {m}월</div>
        <button type="button" onClick={nextMonth} className="relative z-10 px-3 py-1.5 border rounded hover:bg-gray-50 cursor-pointer">▶</button>
      </div>

      {/* 캘린더 */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="grid grid-cols-7 border-b">
          {["일", "월", "화", "수", "목", "금", "토"].map((d, i) => (
            <div key={d} className={`text-center py-2 text-xs font-semibold ${i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-gray-700"}`}>
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: startDayOfWeek }).map((_, i) => (
            <div key={`empty-${i}`} className="h-28 border-r border-b bg-gray-50" />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const dateStr = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const isToday = dateStr === today;
            const dayOfWeek = (startDayOfWeek + i) % 7;
            const dayHolidays = holidaysByDate[dateStr] || [];
            return (
              <div key={day} className={`h-28 border-r border-b p-1 overflow-hidden ${isToday ? "bg-yellow-50" : ""}`}>
                <div className={`text-xs font-medium mb-1 ${dayOfWeek === 0 ? "text-red-500" : dayOfWeek === 6 ? "text-blue-500" : "text-gray-700"} ${isToday ? "font-bold" : ""}`}>
                  {day}
                </div>
                <div className="space-y-0.5">
                  {dayHolidays.slice(0, 3).map((h) => (
                    <div
                      key={h.id}
                      className={`text-[10px] px-1 py-0.5 rounded border truncate cursor-pointer ${TYPE_COLOR[h.type] || TYPE_COLOR.holiday}`}
                      title={`${h.supplier_name}\n${h.title}\n${h.detail}`}
                      onClick={() => handleDelete(h.id)}
                    >
                      <span className="font-semibold">{h.supplier_name}</span>
                    </div>
                  ))}
                  {dayHolidays.length > 3 && <div className="text-[9px] text-gray-400">+{dayHolidays.length - 3}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 리스트 */}
      <div className="mt-6 bg-white rounded-xl border">
        <div className="px-4 py-3 border-b font-semibold text-sm">{y}년 {m}월 목록 ({holidays.length}건)</div>
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">로딩 중...</div>
        ) : holidays.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">등록된 휴무가 없습니다.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b">
                <th className="text-left px-4 py-2">공급사</th>
                <th className="text-left px-3 py-2">기간</th>
                <th className="text-left px-3 py-2">종류</th>
                <th className="text-left px-3 py-2">제목</th>
                <th className="text-left px-3 py-2">출처</th>
                <th className="text-center px-3 py-2">삭제</th>
              </tr>
            </thead>
            <tbody>
              {holidays.map((h) => (
                <tr key={h.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium">{h.supplier_name}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">{h.date_from} ~ {h.date_to}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${TYPE_COLOR[h.type] || TYPE_COLOR.holiday}`}>
                      {TYPE_LABEL[h.type] || h.type}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-700">{h.title}</td>
                  <td className="px-3 py-2 text-xs text-gray-400">{h.source === "gmail" ? "자동" : "수동"}</td>
                  <td className="px-3 py-2 text-center">
                    <button onClick={() => handleDelete(h.id)} className="text-xs text-red-500 hover:underline">삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 등록 모달 */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-[500px]">
            <h2 className="text-lg font-bold mb-4">휴무 등록</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">공급사</label>
                <select value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })} className="w-full border rounded px-3 py-2 text-sm">
                  <option value="">선택...</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">시작일</label>
                  <input type="date" value={form.date_from} onChange={(e) => setForm({ ...form, date_from: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">종료일</label>
                  <input type="date" value={form.date_to} onChange={(e) => setForm({ ...form, date_to: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">종류</label>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full border rounded px-3 py-2 text-sm">
                  <option value="holiday">휴무</option>
                  <option value="delay">배송지연</option>
                  <option value="notice">공지</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">제목</label>
                <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="예: 설연휴 배송 휴무" className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">상세</label>
                <textarea value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} rows={3} className="w-full border rounded px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 border rounded hover:bg-gray-50 text-sm">취소</button>
              <button onClick={handleAdd} className="px-4 py-2 bg-[#C41E1E] text-white rounded text-sm hover:bg-[#A01818]">등록</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
