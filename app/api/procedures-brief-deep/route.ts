export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { toFile } from "openai/uploads";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// Modelo profundo (más caro). Cambia en .env.local si quieres.
const DEEP_MODEL = process.env.DEEP_BRIEF_MODEL || "gpt-4.1";

// Límites (más permisivo que rápido)
const MAX_EXCERPTS = 8;
const MAX_EXCERPT_CHARS = 1200;
const MAX_TOTAL_EXCERPT_CHARS = MAX_EXCERPTS * MAX_EXCERPT_CHARS;

function normalizeText(s: string) {
  return (s || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractJsonObject(raw: string) {
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) return raw.slice(first, last + 1);
  return raw;
}

function repairJson(raw: string) {
  let s = raw;
  s = extractJsonObject(s);
  s = s.replace(/,\s*([}\]])/g, "$1");
  s = s.replace(/\u0000/g, "");
  return s.trim();
}

function safeJsonParse(raw: string) {
  const cleaned = repairJson(raw);
  try {
    return JSON.parse(cleaned);
  } catch {
    return {
      title: "Procedimiento (no parseable)",
      code: "",
      origin: "",
      brief: {
        scope: "No se pudo estructurar automáticamente (JSON inválido).",
        mandatory_permits: [],
        critical_controls: { engineering: [], administrative: [], ppe: [] },
        stop_work: [],
        mandatory_steps: [],
        restrictions: [],
      },
      excerpts: [],
      _raw_text: cleaned.slice(0, 4000),
    };
  }
}

function clampExcerpts(excerpts: any) {
  if (!Array.isArray(excerpts)) return [];
  const trimmed = excerpts.slice(0, MAX_EXCERPTS).map((x: any, idx: number) => ({
    id: String(x?.id || `ex_${idx + 1}`),
    text: normalizeText(String(x?.text || "")).slice(0, MAX_EXCERPT_CHARS),
  }));

  let used = 0;
  const final: { id: string; text: string }[] = [];
  for (const ex of trimmed) {
    if (used >= MAX_TOTAL_EXCERPT_CHARS) break;
    const remaining = MAX_TOTAL_EXCERPT_CHARS - used;
    const cut = ex.text.slice(0, remaining);
    final.push({ id: ex.id, text: cut });
    used += cut.length;
  }
  return final;
}

function ensureProcedureRefShape(obj: any) {
  const p = obj && typeof obj === "object" ? obj : {};

  const title = typeof p.title === "string" ? p.title : "Procedimiento";
  const code = typeof p.code === "string" ? p.code : "";
  const origin = typeof p.origin === "string" ? p.origin : "";

  const brief = p.brief && typeof p.brief === "object" ? p.brief : {};
  const critical = brief.critical_controls && typeof brief.critical_controls === "object"
    ? brief.critical_controls
    : {};

  return {
    title,
    code,
    origin,
    deep: true,
    brief: {
      scope: typeof brief.scope === "string" ? brief.scope : "",
      mandatory_permits: Array.isArray(brief.mandatory_permits) ? brief.mandatory_permits.map(String) : [],
      critical_controls: {
        engineering: Array.isArray(critical.engineering) ? critical.engineering.map(String) : [],
        administrative: Array.isArray(critical.administrative) ? critical.administrative.map(String) : [],
        ppe: Array.isArray(critical.ppe) ? critical.ppe.map(String) : [],
      },
      stop_work: Array.isArray(brief.stop_work) ? brief.stop_work.map(String) : [],
      mandatory_steps: Array.isArray(brief.mandatory_steps) ? brief.mandatory_steps.map(String) : [],
      restrictions: Array.isArray(brief.restrictions) ? brief.restrictions.map(String) : [],
    },
    excerpts: clampExcerpts(p.excerpts),
    ...(p._raw_text ? { _raw_text: String(p._raw_text).slice(0, 4000) } : {}),
  };
}

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

    const resp = await openai.responses.create({
      model: DEEP_MODEL,
      max_output_tokens: 2200,
      input: [
        {
          role: "user",
          content: [
            { type: "input_file", file_id: uploaded.id },
            {
              type: "input_text",
              text: `
Eres HSEQ corporativo. Analiza el procedimiento y devuelve SOLO JSON válido:
{
  "title": "string",
  "code": "string",
  "origin": "string",
  "brief": {
    "scope": "string",
    "mandatory_permits": ["..."],
    "critical_controls": {
      "engineering": ["..."],
      "administrative": ["..."],
      "ppe": ["..."]
    },
    "stop_work": ["..."],
    "mandatory_steps": ["..."],
    "restrictions": ["..."]
  },
  "excerpts": [
    { "id": "ex_1", "text": "..." }
  ]
}
Reglas:
- Máximo 8 excerpts, cada uno <= 1200 caracteres.
- NO incluyas texto fuera del JSON.
- Responde SOLO JSON. Sin markdown.
              `.trim(),
            },
          ],
        },
      ],
    });

    const raw = (resp.output_text || "").trim();
    const parsed = safeJsonParse(raw);
    const procedure_ref = ensureProcedureRefShape(parsed);

    return NextResponse.json({ procedure_ref }, { status: 200 });
  } catch (err: any) {
    const msg = String(err?.message || err);
    console.error("procedure-brief-deep ERROR:", err);

    if (msg.includes("tokens per min") || msg.includes("TPM") || msg.includes("429")) {
      return NextResponse.json(
        {
          error: "Rate limit (TPM) en modo profundo",
          details:
            "Profundiza solo 1 procedimiento a la vez, o usa modo rápido para varios.",
          raw: msg,
        },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: "Error procesando procedimiento (deep)", details: msg },
      { status: 500 }
    );
  }
}