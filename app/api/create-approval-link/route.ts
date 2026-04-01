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
    const approverRole = String(body?.approver_role || "").trim();
    const approverEmail = String(body?.approver_email || "").trim();
    const approverPhone = String(body?.approver_phone || "").trim();

    if (!atsId) {
      return NextResponse.json(
        { ok: false, error: "ats_id es requerido." },
        { status: 400 }
      );
    }

    if (!approverName) {
      return NextResponse.json(
        { ok: false, error: "approver_name es requerido." },
        { status: 400 }
      );
    }

    if (!approverEmail) {
      return NextResponse.json(
        { ok: false, error: "approver_email es requerido." },
        { status: 400 }
      );
    }

    if (!approverPhone) {
      return NextResponse.json(
        { ok: false, error: "approver_phone es requerido." },
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
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();

    const { error } = await supabase.from("ats_approval_links").insert({
      ats_id: atsId,
      token,
      approver_name: approverName,
      approver_role: approverRole || null,
      approver_email: approverEmail,
      approver_phone: approverPhone,
      status: "pending",
      expires_at: expiresAt,
      access_validated: false,
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