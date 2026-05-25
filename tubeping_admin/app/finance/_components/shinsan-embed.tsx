"use client";

import { useState } from "react";

const SHINSAN_BASE = "https://hub.eumlogics.kr/shinsan/";

interface ShinsanEmbedProps {
  title: string;
  hash: string;
}

export default function ShinsanEmbed({ title, hash }: ShinsanEmbedProps) {
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const url = `${SHINSAN_BASE}#${hash}`;

  return (
    <div className="h-full flex flex-col">
      <header className="px-6 py-4 border-b border-gray-200 bg-white flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{title}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            신산애널리틱스 재무 허브 ·{" "}
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#C41E1E] hover:underline"
            >
              hub.eumlogics.kr/shinsan
            </a>
          </p>
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-[#C41E1E] hover:bg-[#A01818] rounded-md transition-colors"
        >
          새 창에서 열기
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </header>

      <div className="flex-1 relative bg-[#F9FAFB]">
        {loading && !blocked && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex items-center gap-3 text-gray-500">
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path fill="currentColor" className="opacity-75" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm">불러오는 중…</span>
            </div>
          </div>
        )}
        {blocked ? (
          <div className="absolute inset-0 flex items-center justify-center px-6">
            <div className="max-w-md text-center">
              <p className="text-sm text-gray-700 mb-3">
                보안 정책으로 이 페이지 내 임베드가 차단되었습니다.
              </p>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-[#C41E1E] hover:bg-[#A01818] rounded-md transition-colors"
              >
                새 창에서 열기
              </a>
            </div>
          </div>
        ) : (
          <iframe
            src={url}
            title={title}
            className="w-full h-full border-0"
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setBlocked(true);
            }}
          />
        )}
      </div>
    </div>
  );
}
