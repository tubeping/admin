import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { sendMail } from "@/lib/mail";

/**
 * POST /api/purchase-orders/remind — 미응답 공급사에 리마인더 발송
 * body: { purchase_order_id?: string }  (없으면 전체 미응답 건 처리)
 *
 * 대상: status가 sent인데 viewed/completed가 아닌 발주서
 *       또는 viewed인데 completed가 아닌 발주서 (송장 미등록)
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const poId: string | undefined = body.purchase_order_id;

  const sb = getServiceClient();

  // 미응답 발주서 조회
  let query = sb
    .from("purchase_orders")
    .select("*, suppliers:supplier_id(name, email)")
    .in("status", ["sent", "viewed"]);

  if (poId) {
    query = query.eq("id", poId);
  }

  const { data: pos, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!pos || pos.length === 0) {
    return NextResponse.json({ message: "리마인더 대상이 없습니다", sent: 0 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://tubepingadmin.vercel.app";
  const portalUrl = `${baseUrl}/admin/supplier`;
  const results: { po_number: string; supplier: string; email: string; success: boolean }[] = [];

  for (const po of pos) {
    const supplierEmail = po.suppliers?.email;
    const supplierName = po.suppliers?.name || "";

    if (!supplierEmail || supplierEmail.includes("@tubeping.supplier") || supplierEmail.includes("@cafe24.supplier")) {
      results.push({
        po_number: po.po_number,
        supplier: supplierName,
        email: supplierEmail || "없음",
        success: false,
      });
      continue;
    }

    const daysSinceSent = po.sent_at
      ? Math.floor((Date.now() - new Date(po.sent_at).getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    const isViewed = po.status === "viewed";
    const subject = isViewed
      ? `[TubePing] 송장번호 등록 요청 (${po.po_number})`
      : `[TubePing] 발주 확인 요청 — ${daysSinceSent}일 경과 (${po.po_number})`;

    const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
    <div style="background:#C41E1E;padding:20px 32px;">
      <span style="font-size:22px;font-weight:bold;color:#fff;">
        <span>Tube</span><span>Ping</span>
      </span>
      <span style="color:rgba(255,255,255,0.8);font-size:14px;margin-left:8px;">리마인더</span>
    </div>
    <div style="padding:32px;">
      <p style="font-size:15px;color:#333;line-height:1.6;">
        안녕하세요, <strong>${supplierName}</strong> 담당자님.<br><br>
        ${isViewed
          ? `발주서를 확인해주셨지만 아직 <strong style="color:#C41E1E;">송장번호가 등록되지 않았습니다.</strong><br>
             가능한 빠른 시일 내에 송장번호를 등록해주시면 감사하겠습니다.`
          : `<strong>${daysSinceSent}일 전</strong> 발송드린 발주서(${po.po_number})가 아직 확인되지 않았습니다.<br>
             확인 후 송장번호 등록을 부탁드립니다.`
        }
      </p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        <tr style="border-bottom:1px solid #eee;">
          <td style="padding:10px 16px;font-size:13px;color:#666;">발주번호</td>
          <td style="padding:10px 16px;font-size:14px;font-weight:bold;">${po.po_number}</td>
        </tr>
        <tr style="border-bottom:1px solid #eee;">
          <td style="padding:10px 16px;font-size:13px;color:#666;">상품 수</td>
          <td style="padding:10px 16px;font-size:14px;">${po.total_items}건</td>
        </tr>
        <tr>
          <td style="padding:10px 16px;font-size:13px;color:#666;">접속 비밀번호</td>
          <td style="padding:10px 16px;font-size:22px;font-weight:bold;color:#C41E1E;">${po.access_password}</td>
        </tr>
      </table>
      <a href="${portalUrl}" style="display:inline-block;padding:14px 40px;background:#C41E1E;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
        송장번호 등록하기
      </a>
    </div>
  </div>
</body></html>`;

    const sent = await sendMail(supplierEmail, subject, html);

    results.push({
      po_number: po.po_number,
      supplier: supplierName,
      email: supplierEmail,
      success: sent,
    });
  }

  const sent = results.filter((r) => r.success).length;
  return NextResponse.json({ total: pos.length, sent, results });
}
