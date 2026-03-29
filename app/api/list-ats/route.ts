import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const { data, error } = await supabase
      .from("ats_records")
      .select(`
        id,
        created_at,
        job_title,
        company,
        location,
        work_date,
        shift,
        stop_work_decision,
        hazards_count,
        controls_count
      `)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      return NextResponse.json(
        { error: "No se pudo consultar ATS.", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, data }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Error interno listando ATS.", details: String(err?.message || err) },
      { status: 500 }
    );
  }
}