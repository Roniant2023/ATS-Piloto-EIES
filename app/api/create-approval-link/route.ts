import { NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRole) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const atsId = String(body?.ats_id || "").trim();
    const approverName = String(body?.approver_name || "").trim();

    if (!atsId) {
      return NextResponse.json(
        { ok: false, error: "ats_id es requerido." },
        { status: 400 }
      );
    }

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_VERCEL_URL ||
      "";

    if (!appUrl) {
      return NextResponse.json(
        { ok: false, error: "Falta NEXT_PUBLIC_APP_URL." },
        { status: 500 }
      );
    }

    const baseUrl = appUrl.startsWith("http") ? appUrl : `https://${appUrl}`;
    const supabase = getSupabaseAdmin();

    const token = crypto.randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(); // 7 días

    const { error } = await supabase.from("ats_approval_links").insert({
      ats_id: atsId,
      token,
      approver_name: approverName || null,
      status: "pending",
      expires_at: expiresAt,
    });

    if (error) {
      return NextResponse.json(
        { ok: false, error: `No se pudo guardar el link: ${error.message}` },
        { status: 500 }
      );
    }

    const approval_url = `${baseUrl}/ats/aprobar/${token}`;

    return NextResponse.json({
      ok: true,
      token,
      approval_url,
      expires_at: expiresAt,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}