// app/api/norm-brief/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { toFile } from "openai/uploads";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const ATS_MODEL = process.env.ATS_MODEL || "gpt-4.1-mini";

/* =========================
   TYPES
========================= */
type NormBrief = {
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

function normalizeNorm(obj: any, originFallback: string): NormBrief {
  const x = obj && typeof obj === "object" ? obj : {};
  const kc = x.key_controls && typeof x.key_controls === "object" ? x.key_controls : {};

  return {
    title: pickString(x.title, "Norma"),
    code: pickString(x.code, ""),
    origin: pickString(x.origin, originFallback),
    parseable: typeof x.parseable === "boolean" ? x.parseable : true,
    brief: {
      scope: pickString(x.scope, ""),
      mandatory_permits: safeArrayStrings(x.mandatory_permits),
      critical_controls: {
        engineering: safeArrayStrings(kc.engineering),
        administrative: safeArrayStrings(kc.administrative),
        ppe: safeArrayStrings(kc.ppe),
      },
      stop_work: safeArrayStrings(x.stop_work),
      mandatory_steps: safeArrayStrings(x.mandatory_steps),
      restrictions: safeArrayStrings(x.restrictions),
    },
  };
}

/* =========================
   SCHEMA
========================= */
const NORM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    norm: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        code: { type: "string" },
        origin: { type: "string" },
        parseable: { type: "boolean" },
        scope: { type: "string" },

        mandatory_permits: { type: "array", items: { type: "string" } },

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

        stop_work: { type: "array", items: { type: "string" } },
        mandatory_steps: { type: "array", items: { type: "string" } },
        restrictions: { type: "array", items: { type: "string" } },
      },
      required: [
        "title",
        "code",
        "origin",
        "parseable",
        "scope",
        "mandatory_permits",
        "key_controls",
        "stop_work",
        "mandatory_steps",
        "restrictions",
      ],
    },
  },
  required: ["norm"],
} as const;

/* =========================
   ROUTE
========================= */
export async function POST(req: Request) {
  try {
    const form = await req.formData();

    const file = form.get("file") as File;

    if (!file) {
      return NextResponse.json(
        { error: "Debes adjuntar un archivo de norma." },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const uploadable = await toFile(buffer, file.name, {
      type: file.type || "application/pdf",
    });

    const uploaded = await client.files.create({
      file: uploadable,
      purpose: "assistants",
    });

    const prompt = `
Eres especialista HSEQ y normatividad.

Analiza la norma adjunta y extrae SOLO información útil para operación en campo.

OBJETIVO:
Convertir la norma en controles prácticos para ATS.

REGLAS:
1) NO copies la norma literal
2) Tradúcela a acciones operativas
3) Prioriza obligaciones y cumplimiento legal
4) Controles en jerarquía: engineering, administrative, ppe
5) stop_work: condiciones donde la norma obliga a detener
6) mandatory_steps: obligaciones directas de la norma
7) restrictions: prohibiciones o limitaciones normativas

Devuelve SOLO JSON válido.
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
          name: "norm_schema",
          schema: NORM_SCHEMA,
        },
      },
    });

    const out = (response.output_text || "").trim();

    console.log("====================================");
    console.log("NORM RAW OUTPUT:");
    console.log(out);
    console.log("====================================");

    let norm;

    try {
      const parsed = JSON.parse(out);
      norm = normalizeNorm(parsed.norm, file.name);
    } catch (err) {
      console.error("❌ Error parseando norma:", err);
      norm = {
        title: "Norma",
        code: "",
        origin: file.name,
        parseable: false,
        brief: {
          scope: "No se pudo procesar la norma.",
          mandatory_permits: [],
          critical_controls: {
            engineering: [],
            administrative: [],
            ppe: [],
          },
          stop_work: [],
          mandatory_steps: [],
          restrictions: [],
        },
      };
    }

    return NextResponse.json({ norm }, { status: 200 });
  } catch (err: any) {
    console.error("norm-brief ERROR:", err);
    return NextResponse.json(
      { error: "Error procesando norma", details: err.message },
      { status: 500 }
    );
  }
}