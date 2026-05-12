import { NextResponse } from "next/server";
import { issueLinkCode, getMemberByLinkCode, linkKakaoToMember } from "@/lib/teamWorkboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/team/link
 *   action="issue":  { action, member_id }            → { code }
 *   action="verify": { action, code, kakao_user_id }  → { member }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = body.action;

    if (action === "issue") {
      if (!body.member_id) return NextResponse.json({ error: "member_id required" }, { status: 400 });
      const code = await issueLinkCode(body.member_id);
      return NextResponse.json({ code, expires_in_hours: 24 });
    }

    if (action === "verify") {
      if (!body.code || !body.kakao_user_id) {
        return NextResponse.json({ error: "code and kakao_user_id required" }, { status: 400 });
      }
      const member = await getMemberByLinkCode(String(body.code).toUpperCase());
      if (!member) {
        return NextResponse.json({ error: "invalid_or_expired_code" }, { status: 404 });
      }
      await linkKakaoToMember(member.id, body.kakao_user_id);
      return NextResponse.json({ member: { ...member, kakao_user_id: body.kakao_user_id } });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    console.error("[POST /api/team/link]", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
