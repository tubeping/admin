import "server-only";
import { publicEnv } from "./env.public";

function req(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required server env: ${key}`);
  return v;
}

function opt(key: string, defaultValue = ""): string {
  return process.env[key] ?? defaultValue;
}

export const env = {
  ...publicEnv,

  SUPABASE_SERVICE_ROLE_KEY: req("SUPABASE_SERVICE_ROLE_KEY"),

  CAFE24_CLIENT_ID: req("CAFE24_CLIENT_ID").trim(),
  CAFE24_CLIENT_SECRET: req("CAFE24_CLIENT_SECRET").trim(),
  CAFE24_MALL_ID: opt("CAFE24_MALL_ID"),
  CAFE24_ACCESS_TOKEN: opt("CAFE24_ACCESS_TOKEN"),
  CAFE24_REFRESH_TOKEN: opt("CAFE24_REFRESH_TOKEN"),

  CHANNELTALK_ACCESS_KEY: opt("CHANNELTALK_ACCESS_KEY"),
  CHANNELTALK_ACCESS_SECRET: opt("CHANNELTALK_ACCESS_SECRET"),

  SMTP_USER: opt("SMTP_USER"),
  SMTP_PASS: opt("SMTP_PASS"),

  GEMINI_API_KEY: opt("GEMINI_API_KEY"),
  YOUTUBE_API_KEY: opt("YOUTUBE_API_KEY"),
  CRON_SECRET: opt("CRON_SECRET"),
} as const;
