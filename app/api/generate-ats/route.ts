// app/api/generate-ats/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const ATS_MODEL = process.env.ATS_MODEL || "gpt-4.1-mini";

const REQUIRE_LESSON_LEARNED_ON_INCIDENTS =
  (process.env.REQUIRE_LESSON_LEARNED_ON_INCIDENTS ?? "true").toLowerCase() !== "false";

/* =========================
   Helpers generales
========================= */

function pickString(v: any, fallback = "") {
  return typeof v === "string" ? v : fallback;
}

function pickArray(v: any) {
  return Array.isArray(v) ? v : [];
}

function safeArrayStrings(v: any): string[] {
  return Array.isArray(v)
    ? v
        .map((x) => String(x ?? ""))
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
}

function mergeUnique(listA: string[], listB: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const s of [...(listA || []), ...(listB || [])]) {
    const v = String(s || "").trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }

  return out;
}

function normalizeYesNo(v: any): "Si" | "No" | "" {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "";
  if (["si", "sí", "true", "1", "yes", "y"].includes(s)) return "Si";
  if (["no", "false", "0", "n"].includes(s)) return "No";
  return "";
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
      clause: x.clause ? x.clause : null,
      note: x.note ? x.note : null,
      url: x.url ? x.url : null,
    }));
}

/* =========================
   Tipos auxiliares
========================= */

type CriticalTasks = {
  lifting: boolean;
  hotWork: boolean;
  workAtHeight: boolean;
  confinedSpace: boolean;
  highPressure: boolean;
};

type ChecklistDecisionHint = "STOP" | "REVIEW_REQUIRED" | "CONTINUE";

type ChecklistAction = {
  priority: "critical" | "high" | "medium" | "low";
  category: "administrative" | "engineering" | "ppe";
  action: string;
  evidence: string[];
};

type ChecklistActionsPayload = {
  decision_hint: ChecklistDecisionHint;
  missing: string[];
  critical_fails: string[];
  derived_controls: {
    engineering: string[];
    administrative: string[];
    ppe: string[];
  };
  actions: ChecklistAction[];
  snapshot: any;
};
/* =========================
   ROUTE
========================= */

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const environment = normalizeEnvironment(body?.environment);

    const tasks: CriticalTasks = {
      lifting: !!body.lifting,
      hotWork: !!body.hotWork,
      workAtHeight: !!body.workAtHeight,
      confinedSpace: !!body.confinedSpace,
      highPressure: !!body.highPressure,
    };

    const taskDescription = pickString(body?.taskDescription, "");

    const normativeRefs = normalizeNormRefs(body?.normative_refs);

    const estrella = body?.estrella_format ?? null;

    const checklistBase = deriveChecklistDeterministic(estrella, body);

    const procedure_refs_raw = pickArray(body?.procedure_refs);

    const procedure_refs = procedure_refs_raw.map(normalizeProcedureRef);

    const procedureInfluence = buildProcedureInfluence(procedure_refs);

    const autoTriggers = computeStopWorkTriggers({
      ...body,
      environment,
    });

    const meta = {
      title: pickString(body.jobTitle, "ATS"),
      company: pickString(body.company, ""),
      location: pickString(body.location, ""),
      date: pickString(body.date, ""),
      shift: pickString(body.shift, ""),
    };

    const prompt = `
Eres un experto corporativo HSEQ y seguridad de procesos.
Debes generar un ATS (Análisis de Trabajo Seguro).

Reglas:
- Devuelve SOLO JSON.
- Genera hazards, controls y steps.
- Usa normativa cuando aplique.
`.trim();

    const inputPayload = {
      meta,
      task_description: taskDescription,
      environment,
      tasks,
      normative_refs: normativeRefs,
      checklist_actions_seed: checklistBase,
      procedure_refs,
    };

    const response = await client.responses.create({
      model: ATS_MODEL,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_text", text: JSON.stringify(inputPayload) },
          ],
        },
      ],
      max_output_tokens: 2000,
      text: {
        format: {
          type: "json_schema",
          name: "ats_schema",
          schema: ATS_SCHEMA,
        },
      },
    });

    const out = (response.output_text || "").trim();

    let ats;

    try {
      ats = JSON.parse(out);
    } catch {
      ats = {
        meta,
        environment,
        hazards: [],
        controls: { engineering: [], administrative: [], ppe: [] },
        steps: [],
        stop_work: {
          decision: autoTriggers.length ? "REVIEW_REQUIRED" : "CONTINUE",
          auto_triggers: autoTriggers,
          criteria: [],
          rationale: "Salida IA no parseable.",
        },
        procedure_refs_used: procedureInfluence.applied,
        procedure_influence: procedureInfluence,
        checklist_actions: checklistBase,
        normative_refs: normativeRefs,
        recommendations: [],
      };
    }

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