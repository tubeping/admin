import StatementPage from "./statement/page";

// /admin/finance 는 손익계산서(/admin/finance/statement) 와 같은 화면으로 통합.
// 사이드바의 "재무 대시보드" = 손익계산서 = 동일 URL 들 다 같은 화면.
// (구버전 ShinsanNative dashboard 는 더 이상 사용 안 함. 2025 결산 비교 / 거래처 TOP 5 등
//  유용 요소는 후속 작업에서 손익계산서 페이지에 카드로 통합 예정.)
export default function FinancePage() {
  return <StatementPage />;
}
