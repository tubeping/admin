"use client";

import { useState, useEffect, useMemo } from "react";

type Supplier = {
  순위?: number;
  grade?: string;
  total_score?: number;
  "판매처(네이버)"?: string;
  사업자명?: string;
  전화번호?: string;
  이메일?: string;
  "인기상품 키워드수"?: number;
  "TOP10 횟수"?: number;
  "인기 키워드"?: string;
  대표상품?: string;
  평균가격?: number;
  대카테고리?: string;
  카테고리?: string;
  브랜드?: string;
  쇼핑몰?: string;
  사업자번호?: string;
  주소?: string;
  지역?: string;
  연락처확인?: boolean | string;
  추천이유?: string;
  출처?: string;
  FTC_상호?: string;
  FTC_대표자?: string;
  FTC_이메일?: string;
  FTC_전화?: string;
  FTC_주소?: string;
  FTC_사업자번호?: string;
  FTC_통신판매번호?: string;
  FTC_업소상태?: string;
  FTC_법인여부?: string;
  FTC_판매채널?: string;
  FTC_매칭방식?: string;
  발송가능이메일?: boolean | string;
  최종이메일?: string;
};

type DbInfo = {
  updated_at: string;
  total: number;
  suppliers: Supplier[];
};

const PAGE_SIZE = 50;

const GRADE_COLORS: Record<string, string> = {
  S: "bg-red-100 text-red-700",
  A: "bg-blue-100 text-blue-700",
  B: "bg-green-100 text-green-700",
  C: "bg-orange-100 text-orange-700",
  D: "bg-gray-100 text-gray-600",
};

function isTrue(v: boolean | string | undefined): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return false;
}

export default function SuppliersOutreachPage() {
  const [data, setData] = useState<DbInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");

  // 필터 상태
  const [search, setSearch] = useState("");
  const [gradeFilter, setGradeFilter] = useState<string>("");
  const [sendableOnly, setSendableOnly] = useState(false);
  const [contactOnly, setContactOnly] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/admin/suppliers-db.json")
      .then((r) => r.json())
      .then((d: DbInfo) => {
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        setErr(String(e));
        setLoading(false);
      });
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    let rows = data.suppliers;
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => {
        return (
          (r["판매처(네이버)"] || "").toLowerCase().includes(q) ||
          (r.사업자명 || "").toLowerCase().includes(q) ||
          (r.이메일 || "").toLowerCase().includes(q) ||
          (r.최종이메일 || "").toLowerCase().includes(q) ||
          (r.브랜드 || "").toLowerCase().includes(q) ||
          (r.카테고리 || "").toLowerCase().includes(q)
        );
      });
    }
    if (gradeFilter) {
      rows = rows.filter((r) => r.grade === gradeFilter);
    }
    if (sendableOnly) {
      rows = rows.filter((r) => isTrue(r.발송가능이메일));
    }
    if (contactOnly) {
      rows = rows.filter((r) => isTrue(r.연락처확인));
    }
    if (sourceFilter) {
      rows = rows.filter((r) => (r.출처 || "") === sourceFilter);
    }
    return rows;
  }, [data, search, gradeFilter, sendableOnly, contactOnly, sourceFilter]);

  const sources = useMemo(() => {
    if (!data) return [];
    const s = new Set<string>();
    data.suppliers.forEach((r) => r.출처 && s.add(r.출처));
    return Array.from(s).sort();
  }, [data]);

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  function toggleSelect(key: string) {
    const ns = new Set(selected);
    if (ns.has(key)) ns.delete(key);
    else ns.add(key);
    setSelected(ns);
  }

  function toggleSelectAll() {
    const pageKeys = paged.map((r) => r["판매처(네이버)"] || "").filter(Boolean);
    const allSelected = pageKeys.every((k) => selected.has(k));
    const ns = new Set(selected);
    pageKeys.forEach((k) => {
      if (allSelected) ns.delete(k);
      else ns.add(k);
    });
    setSelected(ns);
  }

  function exportCsv(rows: Supplier[]) {
    const headers = [
      "순위",
      "grade",
      "total_score",
      "판매처(네이버)",
      "사업자명",
      "대표자(FTC)",
      "최종이메일",
      "전화번호",
      "FTC_전화",
      "사업자번호",
      "주소",
      "카테고리",
      "브랜드",
      "출처",
      "FTC_법인여부",
      "FTC_매칭방식",
      "발송가능이메일",
    ];
    const lines = [headers.join(",")];
    for (const r of rows) {
      const row = [
        r.순위 ?? "",
        r.grade ?? "",
        r.total_score ?? "",
        r["판매처(네이버)"] ?? "",
        r.사업자명 ?? "",
        r.FTC_대표자 ?? "",
        r.최종이메일 ?? r.이메일 ?? "",
        r.전화번호 ?? "",
        r.FTC_전화 ?? "",
        r.사업자번호 ?? r.FTC_사업자번호 ?? "",
        r.주소 ?? r.FTC_주소 ?? "",
        r.카테고리 ?? "",
        r.브랜드 ?? "",
        r.출처 ?? "",
        r.FTC_법인여부 ?? "",
        r.FTC_매칭방식 ?? "",
        isTrue(r.발송가능이메일) ? "O" : "",
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
      lines.push(row.join(","));
    }
    const csv = "﻿" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `suppliers_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="text-gray-500">공급사 DB 로딩 중...</div>
      </div>
    );
  }

  if (err || !data) {
    return (
      <div className="p-8">
        <div className="text-red-600">로딩 실패: {err || "unknown"}</div>
      </div>
    );
  }

  const stats = {
    total: data.total,
    contact: data.suppliers.filter((r) => isTrue(r.연락처확인)).length,
    sendable: data.suppliers.filter((r) => isTrue(r.발송가능이메일)).length,
    ftcMatched: data.suppliers.filter((r) => r.FTC_매칭방식).length,
  };

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">공급사 영업</h1>
        <p className="text-sm text-gray-500 mt-1">
          네이버 스마트스토어 / 레뷰 / 리뷰노트 공급사 {data.total.toLocaleString()}개 · DB 업데이트 {data.updated_at}
        </p>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="전체 공급사" value={stats.total} />
        <StatCard label="연락처 확인" value={stats.contact} color="blue" />
        <StatCard label="FTC DB 매칭" value={stats.ftcMatched} color="purple" />
        <StatCard label="이메일 발송 가능" value={stats.sendable} color="green" />
      </div>

      {/* 필터 */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <input
          type="text"
          placeholder="검색 (판매처명/사업자명/이메일/카테고리...)"
          className="px-3 py-2 border border-gray-300 rounded text-sm w-80"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          className="px-3 py-2 border border-gray-300 rounded text-sm"
          value={gradeFilter}
          onChange={(e) => {
            setGradeFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">등급 전체</option>
          <option value="S">S</option>
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="C">C</option>
          <option value="D">D</option>
        </select>
        <select
          className="px-3 py-2 border border-gray-300 rounded text-sm"
          value={sourceFilter}
          onChange={(e) => {
            setSourceFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">출처 전체</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={contactOnly}
            onChange={(e) => {
              setContactOnly(e.target.checked);
              setPage(1);
            }}
          />
          연락처 확인만
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={sendableOnly}
            onChange={(e) => {
              setSendableOnly(e.target.checked);
              setPage(1);
            }}
          />
          발송 가능 이메일만
        </label>
        <div className="flex-1" />
        <button
          onClick={() => exportCsv(filtered)}
          className="px-3 py-2 text-sm bg-gray-900 text-white rounded hover:bg-gray-800"
        >
          필터 결과 CSV ({filtered.length.toLocaleString()})
        </button>
        {selected.size > 0 && (
          <button
            onClick={() => {
              const selectedRows = data.suppliers.filter((r) =>
                selected.has(r["판매처(네이버)"] || "")
              );
              exportCsv(selectedRows);
            }}
            className="px-3 py-2 text-sm bg-[#C41E1E] text-white rounded hover:bg-red-700"
          >
            선택 {selected.size}건 CSV
          </button>
        )}
      </div>

      <div className="text-sm text-gray-500 mb-2">
        {filtered.length.toLocaleString()}개 결과 · 페이지 {page} / {totalPages || 1}
      </div>

      {/* 테이블 */}
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-3 py-2 w-10">
                <input
                  type="checkbox"
                  onChange={toggleSelectAll}
                  checked={
                    paged.length > 0 &&
                    paged.every((r) => selected.has(r["판매처(네이버)"] || ""))
                  }
                />
              </th>
              <th className="px-3 py-2 text-left w-12">순위</th>
              <th className="px-3 py-2 text-left w-12">등급</th>
              <th className="px-3 py-2 text-left">판매처</th>
              <th className="px-3 py-2 text-left">사업자명 (FTC)</th>
              <th className="px-3 py-2 text-left">대표자</th>
              <th className="px-3 py-2 text-left">이메일</th>
              <th className="px-3 py-2 text-left">전화</th>
              <th className="px-3 py-2 text-left">카테고리/키워드</th>
              <th className="px-3 py-2 text-left w-16">법인</th>
              <th className="px-3 py-2 text-left w-16">출처</th>
              <th className="px-3 py-2 text-left w-16">발송가능</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((r, i) => {
              const key = r["판매처(네이버)"] || `idx_${i}`;
              const email = r.최종이메일 || r.이메일 || "";
              const phone = r.전화번호 || r.FTC_전화 || "";
              const ceo = r.FTC_대표자 || "";
              const bizName = r.사업자명 || r.FTC_상호 || "";
              return (
                <tr key={key} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      onChange={() => toggleSelect(key)}
                    />
                  </td>
                  <td className="px-3 py-2 text-gray-500">{r.순위 || ""}</td>
                  <td className="px-3 py-2">
                    {r.grade && (
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                          GRADE_COLORS[r.grade] || ""
                        }`}
                      >
                        {r.grade}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-medium text-gray-900">
                    {r["판매처(네이버)"] || ""}
                    {r.total_score && (
                      <span className="ml-2 text-xs text-gray-400">
                        {r.total_score}점
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-700">{bizName}</td>
                  <td className="px-3 py-2 text-gray-700">{ceo}</td>
                  <td className="px-3 py-2 text-gray-700">
                    {email ? (
                      <span
                        className={
                          email.includes("*") ? "text-gray-400" : "text-blue-600"
                        }
                      >
                        {email}
                      </span>
                    ) : (
                      <span className="text-gray-300">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    {phone && phone !== "010-개인정보" ? phone : (
                      <span className="text-gray-300">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-500 text-xs max-w-xs truncate">
                    {r.카테고리 || r["인기 키워드"] || ""}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">
                    {r.FTC_법인여부 || ""}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">{r.출처 || ""}</td>
                  <td className="px-3 py-2">
                    {isTrue(r.발송가능이메일) && (
                      <span className="inline-block px-1.5 py-0.5 rounded bg-green-100 text-green-700 text-xs font-medium">
                        OK
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      <div className="flex justify-center gap-2 mt-4">
        <button
          className="px-3 py-1 border rounded disabled:opacity-50"
          disabled={page === 1}
          onClick={() => setPage(1)}
        >
          처음
        </button>
        <button
          className="px-3 py-1 border rounded disabled:opacity-50"
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
        >
          이전
        </button>
        <span className="px-3 py-1 text-sm">
          {page} / {totalPages || 1}
        </span>
        <button
          className="px-3 py-1 border rounded disabled:opacity-50"
          disabled={page >= totalPages}
          onClick={() => setPage(page + 1)}
        >
          다음
        </button>
        <button
          className="px-3 py-1 border rounded disabled:opacity-50"
          disabled={page >= totalPages}
          onClick={() => setPage(totalPages)}
        >
          끝
        </button>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color = "gray",
}: {
  label: string;
  value: number;
  color?: "gray" | "blue" | "green" | "purple";
}) {
  const colors = {
    gray: "bg-gray-50 text-gray-900",
    blue: "bg-blue-50 text-blue-900",
    green: "bg-green-50 text-green-900",
    purple: "bg-purple-50 text-purple-900",
  };
  return (
    <div className={`${colors[color]} rounded-lg p-4`}>
      <div className="text-xs font-medium opacity-70">{label}</div>
      <div className="text-2xl font-bold mt-1">{value.toLocaleString()}</div>
    </div>
  );
}
