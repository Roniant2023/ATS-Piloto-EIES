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

function clampExcerpts(excerpts: any) {
  if (!Array.isArray(excerpts)) return [];
  return excerpts.slice(0, MAX_EXCERPTS).map((x: any, idx: number) => ({
    id: String(x?.id || `ex_${idx + 1}`),
    text: normalizeText(String(x?.text || "")).slice(0, MAX_EXCERPT_CHARS),
  }));
}

function ensureProcedureRefShape(obj: any) {
  const p = obj && typeof obj === "object" ? obj : {};
  const brief = p.brief && typeof p.brief === "object" ? p.brief : {};
  const critical =
    brief.critical_controls && typeof brief.critical_controls === "object"
      ? brief.critical_controls
      : {};

  return {
    title: typeof p.title === "string" ? p.title : "Procedimiento",
    code: typeof p.code === "string" ? p.code : "",
    origin: typeof p.origin === "string" ? p.origin : "",
    brief: {
      scope: typeof brief.scope === "string" ? brief.scope : "",
      mandatory_permits: Array.isArray(brief.mandatory_permits)
        ? brief.mandatory_permits.map(String)
        : [],
      critical_controls: {
        engineering: Array.isArray(critical.engineering)
          ? critical.engineering.map(String)
          : [],
        administrative: Array.isArray(critical.administrative)
          ? critical.administrative.map(String)
          : [],
        ppe: Array.isArray(critical.ppe) ? critical.ppe.map(String) : [],
      },
      stop_work: Array.isArray(brief.stop_work) ? brief.stop_work.map(String) : [],
      mandatory_steps: Array.isArray(brief.mandatory_steps)
        ? brief.mandatory_steps.map(String)
        : [],
      restrictions: Array.isArray(brief.restrictions) ? brief.restrictions.map(String) : [],
    },
    excerpts: clampExcerpts(p.excerpts),
    parseable: true,
    warnings: Array.isArray(p.warnings) ? p.warnings.map(String) : [],
  };
}

/**
 * ✅ Structured Output schema
 * OJO: si additionalProperties=false, OpenAI exige required con TODAS las keys de properties.
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
- NO pegues el documento completo.
- Devuelve SOLO JSON que cumpla el schema.
`.trim();

    const resp = await openai.responses.create({
      model: BRIEF_MODEL,
      max_output_tokens: 1400,
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
    let parsed: any;
    try {
      parsed = JSON.parse(out);
    } catch {
      // Si llegara a pasar (no debería), marcamos como no parseable pero sin romper.
      return NextResponse.json(
        {
          procedure_ref: {
            title: "Procedimiento (no parseable)",
            code: "",
            origin: "",
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
            warnings: ["JSON inválido devuelto por el modelo."],
          },
        },
        { status: 200 }
      );
    }

    const procedure_ref = ensureProcedureRefShape(parsed);
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