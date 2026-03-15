/*bloque1

"use client";

import React, { useMemo, useRef, useState, useEffect } from "react";
import { useReactToPrint } from "react-to-print";

/* =========================
TIPOS
========================= */
type ProcedureRef = {
  title?: string;
  code?: string;
  origin?: string;
  parseable?: boolean;
  [key: string]: any;
};

type ProcedureResult = {
  ok: boolean;
  fileName: string;
  procedure?: ProcedureRef;
  error?: string;
  details?: string;
};

type Environment = {
  timeOfDay?: string | null;
  weather?: string | null;
  temperatureC?: number | null;
  humidityPct?: number | null;
  wind?: string | null;
  lighting?: string | null;
  terrain?: string | null;
  visibility?: string | null;
};

type ATSStopWork = {
  decision: "STOP" | "CONTINUE" | "REVIEW_REQUIRED";
  auto_triggers: string[];
  criteria: string[];
  rationale: string;
};

type ATSProcedureMini = {
  title: string;
  code: string;
  origin: string;
};

type ATSProcedureInfluence = {
  applied: ATSProcedureMini[];
  not_parseable: ATSProcedureMini[];
  derived_controls: Array<{
    level: "engineering" | "administrative" | "ppe";
    control: string;
    source: ATSProcedureMini;
  }>;
};
/* bloque2
/* =========================
Checklist types
========================= */

type ATSChecklistDecisionHint =
  | "STOP"
  | "REVIEW_REQUIRED"
  | "CONTINUE";

type ATSChecklistAction = {
  priority: "critical" | "high" | "medium" | "low";
  category: "administrative" | "engineering" | "ppe";
  action: string;
  evidence: string[];
};

type ATSChecklistActions = {
  decision_hint: ATSChecklistDecisionHint;
  missing: string[];
  critical_fails: string[];
  derived_controls: {
    engineering: string[];
    administrative: string[];
    ppe: string[];
  };
  actions: ATSChecklistAction[];
  snapshot: any;
};
/*bloque3
type ATSRecommendations = {
  controls?: {
    engineering?: string[];
    administrative?: string[];
    ppe?: string[];
  };
  recommendations?: string[];
  notes?: string[];
  [key: string]: any;
};

type ATS = {
  meta: {
    title: string;
    company: string;
    location: string;
    date: string;
    shift: string;
  };

  environment: any;

  hazards: string[];

  controls: {
    engineering: string[];
    administrative: string[];
    ppe: string[];
  };

  steps: Array<{
    step: string;
    hazards: string[];
    controls: string[];
  }>;

  stop_work: ATSStopWork;

  procedure_refs_used: ATSProcedureMini[];

  procedure_influence: ATSProcedureInfluence;

  checklist_actions?: ATSChecklistActions;

  normative_refs?: string[];
  normative_refs_used?: string[];

  recommendations?: ATSRecommendations;
  ai_recommendations?: ATSRecommendations;
  suggestions?: ATSRecommendations;
  controls_recommendations?: ATSRecommendations;
};
/*Bloque4
/* =========================
Helpers
========================= */

function safeArray(x: any): string[] {
  if (!x) return [];
  if (Array.isArray(x)) return x;
  if (typeof x === "string") return [x];
  return [];
}

function mergeUnique(a: string[], b: string[]) {
  return Array.from(new Set([...(a || []), ...(b || [])]));
}

function normalizeText(s: any): string {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
/*Bloque5
function asProcedureMini(p: any): ATSProcedureMini {
  return {
    title: String(p?.title || "Procedimiento sin título"),
    code: String(p?.code || "N/A"),
    origin: String(p?.origin || "Adjunto"),
  };
}

function extractJsonFromText(text: string): any | null {
  if (!text) return null;

  const cleaned = text.trim();

  try {
    return JSON.parse(cleaned);
  } catch {}

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const maybe = cleaned.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(maybe);
    } catch {}
  }

  return null;
}

function splitLines(text: string): string[] {
  return String(text || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function uniqueStrings(arr: string[]): string[] {
  return Array.from(
    new Set(
      (arr || [])
        .map((x) => String(x || "").trim())
        .filter(Boolean)
    )
  );
}
/*bloque6
function extractPotentialControlsFromText(text: string): {
  engineering: string[];
  administrative: string[];
  ppe: string[];
} {
  const lines = splitLines(text);

  const engineering: string[] = [];
  const administrative: string[] = [];
  const ppe: string[] = [];

  for (const raw of lines) {
    const line = normalizeText(raw);

    if (!line) continue;

    if (
      /guarda|barrera|baranda|aislamiento|enclavamiento|dispositivo|sensor|alarma|ventilacion|extractor|linea de vida|anclaje|proteccion colectiva|resguardo|parada de emergencia|interlock/.test(
        line
      )
    ) {
      engineering.push(raw);
      continue;
    }

    if (
      /permiso|procedimiento|capacitacion|entrenamiento|inspeccion|senalizacion|demarcacion|analisis de riesgo|ats|ast|supervision|plan de izaje|checklist|charla|autorizacion|bloqueo|lototo|loto|control operacional/.test(
        line
      )
    ) {
      administrative.push(raw);
      continue;
    }

    if (
      /casco|gafas|guantes|respirador|protector auditivo|botas|arnes|barbuquejo|careta|tapaoidos|mascarilla|ropa de trabajo|chaleco|epp/.test(
        line
      )
    ) {
      ppe.push(raw);
      continue;
    }
  }

  return {
    engineering: uniqueStrings(engineering),
    administrative: uniqueStrings(administrative),
    ppe: uniqueStrings(ppe),
  };
}
/*bloque7
function inferControlsFromProcedure(proc: any): Array<{
  level: "engineering" | "administrative" | "ppe";
  control: string;
}> {
  const results: Array<{
    level: "engineering" | "administrative" | "ppe";
    control: string;
  }> = [];

  if (!proc) return results;

  const textBlocks: string[] = [];

  if (typeof proc === "string") {
    textBlocks.push(proc);
  } else if (typeof proc === "object") {
    for (const [_, value] of Object.entries(proc)) {
      if (typeof value === "string") {
        textBlocks.push(value);
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string") textBlocks.push(item);
          else if (typeof item === "object" && item) {
            for (const sub of Object.values(item)) {
              if (typeof sub === "string") textBlocks.push(sub);
            }
          }
        }
      }
    }
  }

  const consolidated = textBlocks.join("\n");
  const extracted = extractPotentialControlsFromText(consolidated);

  extracted.engineering.forEach((c) =>
    results.push({ level: "engineering", control: c })
  );
  extracted.administrative.forEach((c) =>
    results.push({ level: "administrative", control: c })
  );
  extracted.ppe.forEach((c) => results.push({ level: "ppe", control: c }));

  return results;
}
/*Bloque8
function buildProcedureInfluence(
  procedures: ProcedureRef[]
): ATSProcedureInfluence {
  const applied: ATSProcedureMini[] = [];
  const not_parseable: ATSProcedureMini[] = [];
  const derived_controls: Array<{
    level: "engineering" | "administrative" | "ppe";
    control: string;
    source: ATSProcedureMini;
  }> = [];

  for (const p of procedures || []) {
    const mini = asProcedureMini(p);

    if (p?.parseable === false) {
      not_parseable.push(mini);
      continue;
    }

    applied.push(mini);

    const controls = inferControlsFromProcedure(p);
    controls.forEach((ctrl) => {
      derived_controls.push({
        ...ctrl,
        source: mini,
      });
    });
  }

  return {
    applied,
    not_parseable,
    derived_controls,
  };
}

function groupDerivedControls(
  derived: ATSProcedureInfluence["derived_controls"]
): {
  engineering: string[];
  administrative: string[];
  ppe: string[];
} {
  const engineering = uniqueStrings(
    (derived || [])
      .filter((x) => x.level === "engineering")
      .map((x) => x.control)
  );

  const administrative = uniqueStrings(
    (derived || [])
      .filter((x) => x.level === "administrative")
      .map((x) => x.control)
  );

  const ppe = uniqueStrings(
    (derived || [])
      .filter((x) => x.level === "ppe")
      .map((x) => x.control)
  );

  return { engineering, administrative, ppe };
}
/*bloque9
function yes(v: any): boolean {
  return v === true || v === "true" || v === "sí" || v === "si" || v === "yes";
}

function no(v: any): boolean {
  return v === false || v === "false" || v === "no";
}

function buildChecklistActions(snapshot: any): ATSChecklistActions {
  const missing: string[] = [];
  const critical_fails: string[] = [];

  const derived_controls = {
    engineering: [] as string[],
    administrative: [] as string[],
    ppe: [] as string[],
  };

  const actions: ATSChecklistAction[] = [];

  const workAtHeight = yes(snapshot?.workAtHeight);
  const confinedSpace = yes(snapshot?.confinedSpace);
  const liftingOps = yes(snapshot?.liftingOps);
  const lineOpening = yes(snapshot?.lineOpening);
  const energizedWork = yes(snapshot?.energizedWork);
  const hotWork = yes(snapshot?.hotWork);

  const hasPermit = yes(snapshot?.permitApproved);
  const hasIsolation = yes(snapshot?.isolated);
  const gasTestOk = yes(snapshot?.gasTestOk);
  const rescuePlan = yes(snapshot?.rescuePlan);
  const certifiedPersonnel = yes(snapshot?.certifiedPersonnel);
  const ppeVerified = yes(snapshot?.ppeVerified);
  const toolsInspected = yes(snapshot?.toolsInspected);
  const areaDelimited = yes(snapshot?.areaDelimited);
  const weatherOk = yes(snapshot?.weatherOk);
/*bloque10
if (!hasPermit) {
    missing.push("Permiso de trabajo aprobado");
    actions.push({
      priority: "critical",
      category: "administrative",
      action: "Gestionar y aprobar el permiso de trabajo antes de iniciar.",
      evidence: ["Permiso firmado y vigente"],
    });
  }

  if (!ppeVerified) {
    missing.push("Verificación de EPP");
    actions.push({
      priority: "high",
      category: "ppe",
      action: "Verificar y registrar el EPP requerido para la tarea.",
      evidence: ["Checklist EPP", "Inspección visual previa"],
    });
    derived_controls.ppe.push("Uso obligatorio de EPP verificado antes de iniciar");
  }

  if (!toolsInspected) {
    missing.push("Inspección de herramientas/equipos");
    actions.push({
      priority: "high",
      category: "administrative",
      action: "Inspeccionar herramientas y equipos antes del uso.",
      evidence: ["Checklist preoperacional", "Registro de inspección"],
    });
  }

  if (!areaDelimited) {
    missing.push("Demarcación / aislamiento del área");
    actions.push({
      priority: "high",
      category: "engineering",
      action: "Instalar barreras, cinta o delimitación del área de trabajo.",
      evidence: ["Área señalizada y restringida"],
    });
    derived_controls.engineering.push("Demarcación y aislamiento del área de trabajo");
  }
/* bloque 11
if (workAtHeight) {
    derived_controls.ppe.push("Uso de arnés certificado con sistema de detención de caídas");
    derived_controls.engineering.push("Instalar línea de vida o punto de anclaje certificado");
    derived_controls.administrative.push("Verificar permiso y personal autorizado para trabajo en alturas");

    if (!rescuePlan) {
      critical_fails.push("Trabajo en alturas sin plan de rescate");
      actions.push({
        priority: "critical",
        category: "administrative",
        action: "Definir y socializar plan de rescate antes del inicio.",
        evidence: ["Plan de rescate disponible", "Brigada o respuesta definida"],
      });
    }

    if (!certifiedPersonnel) {
      critical_fails.push("Trabajo en alturas con personal no certificado");
      actions.push({
        priority: "critical",
        category: "administrative",
        action: "Asegurar personal certificado y autorizado para trabajo en alturas.",
        evidence: ["Certificados vigentes", "Autorización interna"],
      });
    }
  }

  if (confinedSpace) {
    derived_controls.administrative.push("Aplicar permiso de espacio confinado");
    derived_controls.engineering.push("Ventilación del espacio y control de acceso");
    derived_controls.ppe.push("EPP según monitoreo atmosférico y riesgo específico");

    if (!gasTestOk) {
      critical_fails.push("Espacio confinado sin prueba de gases aceptable");
      actions.push({
        priority: "critical",
        category: "administrative",
        action: "Realizar prueba de gases y validar condiciones seguras antes de ingresar.",
        evidence: ["Registro de monitoreo atmosférico"],
      });
    }

    if (!rescuePlan) {
      critical_fails.push("Espacio confinado sin plan de rescate");
      actions.push({
        priority: "critical",
        category: "administrative",
        action: "Definir plan de rescate específico para espacio confinado.",
        evidence: ["Plan de rescate", "Equipos disponibles"],
      });
    }
  }
/*bloque12
if (liftingOps) {
    derived_controls.administrative.push("Aplicar plan de izaje y roles definidos");
    derived_controls.engineering.push("Usar accesorios certificados y zona de exclusión");
    derived_controls.ppe.push("Casco con barbuquejo y calzado de seguridad");

    if (!certifiedPersonnel) {
      critical_fails.push("Izaje con personal no competente/certificado");
      actions.push({
        priority: "critical",
        category: "administrative",
        action: "Validar operador, aparejador o señalero competente antes del izaje.",
        evidence: ["Certificados", "Autorización", "Inspección documental"],
      });
    }
  }

  if (lineOpening) {
    derived_controls.administrative.push("Aplicar procedimiento de apertura de líneas");
    derived_controls.engineering.push("Verificar despresurización, drenaje y bridas ciegas si aplica");
    derived_controls.ppe.push("Protección facial, guantes y ropa de protección según sustancia");

    if (!hasIsolation) {
      critical_fails.push("Apertura de línea sin aislamiento verificado");
      actions.push({
        priority: "critical",
        category: "engineering",
        action: "Aislar, bloquear y confirmar cero energía / cero presión antes de abrir.",
        evidence: ["LOTO aplicado", "Verificación de cero energía", "Purgado/drenado"],
      });
    }
  }

  if (energizedWork) {
    derived_controls.administrative.push("Aplicar permiso y análisis específico para trabajo energizado");
    derived_controls.engineering.push("Aislamiento, barreras y control de aproximación");
    derived_controls.ppe.push("EPP dieléctrico / arco eléctrico según evaluación");

    if (!hasIsolation) {
      critical_fails.push("Trabajo energizado sin control de aislamiento suficiente");
      actions.push({
        priority: "critical",
        category: "engineering",
        action: "Implementar aislamiento eléctrico o justificar formalmente trabajo energizado.",
        evidence: ["Esquema de aislamiento", "Autorización", "Evaluación de riesgo eléctrico"],
      });
    }
  }
/*bloque13
if (hotWork) {
    derived_controls.administrative.push("Aplicar permiso de trabajo en caliente");
    derived_controls.engineering.push("Retiro de combustibles, pantallas y extintores disponibles");
    derived_controls.ppe.push("Careta, guantes y ropa resistente a proyecciones/chispas");

    if (!areaDelimited) {
      actions.push({
        priority: "high",
        category: "engineering",
        action: "Establecer perímetro y controlar exposición a chispas o radiación.",
        evidence: ["Barreras", "Pantallas", "Señalización"],
      });
    }
  }

  if (!weatherOk) {
    actions.push({
      priority: "medium",
      category: "administrative",
      action: "Reevaluar condiciones climáticas antes de iniciar o continuar la tarea.",
      evidence: ["Registro de clima", "Verificación del supervisor"],
    });
  }

  let decision_hint: ATSChecklistDecisionHint = "CONTINUE";

  if (critical_fails.length > 0) {
    decision_hint = "STOP";
  } else if (missing.length > 0 || actions.some((a) => a.priority === "high")) {
    decision_hint = "REVIEW_REQUIRED";
  }

  return {
    decision_hint,
    missing: uniqueStrings(missing),
    critical_fails: uniqueStrings(critical_fails),
    derived_controls: {
      engineering: uniqueStrings(derived_controls.engineering),
      administrative: uniqueStrings(derived_controls.administrative),
      ppe: uniqueStrings(derived_controls.ppe),
    },
    actions,
    snapshot,
  };
}
/*bloque14
function buildStopWork(
  hazards: string[],
  controls: ATS["controls"],
  checklist?: ATSChecklistActions
): ATSStopWork {
  const hz = (hazards || []).map((h) => normalizeText(h));

  const auto_triggers: string[] = [];
  const criteria: string[] = [];
  let rationale = "Condiciones dentro de parámetros aceptables con controles definidos.";
  let decision: ATSStopWork["decision"] = "CONTINUE";

  const highRiskHazards = [
    "caida de altura",
    "caida de objetos",
    "atrapamiento",
    "espacio confinado",
    "energia peligrosa",
    "electrico",
    "explosion",
    "incendio",
    "presion",
    "linea presurizada",
    "izaje",
  ];

  const foundHighRisk = hz.some((h) =>
    highRiskHazards.some((r) => h.includes(r))
  );

  if (foundHighRisk) {
    criteria.push("Existen peligros de alto potencial en la tarea.");
  }

  const totalControls =
    (controls?.engineering?.length || 0) +
    (controls?.administrative?.length || 0) +
    (controls?.ppe?.length || 0);

  if (totalControls === 0) {
    auto_triggers.push("No se identificaron controles.");
  }

  if (checklist?.critical_fails?.length) {
    auto_triggers.push(...checklist.critical_fails);
  }

  if (auto_triggers.length > 0) {
    decision = "STOP";
    rationale =
      "Se identificaron condiciones críticas no controladas que impiden iniciar o continuar la tarea.";
  } else if (
    checklist?.decision_hint === "REVIEW_REQUIRED" ||
    (foundHighRisk && totalControls < 3)
  ) {
    decision = "REVIEW_REQUIRED";
    rationale =
      "La tarea requiere validación adicional antes de continuar por presencia de peligros relevantes o controles insuficientes.";
  }

  if (checklist?.missing?.length) {
    criteria.push(...checklist.missing.map((m) => `Pendiente: ${m}`));
  }

  return {
    decision,
    auto_triggers: uniqueStrings(auto_triggers),
    criteria: uniqueStrings(criteria),
    rationale,
  };
}
/*bloque15
function extractRecommendationsFlexible(data: any): ATSRecommendations {
  if (!data || typeof data !== "object") return {};

  const candidate =
    data?.recommendations ||
    data?.ai_recommendations ||
    data?.controls_recommendations ||
    data?.suggestions ||
    data;

  return {
    controls: {
      engineering: safeArray(candidate?.controls?.engineering),
      administrative: safeArray(candidate?.controls?.administrative),
      ppe: safeArray(candidate?.controls?.ppe),
    },
    recommendations: safeArray(candidate?.recommendations),
    notes: safeArray(candidate?.notes),
  };
}

function buildFinalATS(args: {
  meta: ATS["meta"];
  environment: any;
  hazards: string[];
  baseControls: ATS["controls"];
  procedures: ProcedureRef[];
  steps: ATS["steps"];
  normativeRefs?: string[];
  aiData?: any;
  checklistSnapshot?: any;
}): ATS {
  const procedure_influence = buildProcedureInfluence(args.procedures || []);
  const groupedDerived = groupDerivedControls(procedure_influence.derived_controls);
  const checklist_actions = buildChecklistActions(args.checklistSnapshot || {});
  const recommendations = extractRecommendationsFlexible(args.aiData);

  const controls: ATS["controls"] = {
    engineering: uniqueStrings(
      mergeUnique(
        mergeUnique(args.baseControls.engineering || [], groupedDerived.engineering),
        safeArray(recommendations?.controls?.engineering)
      )
    ),
    administrative: uniqueStrings(
      mergeUnique(
        mergeUnique(args.baseControls.administrative || [], groupedDerived.administrative),
        safeArray(recommendations?.controls?.administrative)
      )
    ),
    ppe: uniqueStrings(
      mergeUnique(
        mergeUnique(args.baseControls.ppe || [], groupedDerived.ppe),
        safeArray(recommendations?.controls?.ppe)
      )
    ),
  };
/*bloque 16
controls.engineering = uniqueStrings(
    mergeUnique(controls.engineering, checklist_actions.derived_controls.engineering)
  );
  controls.administrative = uniqueStrings(
    mergeUnique(
      controls.administrative,
      checklist_actions.derived_controls.administrative
    )
  );
  controls.ppe = uniqueStrings(
    mergeUnique(controls.ppe, checklist_actions.derived_controls.ppe)
  );

  const stop_work = buildStopWork(args.hazards, controls, checklist_actions);

  return {
    meta: args.meta,
    environment: args.environment,
    hazards: uniqueStrings(args.hazards || []),
    controls,
    steps: args.steps || [],
    stop_work,
    procedure_refs_used: (args.procedures || [])
      .filter((p) => p?.parseable !== false)
      .map(asProcedureMini),
    procedure_influence,
    checklist_actions,
    normative_refs: uniqueStrings(args.normativeRefs || []),
    normative_refs_used: uniqueStrings(args.normativeRefs || []),
    recommendations,
    ai_recommendations: recommendations,
    suggestions: recommendations,
    controls_recommendations: recommendations,
  };
}

export default function ATSInteligentePage() {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: "ATS_Inteligente",
  });
/*bloque17
const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [rawAiResponse, setRawAiResponse] = useState<string>("");

  const [company, setCompany] = useState("Estrella International Energy Services");
  const [title, setTitle] = useState("Análisis de Trabajo Seguro");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [shift, setShift] = useState("Día");

  const [timeOfDay, setTimeOfDay] = useState("");
  const [weather, setWeather] = useState("");
  const [temperatureC, setTemperatureC] = useState<string>("");
  const [humidityPct, setHumidityPct] = useState<string>("");
  const [wind, setWind] = useState("");
  const [lighting, setLighting] = useState("");
  const [terrain, setTerrain] = useState("");
  const [visibility, setVisibility] = useState("");

  const [hazardsText, setHazardsText] = useState("");
  const [engineeringControlsText, setEngineeringControlsText] = useState("");
  const [administrativeControlsText, setAdministrativeControlsText] = useState("");
  const [ppeControlsText, setPpeControlsText] = useState("");

  const [stepsText, setStepsText] = useState("");
  const [normativeRefsText, setNormativeRefsText] = useState("");

  const [workAtHeight, setWorkAtHeight] = useState(false);
  const [confinedSpace, setConfinedSpace] = useState(false);
  const [liftingOps, setLiftingOps] = useState(false);
  const [lineOpening, setLineOpening] = useState(false);
  const [energizedWork, setEnergizedWork] = useState(false);
  const [hotWork, setHotWork] = useState(false);
/*bloque18
const [permitApproved, setPermitApproved] = useState(false);
  const [isolated, setIsolated] = useState(false);
  const [gasTestOk, setGasTestOk] = useState(false);
  const [rescuePlan, setRescuePlan] = useState(false);
  const [certifiedPersonnel, setCertifiedPersonnel] = useState(false);
  const [ppeVerified, setPpeVerified] = useState(false);
  const [toolsInspected, setToolsInspected] = useState(false);
  const [areaDelimited, setAreaDelimited] = useState(false);
  const [weatherOk, setWeatherOk] = useState(true);

  const [procedureFiles, setProcedureFiles] = useState<File[]>([]);
  const [procedureResults, setProcedureResults] = useState<ProcedureResult[]>([]);

  const [atsResult, setAtsResult] = useState<ATS | null>(null);

  const baseEnvironment: Environment = useMemo(
    () => ({
      timeOfDay: timeOfDay || null,
      weather: weather || null,
      temperatureC: temperatureC ? Number(temperatureC) : null,
      humidityPct: humidityPct ? Number(humidityPct) : null,
      wind: wind || null,
      lighting: lighting || null,
      terrain: terrain || null,
      visibility: visibility || null,
    }),
    [
      timeOfDay,
      weather,
      temperatureC,
      humidityPct,
      wind,
      lighting,
      terrain,
      visibility,
    ]
  );
/* Bloque19
const checklistSnapshot = useMemo(
    () => ({
      workAtHeight,
      confinedSpace,
      liftingOps,
      lineOpening,
      energizedWork,
      hotWork,
      permitApproved,
      isolated,
      gasTestOk,
      rescuePlan,
      certifiedPersonnel,
      ppeVerified,
      toolsInspected,
      areaDelimited,
      weatherOk,
    }),
    [
      workAtHeight,
      confinedSpace,
      liftingOps,
      lineOpening,
      energizedWork,
      hotWork,
      permitApproved,
      isolated,
      gasTestOk,
      rescuePlan,
      certifiedPersonnel,
      ppeVerified,
      toolsInspected,
      areaDelimited,
      weatherOk,
    ]
  );

  const parsedHazards = useMemo(
    () => uniqueStrings(splitLines(hazardsText)),
    [hazardsText]
  );

  const parsedBaseControls = useMemo(
    () => ({
      engineering: uniqueStrings(splitLines(engineeringControlsText)),
      administrative: uniqueStrings(splitLines(administrativeControlsText)),
      ppe: uniqueStrings(splitLines(ppeControlsText)),
    }),
    [engineeringControlsText, administrativeControlsText, ppeControlsText]
  );
/*bloque20
const parsedSteps = useMemo(() => {
    const lines = splitLines(stepsText);

    return lines.map((line) => ({
      step: line,
      hazards: [],
      controls: [],
    }));
  }, [stepsText]);

  const parsedNormativeRefs = useMemo(
    () => uniqueStrings(splitLines(normativeRefsText)),
    [normativeRefsText]
  );

  async function readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }
/*bloque21
async function processProcedureFiles(files: File[]): Promise<ProcedureResult[]> {
    const results: ProcedureResult[] = [];

    for (const file of files) {
      try {
        const text = await readFileAsText(file);
        const maybeJson = extractJsonFromText(text);

        if (maybeJson && typeof maybeJson === "object") {
          results.push({
            ok: true,
            fileName: file.name,
            procedure: {
              ...maybeJson,
              title:
                maybeJson?.title ||
                maybeJson?.nombre ||
                maybeJson?.procedure ||
                file.name,
              code:
                maybeJson?.code ||
                maybeJson?.codigo ||
                maybeJson?.id ||
                "N/A",
              origin: file.name,
              parseable: true,
            },
          });
        } else {
          results.push({
            ok: true,
            fileName: file.name,
            procedure: {
              title: file.name,
              code: "N/A",
              origin: file.name,
              parseable: true,
              content: text,
            },
          });
        }
      } catch (e: any) {
        results.push({
          ok: false,
          fileName: file.name,
          error: "No fue posible leer el archivo",
          details: String(e?.message || e || ""),
        });
      }
    }

    return results;
  }
/*bloque22
async function handleProcedureUpload(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const files = Array.from(e.target.files || []);
    setProcedureFiles(files);

    if (!files.length) {
      setProcedureResults([]);
      return;
    }

    const results = await processProcedureFiles(files);
    setProcedureResults(results);
  }

  async function callAiForATS(payload: any): Promise<any> {
    const res = await fetch("/api/ats-inteligente", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    setRawAiResponse(text);

    const maybeJson = extractJsonFromText(text);

    if (!res.ok) {
      throw new Error(
        maybeJson?.error || text || "Error al consultar el servicio de IA"
      );
    }

    return maybeJson || {};
  }
/*bloque23
async function generateATS() {
    setLoading(true);
    setError("");

    try {
      const procedures = procedureResults
        .filter((r) => r.ok && r.procedure)
        .map((r) => r.procedure as ProcedureRef);

      const meta = {
        title,
        company,
        location,
        date,
        shift,
      };

      const payload = {
        meta,
        environment: baseEnvironment,
        hazards: parsedHazards,
        controls: parsedBaseControls,
        steps: parsedSteps,
        procedure_refs: procedures,
        normative_refs: parsedNormativeRefs,
        checklist: checklistSnapshot,
      };

      const aiData = await callAiForATS(payload);

      const finalATS = buildFinalATS({
        meta,
        environment: baseEnvironment,
        hazards: parsedHazards,
        baseControls: parsedBaseControls,
        procedures,
        steps: parsedSteps,
        normativeRefs: parsedNormativeRefs,
        aiData,
        checklistSnapshot,
      });

      setAtsResult(finalATS);
    } catch (e: any) {
      setError(String(e?.message || e || "Error inesperado"));
    } finally {
      setLoading(false);
    }
  }
/*bloque24
function resetForm() {
    setError("");
    setRawAiResponse("");
    setAtsResult(null);

    setLocation("");
    setTimeOfDay("");
    setWeather("");
    setTemperatureC("");
    setHumidityPct("");
    setWind("");
    setLighting("");
    setTerrain("");
    setVisibility("");

    setHazardsText("");
    setEngineeringControlsText("");
    setAdministrativeControlsText("");
    setPpeControlsText("");
    setStepsText("");
    setNormativeRefsText("");

    setWorkAtHeight(false);
    setConfinedSpace(false);
    setLiftingOps(false);
    setLineOpening(false);
    setEnergizedWork(false);
    setHotWork(false);

    setPermitApproved(false);
    setIsolated(false);
    setGasTestOk(false);
    setRescuePlan(false);
    setCertifiedPersonnel(false);
    setPpeVerified(false);
    setToolsInspected(false);
    setAreaDelimited(false);
    setWeatherOk(true);

    setProcedureFiles([]);
    setProcedureResults([]);
  }

  const checklistPreview = useMemo(
    () => buildChecklistActions(checklistSnapshot),
    [checklistSnapshot]
  );
/*bloque25
const stopBadgeClass =
    atsResult?.stop_work?.decision === "STOP"
      ? "bg-red-100 text-red-800 border-red-300"
      : atsResult?.stop_work?.decision === "REVIEW_REQUIRED"
      ? "bg-yellow-100 text-yellow-800 border-yellow-300"
      : "bg-green-100 text-green-800 border-green-300";

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold">ATS Inteligente</h1>
            <p className="text-sm text-slate-600">
              Generación de análisis de trabajo seguro con soporte de IA,
              checklist crítico y consolidación de controles.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={generateATS}
              disabled={loading}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Generando..." : "Generar ATS"}
            </button>

            <button
              onClick={resetForm}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-100"
            >
              Limpiar
            </button>

            <button
              onClick={() => handlePrint?.()}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-100"
            >
              Imprimir / PDF
            </button>
          </div>
        </div>
/*bloque26
{error ? (
          <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
            <strong>Error:</strong> {error}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2 space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold">1. Datos generales</h2>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Empresa</span>
                  <input
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Título</span>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Ubicación</span>
                  <input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Campo / locación / área"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Fecha</span>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Turno</span>
                  <select
                    value={shift}
                    onChange={(e) => setShift(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  >
                    <option value="Día">Día</option>
                    <option value="Noche">Noche</option>
                    <option value="Mixto">Mixto</option>
                  </select>
                </label>
              </div>
            </section>
/*Bloque27
<section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold">2. Condiciones del entorno</h2>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Hora del día</span>
                  <input
                    value={timeOfDay}
                    onChange={(e) => setTimeOfDay(e.target.value)}
                    placeholder="Mañana / tarde / noche"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Clima</span>
                  <input
                    value={weather}
                    onChange={(e) => setWeather(e.target.value)}
                    placeholder="Soleado / lluvia / tormenta"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Temperatura °C</span>
                  <input
                    value={temperatureC}
                    onChange={(e) => setTemperatureC(e.target.value)}
                    type="number"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Humedad %</span>
                  <input
                    value={humidityPct}
                    onChange={(e) => setHumidityPct(e.target.value)}
                    type="number"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Viento</span>
                  <input
                    value={wind}
                    onChange={(e) => setWind(e.target.value)}
                    placeholder="Bajo / moderado / fuerte"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Iluminación</span>
                  <input
                    value={lighting}
                    onChange={(e) => setLighting(e.target.value)}
                    placeholder="Adecuada / deficiente"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Terreno</span>
                  <input
                    value={terrain}
                    onChange={(e) => setTerrain(e.target.value)}
                    placeholder="Estable / irregular / fangoso"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Visibilidad</span>
                  <input
                    value={visibility}
                    onChange={(e) => setVisibility(e.target.value)}
                    placeholder="Buena / limitada"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
              </div>
            </section>
/*bloque28
<section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold">3. Peligros, controles y pasos</h2>

              <div className="grid grid-cols-1 gap-4">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">
                    Peligros identificados
                  </span>
                  <textarea
                    value={hazardsText}
                    onChange={(e) => setHazardsText(e.target.value)}
                    rows={5}
                    placeholder={`Un peligro por línea
Caída de altura
Caída de objetos
Atrapamiento
Líneas presurizadas`}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium">
                      Controles de ingeniería
                    </span>
                    <textarea
                      value={engineeringControlsText}
                      onChange={(e) => setEngineeringControlsText(e.target.value)}
                      rows={6}
                      placeholder="Un control por línea"
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-sm font-medium">
                      Controles administrativos
                    </span>
                    <textarea
                      value={administrativeControlsText}
                      onChange={(e) => setAdministrativeControlsText(e.target.value)}
                      rows={6}
                      placeholder="Un control por línea"
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-sm font-medium">
                      EPP
                    </span>
                    <textarea
                      value={ppeControlsText}
                      onChange={(e) => setPpeControlsText(e.target.value)}
                      rows={6}
                      placeholder="Un EPP por línea"
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium">
                    Pasos de la tarea
                  </span>
                  <textarea
                    value={stepsText}
                    onChange={(e) => setStepsText(e.target.value)}
                    rows={5}
                    placeholder={`Un paso por línea
Inspección del área
Aseguramiento del equipo
Ejecución de la tarea
Cierre y orden del área`}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium">
                    Referencias normativas / procedimientos
                  </span>
                  <textarea
                    value={normativeRefsText}
                    onChange={(e) => setNormativeRefsText(e.target.value)}
                    rows={4}
                    placeholder={`Una referencia por línea
Resolución 4272 de 2021
ISO 45001
Procedimiento de trabajo en alturas`}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
              </div>
            </section>
/*Bloque29
<section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold">4. Checklist crítico</h2>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div>
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">
                    Tipo de trabajo
                  </h3>
                  <div className="grid grid-cols-1 gap-2">
                    {[
                      [workAtHeight, setWorkAtHeight, "Trabajo en alturas"],
                      [confinedSpace, setConfinedSpace, "Espacio confinado"],
                      [liftingOps, setLiftingOps, "Izaje de cargas"],
                      [lineOpening, setLineOpening, "Apertura de líneas"],
                      [energizedWork, setEnergizedWork, "Trabajo energizado"],
                      [hotWork, setHotWork, "Trabajo en caliente"],
                    ].map(([value, setter, label]) => (
                      <label
                        key={label as string}
                        className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2"
                      >
                        <input
                          type="checkbox"
                          checked={value as boolean}
                          onChange={(e) =>
                            (setter as React.Dispatch<React.SetStateAction<boolean>>)(
                              e.target.checked
                            )
                          }
                          className="h-4 w-4"
                        />
                        <span className="text-sm">{label as string}</span>
                      </label>
                    ))}
                  </div>
                </div>
/*bloque30
<div>
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">
                    Verificaciones previas
                  </h3>
                  <div className="grid grid-cols-1 gap-2">
                    {[
                      [permitApproved, setPermitApproved, "Permiso aprobado"],
                      [isolated, setIsolated, "Aislamiento verificado"],
                      [gasTestOk, setGasTestOk, "Prueba de gases aceptable"],
                      [rescuePlan, setRescuePlan, "Plan de rescate disponible"],
                      [certifiedPersonnel, setCertifiedPersonnel, "Personal certificado"],
                      [ppeVerified, setPpeVerified, "EPP verificado"],
                      [toolsInspected, setToolsInspected, "Herramientas inspeccionadas"],
                      [areaDelimited, setAreaDelimited, "Área delimitada"],
                      [weatherOk, setWeatherOk, "Condiciones climáticas aceptables"],
                    ].map(([value, setter, label]) => (
                      <label
                        key={label as string}
                        className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2"
                      >
                        <input
                          type="checkbox"
                          checked={value as boolean}
                          onChange={(e) =>
                            (setter as React.Dispatch<React.SetStateAction<boolean>>)(
                              e.target.checked
                            )
                          }
                          className="h-4 w-4"
                        />
                        <span className="text-sm">{label as string}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </section>
/*Bloque31
<section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold">5. Carga de procedimientos</h2>

              <div className="space-y-4">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium">
                    Adjuntar procedimientos / instructivos / JSON / TXT
                  </span>
                  <input
                    type="file"
                    multiple
                    onChange={handleProcedureUpload}
                    className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                </label>

                {procedureFiles.length ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="mb-2 text-sm font-medium text-slate-700">
                      Archivos cargados:
                    </p>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
                      {procedureFiles.map((file) => (
                        <li key={file.name}>{file.name}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {procedureResults.length ? (
                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    <table className="min-w-full border-collapse text-sm">
                      <thead className="bg-slate-100 text-left text-slate-700">
                        <tr>
                          <th className="px-3 py-2">Archivo</th>
                          <th className="px-3 py-2">Estado</th>
                          <th className="px-3 py-2">Título</th>
                          <th className="px-3 py-2">Código</th>
                        </tr>
                      </thead>
                      <tbody>
                        {procedureResults.map((r, idx) => (
                          <tr key={`${r.fileName}-${idx}`} className="border-t border-slate-200">
                            <td className="px-3 py-2">{r.fileName}</td>
                            <td className="px-3 py-2">
                              {r.ok ? (
                                <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-800">
                                  OK
                                </span>
                              ) : (
                                <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-800">
                                  Error
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2">{r.procedure?.title || "-"}</td>
                            <td className="px-3 py-2">{r.procedure?.code || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            </section>
          </div>
/*Bloque32
<div className="space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold">Vista previa del checklist</h2>

              <div className="mb-4">
                <span
                  className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${
                    checklistPreview.decision_hint === "STOP"
                      ? "border-red-300 bg-red-100 text-red-800"
                      : checklistPreview.decision_hint === "REVIEW_REQUIRED"
                      ? "border-yellow-300 bg-yellow-100 text-yellow-800"
                      : "border-green-300 bg-green-100 text-green-800"
                  }`}
                >
                  {checklistPreview.decision_hint}
                </span>
              </div>

              {checklistPreview.critical_fails.length ? (
                <div className="mb-4">
                  <h3 className="mb-2 text-sm font-semibold text-red-700">
                    Fallas críticas
                  </h3>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {checklistPreview.critical_fails.map((item, idx) => (
                      <li key={`${item}-${idx}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {checklistPreview.missing.length ? (
                <div className="mb-4">
                  <h3 className="mb-2 text-sm font-semibold text-yellow-700">
                    Pendientes
                  </h3>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {checklistPreview.missing.map((item, idx) => (
                      <li key={`${item}-${idx}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
/*Bloque33
<div>
                <h3 className="mb-2 text-sm font-semibold text-slate-700">
                  Acciones sugeridas
                </h3>
                {checklistPreview.actions.length ? (
                  <ul className="space-y-2">
                    {checklistPreview.actions.map((a, idx) => (
                      <li
                        key={`${a.action}-${idx}`}
                        className="rounded-xl border border-slate-200 p-3"
                      >
                        <div className="mb-1 flex items-center justify-between gap-3">
                          <span className="text-sm font-medium">{a.action}</span>
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold uppercase text-slate-700">
                            {a.priority}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500">
                          Categoría: {a.category}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">
                    No hay acciones pendientes con la información actual.
                  </p>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold">Resumen rápido</h2>

              <div className="space-y-3 text-sm text-slate-700">
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <strong>Peligros:</strong> {parsedHazards.length}
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <strong>Controles de ingeniería:</strong> {parsedBaseControls.engineering.length}
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <strong>Controles administrativos:</strong> {parsedBaseControls.administrative.length}
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <strong>EPP:</strong> {parsedBaseControls.ppe.length}
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <strong>Pasos:</strong> {parsedSteps.length}
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <strong>Procedimientos cargados:</strong> {procedureResults.length}
                </div>
              </div>
            </section>
          </div>
        </div>
/*Bloque34
<div>
                <h3 className="mb-2 text-sm font-semibold text-slate-700">
                  Acciones sugeridas
                </h3>
                {checklistPreview.actions.length ? (
                  <ul className="space-y-2">
                    {checklistPreview.actions.map((a, idx) => (
                      <li
                        key={`${a.action}-${idx}`}
                        className="rounded-xl border border-slate-200 p-3"
                      >
                        <div className="mb-1 flex items-center justify-between gap-3">
                          <span className="text-sm font-medium">{a.action}</span>
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold uppercase text-slate-700">
                            {a.priority}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500">
                          Categoría: {a.category}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">
                    No hay acciones pendientes con la información actual.
                  </p>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold">Resumen rápido</h2>

              <div className="space-y-3 text-sm text-slate-700">
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <strong>Peligros:</strong> {parsedHazards.length}
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <strong>Controles de ingeniería:</strong> {parsedBaseControls.engineering.length}
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <strong>Controles administrativos:</strong> {parsedBaseControls.administrative.length}
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <strong>EPP:</strong> {parsedBaseControls.ppe.length}
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <strong>Pasos:</strong> {parsedSteps.length}
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <strong>Procedimientos cargados:</strong> {procedureResults.length}
                </div>
              </div>
            </section>
          </div>
        </div>
/*Bloque35
<div className="mb-6">
                <h3 className="mb-2 text-lg font-semibold">Decisión Stop Work</h3>
                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="mb-3 text-sm text-slate-700">
                    <strong>Razonamiento:</strong> {atsResult.stop_work.rationale}
                  </p>

                  {atsResult.stop_work.auto_triggers?.length ? (
                    <div className="mb-3">
                      <h4 className="mb-1 text-sm font-semibold text-red-700">
                        Disparadores automáticos
                      </h4>
                      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                        {atsResult.stop_work.auto_triggers.map((item, idx) => (
                          <li key={`${item}-${idx}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {atsResult.stop_work.criteria?.length ? (
                    <div>
                      <h4 className="mb-1 text-sm font-semibold text-slate-700">
                        Criterios considerados
                      </h4>
                      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                        {atsResult.stop_work.criteria.map((item, idx) => (
                          <li key={`${item}-${idx}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </div>
/*Bloque36
<div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-lg font-semibold">Peligros identificados</h3>
                  <div className="rounded-xl border border-slate-200 p-4">
                    {atsResult.hazards?.length ? (
                      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                        {atsResult.hazards.map((hazard, idx) => (
                          <li key={`${hazard}-${idx}`}>{hazard}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-slate-500">
                        No se registraron peligros.
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 text-lg font-semibold">Condiciones del entorno</h3>
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="grid grid-cols-1 gap-2 text-sm text-slate-700 md:grid-cols-2">
                      <div><strong>Clima:</strong> {atsResult.environment?.weather || "-"}</div>
                      <div><strong>Temperatura:</strong> {atsResult.environment?.temperatureC ?? "-"}</div>
                      <div><strong>Humedad:</strong> {atsResult.environment?.humidityPct ?? "-"}</div>
                      <div><strong>Viento:</strong> {atsResult.environment?.wind || "-"}</div>
                      <div><strong>Iluminación:</strong> {atsResult.environment?.lighting || "-"}</div>
                      <div><strong>Terreno:</strong> {atsResult.environment?.terrain || "-"}</div>
                      <div><strong>Visibilidad:</strong> {atsResult.environment?.visibility || "-"}</div>
                    </div>
                  </div>
                </div>
              </div>
/*bloque 37
<div className="mb-6">
                <h3 className="mb-2 text-lg font-semibold">Controles consolidados</h3>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <div className="rounded-xl border border-slate-200 p-4">
                    <h4 className="mb-2 font-semibold text-slate-800">
                      Ingeniería
                    </h4>
                    {atsResult.controls.engineering?.length ? (
                      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                        {atsResult.controls.engineering.map((item, idx) => (
                          <li key={`${item}-${idx}`}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-slate-500">Sin registros.</p>
                    )}
                  </div>

                  <div className="rounded-xl border border-slate-200 p-4">
                    <h4 className="mb-2 font-semibold text-slate-800">
                      Administrativos
                    </h4>
                    {atsResult.controls.administrative?.length ? (
                      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                        {atsResult.controls.administrative.map((item, idx) => (
                          <li key={`${item}-${idx}`}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-slate-500">Sin registros.</p>
                    )}
                  </div>

                  <div className="rounded-xl border border-slate-200 p-4">
                    <h4 className="mb-2 font-semibold text-slate-800">EPP</h4>
                    {atsResult.controls.ppe?.length ? (
                      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                        {atsResult.controls.ppe.map((item, idx) => (
                          <li key={`${item}-${idx}`}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-slate-500">Sin registros.</p>
                    )}
                  </div>
                </div>
              </div>
/*Bloque38
<div className="mb-6">
                <h3 className="mb-2 text-lg font-semibold">Pasos de la tarea</h3>
                <div className="overflow-hidden rounded-xl border border-slate-200">
                  <table className="min-w-full border-collapse text-sm">
                    <thead className="bg-slate-100 text-left text-slate-700">
                      <tr>
                        <th className="px-3 py-2">#</th>
                        <th className="px-3 py-2">Paso</th>
                        <th className="px-3 py-2">Peligros</th>
                        <th className="px-3 py-2">Controles</th>
                      </tr>
                    </thead>
                    <tbody>
                      {atsResult.steps?.length ? (
                        atsResult.steps.map((step, idx) => (
                          <tr key={`${step.step}-${idx}`} className="border-t border-slate-200 align-top">
                            <td className="px-3 py-2">{idx + 1}</td>
                            <td className="px-3 py-2">{step.step}</td>
                            <td className="px-3 py-2">
                              {step.hazards?.length ? step.hazards.join(", ") : "-"}
                            </td>
                            <td className="px-3 py-2">
                              {step.controls?.length ? step.controls.join(", ") : "-"}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={4} className="px-3 py-4 text-center text-slate-500">
                            No se registraron pasos.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
/*bloque39
<div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-lg font-semibold">
                    Procedimientos aplicados
                  </h3>
                  <div className="rounded-xl border border-slate-200 p-4">
                    {atsResult.procedure_influence?.applied?.length ? (
                      <ul className="space-y-2 text-sm text-slate-700">
                        {atsResult.procedure_influence.applied.map((p, idx) => (
                          <li
                            key={`${p.code}-${idx}`}
                            className="rounded-lg bg-slate-50 px-3 py-2"
                          >
                            <div className="font-medium">{p.title}</div>
                            <div className="text-xs text-slate-500">
                              Código: {p.code} · Origen: {p.origin}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-slate-500">
                        No hay procedimientos aplicados.
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 text-lg font-semibold">
                    Procedimientos no interpretables
                  </h3>
                  <div className="rounded-xl border border-slate-200 p-4">
                    {atsResult.procedure_influence?.not_parseable?.length ? (
                      <ul className="space-y-2 text-sm text-slate-700">
                        {atsResult.procedure_influence.not_parseable.map((p, idx) => (
                          <li
                            key={`${p.code}-${idx}`}
                            className="rounded-lg bg-slate-50 px-3 py-2"
                          >
                            <div className="font-medium">{p.title}</div>
                            <div className="text-xs text-slate-500">
                              Código: {p.code} · Origen: {p.origin}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-slate-500">
                        Todos los procedimientos cargados fueron procesados.
                      </p>
                    )}
                  </div>
                </div>
              </div>
/*Bloque40
<div className="mb-6">
                <h3 className="mb-2 text-lg font-semibold">
                  Controles derivados de procedimientos
                </h3>
                <div className="rounded-xl border border-slate-200 p-4">
                  {atsResult.procedure_influence?.derived_controls?.length ? (
                    <div className="overflow-hidden rounded-xl border border-slate-200">
                      <table className="min-w-full border-collapse text-sm">
                        <thead className="bg-slate-100 text-left text-slate-700">
                          <tr>
                            <th className="px-3 py-2">Nivel</th>
                            <th className="px-3 py-2">Control</th>
                            <th className="px-3 py-2">Fuente</th>
                          </tr>
                        </thead>
                        <tbody>
                          {atsResult.procedure_influence.derived_controls.map((item, idx) => (
                            <tr
                              key={`${item.control}-${idx}`}
                              className="border-t border-slate-200 align-top"
                            >
                              <td className="px-3 py-2 uppercase">{item.level}</td>
                              <td className="px-3 py-2">{item.control}</td>
                              <td className="px-3 py-2">
                                {item.source.title} ({item.source.code})
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">
                      No se derivaron controles adicionales desde los procedimientos.
                    </p>
                  )}
                </div>
              </div>
/*bloque41
<div className="mb-6">
                <h3 className="mb-2 text-lg font-semibold">
                  Resultado del checklist
                </h3>

                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="mb-4">
                    <span
                      className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${
                        atsResult.checklist_actions?.decision_hint === "STOP"
                          ? "border-red-300 bg-red-100 text-red-800"
                          : atsResult.checklist_actions?.decision_hint === "REVIEW_REQUIRED"
                          ? "border-yellow-300 bg-yellow-100 text-yellow-800"
                          : "border-green-300 bg-green-100 text-green-800"
                      }`}
                    >
                      {atsResult.checklist_actions?.decision_hint || "N/A"}
                    </span>
                  </div>

                  {atsResult.checklist_actions?.critical_fails?.length ? (
                    <div className="mb-4">
                      <h4 className="mb-1 text-sm font-semibold text-red-700">
                        Fallas críticas
                      </h4>
                      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                        {atsResult.checklist_actions.critical_fails.map((item, idx) => (
                          <li key={`${item}-${idx}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {atsResult.checklist_actions?.missing?.length ? (
                    <div className="mb-4">
                      <h4 className="mb-1 text-sm font-semibold text-yellow-700">
                        Elementos pendientes
                      </h4>
                      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                        {atsResult.checklist_actions.missing.map((item, idx) => (
                          <li key={`${item}-${idx}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
/*bloque42
{atsResult.checklist_actions?.actions?.length ? (
                    <div>
                      <h4 className="mb-2 text-sm font-semibold text-slate-700">
                        Acciones requeridas
                      </h4>
                      <ul className="space-y-2">
                        {atsResult.checklist_actions.actions.map((a, idx) => (
                          <li
                            key={`${a.action}-${idx}`}
                            className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-700"
                          >
                            <div className="mb-1 flex items-center justify-between gap-3">
                              <span className="font-medium">{a.action}</span>
                              <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold uppercase text-slate-600 border border-slate-200">
                                {a.priority}
                              </span>
                            </div>
                            <div className="text-xs text-slate-500">
                              Categoría: {a.category}
                            </div>
                            {a.evidence?.length ? (
                              <div className="mt-2 text-xs text-slate-500">
                                Evidencia: {a.evidence.join(" · ")}
                              </div>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </div>
/*bloque43
<div className="mb-6">
                <h3 className="mb-2 text-lg font-semibold">
                  Recomendaciones IA
                </h3>

                <div className="rounded-xl border border-slate-200 p-4">
                  {(atsResult.recommendations?.recommendations?.length ||
                    atsResult.recommendations?.notes?.length ||
                    atsResult.recommendations?.controls?.engineering?.length ||
                    atsResult.recommendations?.controls?.administrative?.length ||
                    atsResult.recommendations?.controls?.ppe?.length) ? (
                    <div className="space-y-4">
                      {atsResult.recommendations?.recommendations?.length ? (
                        <div>
                          <h4 className="mb-1 text-sm font-semibold text-slate-700">
                            Recomendaciones
                          </h4>
                          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                            {atsResult.recommendations.recommendations.map((item, idx) => (
                              <li key={`${item}-${idx}`}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {atsResult.recommendations?.notes?.length ? (
                        <div>
                          <h4 className="mb-1 text-sm font-semibold text-slate-700">
                            Notas
                          </h4>
                          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                            {atsResult.recommendations.notes.map((item, idx) => (
                              <li key={`${item}-${idx}`}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
/*Bloque44
<div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                        <div className="rounded-xl bg-slate-50 p-3">
                          <h4 className="mb-2 text-sm font-semibold text-slate-700">
                            Ingeniería
                          </h4>
                          {atsResult.recommendations?.controls?.engineering?.length ? (
                            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                              {atsResult.recommendations.controls.engineering.map((item, idx) => (
                                <li key={`${item}-${idx}`}>{item}</li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-sm text-slate-500">Sin recomendaciones.</p>
                          )}
                        </div>

                        <div className="rounded-xl bg-slate-50 p-3">
                          <h4 className="mb-2 text-sm font-semibold text-slate-700">
                            Administrativos
                          </h4>
                          {atsResult.recommendations?.controls?.administrative?.length ? (
                            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                              {atsResult.recommendations.controls.administrative.map((item, idx) => (
                                <li key={`${item}-${idx}`}>{item}</li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-sm text-slate-500">Sin recomendaciones.</p>
                          )}
                        </div>

                        <div className="rounded-xl bg-slate-50 p-3">
                          <h4 className="mb-2 text-sm font-semibold text-slate-700">EPP</h4>
                          {atsResult.recommendations?.controls?.ppe?.length ? (
                            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                              {atsResult.recommendations.controls.ppe.map((item, idx) => (
                                <li key={`${item}-${idx}`}>{item}</li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-sm text-slate-500">Sin recomendaciones.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">
                      No se recibieron recomendaciones adicionales de la IA.
                    </p>
                  )}
                </div>
              </div>
/*bloque45
<div className="mb-6">
                <h3 className="mb-2 text-lg font-semibold">
                  Referencias normativas usadas
                </h3>
                <div className="rounded-xl border border-slate-200 p-4">
                  {atsResult.normative_refs_used?.length ? (
                    <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                      {atsResult.normative_refs_used.map((item, idx) => (
                        <li key={`${item}-${idx}`}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-slate-500">
                      No se registraron referencias normativas.
                    </p>
                  )}
                </div>
              </div>

              {rawAiResponse ? (
                <div>
                  <h3 className="mb-2 text-lg font-semibold">Respuesta cruda de IA</h3>
                  <div className="overflow-auto rounded-xl border border-slate-200 bg-slate-950 p-4">
                    <pre className="whitespace-pre-wrap break-words text-xs text-slate-100">
{rawAiResponse}
                    </pre>
                  </div>
                </div>
              ) : null}
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}

