import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const ats = body?.ats;
    if (!ats) {
      return NextResponse.json(
        { error: "No se recibió ATS para guardar." },
        { status: 400 }
      );
    }

    const hazardsCount = Array.isArray(ats?.hazards) ? ats.hazards.length : 0;

    const controlsCount =
      (Array.isArray(ats?.controls?.engineering) ? ats.controls.engineering.length : 0) +
      (Array.isArray(ats?.controls?.administrative) ? ats.controls.administrative.length : 0) +
      (Array.isArray(ats?.controls?.ppe) ? ats.controls.ppe.length : 0);

    const usedLessonLearned =
      Array.isArray(ats?.procedure_refs_used) &&
      ats.procedure_refs_used.some((p: any) =>
        String(p?.origin || "").toLowerCase().includes("lección")
      );

    const usedNormReference = !!String(body?.norm_reference || "").trim();

    const usedDocuments =
      Array.isArray(ats?.procedure_refs_used) && ats.procedure_refs_used.length > 0;

    const documentsCount = Array.isArray(ats?.procedure_refs_used)
      ? ats.procedure_refs_used.length
      : 0;

    const payload = {
      job_title: ats?.meta?.title || "",
      company: ats?.meta?.company || "",
      location: ats?.meta?.location || "",
      work_date: ats?.meta?.date || "",
      shift: ats?.meta?.shift || "",
      activity_description: body?.activity_description || "",
      norm_reference: body?.norm_reference || "",
      stop_work_decision: ats?.stop_work?.decision || "",
      hazards_count: hazardsCount,
      controls_count: controlsCount,
      used_lesson_learned: usedLessonLearned,
      used_norm_reference: usedNormReference,
      used_documents: usedDocuments,
      documents_count: documentsCount,
      ats_json: ats,
    };

    const { data, error } = await supabase
      .from("ats_records")
      .insert([payload])
      .select();

    if (error) {
      console.error("save-ats supabase error:", error);
      return NextResponse.json(
        { error: "No se pudo guardar el ATS.", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, data }, { status: 200 });
  } catch (err: any) {
    console.error("save-ats route error:", err);
    return NextResponse.json(
      { error: "Error interno guardando ATS.", details: String(err?.message || err) },
      { status: 500 }
    );
  }
}