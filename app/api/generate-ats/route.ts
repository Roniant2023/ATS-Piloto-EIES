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

/* =========================
   Stop Work determinístico
========================= */
function computeStopWorkTriggers(payload: any) {
  const env = payload?.environment || {};
  const tasks: CriticalTasks = {
    lifting: !!payload?.lifting,
    hotWork: !!payload?.hotWork,
    workAtHeight: !!payload?.workAtHeight,
    confinedSpace: !!payload?.confinedSpace,
    highPressure: !!payload?.highPressure,
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

  if (weather === "Lluvia" && tasks.workAtHeight) {
    triggers.push(
      "Lluvia: evaluar superficie resbalosa, anclajes y visibilidad; si no hay condiciones seguras → STOP WORK en alturas."
    );
  }

  if (wind === "Fuerte" || weather === "Viento fuerte") {
    if (tasks.lifting) {
      triggers.push(
        "Viento fuerte: STOP WORK para izaje hasta que condiciones sean seguras (control de oscilación/carga)."
      );
    }
    if (tasks.workAtHeight) {
      triggers.push(
        "Viento fuerte: suspender trabajo en alturas si compromete estabilidad o control del trabajador."
      );
    }
  }

  if (visibility === "Baja") {
    triggers.push(
      "Visibilidad baja: STOP WORK si no se puede garantizar control del área, señalización, comunicación y supervisión."
    );
  }

  if (lighting === "Deficiente") {
    triggers.push(
      "Iluminación deficiente: STOP WORK si no se puede corregir con iluminación artificial adecuada."
    );
  }

  if (timeOfDay === "Noche" && lighting === "") {
    triggers.push(
      "Trabajo nocturno sin especificar iluminación: STOP WORK hasta confirmar iluminación y controles."
    );
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
    triggers.push(
      "Alta humedad + calor: riesgo de estrés térmico; detener si no hay control administrativo y vigilancia."
    );
  }

  if (weather === "Neblina" && tasks.lifting) {
    triggers.push(
      "Neblina: STOP WORK para izaje si la visibilidad compromete señalización, señalero y control de área."
    );
  }

  if (tasks.confinedSpace) {
    triggers.push(
      "Espacio confinado: detener el trabajo si no se cuenta con monitoreo de gases, ventilación adecuada, permiso vigente o vigía designado."
    );
  }

  if (tasks.highPressure) {
    triggers.push(
      "Altas presiones: detener el trabajo si no se ha confirmado aislamiento, despresurización, integridad de conexiones y control de energía."
    );
  }

  return triggers;
}

/* =========================
   Normalizadores
========================= */
function normalizeEnvironment(env: any) {
  const e = env && typeof env === "object" ? env : {};
  const toStrOrNull = (v: any) =>
    typeof v === "string" && v.trim() ? v : null;

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
      ? e.controlsAvailable.map(String).map((s: string) => s.trim()).filter(Boolean)
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
    brief?.critical_controls && typeof brief.critical_controls === "object"
      ? brief.critical_controls
      : {};

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
   Lección aprendida
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
  if (criticalFails.length > 0) {
    decision_hint = "STOP";
  } else if (missing.length > 0 || actions.some((a) => a.priority === "high" || a.priority === "medium")) {
    decision_hint = "REVIEW_REQUIRED";
  }

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
      supervisorChecks: {
        stagesClarity,
        hazardsControlled,
        isolationConfirmed,
        commsAgreed,
        toolsOk,
      },
    },
  };
}

function sanitizeChecklistActions(
  x: any,
  fallback: ChecklistActionsPayload
): ChecklistActionsPayload {
  const o = x && typeof x === "object" ? x : fallback;

  const decision_hint: ChecklistDecisionHint =
    (["STOP", "REVIEW_REQUIRED", "CONTINUE"] as const).includes(o.decision_hint)
      ? o.decision_hint
      : fallback.decision_hint;

  const actions: ChecklistAction[] = Array.isArray(o.actions)
    ? o.actions
        .map((a: any) => ({
          priority: (["critical", "high", "medium", "low"] as const).includes(a?.priority)
            ? a.priority
            : "medium",
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

  const snapshot =
    o.snapshot && typeof o.snapshot === "object"
      ? o.snapshot
      : (fallback.snapshot as any);

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
async function enrichChecklistWithAI(
  base: ChecklistActionsPayload,
  body: any
): Promise<ChecklistActionsPayload> {
  if (!process.env.OPENAI_API_KEY) return base;

  const hasSignal =
    (base?.actions?.length || 0) > 0 ||
    (base?.missing?.length || 0) > 0 ||
    (base?.critical_fails?.length || 0) > 0;

  if (!hasSignal) return base;

  const prompt = `
Eres un especialista HSEQ corporativo.
A partir de un checklist debes:
1) Mejorar y concretar actions para que sean verificables y auditables.
2) Mantener jerarquía: engineering, administrative, ppe.
3) No inventes procedimientos ni permisos específicos.
4) Devuelve SOLO JSON con la misma estructura recibida.

Reglas:
- Si hay critical_fails -> decision_hint debe seguir en STOP.
- Si no hay critical_fails pero hay missing -> decision_hint debe ser REVIEW_REQUIRED.
`.trim();

  const input = {
    base,
    context: {
      taskDescription: pickString(body?.taskDescription, ""),
      tasks: {
        lifting: !!body?.lifting,
        hotWork: !!body?.hotWork,
        workAtHeight: !!body?.workAtHeight,
        confinedSpace: !!body?.confinedSpace,
        highPressure: !!body?.highPressure,
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
    max_output_tokens: 900,
  });

  const out = (response.output_text || "").trim();

  try {
    const parsed = JSON.parse(out);

    if ((base?.critical_fails?.length || 0) > 0) {
      parsed.decision_hint = "STOP";
    }
    if ((base?.critical_fails?.length || 0) === 0 && (base?.missing?.length || 0) > 0) {
      parsed.decision_hint = "REVIEW_REQUIRED";
    }

    return sanitizeChecklistActions(parsed, base);
  } catch {
    return base;
  }
}

/* =========================
   Fallbacks
========================= */
function buildFallbackHazards(params: {
  checklist: ChecklistActionsPayload;
  tasks: CriticalTasks;
  environment: ReturnType<typeof normalizeEnvironment>;
  autoTriggers: string[];
  taskDescription: string;
}) {
  const { checklist, tasks, environment, autoTriggers, taskDescription } = params;

  let hazards = mergeUnique(
    safeArrayStrings(checklist?.snapshot?.dangerTypes),
    safeArrayStrings(checklist?.snapshot?.environmentDangers)
  );

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
  if (tasks.confinedSpace) {
    hazards = mergeUnique(hazards, [
      "Espacio confinado: atmósfera peligrosa, deficiencia de oxígeno, intoxicación por gases o rescate complejo.",
    ]);
  }
  if (tasks.highPressure) {
    hazards = mergeUnique(hazards, [
      "Líneas o equipos de alta presión: liberación de energía, latigazo de mangueras, proyección de fluidos.",
    ]);
  }

  const desc = String(taskDescription || "").toLowerCase();

  if (desc.includes("válvula") || desc.includes("valvula")) {
    hazards = mergeUnique(hazards, [
      "Intervención de válvulas/accesorios: atrapamiento de manos, liberación inesperada de presión o producto.",
    ]);
  }
  if (desc.includes("manguera")) {
    hazards = mergeUnique(hazards, [
      "Mangueras y conexiones: latigazo, desacople inesperado y proyección de fluidos.",
    ]);
  }
  if (desc.includes("línea") || desc.includes("linea") || desc.includes("manifold")) {
    hazards = mergeUnique(hazards, [
      "Intervención en línea de proceso: liberación de energía, fugas, exposición a fluidos o presión residual.",
    ]);
  }
  if (desc.includes("equipo") || desc.includes("bomba") || desc.includes("motor")) {
    hazards = mergeUnique(hazards, [
      "Intervención de equipos: atrapamiento, energización inesperada, contacto con partes móviles.",
    ]);
  }

  if (environment?.visibility === "Baja") {
    hazards = mergeUnique(hazards, [
      "Visibilidad baja: riesgo de atropellamiento/colisión y pérdida de control del área.",
    ]);
  }
  if (environment?.lighting === "Deficiente") {
    hazards = mergeUnique(hazards, [
      "Iluminación deficiente: errores operacionales, tropiezos/caídas, colisiones.",
    ]);
  }
  if (environment?.terrain === "Húmedo/Resbaloso" || environment?.terrain === "Barro") {
    hazards = mergeUnique(hazards, [
      "Superficie resbalosa/inestable: caídas al mismo nivel, pérdida de estabilidad de equipos.",
    ]);
  }
  if (environment?.weather === "Tormenta eléctrica") {
    hazards = mergeUnique(hazards, [
      "Tormenta eléctrica: exposición a descarga, pérdida de control de tareas expuestas.",
    ]);
  }
  if (environment?.wind === "Fuerte" || environment?.weather === "Viento fuerte") {
    hazards = mergeUnique(hazards, [
      "Viento fuerte: oscilación de cargas y pérdida de estabilidad/control.",
    ]);
  }

  if ((autoTriggers?.length || 0) > 0) {
    hazards = mergeUnique(hazards, [
      "Condiciones críticas detectadas (STOP/REVIEW): ver auto_triggers y criterios de Stop Work.",
    ]);
  }

  if (hazards.length === 0) {
    hazards = [
      "Riesgos generales de operación: interacción hombre-máquina, energías peligrosas, orden y aseo, y condiciones del entorno.",
    ];
  }

  return hazards;
}

function buildFallbackControls(params: {
  tasks: CriticalTasks;
  checklist: ChecklistActionsPayload;
  procedureInfluence: ReturnType<typeof buildProcedureInfluence>;
  taskDescription: string;
}) {
  const { tasks, checklist, procedureInfluence, taskDescription } = params;

  const engineering: string[] = [];
  const administrative: string[] = [];
  const ppe: string[] = [];

  engineering.push(...safeArrayStrings(checklist?.derived_controls?.engineering));
  administrative.push(...safeArrayStrings(checklist?.derived_controls?.administrative));
  ppe.push(...safeArrayStrings(checklist?.derived_controls?.ppe));

  const procDerived = Array.isArray(procedureInfluence?.derived_controls)
    ? procedureInfluence.derived_controls
    : [];

  for (const item of procDerived) {
    if (item?.level === "engineering") engineering.push(item.control);
    if (item?.level === "administrative") administrative.push(item.control);
    if (item?.level === "ppe") ppe.push(item.control);
  }

  administrative.push("Realizar charla preoperacional y confirmar roles/responsables.");
  administrative.push("Inspección preoperacional del área, herramientas y equipos.");
  administrative.push("Mantener orden y aseo durante la ejecución.");
  administrative.push("Detener el trabajo ante cambios no controlados en la tarea o el entorno.");

  ppe.push("Casco de seguridad.");
  ppe.push("Botas de seguridad.");
  ppe.push("Guantes adecuados a la tarea.");
  ppe.push("Gafas de seguridad.");

  if (tasks.workAtHeight) {
    engineering.push("Verificar punto de anclaje o sistema anticaídas certificado.");
    administrative.push("Validar permiso y personal autorizado para trabajo en alturas.");
    ppe.push("Arnés de seguridad con sistema anticaídas.");
  }

  if (tasks.hotWork) {
    engineering.push("Retiro o protección de materiales combustibles del área.");
    administrative.push("Aplicar permiso de trabajo en caliente.");
    administrative.push("Ubicar extintor operativo y vigía de fuego si aplica.");
    ppe.push("Protección facial y ropa adecuada contra chispas/proyecciones.");
  }

  if (tasks.lifting) {
    engineering.push("Definir zona de exclusión y verificar accesorios de izaje.");
    administrative.push("Aplicar plan de izaje y comunicación señalero-operador.");
    ppe.push("Casco con barbuquejo si aplica.");
  }

  if (tasks.confinedSpace) {
    engineering.push("Ventilación adecuada del espacio y control de accesos.");
    administrative.push("Permiso de ingreso a espacio confinado.");
    administrative.push("Monitoreo continuo de gases y vigía externo.");
    ppe.push("Protección respiratoria según evaluación atmosférica.");
  }

  if (tasks.highPressure) {
    engineering.push("Verificar aislamiento mecánico, despresurización y barreras.");
    administrative.push("Confirmar energía cero antes de intervenir la línea o equipo.");
    ppe.push("Protección facial y corporal según riesgo por fluido/presión.");
  }

  const desc = String(taskDescription || "").toLowerCase();
  if (desc.includes("válvula") || desc.includes("valvula")) {
    administrative.push("Verificar posición segura, aislamiento y condición de la válvula antes de intervenir.");
  }
  if (desc.includes("manguera")) {
    engineering.push("Inspeccionar integridad de mangueras y conexiones antes de operar.");
  }

  return {
    engineering: mergeUnique([], engineering),
    administrative: mergeUnique([], administrative),
    ppe: mergeUnique([], ppe),
  };
}

function buildFallbackSteps(params: {
  meta: { title: string; company: string; location: string; date: string; shift: string };
  hazards: string[];
  controls: { engineering: string[]; administrative: string[]; ppe: string[] };
  tasks: CriticalTasks;
  checklist: ChecklistActionsPayload;
  taskDescription: string;
}) {
  const { meta, hazards, controls, tasks, checklist, taskDescription } = params;

  const topHazards = hazards.slice(0, Math.min(6, hazards.length));
  const topControls = mergeUnique(
    mergeUnique(controls.engineering, controls.administrative),
    controls.ppe
  ).slice(0, 10);

  const steps: Array<{ step: string; hazards: string[]; controls: string[] }> = [];

  steps.push({
    step: "1) Charla preoperacional, revisión del alcance, roles, permisos y comunicación.",
    hazards: topHazards,
    controls: mergeUnique(
      ["Definir responsable del trabajo, roles del equipo y condiciones de inicio."],
      safeArrayStrings(checklist?.actions?.map((a) => a.action)).slice(0, 3)
    ),
  });

  steps.push({
    step: "2) Inspección del área, demarcación, orden y aseo, y verificación de condiciones del entorno.",
    hazards: topHazards,
    controls: mergeUnique(
      [
        "Delimitar y señalizar el área.",
        "Verificar accesos, interferencias, iluminación, visibilidad y terreno.",
      ],
      topControls
    ),
  });

  steps.push({
    step: "3) Verificación de aislamiento, herramientas, equipos y controles críticos antes de iniciar.",
    hazards: topHazards,
    controls: mergeUnique(
      [
        "Confirmar condiciones seguras, inspección preoperacional y disponibilidad de EPP.",
      ],
      topControls
    ),
  });

  if (tasks.lifting) {
    steps.push({
      step: "4) Ejecución del izaje con control de zona de exclusión y comunicación señalero-operador.",
      hazards: mergeUnique(topHazards, ["Caída de carga, atrapamiento y golpeado por carga."]),
      controls: mergeUnique(
        [
          "Verificar accesorios, puntos de izaje, capacidad y señalero competente.",
        ],
        topControls
      ),
    });
  }

  if (tasks.hotWork) {
    steps.push({
      step: "4) Ejecución del trabajo en caliente controlando fuentes de ignición y exposición a chispas.",
      hazards: mergeUnique(topHazards, ["Incendio, quemaduras, proyección de partículas y humos."]),
      controls: mergeUnique(
        [
          "Permiso vigente, extintor disponible, materiales combustibles controlados y vigilancia de fuego.",
        ],
        topControls
      ),
    });
  }

  if (tasks.workAtHeight) {
    steps.push({
      step: "4) Ejecución del trabajo en alturas con sistema anticaídas y control de caída de objetos.",
      hazards: mergeUnique(topHazards, ["Caída a distinto nivel y caída de objetos."]),
      controls: mergeUnique(
        [
          "Verificar anclajes, línea de vida, plan de rescate y uso correcto del arnés.",
        ],
        topControls
      ),
    });
  }

  if (tasks.confinedSpace) {
    steps.push({
      step: "4) Ingreso y ejecución en espacio confinado con monitoreo continuo y vigía externo.",
      hazards: mergeUnique(topHazards, ["Atmósfera peligrosa, intoxicación y rescate complejo."]),
      controls: mergeUnique(
        [
          "Monitoreo atmosférico, ventilación adecuada, permiso vigente y vigía externo permanente.",
        ],
        topControls
      ),
    });
  }

  if (tasks.highPressure) {
    steps.push({
      step: "4) Intervención del sistema de alta presión verificando aislamiento, energía cero y condición segura de conexiones.",
      hazards: mergeUnique(topHazards, ["Liberación de energía, latigazo de mangueras y proyección de fluidos."]),
      controls: mergeUnique(
        [
          "Confirmar despresurización, aislamiento, integridad de conexiones y EPP especializado.",
        ],
        topControls
      ),
    });
  }

  if (!tasks.lifting && !tasks.hotWork && !tasks.workAtHeight && !tasks.confinedSpace && !tasks.highPressure) {
    steps.push({
      step: taskDescription?.trim()
        ? `4) Ejecución de la tarea: ${taskDescription.trim()}`
        : "4) Ejecución del trabajo según plan y controles definidos.",
      hazards: topHazards,
      controls: topControls,
    });
  }

  steps.push({
    step: "5) Cierre del trabajo, verificación final, retiro de demarcación y housekeeping.",
    hazards: ["Exposición residual por energías, objetos o interacción con equipos durante el cierre."],
    controls: [
      "Asegurar condición final segura del área.",
      "Retirar señalización de manera controlada.",
      "Registrar observaciones, incidentes o novedades.",
      `Registrar ATS: ${meta.title} | ${meta.location} | ${meta.date} | Turno: ${meta.shift}`,
    ],
  });

  return steps;
}

/* =========================
   JSON Schema ATS
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
        checklistBase.missing = mergeUnique(checklistBase.missing, [
          "Incidentes en trabajos similares = Sí, pero no se adjuntó lección aprendida (lesson_learned_brief).",
        ]);
        checklistBase.actions = [
          ...checklistBase.actions,
          {
            priority: "high",
            category: "administrative",
            action:
              "Adjuntar y revisar una Lección Aprendida antes de iniciar. Socializar controles y validar aplicabilidad.",
            evidence: ["Incidentes = Sí", "Lección aprendida pendiente"],
          },
        ];
        if (checklistBase.decision_hint === "CONTINUE") {
          checklistBase.decision_hint = "REVIEW_REQUIRED";
        }
      }
    }

    const procedure_refs_raw = pickArray(body?.procedure_refs);
    const procedure_refs_combined = lessonLearnedRef
      ? [...procedure_refs_raw, lessonLearnedRef]
      : procedure_refs_raw;

    const procedure_refs = procedure_refs_combined.map(normalizeProcedureRef);
    const procedureInfluence = buildProcedureInfluence(procedure_refs);

    const autoTriggersEnv = computeStopWorkTriggers({ ...body, environment });

    const lessonStopWork = lessonLearnedRef
      ? safeArrayStrings(lessonLearnedRef?.brief?.stop_work)
      : [];

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
Eres un experto corporativo HSEQ y seguridad de procesos.
Debes generar un ATS (Análisis de Trabajo Seguro) en ESPAÑOL, técnico, claro, práctico y auditable.

Reglas obligatorias:
1. Usa como base principal:
- descripción de la tarea
- entorno
- tareas críticas
- procedimientos cargados
- checklist corporativo
- referencias normativas

2. Debes generar SIEMPRE:
- hazards con mínimo 3 ítems
- controls separados en engineering, administrative y ppe
- steps con mínimo 4 pasos

3. STOP WORK:
- Si auto_triggers no está vacío, la decisión nunca puede ser CONTINUE.
- Debe ser STOP o REVIEW_REQUIRED.
- Explica claramente la razón.

4. Procedimientos:
- Refleja los documentos usados en procedure_refs_used.
- Usa sus brief para reforzar controles y pasos.
- No copies párrafos completos.

5. Normativa:
- Usa normative_refs si vienen.
- No inventes artículos ni cláusulas.
- Si no hay anclaje claro, verification debe ser "requires_verification".

6. Checklist:
- Incluye checklist_actions en la salida.
- No inventes datos faltantes.

7. Contexto de tarea:
- La descripción breve de tarea puede contener información operativa clave como:
  desmontaje, cambio de válvula, intervención de línea, mantenimiento, equipos, mangueras, manifolds, conexiones, etc.
- Debes inferir peligros y controles razonables en un contexto industrial.

Devuelve SOLO JSON válido según el schema.
`.trim();

    const inputPayload = {
      meta,
      task_description: taskDescription,
      environment,
      tasks: {
        lifting: tasks.lifting,
        hotWork: tasks.hotWork,
        workAtHeight: tasks.workAtHeight,
        confinedSpace: tasks.confinedSpace,
        highPressure: tasks.highPressure,
      },
      stop_work_seed: {
        auto_triggers: autoTriggers,
        criteria: generalCriteria,
      },
      procedure_refs: procedure_refs.map((p) => ({
        title: p.title,
        code: p.code,
        origin: p.origin,
        parseable: p.parseable,
        brief: p.brief,
      })),
      normative_refs: normativeRefs,
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
      max_output_tokens: 2600,
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
      autoTriggers.length
        ? "Condiciones críticas detectadas; requiere revisión."
        : "Sin condiciones críticas detectadas."
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

    const checklistFromModel = ats?.checklist_actions ?? checklistBase;
    const enriched = await enrichChecklistWithAI(checklistBase, body);

    const mergedChecklist = sanitizeChecklistActions(
      {
        ...(checklistFromModel || {}),
        ...(enriched || {}),
      },
      checklistBase
    );

    if ((checklistBase?.critical_fails?.length || 0) > 0) {
      mergedChecklist.decision_hint = "STOP";
    }
    if ((checklistBase?.critical_fails?.length || 0) === 0 && (checklistBase?.missing?.length || 0) > 0) {
      if (mergedChecklist.decision_hint === "CONTINUE") {
        mergedChecklist.decision_hint = "REVIEW_REQUIRED";
      }
    }

    ats.checklist_actions = mergedChecklist;

    const fallbackControls = buildFallbackControls({
      tasks,
      checklist: mergedChecklist,
      procedureInfluence,
      taskDescription,
    });

    ats.controls.engineering = mergeUnique(
      mergeUnique(ats.controls.engineering, fallbackControls.engineering),
      safeArrayStrings(mergedChecklist?.derived_controls?.engineering)
    );
    ats.controls.administrative = mergeUnique(
      mergeUnique(ats.controls.administrative, fallbackControls.administrative),
      safeArrayStrings(mergedChecklist?.derived_controls?.administrative)
    );
    ats.controls.ppe = mergeUnique(
      mergeUnique(ats.controls.ppe, fallbackControls.ppe),
      safeArrayStrings(mergedChecklist?.derived_controls?.ppe)
    );

    const hint = mergedChecklist?.decision_hint as ChecklistDecisionHint;

    if (hint === "STOP" && ats.stop_work.decision !== "STOP") {
      ats.stop_work.decision = "STOP";
      ats.stop_work.rationale =
        (ats.stop_work.rationale ? ats.stop_work.rationale + " " : "") +
        "Checklist corporativo indica STOP por verificación negativa o control crítico no cumplido.";
    } else if (hint === "REVIEW_REQUIRED" && ats.stop_work.decision === "CONTINUE") {
      ats.stop_work.decision = "REVIEW_REQUIRED";
      ats.stop_work.rationale =
        (ats.stop_work.rationale ? ats.stop_work.rationale + " " : "") +
        "Checklist corporativo requiere verificación adicional antes de continuar.";
    }

    const cf = safeArrayStrings(mergedChecklist?.critical_fails);
    if (cf.length) {
      ats.stop_work.auto_triggers = mergeUnique(
        ats.stop_work.auto_triggers,
        cf.map((x) => `Checklist: ${x}`)
      );
    }

    ats.normative_refs = normalizeNormRefs(ats?.normative_refs ?? normativeRefs);
    if (!Array.isArray(ats.normative_refs)) ats.normative_refs = [];

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

        return {
          topic,
          recommendation,
          based_on,
          verification: based_on.length ? verification : "requires_verification",
        };
      })
      .filter((r: any) => r.topic && r.recommendation)
      .slice(0, 10);

    if ((ats.hazards?.length || 0) === 0) {
      ats.hazards = buildFallbackHazards({
        checklist: mergedChecklist,
        tasks,
        environment: ats.environment,
        autoTriggers: ats.stop_work?.auto_triggers || [],
        taskDescription,
      });
    }

    if ((ats.hazards?.length || 0) < 3) {
      ats.hazards = mergeUnique(
        ats.hazards,
        buildFallbackHazards({
          checklist: mergedChecklist,
          tasks,
          environment: ats.environment,
          autoTriggers: ats.stop_work?.auto_triggers || [],
          taskDescription,
        })
      ).slice(0, 12);
    }

    if ((ats.steps?.length || 0) === 0) {
      ats.steps = buildFallbackSteps({
        meta: ats.meta,
        hazards: ats.hazards,
        controls: ats.controls,
        tasks,
        checklist: mergedChecklist,
        taskDescription,
      });
    }

    if ((ats.steps?.length || 0) < 4) {
      ats.steps = buildFallbackSteps({
        meta: ats.meta,
        hazards: ats.hazards,
        controls: ats.controls,
        tasks,
        checklist: mergedChecklist,
        taskDescription,
      });
    }

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
    return NextResponse.json(
      { error: "Error generando ATS", details: msg },
      { status: 500 }
    );
  }
}