import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
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
    const atsId = body?.atsId;
    const executants = Array.isArray(body?.executants) ? body.executants : [];

    if (!atsId) {
      return NextResponse.json({ ok: false, error: "ATS requerido" }, { status: 400 });
    }

    const validExecutants = executants
      .map((e: any) => ({
        name: String(e?.name || "").trim(),
        phone: String(e?.signature || "").replace(/\D/g, ""),
      }))
      .filter((e: any) => e.name && e.phone);

    if (validExecutants.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No hay ejecutantes con nombre y WhatsApp." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    const rows = validExecutants.map((e: any) => ({
      ats_id: atsId,
      token: randomUUID(),
      name: e.name,
      role: "",
      document_id: "",
      signature_data: "",
      status: "pending",
    }));

    const { data, error } = await supabase
      .from("ats_executant_signatures")
      .insert(rows)
      .select();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    const links = (data || []).map((row: any, index: number) => ({
      id: row.id,
      name: row.name,
      phone: validExecutants[index]?.phone || "",
      token: row.token,
      signUrl: `${baseUrl}/ats/sign/${row.token}`,
    }));

    return NextResponse.json({
      ok: true,
      links,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Error inesperado" },
      { status: 500 }
    );
  }
}