// app/api/lesson-learned-brief/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { toFile } from "openai/uploads";

const apiKey = process.env.OPENAI_API_KEY;
const client = apiKey ? new OpenAI({ apiKey }) : null;
const ATS_MODEL = process.env.ATS_MODEL || "gpt-4.1-mini";

/* =========================
   TIPOS
========================= */
type LessonLearned = {
  title: string;
  origin: string;
  date: string | null;
  parseable: boolean;
  confidence: "low" | "medium" | "high";
  summary: string;

  what_happened: string[];
  what_went_wrong: string[];
  contributing_factors: string[];

  key_controls: {
    engineering: string[];
    administrative: string[];
    ppe: string[];
  };

  verification_points: string[];
  stop_work_triggers: string[];
  talk_points: string[];

  errors: string[];
};

type LessonLearnedBrief = {
  title: string;
  code: string;
  origin: string;
  parseable: boolean;
  brief: {
    scope: string;
    mandatory_permits: string[];
    critical_controls: {
      engineering: string[];
      administrative: string[];
      ppe: string[];
    };
    stop_work: string[];
    mandatory_steps: string[];
    restrictions: string[];
  };
};

type ApiResponse = {
  lesson: LessonLearned;
  lesson_learned_brief: LessonLearnedBrief;
};

/* =========================
   HELPERS
========================= */
function pickString(v: any, fallback = "") {
  return typeof v === "string" ? v : fallback;
}

function safeArrayStrings(v: any): string[] {
  return Array.isArray(v)
    ? v.map((x) => String(x ?? "").trim()).filter(Boolean)
    : [];
}

function uniq(arr: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of arr || []) {
    const v = String(s || "").trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function clampText(text: string, maxChars: number) {
  const t = String(text || "").replace(/\r/g, "").trim();
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars) + "\n\n[...texto recortado por longitud...]";
}

function extLower(name: string) {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}

function isPdfOrDocx(name: string) {
  const e = extLower(name);
  return e === "pdf" || e === "docx";
}

function normalizeCode(v: any) {
  return typeof v === "string" ? v.trim() : "";
}

function normalizeLesson(obj: any, originFallback: string): LessonLearned {
  const x = obj && typeof obj === "object" ? obj : {};
  const kc = x.key_controls && typeof x.key_controls === "object" ? x.key_controls : {};

  return {
    title: pickString(x.title, "Lección aprendida"),
    origin: pickString(x.origin, originFallback),
    date: typeof x.date === "string" ? x.date : null,
    parseable: typeof x.parseable === "boolean" ? x.parseable : true,
    confidence: ["low", "medium", "high"].includes(x.confidence) ? x.confidence : "medium",
    summary: pickString(x.summary, ""),

    what_happened: uniq(safeArrayStrings(x.what_happened)),
    what_went_wrong: uniq(safeArrayStrings(x.what_went_wrong)),
    contributing_factors: uniq(safeArrayStrings(x.contributing_factors)),

    key_controls: {
      engineering: uniq(safeArrayStrings(kc.engineering)),
      administrative: uniq(safeArrayStrings(kc.administrative)),
      ppe: uniq(safeArrayStrings(kc.ppe)),
    },

    verification_points: uniq(safeArrayStrings(x.verification_points)),
    stop_work_triggers: uniq(safeArrayStrings(x.stop_work_triggers)),
    talk_points: uniq(safeArrayStrings(x.talk_points)),
    errors: uniq(safeArrayStrings(x.errors)),
  };
}

function fallbackLesson(origin: string, reason: string): LessonLearned {
  return {
    title: "Lección aprendida",
    origin,
    date: null,
    parseable: false,
    confidence: "low",
    summary: reason,
    what_happened: [],
    what_went_wrong: ["No fue posible estructurar automáticamente el documento."],
    contributing_factors: [],
    key_controls: {
      engineering: [],
      administrative: [],
      ppe: [],
    },
    verification_points: [],
    stop_work_triggers: [],
    talk_points: [],
    errors: [reason],
  };
}

function toProcedureLikeBrief(
  lesson: LessonLearned,
  opts: { code: string; origin: string }
): LessonLearnedBrief {
  const restrictions = uniq([
    ...safeArrayStrings(lesson.what_went_wrong),
    ...safeArrayStrings(lesson.contributing_factors).map(
      (x) => `Factor contribuyente: ${x}`
    ),
  ]).slice(0, 12);

  const mandatory_steps = uniq([
    ...safeArrayStrings(lesson.verification_points),
    ...safeArrayStrings(lesson.what_happened).slice(0, 6),
  ]).slice(0, 18);

  return {
    title: lesson.title || "Lección aprendida",
    code: opts.code || "",
    origin: opts.origin || lesson.origin || "Lección aprendida",
    parseable: !!lesson.parseable,
    brief: {
      scope: clampText(lesson.summary || "", 1500),
      mandatory_permits: [],
      critical_controls: {
        engineering: uniq(safeArrayStrings(lesson.key_controls?.engineering)).slice(0, 18),
        administrative: uniq(safeArrayStrings(lesson.key_controls?.administrative)).slice(0, 24),
        ppe: uniq(safeArrayStrings(lesson.key_controls?.ppe)).slice(0, 18),
      },
      stop_work: uniq(safeArrayStrings(lesson.stop_work_triggers)).slice(0, 12),
      mandatory_steps,
      restrictions,
    },
  };
}

/* =========================
   SCHEMA
========================= */
const LESSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    lesson: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        origin: { type: "string" },
        date: { type: ["string", "null"] },
        parseable: { type: "boolean" },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
        summary: { type: "string" },

        what_happened: { type: "array", items: { type: "string" } },
        what_went_wrong: { type: "array", items: { type: "string" } },
        contributing_factors: { type: "array", items: { type: "string" } },

        key_controls: {
          type: "object",
          additionalProperties: false,
          properties: {
            engineering: { type: "array", items: { type: "string" } },
            administrative: { type: "array", items: { type: "string" } },
            ppe: { type: "array", items: { type: "string" } },
          },
          required: ["engineering", "administrative", "ppe"],
        },

        verification_points: { type: "array", items: { type: "string" } },
        stop_work_triggers: { type: "array", items: { type: "string" } },
        talk_points: { type: "array", items: { type: "string" } },
        errors: { type: "array", items: { type: "string" } },
      },
      required: [
        "title",
        "origin",
        "date",
        "parseable",
        "confidence",
        "summary",
        "what_happened",
        "what_went_wrong",
        "contributing_factors",
        "key_controls",
        "verification_points",
        "stop_work_triggers",
        "talk_points",
        "errors",
      ],
    },
  },
  required: ["lesson"],
} as const;

/* =========================
   ROUTE
========================= */
export async function POST(req: Request) {
  try {
    if (!client) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY no configurada." },
        { status: 500 }
      );
    }

    const form = await req.formData();

    const fileAny = form.get("file");
    const code = normalizeCode(form.get("code"));
    const originOverride = pickString(form.get("origin"), "");
    const titleOverride = pickString(form.get("title"), "");

    const isFileLike =
      fileAny &&
      typeof fileAny === "object" &&
      typeof (fileAny as any).arrayBuffer === "function" &&
      typeof (fileAny as any).name === "string";

    if (!isFileLike) {
      return NextResponse.json(
        { error: "Falta archivo en FormData (campo 'file')." },
        { status: 400 }
      );
    }

    const file = fileAny as File;
    const fileName = file.name || "lesson";

    if (!isPdfOrDocx(fileName)) {
      return NextResponse.json(
        { error: "Archivo no soportado. Solo PDF o DOCX." },
        { status: 400 }
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const uploadable = await toFile(buf, fileName, {
      type: file.type || (extLower(fileName) === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    });

    const uploaded = await client.files.create({
      file: uploadable,
      purpose: "assistants",
    });

    const prompt = `
Eres especialista HSEQ / Seguridad de Procesos.

Analiza la lección aprendida adjunta y devuelve un resumen operacional útil para:
- robustecer un ATS
- soportar una charla preturno
- priorizar controles críticos verificables

Reglas:
1) NO inventes hechos. Si falta claridad, usa "requiere verificación".
2) Redacta en español, claro y auditable.
3) Si la información es parcial, completa con arrays vacíos o strings vacíos.
4) Nunca omitas campos obligatorios del schema.
5) Controles en jerarquía: engineering, administrative, ppe.
6) stop_work_triggers: condiciones claras que obligan a detener.
7) Resume el contenido técnico del documento, no copies el documento completo.
8) Devuelve SOLO JSON válido, sin markdown ni texto adicional.
`.trim();

    const response = await client.responses.create({
      model: ATS_MODEL,
      input: [
        {
          role: "user",
          content: [
            { type: "input_file", file_id: uploaded.id },
            { type: "input_text", text: prompt },
          ],
        },
      ],
      max_output_tokens: 1800,
      text: {
        format: {
          type: "json_schema",
          name: "lesson_learned_schema",
          schema: LESSON_SCHEMA,
        },
      },
    });

    const out = (response.output_text || "").trim();

    console.log("====================================");
    console.log("LESSON LEARNED RAW OUTPUT:");
    console.log(out);
    console.log("====================================");

    let lesson: LessonLearned;

    try {
      const parsed = JSON.parse(out) as { lesson: any };
      lesson = normalizeLesson(parsed?.lesson, originOverride || fileName);

      if (!lesson.summary.trim()) {
        lesson = fallbackLesson(
          originOverride || fileName,
          "La IA devolvió un resumen vacío; se aplicó fallback."
        );
      }
    } catch (err) {
      console.error("❌ Error parseando JSON de lesson-learned-brief:", err);
      lesson = fallbackLesson(
        originOverride || fileName,
        "No se pudo parsear JSON de IA; se aplicó fallback."
      );
    }

    if (titleOverride.trim()) lesson.title = titleOverride.trim();
    if (originOverride.trim()) lesson.origin = originOverride.trim();

    const lesson_learned_brief = toProcedureLikeBrief(lesson, {
      code,
      origin: originOverride || "Lección aprendida",
    });

    const payload: ApiResponse = {
      lesson,
      lesson_learned_brief,
    };

    return NextResponse.json(payload, { status: 200 });
  } catch (err: any) {
    const msg = String(err?.message || err);
    console.error("lesson-learned-brief ERROR:", err);
    return NextResponse.json(
      { error: "Error procesando lección aprendida", details: msg },
      { status: 500 }
    );
  }
}