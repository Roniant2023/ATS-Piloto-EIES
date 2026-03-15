export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const ATS_MODEL = process.env.ATS_MODEL || "gpt-4.1-mini";

/* =========================
Helpers
========================= */

function pickString(v: any, fallback = "") {
  return typeof v === "string" ? v : fallback;
}

function safeArrayStrings(v: any): string[] {
  return Array.isArray(v)
    ? v.map((x) => String(x ?? "").trim()).filter(Boolean)
    : [];
}

function mergeUnique(a: string[], b: string[]) {
  return [...new Set([...(a || []), ...(b || [])])];
}

/* =========================
Normativa
========================= */

type NormRef = {
  standard: string;
  clause: string | null;
  note: string | null;
  url: string | null;
};

function normalizeNormRefs(v: any): NormRef[] {
  const arr = Array.isArray(v) ? v : [];

  return arr
    .map((x) => ({
      standard: String(x?.standard ?? "").trim(),
      clause: String(x?.clause ?? "").trim(),
      note: String(x?.note ?? "").trim(),
      url: String(x?.url ?? "").trim(),
    }))
    .filter((x) => x.standard.length > 0)
    .map((x) => ({
      standard: x.standard,
      clause: x.clause || null,
      note: x.note || null,
      url: x.url || null,
    }));
}

/* =========================
Motor Normativo
========================= */

function buildNormativeEngine({
  taskDescription,
  normativeRefs,
  tasks,
}: any) {

  const desc = String(taskDescription || "").toLowerCase();

  const analysis: any[] = [];

  for (const norm of normativeRefs) {

    const standard = norm.standard.toLowerCase();

    /* ========= ASME B30 ========= */

    if (standard.includes("asme b30")) {

      if (tasks.lifting || desc.includes("izaje") || desc.includes("grua")) {

        analysis.push({
          standard: norm.standard,
          applies_to: "Operaciones de izaje con grúa",
          relevance:
            "Control de maniobras de izaje, accesorios y zona de carga suspendida",

          required_controls: [
            "Inspección previa de eslingas, grilletes y accesorios",
            "Definir zona de exclusión bajo la carga suspendida",
            "Asignar señalero competente",
            "Verificar capacidad de carga del equipo",
            "Evaluar condiciones meteorológicas antes del izaje"
          ],

          stop_work_conditions: [
            "Accesorios de izaje defectuosos",
            "Pérdida de control de la carga",
            "Condiciones meteorológicas inseguras"
          ]
        });

      }

    }

    /* ========= API RP 54 ========= */

    if (standard.includes("api rp 54")) {

      analysis.push({

        standard: norm.standard,
        applies_to: "Operaciones de perforación o well service",

        relevance:
          "Control de energía peligrosa y seguridad de equipos en operaciones de pozo",

        required_controls: [
          "Inspección de equipos antes de operar",
          "Control de energías peligrosas",
          "Comunicación efectiva entre operadores"
        ],

        stop_work_conditions: [
          "Equipos defectuosos",
          "Condiciones inseguras en área de operación"
        ]

      });

    }

  }

  return analysis;

}

/* =========================
ROUTE
========================= */

export async function POST(req: Request) {

  try {

    const body = await req.json();

    const tasks = {
      lifting: !!body.lifting,
      hotWork: !!body.hotWork,
      workAtHeight: !!body.workAtHeight,
      confinedSpace: !!body.confinedSpace,
      highPressure: !!body.highPressure,
    };

    const taskDescription = pickString(body?.taskDescription, "");

    const normativeRefs = normalizeNormRefs(body?.normative_refs);

    const normativeAnalysis = buildNormativeEngine({
      taskDescription,
      normativeRefs,
      tasks,
    });

    const meta = {
      title: pickString(body.jobTitle, "ATS"),
      company: pickString(body.company, ""),
      location: pickString(body.location, ""),
      date: pickString(body.date, ""),
      shift: pickString(body.shift, ""),
    };

    const prompt = `
Eres un especialista HSEQ.

Genera un ATS (Análisis de Trabajo Seguro) profesional para operaciones industriales.

El ATS debe incluir:

hazards
controls
steps
stop_work
recommendations

Usa la información normativa incluida cuando sea aplicable.

Devuelve SOLO JSON válido.
`;

    const payload = {
      meta,
      task_description: taskDescription,
      tasks,
      normative_refs: normativeRefs,
      normative_analysis: normativeAnalysis,
    };

    const response = await client.responses.create({

      model: ATS_MODEL,

      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_text", text: JSON.stringify(payload) },
          ],
        },
      ],

      max_output_tokens: 2000,

    });

    const out = (response.output_text || "").trim();

    let ats: any;

    try {

      ats = JSON.parse(out);

    } catch {

      ats = {
        meta,
        hazards: [],
        controls: {
          engineering: [],
          administrative: [],
          ppe: [],
        },
        steps: [],
        stop_work: {
          decision: "REVIEW_REQUIRED",
          auto_triggers: [],
          criteria: [],
          rationale: "Salida IA no parseable",
        },
        normative_refs: normativeRefs,
        normative_analysis: normativeAnalysis,
        recommendations: [],
      };

    }

    /* =========================
    Integrar controles normativos
    ========================= */

    ats.controls = ats.controls || {
      engineering: [],
      administrative: [],
      ppe: [],
    };

    ats.stop_work = ats.stop_work || {
      decision: "CONTINUE",
      auto_triggers: [],
      criteria: [],
      rationale: "",
    };

    for (const rule of normativeAnalysis) {

      ats.controls.administrative = mergeUnique(
        ats.controls.administrative,
        safeArrayStrings(rule.required_controls)
      );

      ats.stop_work.auto_triggers = mergeUnique(
        ats.stop_work.auto_triggers,
        safeArrayStrings(rule.stop_work_conditions)
      );

    }

    ats.normative_analysis = normativeAnalysis;

    return NextResponse.json({ ats }, { status: 200 });

  } catch (err: any) {

    console.error("generate-ats ERROR:", err);

    return NextResponse.json(
      {
        error: "Error generando ATS",
        details: String(err?.message || err),
      },
      { status: 500 }
    );

  }

}