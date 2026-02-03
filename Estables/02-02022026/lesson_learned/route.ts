// app/api/lesson-learned-brief/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";

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

  errors?: string[];
};

type ApiResponse = {
  lesson: LessonLearned;

  // ✅ Este es el objeto "tipo procedimiento" que espera generate-ats (normalizeProcedureRef)
  lesson_learned_brief: {
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
};

/* =========================
   HELPERS
========================= */
function pickString(v: any, fallback = "") {
  return typeof v === "string" ? v : fallback;
}

function safeArrayStrings(v: any): string[] {
  return Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : [];
}

function uniq(arr: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of arr) {
    const v = String(s || "").trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function clampText(text: string, maxChars: number) {
  const t = (text || "").replace(/\r/g, "").trim();
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
  const s = typeof v === "string" ? v.trim() : "";
  // dejamos vacío si no viene (no inventamos códigos)
  return s;
}

function cleanExtractedText(raw: string) {
  return (raw || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* =========================
   EXTRACCIÓN TEXTO: DOCX
========================= */
async function extractTextFromDocx(arrayBuffer: ArrayBuffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: Buffer.from(arrayBuffer) });
  return (result?.value || "").trim();
}

/* =========================
   EXTRACCIÓN TEXTO: PDF (pdfjs-dist legacy, SIN DOM)
   - Evita DOMMatrix, canvas, workers
   ✅ IMPORTANTE: SOLO pdf.mjs (NO pdf.js) para no romper build en Next
========================= */
async function extractTextFromPdf(arrayBuffer: ArrayBuffer): Promise<string> {
  const data = new Uint8Array(arrayBuffer);

  // ✅ Next-friendly
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");

  if (pdfjs?.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = "";
  }

  const loadingTask = pdfjs.getDocument({
    data,
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false,
  });

  const doc = await loadingTask.promise;

  const MAX_PAGES = Number(process.env.LL_MAX_PAGES || 25);
  const maxPages = Math.min(doc.numPages || 0, MAX_PAGES);
  const pageTexts: string[] = [];

  for (let i = 1; i <= maxPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const strings = (content?.items || [])
      .map((it: any) => (typeof it?.str === "string" ? it.str : ""))
      .map((s: string) => s.trim())
      .filter(Boolean);

    if (strings.length) pageTexts.push(strings.join(" "));
  }

  return pageTexts.join("\n\n").trim();
}

/* =========================
   FALLBACK DETERMINÍSTICO
========================= */
function fallbackLesson(origin: string, text: string, errors: string[] = []): LessonLearned {
  const t = clampText(text || "", 6000);

  const lines = (t || "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  const bullets = lines
    .filter((x) => /^(\-|\•|\*|\d+\.|\d+\)|[a-z]\))\s+/.test(x) || x.length <= 120)
    .slice(0, 18);

  const summary =
    (t && t.length >= 80
      ? t.replace(/\s+/g, " ").slice(0, 400)
      : "Lección aprendida recibida. Requiere verificación/estandarización del contenido para su uso operativo.") +
    (errors.length ? ` (Notas: ${errors.join(" | ")})` : "");

  return {
    title: "Lección aprendida",
    origin,
    date: null,
    parseable: t.length >= 80,
    confidence: t.length >= 800 ? "medium" : "low",
    summary,

    what_happened: bullets.slice(0, 5),
    what_went_wrong: bullets.slice(5, 9),
    contributing_factors: bullets.slice(9, 12),

    key_controls: {
      engineering: [],
      administrative: [],
      ppe: [],
    },

    verification_points: [],
    stop_work_triggers: [],
    talk_points: uniq(bullets.slice(0, 10)),

    errors: errors.length ? errors : undefined,
  };
}

/* =========================
   SCHEMA (salida estable)
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
      ],
    },
  },
  required: ["lesson"],
} as const;

/* =========================
   IA (opcional) — mejora y estructura
========================= */
async function buildLessonWithAI(origin: string, rawText: string): Promise<LessonLearned> {
  const text = clampText(cleanExtractedText(rawText), 12000);

  if (!text || text.length < 200) {
    return fallbackLesson(origin, text, ["Texto insuficiente para estructurar con IA."]);
  }

  if (!client) {
    return fallbackLesson(origin, text, ["OPENAI_API_KEY no configurada."]);
  }

  const prompt = `
Eres especialista HSEQ/Seguridad de Procesos.
A partir de una lección aprendida (texto), genera un resumen operacional útil para:
- robustecer un ATS
- soportar una charla preturno (puntos concretos)

Reglas:
1) NO inventes hechos. Si falta claridad, dilo como "requiere verificación".
2) Redacta en español, claro y auditable.
3) Devuelve SOLO JSON que cumpla el schema.
4) Controles en jerarquía: engineering, administrative, ppe.
5) stop_work_triggers: condiciones claras que obligan a detener.
`.trim();

  const input = { origin, text };

  const response = await client.responses.create({
    model: ATS_MODEL,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_text", text: JSON.stringify(input) },
        ],
      },
    ],
    max_output_tokens: 900,
    text: {
      format: {
        type: "json_schema",
        name: "lesson_learned_schema",
        schema: LESSON_SCHEMA,
      },
    },
  });

  const out = (response.output_text || "").trim();
  try {
    const parsed = JSON.parse(out) as { lesson: any };
    const L = parsed.lesson as any;

    const lesson: LessonLearned = {
      title: pickString(L.title, "Lección aprendida"),
      origin: pickString(L.origin, origin),
      date: typeof L.date === "string" ? L.date : null,
      parseable: typeof L.parseable === "boolean" ? L.parseable : true,
      confidence: (["low", "medium", "high"] as const).includes(L.confidence) ? L.confidence : "medium",
      summary: pickString(L.summary, ""),

      what_happened: uniq(safeArrayStrings(L.what_happened)),
      what_went_wrong: uniq(safeArrayStrings(L.what_went_wrong)),
      contributing_factors: uniq(safeArrayStrings(L.contributing_factors)),

      key_controls: {
        engineering: uniq(safeArrayStrings(L?.key_controls?.engineering)),
        administrative: uniq(safeArrayStrings(L?.key_controls?.administrative)),
        ppe: uniq(safeArrayStrings(L?.key_controls?.ppe)),
      },

      verification_points: uniq(safeArrayStrings(L.verification_points)),
      stop_work_triggers: uniq(safeArrayStrings(L.stop_work_triggers)),
      talk_points: uniq(safeArrayStrings(L.talk_points)),

      errors: Array.isArray(L.errors) ? safeArrayStrings(L.errors) : undefined,
    };

    if (!lesson.summary.trim()) {
      return fallbackLesson(origin, text, ["La IA devolvió summary vacío; se aplicó fallback parcial."]);
    }

    return lesson;
  } catch {
    return fallbackLesson(origin, rawText, ["No se pudo parsear JSON de IA; se aplicó fallback."]);
  }
}

/* =========================
   ✅ CONVERSOR a “procedureRef brief”
   (compatible con generate-ats -> normalizeProcedureRef)
========================= */
function toProcedureLikeBrief(lesson: LessonLearned, opts: { code: string; origin: string }) {
  const restrictions = uniq([
    ...safeArrayStrings(lesson.what_went_wrong),
    ...safeArrayStrings(lesson.contributing_factors).map((x) => `Factor contribuyente: ${x}`),
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
      scope: (lesson.summary || "").trim(),
      mandatory_permits: [] as string[], // ✅ no inventamos permisos
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
   ROUTE
========================= */
export async function POST(req: Request) {
  try {
    const form = await req.formData();

    // ✅ Esperado:
    // file: File (pdf/docx)
    // opcional: code, title, origin
    const fileAny = form.get("file");
    const code = normalizeCode(form.get("code"));
    const originOverride = pickString(form.get("origin"), "");
    const titleOverride = pickString(form.get("title"), "");

    // ✅ Validación robusta (evita depender de instanceof File)
    const isFileLike =
      fileAny &&
      typeof fileAny === "object" &&
      typeof (fileAny as any).arrayBuffer === "function" &&
      typeof (fileAny as any).name === "string";

    if (!isFileLike) {
      return NextResponse.json({ error: "Falta archivo en FormData (campo 'file')." }, { status: 400 });
    }

    const file = fileAny as File;

    const fileName = file.name || "lesson";
    if (!isPdfOrDocx(fileName)) {
      return NextResponse.json({ error: "Archivo no soportado. Solo PDF o DOCX." }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();

    // 1) Extraer texto
    let extracted = "";
    const errors: string[] = [];

    try {
      const e = extLower(fileName);
      if (e === "docx") extracted = await extractTextFromDocx(arrayBuffer);
      else extracted = await extractTextFromPdf(arrayBuffer);
    } catch (e: any) {
      errors.push(String(e?.message || e));
      extracted = "";
    }

    extracted = cleanExtractedText(extracted);

    const origin = originOverride || fileName;

    // 2) Si no hay texto suficiente -> fallback seguro (NO 500)
    if (!extracted || extracted.trim().length < 40) {
      const lesson0 = fallbackLesson(origin, extracted, [
        "No se pudo leer texto suficiente del archivo (PDF/DOCX).",
        ...errors,
      ]);

      // ✅ refuerzo para que el ATS lo tome como warning operativo
      lesson0.what_went_wrong = uniq([
        ...(lesson0.what_went_wrong || []),
        "Documento no legible (texto no extraíble). Requiere versión en texto (DOCX o PDF con texto seleccionable).",
      ]);

      lesson0.parseable = false;
      lesson0.confidence = "low";
      lesson0.summary =
        "Lección aprendida cargada pero no se logró extraer texto suficiente. Requiere convertir el archivo a texto o usar DOCX con texto seleccionable.";

      if (titleOverride.trim()) lesson0.title = titleOverride.trim();
      if (originOverride.trim()) lesson0.origin = originOverride.trim();

      const lesson_learned_brief = toProcedureLikeBrief(lesson0, {
        code,
        origin: originOverride || "Lección aprendida",
      });

      const payload: ApiResponse = { lesson: lesson0, lesson_learned_brief };
      return NextResponse.json(payload, { status: 200 });
    }

    // 3) Estructurar con IA (o fallback si no hay key)
    const lesson = await buildLessonWithAI(origin, extracted);

    // overrides (sin inventar)
    if (titleOverride.trim()) lesson.title = titleOverride.trim();
    if (originOverride.trim()) lesson.origin = originOverride.trim();

    if (errors.length) {
      lesson.errors = uniq([...(lesson.errors || []), ...errors]);
    }

    const lesson_learned_brief = toProcedureLikeBrief(lesson, {
      code,
      origin: originOverride || "Lección aprendida",
    });

    const payload: ApiResponse = { lesson, lesson_learned_brief };
    return NextResponse.json(payload, { status: 200 });
  } catch (err: any) {
    const msg = String(err?.message || err);
    console.error("lesson-learned-brief ERROR:", err);
    return NextResponse.json({ error: "Error procesando lección aprendida", details: msg }, { status: 500 });
  }
}