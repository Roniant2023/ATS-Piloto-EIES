import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRole) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  return createClient(url, serviceRole, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const token = String(body?.token || "").trim();
    const approverName = String(body?.approver_name || "").trim();
    const approverSignature = String(
      body?.approver_signature || ""
    ).trim();

    if (!token) {
      return NextResponse.json(
        {
          ok: false,
          error: "token es requerido.",
        },
        {
          status: 400,
        }
      );
    }

    if (!approverSignature) {
      return NextResponse.json(
        {
          ok: false,
          error: "La firma es requerida.",
        },
        {
          status: 400,
        }
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
        {
          ok: false,
          error: linkError.message,
        },
        {
          status: 500,
        }
      );
    }

    if (!linkRow) {
      return NextResponse.json(
        {
          ok: false,
          error: "Link no encontrado.",
        },
        {
          status: 404,
        }
      );
    }

    if (linkRow.status === "signed") {
      return NextResponse.json(
        {
          ok: false,
          error: "Este link ya fue usado.",
        },
        {
          status: 400,
        }
      );
    }

    const signedAt = new Date().toISOString();

    const { error: updateError } = await supabase
      .from("ats_approval_links")
      .update({
        status: "signed",
        signed_at: signedAt,
        approver_name:
          approverName ||
          linkRow.approver_name ||
          "",
        approver_signature_data: approverSignature,
        approver_signed_at: signedAt,
      })
      .eq("id", linkRow.id);

    if (updateError) {
      return NextResponse.json(
        {
          ok: false,
          error: updateError.message,
        },
        {
          status: 500,
        }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "ATS aprobado correctamente.",
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: String(err?.message || err),
      },
      {
        status: 500,
      }
    );
  }
}