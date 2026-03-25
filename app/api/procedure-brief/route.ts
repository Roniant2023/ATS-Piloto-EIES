// app/api/procedure-brief/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { toFile } from "openai/uploads";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const BRIEF_MODEL = process.env.BRIEF_MODEL || "gpt-4.1-mini";

const MAX_EXCERPTS = 6;
const MAX_EXCERPT_CHARS = 900;

function normalizeText(s: string) {
  return (s || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanStringArray(arr: any): string[] {
  return Array.isArray(arr)
    ? arr
        .map((v: any) => String(v).trim())
        .filter((x: string) => x.length > 0)
    : [];
}

function clampExcerpts(excerpts: any) {
  if (!Array.isArray(excerpts)) return [];
  return excerpts.slice(0, MAX_EXCERPTS).map((x: any, idx: number) => ({
    id: String(x?.id || `ex_${idx + 1}`),
    text: normalizeText(String(x?.text || "")).slice(0, MAX_EXCERPT_CHARS),
  }));
}

function ensureProcedureRefShape(obj: any, fallbackName = "Procedimiento") {
  const p = obj && typeof obj === "object" ? obj : {};
  const brief = p.brief && typeof p.brief === "object" ? p.brief : {};
  const critical =
    brief.critical_controls && typeof brief.critical_controls === "object"
      ? brief.critical_controls
      : {};

  const shaped = {
    title:
      typeof p.title === "string" && p.title.trim()
        ? p.title.trim()
        : fallbackName,
    code: typeof p.code === "string" ? p.code.trim() : "",
    origin:
      typeof p.origin === "string" && p.origin.trim()
        ? p.origin.trim()
        : "Archivo cargado por usuario",
    brief: {
      scope: typeof brief.scope === "string" ? brief.scope.trim() : "",
      mandatory_permits: cleanStringArray(brief.mandatory_permits),
      critical_controls: {
        engineering: cleanStringArray(critical.engineering),
        administrative: cleanStringArray(critical.administrative),
        ppe: cleanStringArray(critical.ppe),
      },
      stop_work: cleanStringArray(brief.stop_work),
      mandatory_steps: cleanStringArray(brief.mandatory_steps),
      restrictions: cleanStringArray(brief.restrictions),
    },
    excerpts: clampExcerpts(p.excerpts),
    parseable: true,
    warnings: cleanStringArray(p.warnings),
  };

  const hasUsefulContent =
    !!shaped.brief.scope ||
    shaped.brief.mandatory_permits.length > 0 ||
    shaped.brief.critical_controls.engineering.length > 0 ||
    shaped.brief.critical_controls.administrative.length > 0 ||
    shaped.brief.critical_controls.ppe.length > 0 ||
    shaped.brief.stop_work.length > 0 ||
    shaped.brief.mandatory_steps.length > 0 ||
    shaped.brief.restrictions.length > 0 ||
    shaped.excerpts.length > 0;

  return {
    ...shaped,
    parseable: !!hasUsefulContent,
    warnings: hasUsefulContent
      ? shaped.warnings
      : [...shaped.warnings, "Contenido insuficiente para estructurar el procedimiento."],
  };
}

/**
 * Structured Output schema
 */
const PROCEDURE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    code: { type: "string" },
    origin: { type: "string" },
    brief: {
      type: "object",
      additionalProperties: false,
      properties: {
        scope: { type: "string" },
        mandatory_permits: { type: "array", items: { type: "string" } },
        critical_controls: {
          type: "object",
          additionalProperties: false,
          properties: {
            engineering: { type: "array", items: { type: "string" } },
            administrative: { type: "array", items: { type: "string" } },
            ppe: { type: "array", items: { type: "string" } },
          },
          required: ["engineering", "administrative", "ppe"],
        },
        stop_work: { type: "array", items: { type: "string" } },
        mandatory_steps: { type: "array", items: { type: "string" } },
        restrictions: { type: "array", items: { type: "string" } },
      },
      required: [
        "scope",
        "mandatory_permits",
        "critical_controls",
        "stop_work",
        "mandatory_steps",
        "restrictions",
      ],
    },
    excerpts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          text: { type: "string" },
        },
        required: ["id", "text"],
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["title", "code", "origin", "brief", "excerpts", "warnings"],
} as const;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const f = form.get("file");

    if (!f || !(f instanceof File)) {
      return NextResponse.json({ error: "No se recibió archivo" }, { status: 400 });
    }

    const buf = Buffer.from(await f.arrayBuffer());

    const openaiFile = await toFile(buf, f.name || "procedimiento.pdf", {
      type: f.type || "application/pdf",
    });

    const uploaded = await openai.files.create({
      file: openaiFile,
      purpose: "assistants",
    });

    const prompt = `
Eres HSEQ corporativo. Extrae un resumen estructurado del procedimiento.

Reglas:
- Máximo ${MAX_EXCERPTS} excerpts.
- Cada excerpt <= ${MAX_EXCERPT_CHARS} caracteres.
- Máximo 4 mandatory_permits.
- Máximo 4 controles por categoría.
- Máximo 4 stop_work.
- Máximo 6 mandatory_steps.
- Máximo 4 restrictions.
- Usa frases breves y claras.
- NO pegues el documento completo.
- Si falta información, devuelve string vacío "" o array [].
- NO omitas ninguna clave del schema, aunque esté vacía.
- NO inventes información.
- Devuelve SOLO JSON válido (sin texto adicional, sin markdown, sin explicaciones).
`.trim();

    const resp = await openai.responses.create({
      model: BRIEF_MODEL,
      max_output_tokens: 2200,
      input: [
        {
          role: "user",
          content: [
            { type: "input_file", file_id: uploaded.id },
            { type: "input_text", text: prompt },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "procedure_schema",
          schema: PROCEDURE_SCHEMA,
        },
      },
    });

    const out = (resp.output_text || "").trim();

    console.log("====================================");
    console.log("PROCEDURE BRIEF RAW OUTPUT:");
    console.log(out);
    console.log("====================================");

    if (!out.endsWith("}")) {
      console.error("⚠️ PROCEDURE JSON INCOMPLETO DETECTADO");
      console.error(out.slice(-500));
    }

    let parsed: any;

    try {
      parsed = JSON.parse(out);
    } catch (err) {
      console.error("❌ ERROR PARSEANDO PROCEDURE BRIEF:");
      console.error(err);
      console.error("❌ OUTPUT QUE FALLÓ:");
      console.error(out);

      try {
        const fixed = out.substring(0, out.lastIndexOf("}") + 1);
        parsed = JSON.parse(fixed);
        console.warn("⚠️ PROCEDURE JSON RECUPERADO PARCIALMENTE");
      } catch {
        return NextResponse.json(
          {
            procedure_ref: {
              title: f.name?.replace(/\.[^.]+$/, "") || "Procedimiento (no parseable)",
              code: "",
              origin: "Archivo cargado por usuario",
              brief: {
                scope: "No se pudo estructurar automáticamente.",
                mandatory_permits: [],
                critical_controls: { engineering: [], administrative: [], ppe: [] },
                stop_work: [],
                mandatory_steps: [],
                restrictions: [],
              },
              excerpts: [],
              parseable: false,
              warnings: [
                "JSON inválido o incompleto devuelto por el modelo.",
                "Requiere revisión manual del procedimiento.",
              ],
            },
          },
          { status: 200 }
        );
      }
    }

    const procedure_ref = ensureProcedureRefShape(parsed, f.name || "Procedimiento");
    return NextResponse.json({ procedure_ref }, { status: 200 });
  } catch (err: any) {
    const msg = String(err?.message || err);
    console.error("procedure-brief ERROR:", err);
    return NextResponse.json(
      { error: "Error procesando procedimiento", details: msg },
      { status: 500 }
    );
  }
}