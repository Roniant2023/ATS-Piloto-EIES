import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const atsId = String(body?.atsId || "").trim();

    if (!atsId) {
      return NextResponse.json(
        { ok: false, error: "Falta atsId." },
        { status: 400 }
      );
    }

    const token = crypto.randomBytes(24).toString("hex");

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // vence en 24 horas

    const { data, error } = await supabase
      .from("ats_records")
      .update({
        approval_status: "PENDING_APPROVER",
        approval_token: token,
        approval_token_expires_at: expiresAt.toISOString(),
        approval_link_sent_at: new Date().toISOString(),
        approval_link_used: false,
      })
      .eq("id", atsId)
      .select("id")
      .single();

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { ok: false, error: "No se encontró el ATS." },
        { status: 404 }
      );
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      new URL(req.url).origin;

    const approvalLink = `${baseUrl}/approve/${token}`;

    return NextResponse.json({
      ok: true,
      approvalLink,
      token,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: String(err?.message || err),
      },
      { status: 500 }
    );
  }
}