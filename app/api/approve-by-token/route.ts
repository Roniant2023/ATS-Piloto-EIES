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
    const approverName = String(body?.approver_name || "").trim();
    const approverSignature = String(body?.approver_signature || "").trim();

    if (!token) {
      return NextResponse.json(
        { ok: false, error: "token es requerido." },
        { status: 400 }
      );
    }

    if (!approverSignature) {
      return NextResponse.json(
        { ok: false, error: "La firma del aprobador es requerida." },
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
        { ok: false, error: "Este link ya fue usado." },
        { status: 400 }
      );
    }

    if (linkRow.expires_at && new Date(linkRow.expires_at).getTime() < Date.now()) {
      return NextResponse.json(
        { ok: false, error: "El link expiró." },
        { status: 400 }
      );
    }

    if (!linkRow.access_validated) {
      return NextResponse.json(
        { ok: false, error: "Acceso no validado. Debes ingresar el código OTP antes de firmar." },
        { status: 403 }
      );
    }

    const { data: atsRow, error: atsError } = await supabase
      .from("ats_records")
      .select("id, ats_json")
      .eq("id", linkRow.ats_id)
      .maybeSingle();

    if (atsError) {
      return NextResponse.json(
        { ok: false, error: atsError.message },
        { status: 500 }
      );
    }

    if (!atsRow) {
      return NextResponse.json(
        { ok: false, error: "ATS asociado no encontrado." },
        { status: 404 }
      );
    }

    const ats = atsRow.ats_json || {};
    const estrella = ats?.estrella_format || {};
    const authorizations = estrella?.authorizations || {};

    const updatedAts = {
      ...ats,
      estrella_format: {
        ...estrella,
        authorizations: {
          ...authorizations,
          approver: {
            ...(authorizations?.approver || {}),
            name:
              approverName ||
              authorizations?.approver?.name ||
              linkRow?.approver_name ||
              "",
            signature: approverSignature,
            signedAt: new Date().toISOString(),
          },
        },
      },
    };

    const { error: updateAtsError } = await supabase
      .from("ats_records")
      .update({
        ats_json: updatedAts,
      })
      .eq("id", atsRow.id);

    if (updateAtsError) {
      return NextResponse.json(
        { ok: false, error: updateAtsError.message },
        { status: 500 }
      );
    }

    const { error: updateLinkError } = await supabase
      .from("ats_approval_links")
      .update({
        status: "signed",
        signed_at: new Date().toISOString(),
        otp_code: null,
        otp_expires_at: null,
      })
      .eq("id", linkRow.id);

    if (updateLinkError) {
      return NextResponse.json(
        { ok: false, error: updateLinkError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "ATS aprobado correctamente.",
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}