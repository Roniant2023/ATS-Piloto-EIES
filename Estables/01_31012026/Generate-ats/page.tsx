"use client";

import React, { useMemo, useRef, useState } from "react";
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

type ATSProcedureMini = { title: string; code: string; origin: string };

type ATSProcedureInfluence = {
  applied: ATSProcedureMini[];
  not_parseable: ATSProcedureMini[];
  derived_controls: Array<{
    level: "engineering" | "administrative" | "ppe";
    control: string;
    source: ATSProcedureMini;
  }>;
};

/* =========================
   ✅ NUEVO: Tipos checklist_actions
========================= */
type ATSChecklistDecisionHint = "STOP" | "REVIEW_REQUIRED" | "CONTINUE";

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
  steps: Array<{ step: string; hazards: string[]; controls: string[] }>;
  stop_work: ATSStopWork;
  procedure_refs_used: ATSProcedureMini[];
  procedure_influence: ATSProcedureInfluence;
  checklist_actions?: ATSChecklistActions; // ✅ NUEVO
};

/* =========================
   UTILS
========================= */
function clsx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function formatDateEsCOFromISO(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

function cleanString(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function cleanNumber(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sanitizeEnvironment(env: Environment): Environment {
  return {
    timeOfDay: cleanString(env.timeOfDay),
    weather: cleanString(env.weather),
    wind: cleanString(env.wind),
    lighting: cleanString(env.lighting),
    terrain: cleanString(env.terrain),
    visibility: cleanString(env.visibility),
    temperatureC: cleanNumber(env.temperatureC),
    humidityPct: cleanNumber(env.humidityPct),
  };
}

function isPdfOrDocx(file: File) {
  const name = file.name.toLowerCase();
  return name.endsWith(".pdf") || name.endsWith(".docx");
}

function fileKey(f: File) {
  return `${f.name}__${f.size}`;
}

function safeJsonParse<T = any>(
  text: string
): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

function badgeForDecision(decision?: string) {
  if (decision === "STOP") return { label: "STOP WORK", cls: "bg-red-600 text-white" };
  if (decision === "REVIEW_REQUIRED")
    return { label: "REVISIÓN REQUERIDA", cls: "bg-amber-500 text-black" };
  return { label: "CONTINUAR", cls: "bg-green-600 text-white" };
}

function sectionColorForDecision(decision?: string) {
  if (decision === "STOP") return "border-red-300 bg-red-50";
  if (decision === "REVIEW_REQUIRED") return "border-amber-300 bg-amber-50";
  return "border-green-300 bg-green-50";
}

function miniLabel(p: { title?: string; code?: string; origin?: string }) {
  const t = (p.title || "Procedimiento").trim();
  const c = (p.code || "").trim();
  const o = (p.origin || "").trim();
  return `${t}${c ? ` (${c})` : ""}${o ? ` — ${o}` : ""}`;
}

/** dedupe + trim + remove vacíos */
function uniqueNonEmpty(arr: any): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const src = Array.isArray(arr) ? arr : [];
  for (const x of src) {
    const s = String(x ?? "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function toggleInArray(list: string[], value: string) {
  const exists = list.includes(value);
  return exists ? list.filter((x) => x !== value) : [...list, value];
}

/* =========================
   ✅ NUEVO: Helpers checklist
========================= */
function badgeForChecklistHint(decision?: string) {
  if (decision === "STOP") return { label: "STOP WORK", cls: "bg-red-600 text-white" };
  if (decision === "REVIEW_REQUIRED")
    return { label: "REVISIÓN REQUERIDA", cls: "bg-amber-500 text-black" };
  return { label: "CONTINUAR", cls: "bg-green-600 text-white" };
}

function sortChecklistActions(list: ATSChecklistAction[]) {
  const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return [...(list || [])].sort((a, b) => (order[a.priority] ?? 99) - (order[b.priority] ?? 99));
}

function pillForPriority(p: ATSChecklistAction["priority"]) {
  if (p === "critical") return { label: "CRÍTICO", cls: "bg-red-600 text-white border-red-700" };
  if (p === "high") return { label: "ALTO", cls: "bg-orange-500 text-black border-orange-600" };
  if (p === "medium") return { label: "MEDIO", cls: "bg-amber-300 text-black border-amber-400" };
  return { label: "BAJO", cls: "bg-slate-200 text-black border-slate-300" };
}

function pillForCategory(c: ATSChecklistAction["category"]) {
  if (c === "engineering")
    return { label: "Ingeniería", cls: "bg-indigo-50 text-indigo-900 border-indigo-200" };
  if (c === "administrative")
    return { label: "Administrativo", cls: "bg-blue-50 text-blue-900 border-blue-200" };
  return { label: "EPP", cls: "bg-emerald-50 text-emerald-900 border-emerald-200" };
}

function pillForDecisionHint(h?: string) {
  if (h === "STOP") return { label: "STOP", cls: "bg-red-600 text-white" };
  if (h === "REVIEW_REQUIRED") return { label: "REVISAR", cls: "bg-amber-500 text-black" };
  return { label: "OK", cls: "bg-green-600 text-white" };
}

/* =========================
   ✅ COMPONENTE: Sección bonita Checklist Actions
========================= */
function ChecklistSection({ checklist }: { checklist: ATSChecklistActions }) {
  const hint = checklist?.decision_hint;
  const hintBadge = badgeForChecklistHint(hint);
  const hintPill = pillForDecisionHint(hint);

  const missing = uniqueNonEmpty(checklist?.missing);
  const criticalFails = uniqueNonEmpty(checklist?.critical_fails);

  const derivedEng = uniqueNonEmpty(checklist?.derived_controls?.engineering);
  const derivedAdm = uniqueNonEmpty(checklist?.derived_controls?.administrative);
  const derivedPpe = uniqueNonEmpty(checklist?.derived_controls?.ppe);

  const actionsSorted = sortChecklistActions(
    Array.isArray(checklist?.actions) ? checklist.actions : []
  );

  return (
    <section className="border rounded-xl p-4 md:p-5 bg-white shadow-sm space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-neutral-500">Checklist corporativo (Formato Estrella)</div>
          <div className="text-lg font-semibold">Acciones y verificación</div>
          <div className="text-sm text-neutral-700 mt-1">
            Estado:{" "}
            <span
              className={clsx(
                "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold",
                hintPill.cls
              )}
            >
              {hintPill.label}
            </span>
          </div>
        </div>

        <span className={clsx("px-3 py-1 rounded-full text-sm font-semibold", hintBadge.cls)}>
          {hintBadge.label}
        </span>
      </div>

      {(criticalFails.length > 0 || missing.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div
            className={clsx(
              "border rounded-lg p-3",
              criticalFails.length ? "border-red-200 bg-red-50" : "border-neutral-200 bg-neutral-50"
            )}
          >
            <div className="font-semibold text-sm flex items-center justify-between">
              <span>Fallos críticos</span>
              <span className="text-xs text-neutral-600">{criticalFails.length}</span>
            </div>
            {criticalFails.length === 0 ? (
              <div className="text-sm text-neutral-600 mt-2">—</div>
            ) : (
              <ul className="mt-2 list-disc pl-5 text-sm space-y-1">
                {criticalFails.map((x, i) => (
                  <li key={i} className="text-red-900">
                    {x}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div
            className={clsx(
              "border rounded-lg p-3",
              missing.length ? "border-amber-200 bg-amber-50" : "border-neutral-200 bg-neutral-50"
            )}
          >
            <div className="font-semibold text-sm flex items-center justify-between">
              <span>Faltantes</span>
              <span className="text-xs text-neutral-600">{missing.length}</span>
            </div>
            {missing.length === 0 ? (
              <div className="text-sm text-neutral-600 mt-2">—</div>
            ) : (
              <ul className="mt-2 list-disc pl-5 text-sm space-y-1">
                {missing.map((x, i) => (
                  <li key={i} className="text-amber-900">
                    {x}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="border rounded-lg p-3 bg-neutral-50">
        <div className="font-semibold text-sm">Controles derivados del checklist</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
          <div className="border rounded-lg p-3 bg-white">
            <div className="text-sm font-semibold">Ingeniería</div>
            {derivedEng.length ? (
              <ul className="mt-2 list-disc pl-5 text-sm space-y-1">
                {derivedEng.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            ) : (
              <div className="text-sm text-neutral-600 mt-2">—</div>
            )}
          </div>
          <div className="border rounded-lg p-3 bg-white">
            <div className="text-sm font-semibold">Administrativos</div>
            {derivedAdm.length ? (
              <ul className="mt-2 list-disc pl-5 text-sm space-y-1">
                {derivedAdm.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            ) : (
              <div className="text-sm text-neutral-600 mt-2">—</div>
            )}
          </div>
          <div className="border rounded-lg p-3 bg-white">
            <div className="text-sm font-semibold">EPP</div>
            {derivedPpe.length ? (
              <ul className="mt-2 list-disc pl-5 text-sm space-y-1">
                {derivedPpe.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            ) : (
              <div className="text-sm text-neutral-600 mt-2">—</div>
            )}
          </div>
        </div>
      </div>

      <div className="border rounded-lg p-3 bg-white">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-sm">Acciones recomendadas</div>
          <div className="text-xs text-neutral-600">{actionsSorted.length} acción(es)</div>
        </div>

        {actionsSorted.length === 0 ? (
          <div className="text-sm text-neutral-600 mt-2">No hay acciones adicionales.</div>
        ) : (
          <ul className="mt-3 space-y-2">
            {actionsSorted.map((a, i) => {
              const pr = pillForPriority(a.priority);
              const cat = pillForCategory(a.category);

              return (
                <li key={i} className="border rounded-lg p-3 bg-neutral-50">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span
                      className={clsx(
                        "text-[11px] font-semibold px-2 py-0.5 rounded-full border",
                        pr.cls
                      )}
                    >
                      {pr.label}
                    </span>
                    <span
                      className={clsx(
                        "text-[11px] font-semibold px-2 py-0.5 rounded-full border",
                        cat.cls
                      )}
                    >
                      {cat.label}
                    </span>
                  </div>

                  <div className="text-sm text-neutral-900">{a.action}</div>

                  {Array.isArray(a.evidence) && a.evidence.length > 0 && (
                    <div className="mt-2">
                      <div className="text-xs font-semibold text-neutral-600">Evidencia</div>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {uniqueNonEmpty(a.evidence).map((e, idx) => (
                          <span
                            key={idx}
                            className="text-[11px] px-2 py-0.5 rounded-full border bg-white text-neutral-800"
                          >
                            {e}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="text-xs text-neutral-500">
        Nota: estas acciones se derivan del Formato Estrella y reglas determinísticas; la IA solo “afina”
        redacción y verificabilidad.
      </div>
    </section>
  );
}

/* =========================
   CONSTANTES FORMATO ESTRELLA (CHECKLISTS)
========================= */
const PELIGROS_TIPOS = [
  "Físico",
  "Químico",
  "Biológico",
  "Mecánico",
  "Tecnológicos",
  "Trabajo en alturas",
  "Espacio Confinado",
  "Locativo",
  "Psicosocial",
  "Biomecánico",
  "Eléctrico",
  "Objetos con potencial de caída",
  "Otros",
] as const;

const PELIGROS_ENTORNO = [
  "Instalaciones Aledañas",
  "Operaciones Simultáneas",
  "Condiciones del terreno",
  "Clima",
  "Otros",
] as const;

const EMERGENCIAS = [
  "Incendio / Explosión",
  "Descontrol de Pozos",
  "Accidente vial",
  "Afectación ambiental",
  "Emergencia Médica",
  "Orden Público",
  "Desastre natural",
  "Gas Sulfhídrico",
] as const;

const EQUIPO_SEGURIDAD = [
  "Casco",
  "Guantes",
  "Mascara facial",
  "Extintores / Matafuegos",
  "Botas de seguridad",
  "Protección Respiratoria",
  "Antiparras/ oxicorte",
  "Lockout/Layout/ EMN",
  "Gafas de Seguridad",
  "Arnés de Seguridad",
  "Barreras",
  "Kit herramientas para alturas",
  "Protección Auditiva",
  "Medición de gases",
  "Señalización/Conos/Limitación de Área",
  "Otros",
] as const;

// Si ya tienes los 10 “Acuerdos de vida” exactos (texto oficial), cámbialos aquí:
const ACUERDOS_DE_VIDA = [
  "1_Detención de tareas",
  "2_Aislamiento de energía, bloqueo y etiquetado",
  "3_Espacios confinados",
  "4_Conducción segura",
  "5_Trabajos en caliente",
  "6_Línea de peligro",
  "7_Izaje",
  "8_Permiso de trabajo",
  "9_Trabajo en altura",
  "10_Salud pública",
] as const;

/* =========================
   COMPONENT
========================= */
export default function Page() {
  // Cabecera (tu ATS inteligente)
  const [jobTitle, setJobTitle] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [dateISO, setDateISO] = useState("");
  const [shift, setShift] = useState("");

  // Actividades
  const [lifting, setLifting] = useState(false);
  const [hotWork, setHotWork] = useState(false);
  const [workAtHeight, setWorkAtHeight] = useState(false);

  // Entorno editable
  const [environment, setEnvironment] = useState<Environment>({
    timeOfDay: null,
    weather: null,
    temperatureC: null,
    humidityPct: null,
    wind: null,
    lighting: null,
    terrain: null,
    visibility: null,
  });

  // Procedimientos
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [procedureRefs, setProcedureRefs] = useState<ProcedureRef[]>([]);
  const [procedureResults, setProcedureResults] = useState<ProcedureResult[]>([]);
  const [uploading, setUploading] = useState(false);

  // ATS
  const [generatingATS, setGeneratingATS] = useState(false);
  const [atsResult, setAtsResult] = useState<ATS | any>(null);

  // UI feedback
  const [uiError, setUiError] = useState<string | null>(null);
  const [uiInfo, setUiInfo] = useState<string | null>(null);

  // File picker
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /** Accordion pasos */
  const [openSteps, setOpenSteps] = useState<Record<number, boolean>>({});
  function toggleStep(i: number) {
    setOpenSteps((prev) => ({ ...prev, [i]: !prev[i] }));
  }

  /* =========================
     ✅ BLOQUES “ATS ESTRELLA” (datos del formato)
  ========================= */
  const [atsNumber, setAtsNumber] = useState("");
  const [permitNumber, setPermitNumber] = useState("");
  const [elaborationDateISO, setElaborationDateISO] = useState("");
  const [executionDateISO, setExecutionDateISO] = useState("");
  const [formatVersion, setFormatVersion] = useState("");
  const [procedureCodeRelated, setProcedureCodeRelated] = useState("");
  const [workFront, setWorkFront] = useState("");

  const [incidentsReference, setIncidentsReference] = useState<"Si" | "No" | "">("");
  const [otherCompanies, setOtherCompanies] = useState<"Si" | "No" | "">("");

  const [dangerTypes, setDangerTypes] = useState<string[]>([]);
  const [dangerTypesOther, setDangerTypesOther] = useState("");

  const [environmentDangers, setEnvironmentDangers] = useState<string[]>([]);
  const [environmentDangersOther, setEnvironmentDangersOther] = useState("");

  const [emergencies, setEmergencies] = useState<string[]>([]);

  const [safetyEquipment, setSafetyEquipment] = useState<string[]>([]);
  const [safetyEquipmentOther, setSafetyEquipmentOther] = useState("");

  const [lifeSavingRules, setLifeSavingRules] = useState<string[]>([]);

  // Autorizaciones
  const [executants, setExecutants] = useState<Array<{ name: string; signature: string }>>([
    { name: "", signature: "" },
    { name: "", signature: "" },
    { name: "", signature: "" },
  ]);

  const [supervisorName, setSupervisorName] = useState("");
  const [supervisorRole, setSupervisorRole] = useState("");
  const [supervisorSignature, setSupervisorSignature] = useState("");

  const [checkStagesClarity, setCheckStagesClarity] = useState<"SI" | "NO" | "N.A." | "">("");
  const [checkHazardsControlled, setCheckHazardsControlled] = useState<"SI" | "NO" | "N.A." | "">("");
  const [checkIsolationConfirmed, setCheckIsolationConfirmed] = useState<"SI" | "NO" | "N.A." | "">("");
  const [checkCommsAgreed, setCheckCommsAgreed] = useState<"SI" | "NO" | "N.A." | "">("");
  const [checkToolsOk, setCheckToolsOk] = useState<"SI" | "NO" | "N.A." | "">("");

  const [approverName, setApproverName] = useState("");
  const [approverSignature, setApproverSignature] = useState("");

  /* =========================
     ✅ PASO 4: PDF/PRINT (react-to-print v3)
  ========================= */
  const printRef = useRef<HTMLDivElement>(null);

  const fileTitle = useMemo(() => {
    const t = String(atsResult?.meta?.title || jobTitle || "Trabajo")
      .trim()
      .replace(/\s+/g, "_");
    const d =
      String(atsResult?.meta?.date || formatDateEsCOFromISO(executionDateISO) || "")
        .trim()
        .replace(/\//g, "-") || "";
    return `ATS_${t}${d ? `_${d}` : ""}`;
  }, [atsResult, jobTitle, executionDateISO]);

  const handlePrintToPdf = useReactToPrint({
    contentRef: printRef, // ✅ v3 usa contentRef
    documentTitle: fileTitle,
    removeAfterPrint: true,
    pageStyle: `
      @page { size: A4; margin: 10mm; }
      @media print {
        html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .no-print { display: none !important; }
        .print-only { display: block !important; }
      }
    `,
    onPrintError: (_location, error) => {
      setUiError(`Error al imprimir: ${String((error as any)?.message || error)}`);
    },
  });

  async function handleCopyATS() {
    try {
      if (!atsResult) return;
      await navigator.clipboard.writeText(JSON.stringify(atsResult, null, 2));
      setUiInfo("✅ ATS copiado al portapapeles.");
      setUiError(null);
    } catch (e: any) {
      setUiError(`No se pudo copiar: ${String(e?.message || e)}`);
    }
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function addFiles(files: File[]) {
    const allowed = files.filter(isPdfOrDocx);
    if (allowed.length === 0) {
      setUiError("Solo se aceptan archivos PDF o DOCX.");
      return;
    }

    setSelectedFiles((prev) => {
      const existing = new Set(prev.map(fileKey));
      const merged = [...prev];
      for (const f of allowed) {
        if (!existing.has(fileKey(f))) merged.push(f);
      }
      return merged;
    });

    setUiError(null);
    setUiInfo(`${allowed.length} archivo(s) agregado(s).`);
  }

  function removeFile(idx: number) {
    setSelectedFiles((prev) => {
      const next = [...prev];
      next.splice(idx, 1);
      return next;
    });
  }

  function clearAllFiles() {
    setSelectedFiles([]);
    setProcedureRefs([]);
    setProcedureResults([]);
    setAtsResult(null);
    setOpenSteps({});
    setUiInfo("Archivos limpiados.");
    setUiError(null);
  }

  async function uploadSingleProcedure(file: File): Promise<ProcedureResult> {
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/procedure-brief", {
        method: "POST",
        body: formData,
      });

      const text = await res.text();
      if (!res.ok) {
        return {
          ok: false,
          fileName: file.name,
          error: "Error en /api/procedure-brief",
          details: `HTTP ${res.status}: ${text}`,
        };
      }

      const parsed = safeJsonParse<any>(text);
      if (!parsed.ok) {
        return {
          ok: false,
          fileName: file.name,
          error: "Respuesta no es JSON",
          details: parsed.error,
        };
      }

      const proc = parsed.value?.procedure_ref;
      if (!proc || typeof proc !== "object") {
        return {
          ok: false,
          fileName: file.name,
          error: "Respuesta inválida",
          details: "No llegó procedure_ref",
        };
      }

      return { ok: true, fileName: file.name, procedure: proc };
    } catch (err: any) {
      return {
        ok: false,
        fileName: file.name,
        error: "Excepción subiendo procedimiento",
        details: String(err?.message || err),
      };
    }
  }

  async function handleUploadProcedures() {
    setUiError(null);
    setUiInfo(null);

    if (!selectedFiles.length) {
      setUiError("Selecciona al menos 1 archivo PDF o DOCX.");
      return;
    }

    setUploading(true);
    setProcedureResults([]);
    setProcedureRefs([]);
    setAtsResult(null);
    setOpenSteps({});

    try {
      const results: ProcedureResult[] = [];
      const procs: ProcedureRef[] = [];

      for (const file of selectedFiles) {
        const r = await uploadSingleProcedure(file);
        results.push(r);
        if (r.ok && r.procedure) procs.push(r.procedure);

        setProcedureResults([...results]);
        setProcedureRefs([...procs]);
      }

      const okCount = procs.length;
      const failCount = results.filter((r) => !r.ok).length;

      if (okCount === 0) {
        setUiError("Se procesaron archivos, pero no se extrajo ningún procedimiento válido.");
      } else {
        setUiInfo(`Procedimientos listos: ${okCount}. Fallidos: ${failCount}.`);
      }
    } finally {
      setUploading(false);
    }
  }

  /** Validación (incluye tus campos clave + generación) */
  const missingReasons = useMemo(() => {
    const reasons: string[] = [];

    if (!jobTitle.trim()) reasons.push("Falta Actividad/Trabajo.");
    if (!company.trim()) reasons.push("Falta Empresa.");
    if (!location.trim()) reasons.push("Falta Ubicación.");
    if (!dateISO) reasons.push("Falta Fecha (meta).");
    if (!shift.trim()) reasons.push("Falta Turno/Jornada.");

    if (!lifting && !hotWork && !workAtHeight) {
      reasons.push("Selecciona al menos una condición (Izaje / Caliente / Alturas).");
    }

    if (selectedFiles.length === 0) reasons.push("No has seleccionado archivos.");
    if (procedureRefs.length === 0) reasons.push("No has procesado procedimientos (o quedaron en 0).");

    // Campos del formato (mínimos sugeridos)
    if (!executionDateISO) reasons.push("Falta Fecha de ejecución (Formato Estrella).");
    if (!elaborationDateISO) reasons.push("Falta Fecha de elaboración (Formato Estrella).");

    if (uploading) reasons.push("Espera: procedimientos en procesamiento.");
    if (generatingATS) reasons.push("Espera: ATS generándose.");

    return reasons;
  }, [
    jobTitle,
    company,
    location,
    dateISO,
    shift,
    lifting,
    hotWork,
    workAtHeight,
    selectedFiles.length,
    procedureRefs.length,
    uploading,
    generatingATS,
    executionDateISO,
    elaborationDateISO,
  ]);

  const canGenerateATS = useMemo(() => missingReasons.length === 0, [missingReasons]);

  async function handleGenerateATS() {
    setUiError(null);
    setUiInfo(null);

    if (!canGenerateATS) {
      setUiError("No se puede generar ATS aún. Revisa los faltantes.");
      return;
    }

    setGeneratingATS(true);
    setAtsResult(null);
    setOpenSteps({});

    try {
      const envSanitized = sanitizeEnvironment(environment);

      const payload = {
        jobTitle: jobTitle.trim(),
        company: company.trim(),
        location: location.trim(),
        date: formatDateEsCOFromISO(dateISO),
        shift: shift.trim(),
        lifting,
        hotWork,
        workAtHeight,
        environment: envSanitized,
        procedure_refs: procedureRefs,
        estrella_format: {
          atsNumber: atsNumber.trim(),
          permitNumber: permitNumber.trim(),
          elaborationDate: formatDateEsCOFromISO(elaborationDateISO),
          executionDate: formatDateEsCOFromISO(executionDateISO),
          version: formatVersion.trim(),
          procedureCodeRelated: procedureCodeRelated.trim(),
          workFront: workFront.trim(),
          incidentsReference,
          otherCompanies,
          dangerTypes,
          dangerTypesOther: dangerTypesOther.trim(),
          environmentDangers,
          environmentDangersOther: environmentDangersOther.trim(),
          emergencies,
          safetyEquipment,
          safetyEquipmentOther: safetyEquipmentOther.trim(),
          lifeSavingRules,
          authorizations: {
            executants,
            supervisor: {
              name: supervisorName.trim(),
              role: supervisorRole.trim(),
              signature: supervisorSignature.trim(),
              checks: {
                stagesClarity: checkStagesClarity,
                hazardsControlled: checkHazardsControlled,
                isolationConfirmed: checkIsolationConfirmed,
                commsAgreed: checkCommsAgreed,
                toolsOk: checkToolsOk,
              },
            },
            approver: {
              name: approverName.trim(),
              signature: approverSignature.trim(),
            },
          },
        },
      };

      const res = await fetch("/api/generate-ats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const text = await res.text();

      if (!res.ok) {
        setUiError(`Error generando ATS (HTTP ${res.status}): ${text}`);
        return;
      }

      const parsed = safeJsonParse<any>(text);
      if (!parsed.ok) {
        setUiError(`Respuesta no JSON: ${parsed.error}`);
        return;
      }

      const ats = parsed.value?.ats ?? parsed.value;
      setAtsResult(ats);
      setUiInfo("✅ ATS generado correctamente.");
    } catch (err: any) {
      setUiError(`Excepción generando ATS: ${String(err?.message || err)}`);
    } finally {
      setGeneratingATS(false);
    }
  }

  /* =========================
     STOP WORK + PROCEDIMIENTOS
  ========================= */
  const decision: string | undefined = atsResult?.stop_work?.decision;
  const decisionBadge = badgeForDecision(decision);
  const decisionSectionCls = sectionColorForDecision(decision);

  const appliedProcedures: ATSProcedureMini[] =
    atsResult?.procedure_influence?.applied ?? atsResult?.procedure_refs_used ?? [];

  const notParseableProcedures: ATSProcedureMini[] = atsResult?.procedure_influence?.not_parseable ?? [];

  /* Normalizaciones display */
  const hazardsList = uniqueNonEmpty(atsResult?.hazards);
  const ctrlEng = uniqueNonEmpty(atsResult?.controls?.engineering);
  const ctrlAdm = uniqueNonEmpty(atsResult?.controls?.administrative);
  const ctrlPpe = uniqueNonEmpty(atsResult?.controls?.ppe);
  const stepsList: ATS["steps"] = Array.isArray(atsResult?.steps) ? atsResult.steps : [];

  const execDatePrint = formatDateEsCOFromISO(executionDateISO);
  const elabDatePrint = formatDateEsCOFromISO(elaborationDateISO);

  // ✅ Checklist del backend
  const checklist: ATSChecklistActions | null = (atsResult?.checklist_actions as ATSChecklistActions) ?? null;

  // ✅ Helpers para cajitas en PDF
  const box = (checked: boolean) => (checked ? "X" : " ");
  const boxByVal = (val: string, target: "SI" | "NO" | "N.A.") => box(val === target);

  // ✅ Resumen “preturno” (simple y directo)
  const topHazards = hazardsList.slice(0, 8);
  const topControls = uniqueNonEmpty([...ctrlEng, ...ctrlAdm, ...ctrlPpe]).slice(0, 10);
  const topSteps = stepsList.slice(0, 6);

  // ✅ Lista de verificación de supervisión propuesta (con cajitas)
  const supervisionChecklistRows = [
    "ATS socializado con todo el equipo (charla preturno realizada).",
    "Roles y responsabilidades definidos (líder, señalero, vigía, etc.).",
    "Área demarcada y control de accesos implementado.",
    "Permisos requeridos verificados y vigentes (si aplica).",
    "Aislamiento de energías (LOTO/EMN) verificado si aplica.",
    "EPP correcto disponible y en buen estado.",
    "Herramientas/equipos inspeccionados y aptos para uso.",
    "Plan de emergencias y comunicación verificados (rutas, puntos, radios/teléfono).",
  ];

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-semibold no-print">ATS Inteligente</h1>

      {/* ✅ ACCIONES (solo copiar arriba) */}
      <div className="no-print flex flex-wrap items-center gap-2">
        <button
          onClick={handleCopyATS}
          disabled={!atsResult}
          className="px-4 py-2 border rounded disabled:opacity-50"
        >
          Copiar ATS (JSON)
        </button>
      </div>

      {/* UI mensajes */}
      {(uiError || uiInfo) && (
        <div
          className={[
            "border rounded p-3 text-sm",
            uiError
              ? "bg-red-50 border-red-200 text-red-800"
              : "bg-green-50 border-green-200 text-green-800",
          ].join(" ")}
        >
          {uiError ?? uiInfo}
        </div>
      )}

      {/* =========================
         FORMATO ESTRELLA - DATOS GENERALES (PANTALLA)
      ========================= */}
      <section className="no-print border rounded p-4 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-xs text-neutral-600">Gestión de HSSEQ</div>
            <div className="text-lg font-semibold">Análisis de Trabajo Seguro</div>
            <div className="text-xs text-neutral-600">
              Formato: <b>02-01-102-F001</b> · Revisión: <b>07</b> · Emisión: <b>04/09/2024</b>
            </div>
          </div>
          <div className="text-xs text-neutral-600">
            Página: <b>1 de 1</b>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            placeholder="N° ATS"
            value={atsNumber}
            onChange={(e) => setAtsNumber(e.target.value)}
            className="border p-2 rounded"
          />
          <input
            placeholder="N° Permiso de trabajo"
            value={permitNumber}
            onChange={(e) => setPermitNumber(e.target.value)}
            className="border p-2 rounded"
          />
          <input
            placeholder="Versión"
            value={formatVersion}
            onChange={(e) => setFormatVersion(e.target.value)}
            className="border p-2 rounded"
          />
          <div className="grid grid-cols-1 gap-2">
            <label className="text-xs text-neutral-600">Fecha de elaboración</label>
            <input
              type="date"
              value={elaborationDateISO}
              onChange={(e) => setElaborationDateISO(e.target.value)}
              className="border p-2 rounded"
            />
          </div>
          <div className="grid grid-cols-1 gap-2">
            <label className="text-xs text-neutral-600">Fecha de ejecución</label>
            <input
              type="date"
              value={executionDateISO}
              onChange={(e) => setExecutionDateISO(e.target.value)}
              className="border p-2 rounded"
            />
          </div>
          <input
            placeholder="Frente de trabajo"
            value={workFront}
            onChange={(e) => setWorkFront(e.target.value)}
            className="border p-2 rounded"
          />
          <input
            placeholder="Código del procedimiento relacionado"
            value={procedureCodeRelated}
            onChange={(e) => setProcedureCodeRelated(e.target.value)}
            className="border p-2 rounded md:col-span-2"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div className="border rounded p-3">
            <div className="font-medium">Incidentes en trabajos similares</div>
            <div className="mt-2 flex gap-4">
              {(["Si", "No"] as const).map((v) => (
                <label key={v} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="incidentsReference"
                    checked={incidentsReference === v}
                    onChange={() => setIncidentsReference(v)}
                  />
                  {v}
                </label>
              ))}
            </div>
          </div>

          <div className="border rounded p-3">
            <div className="font-medium">Involucra personal de otras compañías</div>
            <div className="mt-2 flex gap-4">
              {(["Si", "No"] as const).map((v) => (
                <label key={v} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="otherCompanies"
                    checked={otherCompanies === v}
                    onChange={() => setOtherCompanies(v)}
                  />
                  {v}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Checklists */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="border rounded p-3">
            <div className="font-medium">Tipos de peligros</div>
            <div className="mt-2 space-y-1 text-sm">
              {PELIGROS_TIPOS.map((p) => (
                <label key={p} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={dangerTypes.includes(p)}
                    onChange={() => setDangerTypes((prev) => toggleInArray(prev, p))}
                  />
                  {p}
                </label>
              ))}
              {dangerTypes.includes("Otros") && (
                <input
                  placeholder="Otros (Tipos de peligros)"
                  value={dangerTypesOther}
                  onChange={(e) => setDangerTypesOther(e.target.value)}
                  className="border p-2 rounded w-full mt-2"
                />
              )}
            </div>
          </div>

          <div className="border rounded p-3">
            <div className="font-medium">Peligros del entorno (Periféricos)</div>
            <div className="mt-2 space-y-1 text-sm">
              {PELIGROS_ENTORNO.map((p) => (
                <label key={p} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={environmentDangers.includes(p)}
                    onChange={() => setEnvironmentDangers((prev) => toggleInArray(prev, p))}
                  />
                  {p}
                </label>
              ))}
              {environmentDangers.includes("Otros") && (
                <input
                  placeholder="Otros (Entorno)"
                  value={environmentDangersOther}
                  onChange={(e) => setEnvironmentDangersOther(e.target.value)}
                  className="border p-2 rounded w-full mt-2"
                />
              )}
            </div>
          </div>

          <div className="border rounded p-3">
            <div className="font-medium">Situaciones de emergencia potenciales</div>
            <div className="mt-2 space-y-1 text-sm">
              {EMERGENCIAS.map((p) => (
                <label key={p} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={emergencies.includes(p)}
                    onChange={() => setEmergencies((prev) => toggleInArray(prev, p))}
                  />
                  {p}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="border rounded p-3">
          <div className="font-medium">Equipamiento de seguridad</div>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
            {EQUIPO_SEGURIDAD.map((p) => (
              <label key={p} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={safetyEquipment.includes(p)}
                  onChange={() => setSafetyEquipment((prev) => toggleInArray(prev, p))}
                />
                {p}
              </label>
            ))}
          </div>
          {safetyEquipment.includes("Otros") && (
            <input
              placeholder="Otros (Equipamiento)"
              value={safetyEquipmentOther}
              onChange={(e) => setSafetyEquipmentOther(e.target.value)}
              className="border p-2 rounded w-full mt-3"
            />
          )}
        </div>

        <div className="border rounded p-3">
          <div className="font-medium">Marcar Acuerdos de Vida aplicables</div>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
            {ACUERDOS_DE_VIDA.map((p) => (
              <label key={p} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={lifeSavingRules.includes(p)}
                  onChange={() => setLifeSavingRules((prev) => toggleInArray(prev, p))}
                />
                {p}
              </label>
            ))}
          </div>
          <div className="mt-3 text-xs font-semibold text-red-700">
            Deténgase y busque ayuda si alguno de los controles/acciones anteriores no se ha implementado
          </div>
        </div>
      </section>

      {/* =========================
         UI NORMAL (TU FLUJO ORIGINAL)
      ========================= */}
      <section className="no-print grid grid-cols-1 md:grid-cols-3 gap-4">
        <input
          placeholder="Actividad / Trabajo"
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
          className="border p-2 rounded"
        />
        <input
          placeholder="Empresa"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          className="border p-2 rounded"
        />
        <input
          placeholder="Ubicación"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="border p-2 rounded"
        />
        <input
          type="date"
          value={dateISO}
          onChange={(e) => setDateISO(e.target.value)}
          className="border p-2 rounded"
        />
        <input
          placeholder="Turno / Jornada"
          value={shift}
          onChange={(e) => setShift(e.target.value)}
          className="border p-2 rounded md:col-span-2"
        />
      </section>

      <section className="no-print flex flex-wrap gap-6">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={lifting} onChange={(e) => setLifting(e.target.checked)} /> Izaje
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={hotWork} onChange={(e) => setHotWork(e.target.checked)} /> Trabajo en caliente
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={workAtHeight} onChange={(e) => setWorkAtHeight(e.target.checked)} /> Trabajo
          en alturas
        </label>
      </section>

      {/* ENTORNO */}
      <section className="no-print border rounded p-4 space-y-3">
        <h2 className="font-semibold">Condiciones del entorno</h2>

        <select
          value={environment.timeOfDay ?? ""}
          onChange={(e) => setEnvironment((v) => ({ ...v, timeOfDay: e.target.value || null }))}
          className="border p-2 rounded w-full"
        >
          <option value="">Hora del día</option>
          <option value="Día">Día</option>
          <option value="Noche">Noche</option>
        </select>

        <select
          value={environment.weather ?? ""}
          onChange={(e) => setEnvironment((v) => ({ ...v, weather: e.target.value || null }))}
          className="border p-2 rounded w-full"
        >
          <option value="">Clima</option>
          <option value="Despejado">Despejado</option>
          <option value="Lluvia">Lluvia</option>
          <option value="Tormenta eléctrica">Tormenta eléctrica</option>
          <option value="Neblina">Neblina</option>
        </select>

        <select
          value={environment.wind ?? ""}
          onChange={(e) => setEnvironment((v) => ({ ...v, wind: e.target.value || null }))}
          className="border p-2 rounded w-full"
        >
          <option value="">Viento</option>
          <option value="Calmo">Calmo</option>
          <option value="Moderado">Moderado</option>
          <option value="Fuerte">Fuerte</option>
        </select>

        <select
          value={environment.visibility ?? ""}
          onChange={(e) => setEnvironment((v) => ({ ...v, visibility: e.target.value || null }))}
          className="border p-2 rounded w-full"
        >
          <option value="">Visibilidad</option>
          <option value="Alta">Alta</option>
          <option value="Media">Media</option>
          <option value="Baja">Baja</option>
        </select>

        <select
          value={environment.terrain ?? ""}
          onChange={(e) => setEnvironment((v) => ({ ...v, terrain: e.target.value || null }))}
          className="border p-2 rounded w-full"
        >
          <option value="">Terreno</option>
          <option value="Seco">Seco</option>
          <option value="Húmedo/Resbaloso">Húmedo/Resbaloso</option>
          <option value="Barro">Barro</option>
        </select>

        <input
          type="number"
          placeholder="Temperatura °C"
          value={environment.temperatureC ?? ""}
          onChange={(e) =>
            setEnvironment((v) => ({
              ...v,
              temperatureC: e.target.value === "" ? null : Number(e.target.value),
            }))
          }
          className="border p-2 rounded w-full"
        />

        <input
          type="number"
          placeholder="Humedad %"
          value={environment.humidityPct ?? ""}
          onChange={(e) =>
            setEnvironment((v) => ({
              ...v,
              humidityPct: e.target.value === "" ? null : Number(e.target.value),
            }))
          }
          className="border p-2 rounded w-full"
        />
      </section>

      {/* PROCEDIMIENTOS */}
      <section className="no-print border rounded p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={openFilePicker} className="bg-black text-white px-4 py-2 rounded">
            Seleccionar archivos
          </button>

          <button
            onClick={handleUploadProcedures}
            disabled={uploading || selectedFiles.length === 0}
            className="px-4 py-2 border rounded disabled:opacity-50"
          >
            {uploading ? "Procesando..." : "Procesar procedimientos"}
          </button>

          <button onClick={clearAllFiles} className="px-4 py-2 border rounded">
            Limpiar
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            addFiles(files);
            e.currentTarget.value = "";
          }}
        />

        <div className="text-sm">
          {selectedFiles.length > 0 ? (
            <div className="text-green-700">✅ {selectedFiles.length} archivo(s) seleccionado(s)</div>
          ) : (
            <div className="text-neutral-600">No hay archivos seleccionados.</div>
          )}
        </div>

        {selectedFiles.length > 0 && (
          <ul className="divide-y border rounded">
            {selectedFiles.map((f, idx) => (
              <li key={`${f.name}-${f.size}-${idx}`} className="flex items-center justify-between p-2 text-sm">
                <span>
                  {f.name} <span className="text-neutral-500">({Math.round(f.size / 1024)} KB)</span>
                </span>
                <button className="text-red-700 underline" onClick={() => removeFile(idx)}>
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="text-sm">
          Procedimientos procesados: <b>{procedureRefs.length}</b>
        </div>

        {procedureResults.length > 0 && (
          <div className="mt-2">
            <div className="text-sm font-medium mb-1">Detalle por archivo</div>
            <ul className="divide-y border rounded">
              {procedureResults.map((r, i) => (
                <li key={i} className="p-2 text-sm">
                  <div>
                    <b>{r.fileName}</b>{" "}
                    {r.ok ? <span className="text-green-700">✅ OK</span> : <span className="text-red-700">❌ Error</span>}
                  </div>
                  {!r.ok && (
                    <div className="text-red-800 mt-1">
                      {r.error || "Error"} {r.details ? `— ${r.details}` : ""}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* VALIDACIÓN antes de generar */}
      {missingReasons.length > 0 && (
        <section className="no-print border rounded p-4 bg-yellow-50">
          <div className="font-semibold mb-2">Faltantes antes de generar ATS:</div>
          <ul className="list-disc pl-5 text-sm">
            {missingReasons.map((m, idx) => (
              <li key={idx}>{m}</li>
            ))}
          </ul>
        </section>
      )}

      {/* GENERAR */}
      <section className="no-print border rounded p-4 flex items-center gap-3">
        <button
          onClick={handleGenerateATS}
          disabled={!canGenerateATS}
          className="bg-green-700 text-white px-5 py-2 rounded disabled:opacity-50"
        >
          {generatingATS ? "Generando..." : "Generar ATS"}
        </button>
        <span className="text-sm text-neutral-600">
          {canGenerateATS ? "Listo para generar." : "Completa los faltantes."}
        </span>
      </section>

      {/* STOP WORK + PROCEDIMIENTOS (pantalla) */}
      {atsResult?.stop_work && (
        <section className={`border rounded p-4 space-y-4 ${decisionSectionCls}`}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm text-neutral-700">Decisión Stop Work</div>
              <div className="text-xl font-semibold">{atsResult.stop_work.decision}</div>
            </div>
            <span className={`px-3 py-1 rounded-full text-sm font-semibold ${decisionBadge.cls}`}>
              {decisionBadge.label}
            </span>
          </div>

          <div className="text-sm">
            <div className="font-medium">Razonamiento</div>
            <div className="mt-1 text-neutral-800">{atsResult.stop_work.rationale || "—"}</div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border rounded bg-white p-3">
              <div className="font-medium">Procedimientos aplicados</div>
              {appliedProcedures.length === 0 ? (
                <div className="text-sm text-neutral-600 mt-2">No se registraron procedimientos aplicados.</div>
              ) : (
                <ul className="mt-2 list-disc pl-5 text-sm">
                  {appliedProcedures.map((p, i) => (
                    <li key={i}>{miniLabel(p)}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="border rounded bg-white p-3">
              <div className="font-medium">Procedimientos no parseables</div>
              {notParseableProcedures.length === 0 ? (
                <div className="text-sm text-neutral-600 mt-2">Ninguno.</div>
              ) : (
                <>
                  <div className="text-sm text-neutral-700 mt-2">
                    Se dejan en constancia para revisión manual. <b>No bloquean</b> la generación del ATS.
                  </div>
                  <ul className="mt-2 list-disc pl-5 text-sm">
                    {notParseableProcedures.map((p, i) => (
                      <li key={i}>{miniLabel(p)}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ✅ NUEVO: CHECKLIST ACTIONS BONITO */}
      {checklist && <ChecklistSection checklist={checklist} />}

      {/* ✅ RESUMEN ATS + PASOS (pantalla) */}
      {atsResult && (
        <section className="border rounded p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm text-neutral-600">Resumen ATS</div>
              <div className="text-lg font-semibold">{atsResult?.meta?.title || "ATS"}</div>
              <div className="text-sm text-neutral-700">
                {atsResult?.meta?.company ? `${atsResult.meta.company} — ` : ""}
                {atsResult?.meta?.location || ""}
                {atsResult?.meta?.date ? ` — ${atsResult.meta.date}` : ""}
                {atsResult?.meta?.shift ? ` — ${atsResult.meta.shift}` : ""}
              </div>
            </div>

            <div className="text-sm text-neutral-700">
              <span className="mr-3">
                Peligros: <b>{hazardsList.length}</b>
              </span>
              <span className="mr-3">
                Controles: <b>{ctrlEng.length + ctrlAdm.length + ctrlPpe.length}</b>
              </span>
              <span>
                Pasos: <b>{stepsList.length}</b>
              </span>
            </div>
          </div>

          <div className="border rounded p-3 bg-white">
            <div className="font-medium">Peligros identificados</div>
            {hazardsList.length === 0 ? (
              <div className="text-sm text-neutral-600 mt-2">—</div>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {hazardsList.map((h, i) => (
                  <span key={i} className="text-xs border rounded-full px-3 py-1 bg-gray-50">
                    {h}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="border rounded p-3 bg-white">
            <div className="font-medium">Pasos del trabajo</div>

            {stepsList.length === 0 ? (
              <div className="text-sm text-neutral-600 mt-2">No se generaron pasos.</div>
            ) : (
              <ul className="mt-3 space-y-3">
                {stepsList.map((s, i) => {
                  const stepTitle = (s?.step || "").trim() || `Paso ${i + 1}`;
                  const hz = uniqueNonEmpty(s?.hazards);
                  const ct = uniqueNonEmpty(s?.controls);
                  const isOpen = !!openSteps[i];

                  return (
                    <li key={i} className="border rounded">
                      <button
                        type="button"
                        onClick={() => toggleStep(i)}
                        className="w-full text-left p-3 flex items-start justify-between gap-3"
                      >
                        <div>
                          <div className="font-semibold">{`${i + 1}. ${stepTitle}`}</div>
                          <div className="text-xs text-neutral-600 mt-1">
                            Peligros: <b>{hz.length}</b> · Controles: <b>{ct.length}</b>
                          </div>
                        </div>
                        <span className="text-sm text-neutral-700">{isOpen ? "▲" : "▼"}</span>
                      </button>

                      {isOpen && (
                        <div className="p-3 pt-0 grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="border rounded p-3 bg-gray-50">
                            <div className="font-medium text-sm">Peligros</div>
                            {hz.length === 0 ? (
                              <div className="text-sm text-neutral-600 mt-2">—</div>
                            ) : (
                              <ul className="mt-2 list-disc pl-5 text-sm space-y-1">
                                {hz.map((x, idx) => (
                                  <li key={idx}>{x}</li>
                                ))}
                              </ul>
                            )}
                          </div>

                          <div className="border rounded p-3 bg-gray-50">
                            <div className="font-medium text-sm">Controles</div>
                            {ct.length === 0 ? (
                              <div className="text-sm text-neutral-600 mt-2">—</div>
                            ) : (
                              <ul className="mt-2 list-disc pl-5 text-sm space-y-1">
                                {ct.map((x, idx) => (
                                  <li key={idx}>{x}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      )}

      {/* =========================
          ✅ VISTA IMPRIMIBLE (PDF) — FORMATO ESTRELLA
         ========================= */}
      <div ref={printRef} className="hidden print:block space-y-3 text-[12px] leading-4">
        {/* Header del formato */}
        <div className="border border-black">
          <div className="grid grid-cols-3">
            <div className="p-2 border-r border-black">
              <div className="font-semibold">Gestión de HSSEQ</div>
              <div className="text-xs">Título del Sistema</div>
            </div>
            <div className="p-2 border-r border-black">
              <div className="font-semibold">Análisis de Trabajo Seguro</div>
              <div className="text-xs">Nombre del Formato</div>
            </div>
            <div className="p-2">
              <div className="font-semibold">02-01-102-F001</div>
              <div className="text-xs">N.º del Formato</div>
            </div>
          </div>

          <div className="grid grid-cols-4 border-t border-black">
            <div className="p-2 border-r border-black">
              <div className="text-xs">Fecha Emisión</div>
              <div className="font-semibold">04 septiembre 2024</div>
            </div>
            <div className="p-2 border-r border-black">
              <div className="text-xs">N.º de Revisión</div>
              <div className="font-semibold">07</div>
            </div>
            <div className="p-2 border-r border-black">
              <div className="text-xs">Preparado por</div>
              <div className="font-semibold">HSSEQ</div>
            </div>
            <div className="p-2">
              <div className="text-xs">Aprobado por</div>
              <div className="font-semibold">RAS</div>
            </div>
          </div>
        </div>

        {/* Datos generales */}
        <div className="border border-black p-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <b>N° ATS:</b> {atsNumber || "—"}
            </div>
            <div>
              <b>N° Permiso de trabajo:</b> {permitNumber || "—"}
            </div>
            <div>
              <b>Fecha de elaboración:</b> {elabDatePrint || "—"}
            </div>
            <div>
              <b>Fecha de ejecución:</b> {execDatePrint || "—"}
            </div>
            <div>
              <b>Versión:</b> {formatVersion || "—"}
            </div>
            <div>
              <b>Frente de trabajo:</b> {workFront || "—"}
            </div>
            <div className="col-span-2">
              <b>Trabajo por desarrollar:</b> {jobTitle || atsResult?.meta?.title || "—"}
            </div>
            <div className="col-span-2">
              <b>Código del Procedimiento relacionado:</b> {procedureCodeRelated || "—"}
            </div>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <b>Incidentes en trabajos similares:</b> {incidentsReference || "—"}
            </div>
            <div>
              <b>Otras compañías:</b> {otherCompanies || "—"}
            </div>
          </div>
        </div>

        {/* Tipos de peligros + entorno + emergencias */}
        <div className="border border-black p-2 space-y-2">
          <div>
            <div className="font-semibold">Tipos de peligros para ejecutar el trabajo</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {PELIGROS_TIPOS.map((p) => (
                <div key={p}>
                  [{dangerTypes.includes(p) ? "X" : " "}] {p}
                </div>
              ))}
              {dangerTypes.includes("Otros") && (
                <div>
                  <b>Otros:</b> {dangerTypesOther || "—"}
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="font-semibold">PELIGROS DEL ENTORNO (Periféricos)</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {PELIGROS_ENTORNO.map((p) => (
                <div key={p}>
                  [{environmentDangers.includes(p) ? "X" : " "}] {p}
                </div>
              ))}
              {environmentDangers.includes("Otros") && (
                <div>
                  <b>Otros:</b> {environmentDangersOther || "—"}
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="font-semibold">SITUACIONES DE EMERGENCIA POTENCIALES</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {EMERGENCIAS.map((p) => (
                <div key={p}>
                  [{emergencies.includes(p) ? "X" : " "}] {p}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Peligros / controles del ATS generado (resumen) */}
        <div className="border border-black p-2">
          <div className="font-semibold">Resumen generado (ATS Inteligente)</div>
          <div className="mt-1">
            <b>Empresa:</b> {company || atsResult?.meta?.company || "—"} · <b>Ubicación:</b>{" "}
            {location || atsResult?.meta?.location || "—"} · <b>Turno:</b>{" "}
            {shift || atsResult?.meta?.shift || "—"}
          </div>

          <div className="mt-2">
            <b>Peligros identificados:</b>
            {hazardsList.length ? (
              <ul className="list-disc pl-5 mt-1">
                {hazardsList.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            ) : (
              <div className="mt-1">—</div>
            )}
          </div>

          <div className="mt-2">
            <b>Controles (ingeniería / administrativos / EPP):</b>
            <div className="grid grid-cols-3 gap-2 mt-1">
              <div>
                <div className="font-semibold">Ingeniería</div>
                {ctrlEng.length ? (
                  <ul className="list-disc pl-5">{ctrlEng.map((c, i) => <li key={i}>{c}</li>)}</ul>
                ) : (
                  <div>—</div>
                )}
              </div>
              <div>
                <div className="font-semibold">Administrativos</div>
                {ctrlAdm.length ? (
                  <ul className="list-disc pl-5">{ctrlAdm.map((c, i) => <li key={i}>{c}</li>)}</ul>
                ) : (
                  <div>—</div>
                )}
              </div>
              <div>
                <div className="font-semibold">EPP</div>
                {ctrlPpe.length ? (
                  <ul className="list-disc pl-5">{ctrlPpe.map((c, i) => <li key={i}>{c}</li>)}</ul>
                ) : (
                  <div>—</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Equipamiento */}
        <div className="border border-black p-2">
          <div className="font-semibold">Equipamiento de Seguridad para realizar este trabajo</div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {EQUIPO_SEGURIDAD.map((p) => (
              <div key={p}>
                [{safetyEquipment.includes(p) ? "X" : " "}] {p}
              </div>
            ))}
            {safetyEquipment.includes("Otros") && (
              <div>
                <b>Otros:</b> {safetyEquipmentOther || "—"}
              </div>
            )}
          </div>
        </div>

        {/* Acuerdos de vida */}
        <div className="border border-black p-2">
          <div className="font-semibold">Marcar Acuerdos de vida aplicables</div>
          <div className="mt-1 grid grid-cols-2 gap-x-6 gap-y-1">
            {ACUERDOS_DE_VIDA.map((p) => (
              <div key={p}>
                [{lifeSavingRules.includes(p) ? "X" : " "}] {p}
              </div>
            ))}
          </div>

          <div className="mt-2 font-semibold text-red-700">
            Deténgase y busque ayuda si alguno de los controles/acciones anteriores no se ha implementado
          </div>
        </div>

        {/* Autorización ejecutantes */}
        <div className="border border-black p-2">
          <div className="font-semibold">AUTORIZACIÓN DE LOS EJECUTANTES PARA EL INICIO DEL TRABAJO</div>
          <div className="mt-1 text-xs">
            <b>No comenzaré a trabajar hasta confirmar que…</b>
          </div>

          <div className="mt-2 border border-black">
            <div className="grid grid-cols-2">
              <div className="p-2 border-r border-black font-semibold">Nombre</div>
              <div className="p-2 font-semibold">Firma</div>
            </div>
            {executants.map((ex, idx) => (
              <div key={idx} className="grid grid-cols-2 border-t border-black">
                <div className="p-2 border-r border-black">{ex.name || "—"}</div>
                <div className="p-2">{ex.signature || "—"}</div>
              </div>
            ))}
          </div>

          <div className="mt-3 font-semibold">Verificador de inicio del trabajo (Supervisor de área)</div>

          <div className="mt-2 border border-black">
            <div className="grid grid-cols-4">
              <div className="p-2 border-r border-black font-semibold">Chequeo</div>
              <div className="p-2 border-r border-black font-semibold text-center">SI</div>
              <div className="p-2 border-r border-black font-semibold text-center">NO</div>
              <div className="p-2 font-semibold text-center">N.A.</div>
            </div>

            {[
              ["Tengo claridad de todas las etapas del trabajo a ejecutar", checkStagesClarity],
              ["Se han identificado y controlado todos los peligros y es seguro comenzar", checkHazardsControlled],
              ["He confirmado el aislamiento de todas las fuentes de energías peligrosas", checkIsolationConfirmed],
              ["Se han acordado responsabilidades y canales de comunicación del equipo", checkCommsAgreed],
              ["Cuento con herramientas y equipos necesarios en buenas condiciones", checkToolsOk],
            ].map(([label, val], i) => (
              <div key={i} className="grid grid-cols-4 border-t border-black">
                <div className="p-2 border-r border-black">{label as string}</div>
                <div className="p-2 border-r border-black text-center">{boxByVal(val as string, "SI")}</div>
                <div className="p-2 border-r border-black text-center">{boxByVal(val as string, "NO")}</div>
                <div className="p-2 text-center">{boxByVal(val as string, "N.A.")}</div>
              </div>
            ))}
          </div>

          <div className="mt-2 grid grid-cols-3 gap-2">
            <div>
              <b>Nombre:</b> {supervisorName || "—"}
            </div>
            <div>
              <b>Función:</b> {supervisorRole || "—"}
            </div>
            <div>
              <b>Firma:</b> {supervisorSignature || "—"}
            </div>
          </div>

          <div className="mt-3 font-semibold">Persona que aprueba el ATS</div>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <div>
              <b>Nombre:</b> {approverName || "—"}
            </div>
            <div>
              <b>Firma:</b> {approverSignature || "—"}
            </div>
          </div>

          {/* ==========================================================
              ✅ NUEVO (PEDIDO): RESUMEN CHARLA PRETURNO + CHECKLIST SUPERVISIÓN
              Ubicación: DESPUÉS de la firma del aprobador (en el PDF)
          ========================================================== */}
          <div className="mt-4 border-t border-black pt-3">
            <div className="font-semibold">Resumen para charla preturno</div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <b>Trabajo:</b> {jobTitle || atsResult?.meta?.title || "—"}
              </div>
              <div>
                <b>Decisión Stop Work:</b> {atsResult?.stop_work?.decision || "—"}
              </div>
              <div className="col-span-2">
                <b>Mensaje clave:</b> Si alguna condición cambia o un control no está implementado →{" "}
                <b>DETENER</b> y re-evaluar.
              </div>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-3">
              <div className="border border-black p-2">
                <div className="font-semibold">Peligros críticos (Top)</div>
                {topHazards.length ? (
                  <ul className="list-disc pl-5 mt-1">
                    {topHazards.map((h, i) => (
                      <li key={i}>{h}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="mt-1">—</div>
                )}
              </div>

              <div className="border border-black p-2">
                <div className="font-semibold">Controles clave (Top)</div>
                {topControls.length ? (
                  <ul className="list-disc pl-5 mt-1">
                    {topControls.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="mt-1">—</div>
                )}
              </div>
            </div>

            <div className="mt-3 border border-black p-2">
              <div className="font-semibold">Pasos críticos (resumen)</div>
              {topSteps.length ? (
                <ol className="list-decimal pl-5 mt-1">
                  {topSteps.map((s, i) => (
                    <li key={i}>
                      {String(s?.step || "").trim() || `Paso ${i + 1}`}
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="mt-1">—</div>
              )}
            </div>
          </div>

          <div className="mt-3 border border-black p-2">
            <div className="font-semibold">Lista de verificación de supervisión (preturno)</div>

            <div className="mt-2 border border-black">
              <div className="grid grid-cols-4">
                <div className="p-2 border-r border-black font-semibold">Ítem</div>
                <div className="p-2 border-r border-black font-semibold text-center">SI</div>
                <div className="p-2 border-r border-black font-semibold text-center">NO</div>
                <div className="p-2 font-semibold text-center">N.A.</div>
              </div>

              {supervisionChecklistRows.map((txt, i) => (
                <div key={i} className="grid grid-cols-4 border-t border-black">
                  <div className="p-2 border-r border-black">{txt}</div>
                  <div className="p-2 border-r border-black text-center">[ ]</div>
                  <div className="p-2 border-r border-black text-center">[ ]</div>
                  <div className="p-2 text-center">[ ]</div>
                </div>
              ))}
            </div>

            <div className="mt-2 text-[11px]">
              <b>Resultado del verificador (supervisor):</b> Claridad etapas = [{box(checkStagesClarity === "SI")}] SI / [
              {box(checkStagesClarity === "NO")}] NO / [{box(checkStagesClarity === "N.A.")}] N.A. · Peligros controlados
              = [{box(checkHazardsControlled === "SI")}] SI / [{box(checkHazardsControlled === "NO")}] NO / [
              {box(checkHazardsControlled === "N.A.")}] N.A. · Aislamiento = [{box(checkIsolationConfirmed === "SI")}] SI / [
              {box(checkIsolationConfirmed === "NO")}] NO / [{box(checkIsolationConfirmed === "N.A.")}] N.A. · Comunicación
              = [{box(checkCommsAgreed === "SI")}] SI / [{box(checkCommsAgreed === "NO")}] NO / [
              {box(checkCommsAgreed === "N.A.")}] N.A. · Herramientas OK = [{box(checkToolsOk === "SI")}] SI / [
              {box(checkToolsOk === "NO")}] NO / [{box(checkToolsOk === "N.A.")}] N.A.
            </div>
          </div>
          {/* =========================
              FIN NUEVO BLOQUE
          ========================= */}
        </div>

        {/* Pasos del trabajo (detallado) */}
        <div className="border border-black p-2">
          <div className="font-semibold">Etapas del trabajo a ejecutar (generadas)</div>
          {stepsList.length === 0 ? (
            <div className="mt-2">—</div>
          ) : (
            <div className="mt-2 space-y-2">
              {stepsList.map((s, i) => (
                <div key={i} className="border border-black p-2">
                  <div className="font-semibold">
                    {i + 1}. {String(s.step || `Paso ${i + 1}`)}
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-1">
                    <div>
                      <div className="font-semibold">Riesgos Potenciales</div>
                      {uniqueNonEmpty(s.hazards).length ? (
                        <ul className="list-disc pl-5 mt-1">
                          {uniqueNonEmpty(s.hazards).map((h, idx) => (
                            <li key={idx}>{h}</li>
                          ))}
                        </ul>
                      ) : (
                        <div className="mt-1">—</div>
                      )}
                    </div>
                    <div>
                      <div className="font-semibold">Acciones / Controles</div>
                      {uniqueNonEmpty(s.controls).length ? (
                        <ul className="list-disc pl-5 mt-1">
                          {uniqueNonEmpty(s.controls).map((c, idx) => (
                            <li key={idx}>{c}</li>
                          ))}
                        </ul>
                      ) : (
                        <div className="mt-1">—</div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="text-[10px] text-neutral-700">
          “Descargar PDF” abre el diálogo de impresión del navegador: selecciona “Guardar como PDF”.
        </div>
      </div>

      {/* =========================
          AUTORIZACIONES (PANTALLA) — editables
         ========================= */}
      <section className="no-print border rounded p-4 space-y-3">
        <div className="font-semibold">Autorización y verificación (Formato Estrella)</div>

        <div className="border rounded p-3">
          <div className="font-medium">Ejecutantes</div>
          <div className="mt-2 space-y-2">
            {executants.map((ex, idx) => (
              <div key={idx} className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input
                  placeholder={`Nombre ejecutante ${idx + 1}`}
                  value={ex.name}
                  onChange={(e) =>
                    setExecutants((prev) => {
                      const next = [...prev];
                      next[idx] = { ...next[idx], name: e.target.value };
                      return next;
                    })
                  }
                  className="border p-2 rounded"
                />
                <input
                  placeholder="Firma (texto)"
                  value={ex.signature}
                  onChange={(e) =>
                    setExecutants((prev) => {
                      const next = [...prev];
                      next[idx] = { ...next[idx], signature: e.target.value };
                      return next;
                    })
                  }
                  className="border p-2 rounded"
                />
              </div>
            ))}

            <button
              type="button"
              className="px-3 py-2 border rounded text-sm"
              onClick={() => setExecutants((prev) => [...prev, { name: "", signature: "" }])}
            >
              + Agregar ejecutante
            </button>
          </div>
        </div>

        <div className="border rounded p-3">
          <div className="font-medium">Supervisor verificador</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2">
            <input
              placeholder="Nombre"
              value={supervisorName}
              onChange={(e) => setSupervisorName(e.target.value)}
              className="border p-2 rounded"
            />
            <input
              placeholder="Función"
              value={supervisorRole}
              onChange={(e) => setSupervisorRole(e.target.value)}
              className="border p-2 rounded"
            />
            <input
              placeholder="Firma (texto)"
              value={supervisorSignature}
              onChange={(e) => setSupervisorSignature(e.target.value)}
              className="border p-2 rounded"
            />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 text-sm">
            {[
              ["Claridad de todas las etapas", checkStagesClarity, setCheckStagesClarity],
              ["Peligros identificados y controlados", checkHazardsControlled, setCheckHazardsControlled],
              ["Aislamiento energías peligrosas confirmado", checkIsolationConfirmed, setCheckIsolationConfirmed],
              ["Responsabilidades y comunicación acordadas", checkCommsAgreed, setCheckCommsAgreed],
              ["Herramientas/equipos en buenas condiciones", checkToolsOk, setCheckToolsOk],
            ].map(([label, value, setter], idx) => (
              <div key={idx} className="border rounded p-2">
                <div className="font-medium">{label as string}</div>
                <div className="mt-2 flex flex-wrap gap-4">
                  {(["SI", "NO", "N.A."] as const).map((v) => (
                    <label key={v} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`supcheck_${idx}`}
                        checked={value === v}
                        onChange={() => (setter as any)(v)}
                      />
                      {v}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border rounded p-3">
          <div className="font-medium">Aprobador del ATS</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
            <input
              placeholder="Nombre"
              value={approverName}
              onChange={(e) => setApproverName(e.target.value)}
              className="border p-2 rounded"
            />
            <input
              placeholder="Firma (texto)"
              value={approverSignature}
              onChange={(e) => setApproverSignature(e.target.value)}
              className="border p-2 rounded"
            />
          </div>
        </div>
      </section>

      {/* ✅ BOTÓN FINAL (PDF) */}
      {atsResult && (
        <div className="no-print border-t pt-6 flex justify-end">
          <button onClick={() => handlePrintToPdf()} className="px-6 py-2 bg-black text-white rounded">
            Descargar PDF
          </button>
        </div>
      )}
    </div>
  );
}
