import nodemailer from "nodemailer";

const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (!transporter && SMTP_USER && SMTP_PASS) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

interface Attachment {
  filename: string;
  content: string | Buffer;
  contentType?: string;
}

export async function sendMail(
  to: string,
  subject: string,
  html: string,
  attachments?: Attachment[]
): Promise<boolean> {
  const t = getTransporter();
  if (!t) {
    console.log(`[메일 시뮬레이션] to: ${to} | subject: ${subject} | 첨부: ${attachments?.length || 0}개`);
    return true;
  }

  try {
    await t.sendMail({
      from: `"TubePing" <${SMTP_USER}>`,
      to,
      subject,
      html,
      attachments,
    });
    console.log(`[메일 발송 완료] to: ${to}`);
    return true;
  } catch (err) {
    console.error(`[메일 발송 실패] to: ${to}`, err);
    return false;
  }
}
