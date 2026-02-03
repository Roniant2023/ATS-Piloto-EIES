// app/api/generate-ats/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const ATS_MODEL = process.env.ATS_MODEL || "gpt-4.1-mini";

// ✅ Guardrail configurable (por defecto TRUE para mantener tu política)
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

/** ✅ evita "undefined", nulls y strings vacíos */
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

/** ✅ Normaliza respuestas tipo Si/No con acentos/variantes */
function normalizeYesNo(v: any): "Si" | "No" | "" {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "";
  if (["si", "sí", "sÍ", "true", "1", "yes", "y"].includes(s)) return "Si";
  if (["no", "false", "0", "n"].includes(s)) return "No";
  return "";
}

/* =========================
   ✅ Referencias normativas (opcional)
   🔧 IMPORTANTE: para el schema de OpenAI, fields "opcionales"
   deben existir pero permitir null.
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
   Stop Work determinístico (ENTORNO/TAREA)
========================= */
function computeStopWorkTriggers(payload: any) {
  const env = payload?.environment || {};
  const tasks = {
    lifting: !!payload?.lifting,
    hotWork: !!payload?.hotWork,
    workAtHeight: !!payload?.workAtHeight,
  };

  const weather = (env.weather || "").toString();
  const wind = (env.wind || "").toString();
  const lighting = (env.lighting || "").toString();
  const terrain = (env.terrain || "").toString();
  const visibility = (env.visibility || "").toString();
  const timeOfDay = (env.timeOfDay || "").toString();

  const temperatureC = typeof env.temperatureC === "number" ? env.temperatureC : null;
  const humidityPct = typeof env.humidityPct === "number" ? env.humidityPct : null;

  const triggers: string[] = [];

  if (weather === "Tormenta eléctrica") {
    if (tasks.lifting || tasks.workAtHeight || tasks.hotWork) {
      triggers.push(
        "Tormenta eléctrica: suspender actividades expuestas (izaje/alturas/hot work) y asegurar el área."
      );
    }
  }

  if (weather === "Lluvia") {
    if (tasks.workAtHeight) {
      triggers.push(
        "Lluvia: evaluar superficie resbalosa, anclajes y visibilidad; si no hay condiciones seguras → STOP WORK en alturas."
      );
    }
  }

  if (wind === "Fuerte" || weather === "Viento fuerte") {
    if (tasks.lifting) {
      triggers.push(
        "Viento fuerte: STOP WORK para izaje hasta que condiciones sean seguras (control de oscilación/carga)."
      );
    }
    if (tasks.workAtHeight) {
      triggers.push("Viento fuerte: suspender trabajo en alturas si compromete estabilidad o control del trabajador.");
    }
  }

  if (visibility === "Baja") {
    triggers.push(
      "Visibilidad baja: STOP WORK si no se puede garantizar control del área, señalización, comunicación y supervisión."
    );
  }

  if (lighting === "Deficiente") {
    triggers.push("Iluminación deficiente: STOP WORK si no se puede corregir con iluminación artificial adecuada.");
  }

  if (timeOfDay === "Noche" && lighting === "") {
    triggers.push("Trabajo nocturno sin especificar iluminación: STOP WORK hasta confirmar iluminación y controles.");
  }

  if (terrain === "Húmedo/Resbaloso" || terrain === "Barro") {
    if (tasks.workAtHeight || tasks.lifting) {
      triggers.push(
        "Superficie resbalosa/barro: STOP WORK si compromete estabilidad de equipos/personas o zonas de exclusión."
      );
    } else {
      triggers.push(
        "Superficie resbalosa/barro: reforzar control de caídas al mismo nivel y demarcación; detener si no hay control."
      );
    }
  }

  if (temperatureC !== null && temperatureC >= 35) {
    triggers.push(
      "Temperatura elevada (≥35°C): detener si no hay pausas, hidratación, sombra y monitoreo (estrés térmico)."
    );
  }

  if (humidityPct !== null && humidityPct >= 85 && temperatureC !== null && temperatureC >= 30) {
    triggers.push("Alta humedad + calor: riesgo de estrés térmico; detener si no hay control administrativo y vigilancia.");
  }

  if (weather === "Neblina") {
    if (tasks.lifting) {
      triggers.push("Neblina: STOP WORK para izaje si la visibilidad compromete señalización, señalero y control de área.");
    }
  }

  return triggers;
}

/* =========================
   Normalizadores
========================= */
function normalizeEnvironment(env: any) {
  const e = env && typeof env === "object" ? env : {};
  const toStrOrNull = (v: any) => (typeof v === "string" && v.trim() ? v : null);

  return {
    timeOfDay: toStrOrNull(e.timeOfDay),
    weather: toStrOrNull(e.weather),
    temperatureC: typeof e.temperatureC === "number" ? e.temperatureC : null,
    humidityPct: typeof e.humidityPct === "number" ? e.humidityPct : null,
    wind: toStrOrNull(e.wind),
    lighting: toStrOrNull(e.lighting),
    terrain: toStrOrNull(e.terrain),
    visibility: toStrOrNull(e.visibility),
    noiseLevel: toStrOrNull(e.noiseLevel),
    procedureUsedText: toStrOrNull(e.procedureUsedText),
    controlsAvailable: Array.isArray(e.controlsAvailable)
      ? e.controlsAvailable.map(String).map((s) => s.trim()).filter(Boolean)
      : [],
  };
}

function normalizeProcedureRef(p: any) {
  const title = pickString(p?.title, "Procedimiento");
  const code = pickString(p?.code, "");
  const origin = pickString(p?.origin, "");
  const parseable = typeof p?.parseable === "boolean" ? p.parseable : true;

  const brief = p?.brief && typeof p.brief === "object" ? p.brief : {};
  const critical =
    brief?.critical_controls && typeof brief.critical_controls === "object" ? brief.critical_controls : {};

  return {
    title,
    code,
    origin,
    parseable,
    brief: {
      scope: pickString(brief?.scope, ""),
      mandatory_permits: safeArrayStrings(brief?.mandatory_permits),
      critical_controls: {
        engineering: safeArrayStrings(critical?.engineering),
        administrative: safeArrayStrings(critical?.administrative),
        ppe: safeArrayStrings(critical?.ppe),
      },
      stop_work: safeArrayStrings(brief?.stop_work),
      mandatory_steps: safeArrayStrings(brief?.mandatory_steps),
      restrictions: safeArrayStrings(brief?.restrictions),
    },
  };
}

function buildProcedureInfluence(procedure_refs: any[]) {
  const normalized = procedure_refs.map(normalizeProcedureRef);

  const applied = normalized.filter((p) => p.parseable !== false);
  const notParseable = normalized.filter((p) => p.parseable === false);

  const derived_controls: Array<{
    level: "engineering" | "administrative" | "ppe";
    control: string;
    source: { title: string; code: string; origin: string };
  }> = [];

  for (const p of applied) {
    const src = { title: p.title, code: p.code, origin: p.origin };

    for (const c of p.brief.critical_controls.engineering) {
      if (c.trim()) derived_controls.push({ level: "engineering", control: c, source: src });
    }
    for (const c of p.brief.critical_controls.administrative) {
      if (c.trim()) derived_controls.push({ level: "administrative", control: c, source: src });
    }
    for (const c of p.brief.critical_controls.ppe) {
      if (c.trim()) derived_controls.push({ level: "ppe", control: c, source: src });
    }
  }

  const seen = new Set<string>();
  const deduped = derived_controls.filter((x) => {
    const k = `${x.level}::${x.control}::${x.source.code || x.source.title}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    applied: applied.map((p) => ({ title: p.title, code: p.code, origin: p.origin })),
    not_parseable: notParseable.map((p) => ({ title: p.title, code: p.code, origin: p.origin })),
    derived_controls: deduped,
  };
}

/* =========================
   ✅ Lección aprendida: extracción robusta
========================= */
function extractLessonLearnedRef(body: any) {
  const ll =
    body?.lesson_learned_brief ??
    body?.lesson_learned_ref ??
    body?.lesson?.lesson_learned_brief ??
    body?.data?.lesson_learned_brief ??
    body?.lessonLearned?.lesson_learned_brief ??
    null;

  if (!ll || typeof ll !== "object") return null;

  const normalized = normalizeProcedureRef({
    ...ll,
    origin: pickString(ll?.origin, "Lección aprendida"),
    title: pickString(ll?.title, "Lección aprendida"),
    parseable: true,
  });

  const hasUsefulBrief =
    !!normalized?.brief?.scope ||
    (normalized?.brief?.mandatory_permits?.length || 0) > 0 ||
    (normalized?.brief?.mandatory_steps?.length || 0) > 0 ||
    (normalized?.brief?.stop_work?.length || 0) > 0 ||
    (normalized?.brief?.restrictions?.length || 0) > 0 ||
    (normalized?.brief?.critical_controls?.engineering?.length || 0) > 0 ||
    (normalized?.brief?.critical_controls?.administrative?.length || 0) > 0 ||
    (normalized?.brief?.critical_controls?.ppe?.length || 0) > 0;

  return hasUsefulBrief ? normalized : null;
}

/* =========================
   Checklist Estrella
========================= */
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
  snapshot: {
    incidentsReference: string;
    otherCompanies: string;
    dangerTypes: string[];
    environmentDangers: string[];
    emergencies: string[];
    safetyEquipment: string[];
    lifeSavingRules: string[];
    supervisorChecks: {
      stagesClarity: string;
      hazardsControlled: string;
      isolationConfirmed: string;
      commsAgreed: string;
      toolsOk: string;
    };
  };
};

function deriveChecklistDeterministic(estrella: any, body: any): ChecklistActionsPayload {
  const s = estrella && typeof estrella === "object" ? estrella : {};

  const incidentsReference = normalizeYesNo(s.incidentsReference);
  const otherCompanies = normalizeYesNo(s.otherCompanies);

  const dangerTypes = safeArrayStrings(s.dangerTypes);
  const environmentDangers = safeArrayStrings(s.environmentDangers);
  const emergencies = safeArrayStrings(s.emergencies);
  const safetyEquipment = safeArrayStrings(s.safetyEquipment);
  const lifeSavingRules = safeArrayStrings(s.lifeSavingRules);

  const supervisorChecks = s?.authorizations?.supervisor?.checks || {};
  const stagesClarity = pickString(supervisorChecks?.stagesClarity, "");
  const hazardsControlled = pickString(supervisorChecks?.hazardsControlled, "");
  const isolationConfirmed = pickString(supervisorChecks?.isolationConfirmed, "");
  const commsAgreed = pickString(supervisorChecks?.commsAgreed, "");
  const toolsOk = pickString(supervisorChecks?.toolsOk, "");

  const missing: string[] = [];
  const actions: ChecklistAction[] = [];
  const criticalFails: string[] = [];

  const supMap: Array<[string, string, string]> = [
    ["Claridad de etapas", stagesClarity, "Tengo claridad de todas las etapas del trabajo a ejecutar"],
    ["Peligros controlados", hazardsControlled, "Se han identificado y controlado todos los peligros y es seguro comenzar"],
    ["Aislamiento confirmado", isolationConfirmed, "He confirmado el aislamiento de todas las fuentes de energías peligrosas"],
    ["Comunicación acordada", commsAgreed, "Se han acordado responsabilidades y canales de comunicación del equipo"],
    ["Herramientas OK", toolsOk, "Cuento con herramientas y equipos necesarios en buenas condiciones"],
  ];

  for (const [label, val, text] of supMap) {
    if (!val) {
      missing.push(`Falta selección en verificación del supervisor: ${label}.`);
    } else if (val === "NO") {
      criticalFails.push(`Supervisor marcó NO: ${label}.`);
      actions.push({
        priority: "critical",
        category: "administrative",
        action: `Detener el trabajo y corregir el ítem: "${text}". Revalidar antes de reiniciar.`,
        evidence: ["Checklist supervisor"],
      });
    }
  }

  const elab = pickString(s.elaborationDate, "");
  const exec = pickString(s.executionDate, "");
  if (!elab) missing.push("Falta fecha de elaboración (Formato Estrella).");
  if (!exec) missing.push("Falta fecha de ejecución (Formato Estrella).");

  if (!incidentsReference) {
    missing.push("No se respondió: Incidentes en trabajos similares (Si/No).");
  } else if (incidentsReference === "Si") {
    actions.push({
      priority: "high",
      category: "administrative",
      action:
        "Revisar lecciones aprendidas/incidentes similares, definir controles específicos y socializarlos en charla preoperacional.",
      evidence: ["Incidentes en trabajos similares = Sí"],
    });
  }

  if (!otherCompanies) {
    missing.push("No se respondió: Involucra personal de otras compañías (Si/No).");
  } else if (otherCompanies === "Si") {
    actions.push({
      priority: "high",
      category: "administrative",
      action:
        "Asegurar coordinación inter-contratistas: roles, responsable de área, permisos, comunicación, y control de interferencias (SIMOPS).",
      evidence: ["Otras compañías = Sí"],
    });
  }

  if (dangerTypes.includes("Trabajo en alturas") && !body?.workAtHeight) {
    actions.push({
      priority: "medium",
      category: "administrative",
      action:
        "Validar coherencia: se marcó 'Trabajo en alturas' pero la condición 'Trabajo en alturas' no está activa. Confirmar si aplica y ajustar.",
      evidence: ["Tipos de peligros"],
    });
  }

  if (emergencies.length === 0) {
    actions.push({
      priority: "medium",
      category: "administrative",
      action:
        "Confirmar escenarios de emergencia aplicables (médica, incendio, H2S, ambiental, etc.) y verificar plan de respuesta (rutas, puntos, comunicación).",
      evidence: ["Emergencias sin selección"],
    });
  }

  const ppeDerived: string[] = [];
  const adminDerived: string[] = [];

  const PPE_MAP: Record<string, string> = {
    Casco: "Uso obligatorio de casco de seguridad.",
    Guantes: "Uso obligatorio de guantes adecuados a la tarea.",
    "Botas de seguridad": "Uso obligatorio de botas de seguridad.",
    "Gafas de Seguridad": "Uso obligatorio de gafas de seguridad.",
    "Protección Auditiva": "Uso obligatorio de protección auditiva según niveles de ruido.",
    "Protección Respiratoria": "Uso obligatorio de protección respiratoria según exposición.",
    "Arnés de Seguridad": "Uso de arnés y sistema anticaídas certificado (si aplica trabajo en alturas).",
  };

  for (const k of safetyEquipment) {
    if (PPE_MAP[k]) ppeDerived.push(PPE_MAP[k]);
  }

  if (safetyEquipment.includes("Señalización/Conos/Limitación de Área")) {
    adminDerived.push("Delimitar y señalizar el área de trabajo; controlar accesos.");
  }
  if (safetyEquipment.includes("Medición de gases")) {
    adminDerived.push("Realizar medición de gases previa y continua cuando aplique; registrar resultados.");
  }
  if (safetyEquipment.includes("Extintores / Matafuegos")) {
    adminDerived.push("Verificar extintor disponible/operativo y permiso de trabajo en caliente cuando aplique.");
  }
  if (safetyEquipment.includes("Lockout/Layout/ EMN")) {
    adminDerived.push("Aplicar aislamiento de energías peligrosas (LOTO) y verificación de energía cero si aplica.");
  }

  if (lifeSavingRules.length === 0) {
    actions.push({
      priority: "medium",
      category: "administrative",
      action:
        "Seleccionar y verificar 'Acuerdos de Vida' aplicables antes de iniciar. Si algún control no está implementado → detener y solicitar ayuda.",
      evidence: ["Acuerdos de vida sin selección"],
    });
  }

  let decision_hint: ChecklistDecisionHint = "CONTINUE";
  if (criticalFails.length > 0) decision_hint = "STOP";
  else if (missing.length > 0 || actions.some((a) => a.priority === "high" || a.priority === "medium"))
    decision_hint = "REVIEW_REQUIRED";

  return {
    decision_hint,
    missing,
    critical_fails: criticalFails,
    derived_controls: {
      administrative: adminDerived,
      ppe: ppeDerived,
      engineering: [],
    },
    actions,
    snapshot: {
      incidentsReference,
      otherCompanies,
      dangerTypes,
      environmentDangers,
      emergencies,
      safetyEquipment,
      lifeSavingRules,
      supervisorChecks: { stagesClarity, hazardsControlled, isolationConfirmed, commsAgreed, toolsOk },
    },
  };
}

function sanitizeChecklistActions(x: any, fallback: ChecklistActionsPayload): ChecklistActionsPayload {
  const o = x && typeof x === "object" ? x : fallback;

  const decision_hint: ChecklistDecisionHint = (["STOP", "REVIEW_REQUIRED", "CONTINUE"] as const).includes(o.decision_hint)
    ? o.decision_hint
    : fallback.decision_hint;

  const actions: ChecklistAction[] = Array.isArray(o.actions)
    ? o.actions
        .map((a: any) => ({
          priority: (["critical", "high", "medium", "low"] as const).includes(a?.priority) ? a.priority : "medium",
          category: (["administrative", "engineering", "ppe"] as const).includes(a?.category)
            ? a.category
            : "administrative",
          action: pickString(a?.action, ""),
          evidence: safeArrayStrings(a?.evidence),
        }))
        .filter((a: ChecklistAction) => a.action.trim().length > 0)
    : fallback.actions;

  const derived_controls = {
    engineering: safeArrayStrings(o?.derived_controls?.engineering),
    administrative: safeArrayStrings(o?.derived_controls?.administrative),
    ppe: safeArrayStrings(o?.derived_controls?.ppe),
  };

  const snapshot = o.snapshot && typeof o.snapshot === "object" ? o.snapshot : (fallback.snapshot as any);

  return {
    decision_hint,
    missing: safeArrayStrings(o.missing),
    critical_fails: safeArrayStrings(o.critical_fails),
    derived_controls: {
      engineering: derived_controls.engineering,
      administrative: derived_controls.administrative,
      ppe: derived_controls.ppe,
    },
    actions,
    snapshot: snapshot as any,
  };
}

/* =========================
   IA opcional para checklist
========================= */
async function enrichChecklistWithAI(base: ChecklistActionsPayload, body: any): Promise<ChecklistActionsPayload> {
  if (!process.env.OPENAI_API_KEY) return base;

  const hasSignal =
    (base?.actions?.length || 0) > 0 || (base?.missing?.length || 0) > 0 || (base?.critical_fails?.length || 0) > 0;

  if (!hasSignal) return base;

  const prompt = `
Eres un especialista HSEQ corporativo. 
A partir de un checklist (formato empresa) debes:
1) Mejorar y concretar "actions" (acciones) para que sean verificables y auditables.
2) Mantener la jerarquía: engineering, administrative, ppe.
3) NO inventes procedimientos ni permisos específicos. Si faltan datos, dilo como "requiere verificación".
4) Devuelve SOLO JSON con la misma estructura recibida, sin campos nuevos.

Notas:
- Si hay critical_fails -> decision_hint debe permanecer STOP.
- Si no hay critical_fails pero hay missing -> decision_hint debe ser REVIEW_REQUIRED.
`.trim();

  const input = {
    base,
    context: {
      tasks: {
        lifting: !!body?.lifting,
        hotWork: !!body?.hotWork,
        workAtHeight: !!body?.workAtHeight,
      },
      meta: {
        jobTitle: pickString(body?.jobTitle, ""),
        company: pickString(body?.company, ""),
        location: pickString(body?.location, ""),
      },
    },
  };

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
    max_output_tokens: 800,
  });

  const out = (response.output_text || "").trim();
  try {
    const parsed = JSON.parse(out);

    if ((base?.critical_fails?.length || 0) > 0) parsed.decision_hint = "STOP";
    if ((base?.critical_fails?.length || 0) === 0 && (base?.missing?.length || 0) > 0)
      parsed.decision_hint = "REVIEW_REQUIRED";

    return sanitizeChecklistActions(parsed, base);
  } catch {
    return base;
  }
}

/* =========================
   ✅ Fallbacks (cuando el modelo devuelve hazards/steps vacíos)
========================= */
function buildFallbackHazards(params: {
  checklist: ChecklistActionsPayload;
  tasks: { lifting: boolean; hotWork: boolean; workAtHeight: boolean };
  environment: ReturnType<typeof normalizeEnvironment>;
  autoTriggers: string[];
}) {
  const { checklist, tasks, environment, autoTriggers } = params;

  // 1) Base: lo que venga del checklist (Formato Estrella)
  let hazards = mergeUnique(
    safeArrayStrings(checklist?.snapshot?.dangerTypes),
    safeArrayStrings(checklist?.snapshot?.environmentDangers)
  );

  // 2) Derivar por tareas (mínimo útil, sin inventar detalles del proceso)
  if (tasks.lifting) {
    hazards = mergeUnique(hazards, [
      "Izaje / manejo de cargas: golpeado por carga, atrapamiento, caída de carga, zona de exclusión deficiente.",
    ]);
  }
  if (tasks.hotWork) {
    hazards = mergeUnique(hazards, [
      "Trabajo en caliente: incendio/quemaduras, chispas/proyección, atmósferas inflamables, exposición a humos.",
    ]);
  }
  if (tasks.workAtHeight) {
    hazards = mergeUnique(hazards, [
      "Trabajo en alturas: caída a distinto nivel, caída de objetos, anclajes/linea de vida inadecuados.",
    ]);
  }

  // 3) Condiciones del entorno (si vienen)
  if (environment?.visibility === "Baja") hazards = mergeUnique(hazards, ["Visibilidad baja: riesgo de atropellamiento/colisión y pérdida de control del área."]);
  if (environment?.lighting === "Deficiente") hazards = mergeUnique(hazards, ["Iluminación deficiente: errores operacionales, tropiezos/caídas, colisiones."]);
  if (environment?.terrain === "Húmedo/Resbaloso" || environment?.terrain === "Barro")
    hazards = mergeUnique(hazards, ["Superficie resbalosa/inestable: caídas al mismo nivel, pérdida de estabilidad de equipos."]);
  if (environment?.weather === "Tormenta eléctrica") hazards = mergeUnique(hazards, ["Tormenta eléctrica: exposición a descarga, pérdida de control de tareas expuestas."]);
  if (environment?.wind === "Fuerte" || environment?.weather === "Viento fuerte") hazards = mergeUnique(hazards, ["Viento fuerte: oscilación de cargas y pérdida de estabilidad/ control."]);

  // 4) Si hay autoTriggers, aseguro que quede al menos un “peligro” contextual asociado
  if ((autoTriggers?.length || 0) > 0) {
    hazards = mergeUnique(hazards, ["Condiciones críticas detectadas (STOP/REVIEW): ver auto_triggers y criterios de Stop Work."]);
  }

  // 5) Último recurso: nunca devolver vacío
  if (hazards.length === 0) {
    hazards = [
      "Riesgos generales de operación: interacción hombre-máquina, energías peligrosas, orden y aseo, y condiciones del entorno.",
    ];
  }

  return hazards;
}

function buildFallbackSteps(params: {
  meta: { title: string; company: string; location: string; date: string; shift: string };
  hazards: string[];
  controls: { engineering: string[]; administrative: string[]; ppe: string[] };
  tasks: { lifting: boolean; hotWork: boolean; workAtHeight: boolean };
  checklist: ChecklistActionsPayload;
}) {
  const { meta, hazards, controls, tasks, checklist } = params;

  const topHazards = hazards.slice(0, Math.min(6, hazards.length));
  const topControls = mergeUnique(
    mergeUnique(controls.engineering, controls.administrative),
    controls.ppe
  ).slice(0, 8);

  const steps: Array<{ step: string; hazards: string[]; controls: string[] }> = [];

  steps.push({
    step: "1) Charla preoperacional, roles, comunicación y verificación de competencias.",
    hazards: topHazards,
    controls: mergeUnique(
      ["Definir roles, responsable del trabajo, canales de comunicación y señales (incluye señalero si aplica)."],
      safeArrayStrings(checklist?.actions?.map((a) => a.action)).slice(0, 3)
    ),
  });

  steps.push({
    step: "2) Inspección del área, demarcación, control de accesos y verificación de condiciones (ambiente/orden y aseo).",
    hazards: topHazards,
    controls: mergeUnique(
      [
        "Delimitar y señalizar el área; establecer zonas de exclusión y rutas seguras.",
        "Verificar iluminación/visibilidad/terreno y ajustar controles antes de iniciar.",
      ],
      topControls
    ),
  });

  steps.push({
    step: "3) Verificación de equipos/herramientas y controles críticos antes de iniciar (incluye EPP).",
    hazards: topHazards,
    controls: mergeUnique(
      ["Inspección preoperacional de equipos/herramientas; detener si hay defectos críticos."],
      topControls
    ),
  });

  // Paso específico por tarea (sin inventar detalles de proceso)
  if (tasks.lifting) {
    steps.push({
      step: "4) Ejecución de izaje/manejo de carga con control de zona de exclusión y comunicación señalero-operador.",
      hazards: mergeUnique(topHazards, ["Caída de carga, golpeado por carga, atrapamiento, interacción con equipos móviles."]),
      controls: mergeUnique(
        ["Aplicar plan de izaje (si aplica), verificar accesorios, puntos de izaje y capacidad; usar señalero competente."],
        topControls
      ),
    });
  }

  if (tasks.hotWork) {
    steps.push({
      step: "4) Ejecución de trabajo en caliente con control de ignición y vigilancia de incendio.",
      hazards: mergeUnique(topHazards, ["Incendio/quemaduras, chispas/proyección, atmósfera inflamable, humos."]),
      controls: mergeUnique(
        ["Validar permiso de trabajo en caliente (si aplica), extintor operativo, retirar combustibles y mantener vigilancia de fuego."],
        topControls
      ),
    });
  }

  if (tasks.workAtHeight) {
    steps.push({
      step: "4) Ejecución de trabajo en alturas con sistema anticaídas y control de caída de objetos.",
      hazards: mergeUnique(topHazards, ["Caída a distinto nivel, anclajes inadecuados, caída de objetos."]),
      controls: mergeUnique(
        ["Verificar anclajes/linea de vida, plan de rescate (si aplica) y uso correcto del arnés/sistema anticaídas."],
        topControls
      ),
    });
  }

  // Si no hay tareas específicas activas, poner un paso genérico de ejecución
  if (!tasks.lifting && !tasks.hotWork && !tasks.workAtHeight) {
    steps.push({
      step: "4) Ejecución del trabajo según plan y controles definidos.",
      hazards: topHazards,
      controls: topControls,
    });
  }

  steps.push({
    step: "5) Cierre del trabajo: retiro de demarcación, housekeeping, verificación final y registro de novedades.",
    hazards: ["Exposición residual por energías/orden y aseo, interacción con equipos en retiro."],
    controls: [
      "Asegurar condición segura final del área, retiro controlado de señalización y entrega del sitio.",
      "Registrar observaciones/incidentes/casi-incidentes y controles implementados.",
      `Registrar ATS: ${meta.title} | ${meta.location} | ${meta.date} | Turno: ${meta.shift}`,
    ],
  });

  return steps;
}

/* =========================
   JSON Schema ATS
   🔧 FIX: OpenAI requiere:
   - required en root incluya TODAS las keys de properties
   - en arrays de objetos, required incluya TODAS las keys de properties
   Campos "opcionales" => existen pero permiten null/[].
========================= */
const ATS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    meta: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        company: { type: "string" },
        location: { type: "string" },
        date: { type: "string" },
        shift: { type: "string" },
      },
      required: ["title", "company", "location", "date", "shift"],
    },

    environment: {
      type: "object",
      additionalProperties: false,
      properties: {
        timeOfDay: { type: ["string", "null"] },
        weather: { type: ["string", "null"] },
        temperatureC: { type: ["number", "null"] },
        humidityPct: { type: ["number", "null"] },
        wind: { type: ["string", "null"] },
        lighting: { type: ["string", "null"] },
        terrain: { type: ["string", "null"] },
        visibility: { type: ["string", "null"] },
        noiseLevel: { type: ["string", "null"] },
        procedureUsedText: { type: ["string", "null"] },
        controlsAvailable: { type: "array", items: { type: "string" } },
      },
      required: [
        "timeOfDay",
        "weather",
        "temperatureC",
        "humidityPct",
        "wind",
        "lighting",
        "terrain",
        "visibility",
        "noiseLevel",
        "procedureUsedText",
        "controlsAvailable",
      ],
    },

    hazards: { type: "array", items: { type: "string" } },

    controls: {
      type: "object",
      additionalProperties: false,
      properties: {
        engineering: { type: "array", items: { type: "string" } },
        administrative: { type: "array", items: { type: "string" } },
        ppe: { type: "array", items: { type: "string" } },
      },
      required: ["engineering", "administrative", "ppe"],
    },

    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          step: { type: "string" },
          hazards: { type: "array", items: { type: "string" } },
          controls: { type: "array", items: { type: "string" } },
        },
        required: ["step", "hazards", "controls"],
      },
    },

    stop_work: {
      type: "object",
      additionalProperties: false,
      properties: {
        decision: { type: "string", enum: ["STOP", "CONTINUE", "REVIEW_REQUIRED"] },
        auto_triggers: { type: "array", items: { type: "string" } },
        criteria: { type: "array", items: { type: "string" } },
        rationale: { type: "string" },
      },
      required: ["decision", "auto_triggers", "criteria", "rationale"],
    },

    procedure_refs_used: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          code: { type: "string" },
          origin: { type: "string" },
        },
        required: ["title", "code", "origin"],
      },
    },

    procedure_influence: {
      type: "object",
      additionalProperties: false,
      properties: {
        applied: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              code: { type: "string" },
              origin: { type: "string" },
            },
            required: ["title", "code", "origin"],
          },
        },
        not_parseable: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              code: { type: "string" },
              origin: { type: "string" },
            },
            required: ["title", "code", "origin"],
          },
        },
        derived_controls: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              level: { type: "string", enum: ["engineering", "administrative", "ppe"] },
              control: { type: "string" },
              source: {
                type: "object",
                additionalProperties: false,
                properties: {
                  title: { type: "string" },
                  code: { type: "string" },
                  origin: { type: "string" },
                },
                required: ["title", "code", "origin"],
              },
            },
            required: ["level", "control", "source"],
          },
        },
      },
      required: ["applied", "not_parseable", "derived_controls"],
    },

    checklist_actions: {
      type: "object",
      additionalProperties: false,
      properties: {
        decision_hint: { type: "string", enum: ["STOP", "REVIEW_REQUIRED", "CONTINUE"] },
        missing: { type: "array", items: { type: "string" } },
        critical_fails: { type: "array", items: { type: "string" } },

        derived_controls: {
          type: "object",
          additionalProperties: false,
          properties: {
            engineering: { type: "array", items: { type: "string" } },
            administrative: { type: "array", items: { type: "string" } },
            ppe: { type: "array", items: { type: "string" } },
          },
          required: ["engineering", "administrative", "ppe"],
        },

        actions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
              category: { type: "string", enum: ["administrative", "engineering", "ppe"] },
              action: { type: "string" },
              evidence: { type: "array", items: { type: "string" } },
            },
            required: ["priority", "category", "action", "evidence"],
          },
        },

        snapshot: {
          type: "object",
          additionalProperties: false,
          properties: {
            incidentsReference: { type: "string" },
            otherCompanies: { type: "string" },
            dangerTypes: { type: "array", items: { type: "string" } },
            environmentDangers: { type: "array", items: { type: "string" } },
            emergencies: { type: "array", items: { type: "string" } },
            safetyEquipment: { type: "array", items: { type: "string" } },
            lifeSavingRules: { type: "array", items: { type: "string" } },
            supervisorChecks: {
              type: "object",
              additionalProperties: false,
              properties: {
                stagesClarity: { type: "string" },
                hazardsControlled: { type: "string" },
                isolationConfirmed: { type: "string" },
                commsAgreed: { type: "string" },
                toolsOk: { type: "string" },
              },
              required: ["stagesClarity", "hazardsControlled", "isolationConfirmed", "commsAgreed", "toolsOk"],
            },
          },
          required: [
            "incidentsReference",
            "otherCompanies",
            "dangerTypes",
            "environmentDangers",
            "emergencies",
            "safetyEquipment",
            "lifeSavingRules",
            "supervisorChecks",
          ],
        },
      },
      required: ["decision_hint", "missing", "critical_fails", "derived_controls", "actions", "snapshot"],
    },

    // ✅ Referencias normativas (opcionales pero PRESENTES)
    normative_refs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          standard: { type: "string" },
          clause: { type: ["string", "null"] },
          note: { type: ["string", "null"] },
          url: { type: ["string", "null"] },
        },
        required: ["standard", "clause", "note", "url"],
      },
    },

    // ✅ Recomendaciones sugeridas (opcionales pero PRESENTES)
    recommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          topic: { type: "string" },
          recommendation: { type: "string" },
          based_on: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                standard: { type: "string" },
                clause: { type: ["string", "null"] },
              },
              required: ["standard", "clause"],
            },
          },
          verification: { type: "string", enum: ["ok", "requires_verification"] },
        },
        required: ["topic", "recommendation", "based_on", "verification"],
      },
    },
  },

  // ✅🔧 FIX CLAVE: OpenAI exige que required incluya TODAS las keys del root properties.
  required: [
    "meta",
    "environment",
    "hazards",
    "controls",
    "steps",
    "stop_work",
    "procedure_refs_used",
    "procedure_influence",
    "checklist_actions",
    "normative_refs",
    "recommendations",
  ],
} as const;

/* =========================
   ROUTE
========================= */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const environment = normalizeEnvironment(body?.environment);

    // ✅ Normativa opcional
    const normativeRefs = normalizeNormRefs(body?.normative_refs);

    // ✅ Checklist base determinístico
    const estrella = body?.estrella_format ?? null;
    const checklistBase = deriveChecklistDeterministic(estrella, body);

    // ✅ Lección aprendida requerida si Incidentes = "Si"
    const incidentsFlag = normalizeYesNo(checklistBase?.snapshot?.incidentsReference);
    const lessonLearnedRef = extractLessonLearnedRef(body);

    if (incidentsFlag === "Si" && !lessonLearnedRef) {
      if (REQUIRE_LESSON_LEARNED_ON_INCIDENTS) {
        return NextResponse.json(
          {
            error: "Lección aprendida requerida",
            details:
              "Marcaste 'Si' en incidentes en trabajos similares. Debes cargar una lección aprendida y procesarla con /api/lesson-learned-brief antes de generar el ATS.",
          },
          { status: 400 }
        );
      } else {
        // ✅ Modo flexible: NO bloquea, pero fuerza revisión y añade acción/missing
        checklistBase.missing = mergeUnique(checklistBase.missing, [
          "Incidentes en trabajos similares = Sí, pero no se adjuntó lección aprendida (lesson_learned_brief).",
        ]);
        checklistBase.actions = [
          ...checklistBase.actions,
          {
            priority: "high",
            category: "administrative",
            action:
              "Adjuntar y revisar una Lección Aprendida (procesada con /api/lesson-learned-brief) antes de iniciar. Socializar controles y validar aplicabilidad.",
            evidence: ["Incidentes = Sí", "Lección aprendida pendiente"],
          },
        ];
        if (checklistBase.decision_hint === "CONTINUE") checklistBase.decision_hint = "REVIEW_REQUIRED";
      }
    }

    // Procedimientos + Lección aprendida
    const procedure_refs_raw = pickArray(body?.procedure_refs);
    const procedure_refs_combined = lessonLearnedRef ? [...procedure_refs_raw, lessonLearnedRef] : procedure_refs_raw;

    const procedure_refs = procedure_refs_combined.map(normalizeProcedureRef);
    const procedureInfluence = buildProcedureInfluence(procedure_refs);

    // Stop Work determinístico + aporte de lección aprendida
    const autoTriggersEnv = computeStopWorkTriggers({ ...body, environment });

    const lessonStopWork = lessonLearnedRef ? safeArrayStrings(lessonLearnedRef?.brief?.stop_work) : [];
    const autoTriggers = mergeUnique(
      autoTriggersEnv,
      lessonStopWork.map((x) => `Lección aprendida: ${x}`)
    );

    const generalCriteria = [
      "Condiciones meteorológicas severas (tormenta eléctrica, vientos fuertes) que comprometan el control de la tarea.",
      "Visibilidad/iluminación insuficiente para operar de forma segura.",
      "Superficie/terreno inestable o resbaloso sin mitigación efectiva.",
      "Fallas de equipos críticos, ausencia de permisos/aislamientos, o falta de personal competente.",
      "Cualquier condición insegura que no pueda controlarse inmediatamente.",
    ];

    const meta = {
      title: pickString(body.jobTitle, "ATS"),
      company: pickString(body.company, ""),
      location: pickString(body.location, ""),
      date: pickString(body.date, ""),
      shift: pickString(body.shift, ""),
    };

    const prompt = `
Eres un experto corporativo HSEQ/Seguridad de Procesos.
Genera un ATS (Análisis de Trabajo Seguro) técnico, claro y auditable, en ESPAÑOL, para operaciones industriales.

REQUISITOS CRÍTICOS:
1) STOP WORK:
- Si stop_work.auto_triggers NO está vacío:
  - Inclúyelos EXACTAMENTE en stop_work.auto_triggers
  - Y stop_work.decision debe ser "STOP" o "REVIEW_REQUIRED" (nunca "CONTINUE")
  - Explica en stop_work.rationale.

2) PROCEDIMIENTOS / LECCIONES APRENDIDAS:
- Refleja qué documentos se usaron en procedure_refs_used (título/código/origen).
- Usa los briefs para sugerir controles y pasos sin copiar texto completo.
- Integra controles con jerarquía: ingeniería → administrativos → EPP.
- Si hay "Lección aprendida", úsala para:
  a) reforzar peligros/controles/pasos
  b) reforzar la justificación en stop_work.rationale cuando aplique
  c) priorizar controles críticos verificables.

3) CHECKLIST CORPORATIVO:
- Se adjunta checklist_actions_seed (derivado del Formato Estrella).
- Inclúyelo como "checklist_actions" en el ATS final.
- No inventes datos; si faltan, mantén "missing".

4) REFERENCIAS NORMATIVAS:
- normative_refs siempre estará presente (puede venir vacío).
- Úsalas si vienen, pero NO inventes cláusulas o artículos no incluidos.
- Si el usuario no trae clause, usa clause=null.
- Recomendación por buena práctica (no anclada a norma): based_on=[] y verification="requires_verification".
- Si está anclada a una norma citada: verification="ok" (siempre que sea claro).
- Incluye recommendations (máximo 10), concretas y verificables.

5) COMPLETITUD:
- El ATS NO puede quedar con hazards vacío ni con steps vacío.
- Debe incluir al menos 3 hazards y al menos 4 steps.

Devuelve SOLO JSON que cumpla el schema (sin markdown).
`.trim();

    const inputPayload = {
      meta,
      environment,
      tasks: {
        lifting: !!body.lifting,
        hotWork: !!body.hotWork,
        workAtHeight: !!body.workAtHeight,
      },
      stop_work_seed: { auto_triggers: autoTriggers, criteria: generalCriteria },
      procedure_refs: procedure_refs.map((p) => ({
        title: p.title,
        code: p.code,
        origin: p.origin,
        parseable: p.parseable,
        brief: p.brief,
      })),
      normative_refs: normativeRefs, // ✅ presente (puede ser [])
      derived_controls_seed: procedureInfluence.derived_controls,
      checklist_actions_seed: checklistBase,
    };

    const response = await client.responses.create({
      model: ATS_MODEL,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_text", text: JSON.stringify(inputPayload, null, 2) },
          ],
        },
      ],
      max_output_tokens: 2400,
      text: {
        format: {
          type: "json_schema",
          name: "ats_schema",
          schema: ATS_SCHEMA,
        },
      },
    });

    const out = (response.output_text || "").trim();
    let ats: any;

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
          criteria: generalCriteria,
          rationale: "Salida no parseable; revisar.",
        },
        procedure_refs_used: procedureInfluence.applied,
        procedure_influence: procedureInfluence,
        checklist_actions: checklistBase,
        normative_refs: normativeRefs,
        recommendations: [],
      };
    }

    /* =========================
       Post-procesado determinístico (cumplir schema)
    ========================= */
    ats.meta = {
      title: pickString(ats?.meta?.title, meta.title),
      company: pickString(ats?.meta?.company, meta.company),
      location: pickString(ats?.meta?.location, meta.location),
      date: pickString(ats?.meta?.date, meta.date),
      shift: pickString(ats?.meta?.shift, meta.shift),
    };

    ats.environment = normalizeEnvironment(ats.environment ?? environment);

    ats.hazards = safeArrayStrings(ats.hazards);

    ats.controls = ats.controls || {};
    ats.controls.engineering = safeArrayStrings(ats.controls.engineering);
    ats.controls.administrative = safeArrayStrings(ats.controls.administrative);
    ats.controls.ppe = safeArrayStrings(ats.controls.ppe);

    ats.steps = Array.isArray(ats.steps) ? ats.steps : [];
    ats.steps = ats.steps.map((s: any) => ({
      step: pickString(s?.step, ""),
      hazards: safeArrayStrings(s?.hazards),
      controls: safeArrayStrings(s?.controls),
    }));

    ats.stop_work = ats.stop_work || {};
    ats.stop_work.auto_triggers = autoTriggers;
    ats.stop_work.criteria = generalCriteria;
    ats.stop_work.rationale = pickString(
      ats.stop_work.rationale,
      autoTriggers.length ? "Condiciones críticas detectadas; requiere revisión." : "Sin condiciones críticas detectadas."
    );

    if (autoTriggers.length && ats.stop_work.decision === "CONTINUE") {
      ats.stop_work.decision = "REVIEW_REQUIRED";
      ats.stop_work.rationale =
        (ats.stop_work.rationale ? ats.stop_work.rationale + " " : "") +
        "Hay condiciones críticas detectadas automáticamente; se requiere revisión y control antes de continuar.";
    }
    if (!autoTriggers.length && !["STOP", "CONTINUE", "REVIEW_REQUIRED"].includes(ats.stop_work.decision)) {
      ats.stop_work.decision = "CONTINUE";
    }

    ats.procedure_refs_used = procedureInfluence.applied;
    ats.procedure_influence = procedureInfluence;

    // Checklist + IA opcional
    const checklistFromModel = ats?.checklist_actions ?? checklistBase;
    const enriched = await enrichChecklistWithAI(checklistBase, body);

    const mergedChecklist = sanitizeChecklistActions(
      {
        ...(checklistFromModel || {}),
        ...(enriched || {}),
      },
      checklistBase
    );

    // Guardrails finales checklist
    if ((checklistBase?.critical_fails?.length || 0) > 0) mergedChecklist.decision_hint = "STOP";
    if ((checklistBase?.critical_fails?.length || 0) === 0 && (checklistBase?.missing?.length || 0) > 0) {
      if (mergedChecklist.decision_hint === "CONTINUE") mergedChecklist.decision_hint = "REVIEW_REQUIRED";
    }

    ats.checklist_actions = mergedChecklist;

    // Controles derivados del checklist
    const derived = mergedChecklist?.derived_controls || { engineering: [], administrative: [], ppe: [] };
    ats.controls.administrative = mergeUnique(ats.controls.administrative, safeArrayStrings(derived.administrative));
    ats.controls.ppe = mergeUnique(ats.controls.ppe, safeArrayStrings(derived.ppe));
    ats.controls.engineering = mergeUnique(ats.controls.engineering, safeArrayStrings(derived.engineering));

    // Controles derivados de procedimientos/lección aprendida
    const procDerived = Array.isArray(procedureInfluence?.derived_controls) ? procedureInfluence.derived_controls : [];
    const procAdmin = procDerived.filter((x: any) => x?.level === "administrative").map((x: any) => x?.control);
    const procPpe = procDerived.filter((x: any) => x?.level === "ppe").map((x: any) => x?.control);
    const procEng = procDerived.filter((x: any) => x?.level === "engineering").map((x: any) => x?.control);

    ats.controls.administrative = mergeUnique(ats.controls.administrative, safeArrayStrings(procAdmin));
    ats.controls.ppe = mergeUnique(ats.controls.ppe, safeArrayStrings(procPpe));
    ats.controls.engineering = mergeUnique(ats.controls.engineering, safeArrayStrings(procEng));

    // Ajustar STOP WORK según checklist
    const hint = mergedChecklist?.decision_hint as ChecklistDecisionHint;

    if (hint === "STOP" && ats.stop_work.decision !== "STOP") {
      ats.stop_work.decision = "STOP";
      ats.stop_work.rationale =
        (ats.stop_work.rationale ? ats.stop_work.rationale + " " : "") +
        "Checklist corporativo (Formato Estrella) indica STOP por verificación negativa o control crítico no cumplido.";
    } else if (hint === "REVIEW_REQUIRED" && ats.stop_work.decision === "CONTINUE") {
      ats.stop_work.decision = "REVIEW_REQUIRED";
      ats.stop_work.rationale =
        (ats.stop_work.rationale ? ats.stop_work.rationale + " " : "") +
        "Checklist corporativo (Formato Estrella) requiere verificación adicional antes de continuar.";
    }

    // critical_fails -> auto_triggers
    const cf = safeArrayStrings(mergedChecklist?.critical_fails);
    if (cf.length) {
      ats.stop_work.auto_triggers = mergeUnique(
        ats.stop_work.auto_triggers,
        cf.map((x) => `Checklist: ${x}`)
      );
    }

    // ✅🔧 MUY IMPORTANTE: forzar presencia de estos campos (aunque vengan vacíos)
    ats.normative_refs = normalizeNormRefs(ats?.normative_refs ?? normativeRefs);
    if (!Array.isArray(ats.normative_refs)) ats.normative_refs = [];

    // ✅ recommendations: normalizar based_on con clause=null siempre
    const allowed = new Set((normativeRefs || []).map((n) => n.standard));

    ats.recommendations = Array.isArray(ats?.recommendations) ? ats.recommendations : [];
    ats.recommendations = ats.recommendations
      .map((r: any) => {
        const topic = pickString(r?.topic, "").trim();
        const recommendation = pickString(r?.recommendation, "").trim();
        const verification = (["ok", "requires_verification"] as const).includes(r?.verification)
          ? r.verification
          : "requires_verification";

        const basedOnRaw = Array.isArray(r?.based_on) ? r.based_on : [];
        const based_on = basedOnRaw
          .map((b: any) => ({
            standard: String(b?.standard ?? "").trim(),
            clause: String(b?.clause ?? "").trim(),
          }))
          .filter((b: any) => b.standard && allowed.has(b.standard))
          .map((b: any) => ({
            standard: b.standard,
            clause: b.clause ? b.clause : null,
          }));

        const finalVerification = based_on.length ? verification : "requires_verification";

        return {
          topic,
          recommendation,
          based_on,
          verification: finalVerification,
        };
      })
      .filter((r: any) => r.topic && r.recommendation)
      .slice(0, 10);

    if (!Array.isArray(ats.recommendations)) ats.recommendations = [];

    /* =========================
       ✅ FIX COMPLETITUD: hazards/steps NO pueden quedar vacíos
       (Esto es lo que te estaba faltando)
    ========================= */
    // 1) hazards fallback
    if ((ats.hazards?.length || 0) === 0) {
      ats.hazards = buildFallbackHazards({
        checklist: mergedChecklist,
        tasks: { lifting: !!body.lifting, hotWork: !!body.hotWork, workAtHeight: !!body.workAtHeight },
        environment: ats.environment,
        autoTriggers: ats.stop_work?.auto_triggers || [],
      });
    }

    // 2) steps fallback
    if ((ats.steps?.length || 0) === 0) {
      ats.steps = buildFallbackSteps({
        meta: ats.meta,
        hazards: ats.hazards,
        controls: ats.controls,
        tasks: { lifting: !!body.lifting, hotWork: !!body.hotWork, workAtHeight: !!body.workAtHeight },
        checklist: mergedChecklist,
      });
    }

    // 3) endurecer mínimos (por si el modelo devolvió 1 hazard/1 step)
    if ((ats.hazards?.length || 0) < 3) {
      ats.hazards = mergeUnique(
        ats.hazards,
        buildFallbackHazards({
          checklist: mergedChecklist,
          tasks: { lifting: !!body.lifting, hotWork: !!body.hotWork, workAtHeight: !!body.workAtHeight },
          environment: ats.environment,
          autoTriggers: ats.stop_work?.auto_triggers || [],
        })
      ).slice(0, 12);
    }
    if ((ats.steps?.length || 0) < 4) {
      ats.steps = buildFallbackSteps({
        meta: ats.meta,
        hazards: ats.hazards,
        controls: ats.controls,
        tasks: { lifting: !!body.lifting, hotWork: !!body.hotWork, workAtHeight: !!body.workAtHeight },
        checklist: mergedChecklist,
      });
    }

    // 4) Sanitizar steps otra vez por si el fallback metió algo raro
    ats.steps = Array.isArray(ats.steps) ? ats.steps : [];
    ats.steps = ats.steps.map((s: any) => ({
      step: pickString(s?.step, ""),
      hazards: safeArrayStrings(s?.hazards),
      controls: safeArrayStrings(s?.controls),
    }));

    return NextResponse.json({ ats }, { status: 200 });
  } catch (err: any) {
    const msg = String(err?.message || err);
    console.error("generate-ats ERROR:", err);
    return NextResponse.json({ error: "Error generando ATS", details: msg }, { status: 500 });
  }
}