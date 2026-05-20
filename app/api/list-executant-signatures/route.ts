import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const atsId = body?.atsId;

    if (!atsId) {
      return NextResponse.json(
        { error: "ATS requerido." },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("ats_executant_signatures")
      .select("*")
      .eq("ats_id", atsId)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      data: data || [],
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Error interno." },
      { status: 500 }
    );
  }
}