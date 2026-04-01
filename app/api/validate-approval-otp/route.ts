import { NextResponse } from "next/server";
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
    const token = String(body?.token || "").trim();
    const otp = String(body?.otp || "").trim();

    if (!token) {
      return NextResponse.json(
        { ok: false, error: "token es requerido." },
        { status: 400 }
      );
    }

    if (!otp) {
      return NextResponse.json(
        { ok: false, error: "otp es requerido." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    const { data: linkRow, error: linkError } = await supabase
      .from("ats_approval_links")
      .select("*")
      .eq("token", token)
      .maybeSingle();

    if (linkError) {
      return NextResponse.json(
        { ok: false, error: linkError.message },
        { status: 500 }
      );
    }

    if (!linkRow) {
      return NextResponse.json(
        { ok: false, error: "Link no encontrado." },
        { status: 404 }
      );
    }

    if (linkRow.status === "signed") {
      return NextResponse.json(
        { ok: false, error: "Este link ya fue utilizado." },
        { status: 400 }
      );
    }

    if (linkRow.expires_at && new Date(linkRow.expires_at).getTime() < Date.now()) {
      return NextResponse.json(
        { ok: false, error: "El link expiró." },
        { status: 400 }
      );
    }

    if (!linkRow.otp_code) {
      return NextResponse.json(
        { ok: false, error: "No hay OTP generado para este link." },
        { status: 400 }
      );
    }

    if (!linkRow.otp_expires_at || new Date(linkRow.otp_expires_at).getTime() < Date.now()) {
      return NextResponse.json(
        { ok: false, error: "El OTP expiró. Solicita uno nuevo." },
        { status: 400 }
      );
    }

    if (String(linkRow.otp_code).trim() !== otp) {
      return NextResponse.json(
        { ok: false, error: "OTP incorrecto." },
        { status: 400 }
      );
    }

    const { error: updateError } = await supabase
      .from("ats_approval_links")
      .update({
        access_validated: true,
        otp_code: null,
        otp_expires_at: null,
      })
      .eq("id", linkRow.id);

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "OTP validado correctamente.",
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}