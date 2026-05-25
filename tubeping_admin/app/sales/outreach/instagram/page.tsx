"use client";

import { useState, useEffect, useMemo } from "react";

type Account = {
  rank: number;
  grade: string;
  score: number;
  username: string;
  full_name: string;
  followers: number;
  posts: number;
  likes_max: number;
  likes_total: number;
  categories: string;
  subcats: string;
  sample_url: string;
  biography: string;
  email: string;
  phone: string;
  kakao: string;
  external_url: string;
  has_contact: boolean;
};

type DbInfo = {
  updated_at: string;
  total: number;
  stats: {
    grades: Record<string, number>;
    contact: number;
    email: number;
    phone: number;
    kakao: number;
  };
  accounts: Account[];
};

const PAGE_SIZE = 50;

const GRADE_COLORS: Record<string, string> = {
  S: "bg-red-100 text-red-700",
  A: "bg-blue-100 text-blue-700",
  B: "bg-green-100 text-green-700",
  C: "bg-orange-100 text-orange-700",
  D: "bg-gray-100 text-gray-600",
};


function fmt(n: number): string {
  if (!n) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 10_000) return (n / 10_000).toFixed(1) + "만";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

export default function InstagramOutreachPage() {
  const [data, setData] = useState<DbInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");

  const [search, setSearch] = useState("");
  const [gradeFilter, setGradeFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [contactOnly, setContactOnly] = useState(false);
  const [emailOnly, setEmailOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/admin/instagram-db.json")
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

  const categories = useMemo(() => {
    if (!data) return [];
    const s = new Set<string>();
    data.accounts.forEach((r) => {
      if (r.categories) {
        r.categories.split(" / ").forEach((c) => s.add(c));
      }
    });
    return Array.from(s).sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let rows = data.accounts;
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.username.toLowerCase().includes(q) ||
          (r.full_name || "").toLowerCase().includes(q) ||
          (r.biography || "").toLowerCase().includes(q) ||
          (r.email || "").toLowerCase().includes(q) ||
          (r.subcats || "").toLowerCase().includes(q)
      );
    }
    if (gradeFilter) rows = rows.filter((r) => r.grade === gradeFilter);
    if (categoryFilter) rows = rows.filter((r) => (r.categories || "").includes(categoryFilter));
    if (contactOnly) rows = rows.filter((r) => r.has_contact);
    if (emailOnly) rows = rows.filter((r) => !!r.email);
    return rows;
  }, [data, search, gradeFilter, categoryFilter, contactOnly, emailOnly]);

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  function toggleSelect(key: string) {
    const ns = new Set(selected);
    if (ns.has(key)) ns.delete(key);
    else ns.add(key);
    setSelected(ns);
  }

  function toggleSelectAll() {
    const pageKeys = paged.map((r) => r.username);
    const allSelected = pageKeys.every((k) => selected.has(k));
    const ns = new Set(selected);
    pageKeys.forEach((k) => {
      if (allSelected) ns.delete(k);
      else ns.add(k);
    });
    setSelected(ns);
  }

  function exportCsv(rows: Account[]) {
    const headers = [
      "rank",
      "grade",
      "score",
      "username",
      "full_name",
      "followers",
      "likes_max",
      "posts",
      "categories",
      "subcats",
      "email",
      "phone",
      "kakao",
      "external_url",
      "biography",
      "sample_url",
    ];
    const lines = [headers.join(",")];
    for (const r of rows) {
      const row = [
        r.rank,
        r.grade,
        r.score,
        r.username,
        r.full_name,
        r.followers,
        r.likes_max,
        r.posts,
        r.categories,
        r.subcats,
        r.email,
        r.phone,
        r.kakao,
        r.external_url,
        (r.biography || "").replace(/\n/g, " "),
        r.sample_url,
      ].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`);
      lines.push(row.join(","));
    }
    const csv = "﻿" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `instagram_outreach_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="text-gray-500">인스타 계정 DB 로딩 중...</div>
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

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">인스타 공구 아웃리치</h1>
        <p className="text-sm text-gray-500 mt-1">
          인스타 공구 계정 {data.total.toLocaleString()}개 · DB 업데이트 {data.updated_at}
        </p>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-6 gap-3 mb-6">
        <StatCard label="전체 계정" value={data.total} />
        <StatCard label="S등급" value={data.stats.grades.S || 0} color="red" />
        <StatCard label="A등급" value={data.stats.grades.A || 0} color="blue" />
        <StatCard label="B등급" value={data.stats.grades.B || 0} color="green" />
        <StatCard label="연락처 확보" value={data.stats.contact} color="purple" />
        <StatCard label="이메일 가능" value={data.stats.email} color="green" />
      </div>

      {/* 필터 */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <input
          type="text"
          placeholder="검색 (username / 이름 / bio / email / 카테고리...)"
          className="px-3 py-2 border border-gray-300 rounded text-sm w-96"
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
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">카테고리 전체</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
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
          연락처 확보만
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={emailOnly}
            onChange={(e) => {
              setEmailOnly(e.target.checked);
              setPage(1);
            }}
          />
          이메일 있음만
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
              const selectedRows = data.accounts.filter((r) => selected.has(r.username));
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
                  checked={paged.length > 0 && paged.every((r) => selected.has(r.username))}
                />
              </th>
              <th className="px-3 py-2 text-left w-12">#</th>
              <th className="px-3 py-2 text-left w-12">등급</th>
              <th className="px-3 py-2 text-left">계정</th>
              <th className="px-3 py-2 text-right w-20">팔로워</th>
              <th className="px-3 py-2 text-right w-20">최고♥</th>
              <th className="px-3 py-2 text-right w-12">게시</th>
              <th className="px-3 py-2 text-left">카테고리</th>
              <th className="px-3 py-2 text-left">이메일</th>
              <th className="px-3 py-2 text-left">전화/카톡</th>
              <th className="px-3 py-2 text-left w-16">링크</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((r) => {
              return (
                <tr key={r.username} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(r.username)}
                      onChange={() => toggleSelect(r.username)}
                    />
                  </td>
                  <td className="px-3 py-2 text-gray-500">{r.rank}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                        GRADE_COLORS[r.grade] || ""
                      }`}
                    >
                      {r.grade}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <a
                      href={`https://www.instagram.com/${r.username}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-gray-900 hover:text-blue-600"
                    >
                      @{r.username}
                    </a>
                    {r.full_name && (
                      <div className="text-xs text-gray-400">{r.full_name}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700">{fmt(r.followers)}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{fmt(r.likes_max)}</td>
                  <td className="px-3 py-2 text-right text-gray-500">{r.posts}</td>
                  <td className="px-3 py-2 text-xs text-gray-500 max-w-xs truncate" title={r.subcats}>
                    {r.categories}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {r.email ? (
                      <a href={`mailto:${r.email}`} className="text-blue-600 hover:underline">
                        {r.email}
                      </a>
                    ) : (
                      <span className="text-gray-300">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600">
                    {r.phone && <div>📞 {r.phone}</div>}
                    {r.kakao && <div className="text-yellow-700">💬 {r.kakao.slice(0, 40)}</div>}
                    {!r.phone && !r.kakao && <span className="text-gray-300">-</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.external_url ? (
                      <a
                        href={r.external_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        링크
                      </a>
                    ) : (
                      <span className="text-gray-300">-</span>
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
  color?: "gray" | "blue" | "green" | "purple" | "red";
}) {
  const colors = {
    gray: "bg-gray-50 text-gray-900",
    blue: "bg-blue-50 text-blue-900",
    green: "bg-green-50 text-green-900",
    purple: "bg-purple-50 text-purple-900",
    red: "bg-red-50 text-red-900",
  };
  return (
    <div className={`${colors[color]} rounded-lg p-4`}>
      <div className="text-xs font-medium opacity-70">{label}</div>
      <div className="text-2xl font-bold mt-1">{value.toLocaleString()}</div>
    </div>
  );
}
