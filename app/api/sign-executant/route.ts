import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const token = String(body?.token || "").trim();

    if (!token) {
      return NextResponse.json({ ok: false, error: "Token requerido." }, { status: 400 });
    }

    const { error } = await supabase
      .from("ats_executant_signatures")
      .update({
        name: body?.name || "",
        role: body?.role || "",
        document_id: body?.documentId || "",
        signature_data: body?.signature || "",
        status: "signed",
        signed_at: new Date().toISOString(),
      })
      .eq("token", token);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Error interno." },
      { status: 500 }
    );
  }
}