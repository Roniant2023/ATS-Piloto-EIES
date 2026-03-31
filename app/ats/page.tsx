"use client";

import React, { useMemo, useRef, useState, useEffect } from "react";
import { useReactToPrint } from "react-to-print";
import SignaturePadField from "../components/SignaturePadField";

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
  checklist_actions?: ATSChecklistActions;
};

type LessonLearnedBrief = {
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

type LessonLearnedApiResponse = {
  lesson: any;
  lesson_learned_brief: LessonLearnedBrief;
};

type ATSHistoryItem = {
  id: string;
  created_at: string;
  job_title: string | null;
  company: string | null;
  location: string | null;
  work_date: string | null;
  shift: string | null;
  stop_work_decision: string | null;
  hazards_count: number | null;
  controls_count: number | null;
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
  if (decision === "REVIEW_REQUIRED") {
    return { label: "REVISIÓN REQUERIDA", cls: "bg-amber-500 text-black" };
  }
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
   HELPERS CHECKLIST
========================= */
function badgeForChecklistHint(decision?: string) {
  if (decision === "STOP") return { label: "STOP WORK", cls: "bg-red-600 text-white" };
  if (decision === "REVIEW_REQUIRED") {
    return { label: "REVISIÓN REQUERIDA", cls: "bg-amber-500 text-black" };
  }
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
  if (c === "engineering") {
    return { label: "Ingeniería", cls: "bg-indigo-50 text-indigo-900 border-indigo-200" };
  }
  if (c === "administrative") {
    return { label: "Administrativo", cls: "bg-blue-50 text-blue-900 border-blue-200" };
  }
  return { label: "EPP", cls: "bg-emerald-50 text-emerald-900 border-emerald-200" };
}

function pillForDecisionHint(h?: string) {
  if (h === "STOP") return { label: "STOP", cls: "bg-red-600 text-white" };
  if (h === "REVIEW_REQUIRED") return { label: "REVISAR", cls: "bg-amber-500 text-black" };
  return { label: "OK", cls: "bg-green-600 text-white" };
}

/* =========================
   COMPONENTE CHECKLIST
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
        Nota: estas acciones se derivan del Formato Estrella y reglas determinísticas; la IA solo
        afina redacción y verificabilidad.
      </div>
    </section>
  );
}

/* =========================
   CONSTANTES FORMATO ESTRELLA
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
  const [jobTitle, setJobTitle] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [dateISO, setDateISO] = useState("");
  const [shift, setShift] = useState("");
  const [activityDescription, setActivityDescription] = useState("");
  const [normReference, setNormReference] = useState("");
  const companyLogoSrc = "/logo-eies.png";

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

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [procedureRefs, setProcedureRefs] = useState<ProcedureRef[]>([]);
  const [procedureResults, setProcedureResults] = useState<ProcedureResult[]>([]);
  const [uploading, setUploading] = useState(false);

  const [generatingATS, setGeneratingATS] = useState(false);
  const [savingATS, setSavingATS] = useState(false);
  const [atsResult, setAtsResult] = useState<ATS | any>(null);

  const [atsHistory, setAtsHistory] = useState<ATSHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [adminAuthError, setAdminAuthError] = useState<string | null>(null);

  const [savedAtsId, setSavedAtsId] = useState<string | null>(null);
  const [approverLink, setApproverLink] = useState("");
  const [preparingApproverLink, setPreparingApproverLink] = useState(false);

  const [uiError, setUiError] = useState<string | null>(null);
  const [uiInfo, setUiInfo] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [openSteps, setOpenSteps] = useState<Record<number, boolean>>({});
  function toggleStep(i: number) {
    setOpenSteps((prev) => ({ ...prev, [i]: !prev[i] }));
  }

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

  const lessonInputRef = useRef<HTMLInputElement | null>(null);
  const [lessonFile, setLessonFile] = useState<File | null>(null);
  const [lessonUploading, setLessonUploading] = useState(false);
  const [lessonResult, setLessonResult] = useState<LessonLearnedApiResponse | null>(null);

  function openLessonPicker() {
    lessonInputRef.current?.click();
  }

  function clearLessonLearned() {
    setLessonFile(null);
    setLessonResult(null);
  }

  function handleUnlockAdminSections() {
    setAdminAuthError(null);

    const expected = process.env.NEXT_PUBLIC_ATS_ADMIN_PASSWORD;

    if (!expected) {
      setAdminAuthError("No se configuró la contraseña de acceso.");
      return;
    }

    if (adminPassword.trim() !== expected) {
      setAdminAuthError("Contraseña incorrecta.");
      setAdminUnlocked(false);
      return;
    }

    setAdminUnlocked(true);
    setAdminAuthError(null);
    setUiInfo("🔒 Acceso autorizado a historial y estadísticas.");
  }

  async function copyApproverLink() {
    if (!approverLink) return;

    try {
      await navigator.clipboard.writeText(approverLink);
      setUiInfo("🔗 Link copiado al portapapeles.");
    } catch (err: any) {
      setUiError(`No se pudo copiar el link: ${String(err?.message || err)}`);
    }
  }

  async function sendApproverLinkByWhatsApp() {
    if (!approverLink) return;

    try {
      const approver = approverName.trim() || "Aprobador";
      const atsName = jobTitle.trim() || atsResult?.meta?.title || "ATS";

      const message =
        `Hola ${approver}, te comparto el link para revisar y firmar el ATS:\n\n` +
        `Actividad: ${atsName}\n` +
        `Link de aprobación: ${approverLink}`;

      const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
      window.open(whatsappUrl, "_blank", "noopener,noreferrer");

      setUiInfo("📲 Se abrió WhatsApp para compartir el link de aprobación.");
    } catch (err: any) {
      setUiError(`No se pudo abrir WhatsApp: ${String(err?.message || err)}`);
    }
  }

  async function handlePrepareApproverLink() {
    setUiError(null);
    setUiInfo(null);

    if (!savedAtsId) {
      setUiError("Primero debes guardar el ATS para generar el link del aprobador.");
      return;
    }

    if (!supervisorSignature) {
      setUiError("Primero debe quedar registrada la firma del supervisor.");
      return;
    }

    setPreparingApproverLink(true);

    try {
      const res = await fetch("/api/create-approval-link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ats_id: savedAtsId,
          approver_name: approverName.trim(),
        }),
      });

      const text = await res.text();
      const parsed = safeJsonParse<any>(text);

      if (!res.ok) {
        setUiError(`Error generando link de aprobación (HTTP ${res.status}): ${text}`);
        return;
      }

      if (!parsed.ok || !parsed.value?.ok) {
        setUiError("No se pudo generar el link de aprobación.");
        return;
      }

      const link =
        parsed.value?.approval_url ||
        parsed.value?.url ||
        parsed.value?.link ||
        "";

      if (!link) {
        setUiError("La respuesta no trajo un link de aprobación.");
        return;
      }

      setApproverLink(link);
      setUiInfo("✅ Link de aprobación generado correctamente.");
    } catch (err: any) {
      setUiError(`Excepción generando link de aprobación: ${String(err?.message || err)}`);
    } finally {
      setPreparingApproverLink(false);
    }
  }

  async function uploadLessonLearned(file: File) {
    setUiError(null);
    setUiInfo(null);

    if (!isPdfOrDocx(file)) {
      setUiError("La lección aprendida debe ser PDF o DOCX.");
      return;
    }

    setLessonUploading(true);
    setLessonResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/lesson-learned-brief", {
        method: "POST",
        body: formData,
      });

      const text = await res.text();
      if (!res.ok) {
        setUiError(`Error en /api/lesson-learned-brief (HTTP ${res.status}): ${text}`);
        return;
      }

      const parsed = safeJsonParse<any>(text);
      if (!parsed.ok) {
        setUiError(`Respuesta no JSON en lesson learned: ${parsed.error}`);
        return;
      }

      if (!parsed.value?.lesson_learned_brief) {
        setUiError("Respuesta inválida: no llegó lesson_learned_brief.");
        return;
      }

      setLessonResult(parsed.value);
      setUiInfo("✅ Lección aprendida procesada y lista para el ATS.");
    } catch (err: any) {
      setUiError(`Excepción cargando lección aprendida: ${String(err?.message || err)}`);
    } finally {
      setLessonUploading(false);
    }
  }

  useEffect(() => {
    if (incidentsReference !== "Si") {
      clearLessonLearned();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentsReference]);

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
    contentRef: printRef,
    documentTitle: fileTitle,
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

  async function loadATSHistory() {
    if (!adminUnlocked) return;

    try {
      setLoadingHistory(true);

      const res = await fetch("/api/list-ats", {
        method: "GET",
        cache: "no-store",
      });

      const text = await res.text();
      const parsed = safeJsonParse<any>(text);

      if (!res.ok) {
        console.error("Error listando ATS:", text);
        return;
      }

      if (!parsed.ok || !parsed.value?.ok) {
        console.error("Respuesta inválida listando ATS:", text);
        return;
      }

      setAtsHistory(Array.isArray(parsed.value.data) ? parsed.value.data : []);
    } catch (err) {
      console.error("Excepción listando ATS:", err);
    } finally {
      setLoadingHistory(false);
    }
  }

  async function refreshSavedATS() {
    if (!savedAtsId) {
      setUiError("Primero debes guardar el ATS para poder refrescarlo.");
      return;
    }

    try {
      setUiError(null);
      setUiInfo(null);

      const res = await fetch(`/api/get-ats?id=${savedAtsId}`, {
        method: "GET",
        cache: "no-store",
      });

      const text = await res.text();
      const parsed = safeJsonParse<any>(text);

      if (!res.ok) {
        setUiError(`Error consultando ATS actualizado (HTTP ${res.status}): ${text}`);
        return;
      }

      if (!parsed.ok || !parsed.value?.ok) {
        setUiError("No se pudo refrescar el ATS actualizado.");
        return;
      }

      const freshAts = parsed.value?.data?.ats_json || null;

      if (!freshAts) {
        setUiError("La respuesta no trajo ats_json.");
        return;
      }

      setAtsResult(freshAts);

      const remoteApproverSignature =
        freshAts?.estrella_format?.authorizations?.approver?.signature || "";

      const remoteApproverName =
        freshAts?.estrella_format?.authorizations?.approver?.name || "";

      setApproverSignature(remoteApproverSignature || "");
      setApproverName(remoteApproverName || "");

      setUiInfo("✅ ATS refrescado con la firma remota del aprobador.");
    } catch (err: any) {
      setUiError(`Excepción refrescando ATS: ${String(err?.message || err)}`);
    }
  }

  useEffect(() => {
    if (adminUnlocked) {
      loadATSHistory();
    }
  }, [adminUnlocked]);

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
    setSavedAtsId(null);
    setApproverLink("");
    setApproverName("");
    setApproverSignature("");
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
        setUiError("Se procesaron archivos, pero no se extrajo ningún documento técnico válido.");
      } else {
        setUiInfo(`Documentos técnicos listos: ${okCount}. Fallidos: ${failCount}.`);
      }
    } finally {
      setUploading(false);
    }
  }

  const missingReasons = useMemo(() => {
    const reasons: string[] = [];

    if (!jobTitle.trim()) reasons.push("Falta Actividad/Trabajo.");
    if (!company.trim()) reasons.push("Falta Empresa.");
    if (!location.trim()) reasons.push("Falta Ubicación.");
    if (!dateISO) reasons.push("Falta Fecha (meta).");
    if (!shift.trim()) reasons.push("Falta Turno/Jornada.");

    if (selectedFiles.length === 0) reasons.push("No has seleccionado documentos técnicos.");
    if (procedureRefs.length === 0) reasons.push("No has procesado documentos técnicos (procedimientos/FDS).");

    if (!executionDateISO) reasons.push("Falta Fecha de ejecución (Formato Estrella).");
    if (!elaborationDateISO) reasons.push("Falta Fecha de elaboración (Formato Estrella).");

    if (incidentsReference === "Si") {
      if (!lessonResult?.lesson_learned_brief) {
        reasons.push("Incidentes = Sí → Debes cargar y procesar una Lección aprendida (PDF/DOCX).");
      }
      if (lessonUploading) reasons.push("Espera: lección aprendida en procesamiento.");
    }

    if (uploading) reasons.push("Espera: documentos técnicos en procesamiento.");
    if (generatingATS) reasons.push("Espera: ATS generándose.");
    if (savingATS) reasons.push("Espera: ATS guardándose.");

    return reasons;
  }, [
    jobTitle,
    company,
    location,
    dateISO,
    shift,
    selectedFiles.length,
    procedureRefs.length,
    uploading,
    generatingATS,
    savingATS,
    executionDateISO,
    elaborationDateISO,
    incidentsReference,
    lessonResult,
    lessonUploading,
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

      const payload: any = {
        jobTitle: jobTitle.trim(),
        activity_description: activityDescription.trim(),
        norm_reference: normReference.trim(),
        company: company.trim(),
        location: location.trim(),
        date: formatDateEsCOFromISO(dateISO),
        shift: shift.trim(),
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
              signature: supervisorSignature,
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
              signature: approverSignature,
            },
          },
        },
      };

      if (incidentsReference === "Si" && lessonResult?.lesson_learned_brief) {
        payload.lesson_learned_brief = lessonResult.lesson_learned_brief;
      }

      console.log("ATS PAYLOAD:");
      console.log(payload);

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
      setSavedAtsId(null);
      setApproverLink("");
      setApproverName("");
      setApproverSignature("");
      setUiInfo("✅ ATS generado correctamente.");
    } catch (err: any) {
      setUiError(`Excepción generando ATS: ${String(err?.message || err)}`);
    } finally {
      setGeneratingATS(false);
    }
  }

  async function handleSaveATS() {
    console.log("ENTRÓ A handleSaveATS");

    try {
      if (!atsResult) {
        setUiError("No hay ATS generado para guardar.");
        return;
      }

      setSavingATS(true);
      setUiError(null);
      setUiInfo(null);

      const atsToSave = {
        ...atsResult,
        estrella_format: {
          ...(atsResult?.estrella_format || {}),
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
            ...(atsResult?.estrella_format?.authorizations || {}),
            executants,
            supervisor: {
              ...(atsResult?.estrella_format?.authorizations?.supervisor || {}),
              name: supervisorName.trim(),
              role: supervisorRole.trim(),
              signature: supervisorSignature,
              checks: {
                stagesClarity: checkStagesClarity,
                hazardsControlled: checkHazardsControlled,
                isolationConfirmed: checkIsolationConfirmed,
                commsAgreed: checkCommsAgreed,
                toolsOk: checkToolsOk,
              },
            },
            approver: {
              ...(atsResult?.estrella_format?.authorizations?.approver || {}),
              name: approverName.trim(),
              signature: approverSignature,
            },
          },
        },
      };

      const payload = {
        ats: atsToSave,
        activity_description: activityDescription.trim(),
        norm_reference: normReference.trim(),
      };

      const res = await fetch("/api/save-ats", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const text = await res.text();

      if (!res.ok) {
        setUiError(`Error guardando ATS (HTTP ${res.status}): ${text}`);
        return;
      }

      const parsed = safeJsonParse<any>(text);
      if (!parsed.ok) {
        setUiError(`Respuesta no JSON al guardar ATS: ${parsed.error}`);
        return;
      }

      if (!parsed.value?.ok) {
        setUiError("No se pudo guardar el ATS.");
        return;
      }

      const newId =
        parsed.value?.id ||
        parsed.value?.ats_id ||
        parsed.value?.data?.[0]?.id ||
        null;

      setAtsResult(atsToSave);
      setSavedAtsId(newId);
      setApproverLink("");
      setApproverName("");
      setApproverSignature("");

      setUiInfo("✅ ATS guardado correctamente en Supabase.");
      await loadATSHistory();
    } catch (err: any) {
      setUiError(`Excepción guardando ATS: ${String(err?.message || err)}`);
    } finally {
      setSavingATS(false);
    }
  }

  const decision: string | undefined = atsResult?.stop_work?.decision;
  const decisionBadge = badgeForDecision(decision);
  const decisionSectionCls = sectionColorForDecision(decision);

  const appliedProcedures: ATSProcedureMini[] =
    atsResult?.procedure_influence?.applied ?? atsResult?.procedure_refs_used ?? [];

  const notParseableProcedures: ATSProcedureMini[] =
    atsResult?.procedure_influence?.not_parseable ?? [];

  const hazardsList = uniqueNonEmpty(atsResult?.hazards);
  const ctrlEng = uniqueNonEmpty(atsResult?.controls?.engineering);
  const ctrlAdm = uniqueNonEmpty(atsResult?.controls?.administrative);
  const ctrlPpe = uniqueNonEmpty(atsResult?.controls?.ppe);
  const stepsList: ATS["steps"] = Array.isArray(atsResult?.steps) ? atsResult.steps : [];

  const execDatePrint = formatDateEsCOFromISO(executionDateISO);
  const elabDatePrint = formatDateEsCOFromISO(elaborationDateISO);

  const checklist: ATSChecklistActions | null =
    (atsResult?.checklist_actions as ATSChecklistActions) ?? null;

  const box = (checked: boolean) => (checked ? "X" : " ");
  const boxByVal = (val: string, target: "SI" | "NO" | "N.A.") => box(val === target);

  const topHazards = hazardsList.slice(0, 8);
  const topControls = uniqueNonEmpty([...ctrlEng, ...ctrlAdm, ...ctrlPpe]).slice(0, 10);
  const topSteps = stepsList.slice(0, 6);

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
<div className="text-sm text-neutral-700">
              {(atsResult?.meta?.company ? `${atsResult.meta.company} — ` : "") +
                (atsResult?.meta?.location || "") +
                (atsResult?.meta?.date ? ` — ${atsResult.meta.date}` : "") +
                (atsResult?.meta?.shift ? ` — ${atsResult.meta.shift}` : "")}
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

    <div ref={printRef} className="hidden print:block space-y-3 text-[12px] leading-4">
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold text-[14px]">Análisis de Trabajo Seguro</div>
        <img
          src={companyLogoSrc}
          alt="Logo compañía"
          style={{ height: "50px", width: "auto", objectFit: "contain" }}
        />
      </div>

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

        <div className="mt-2">
          <b>Referencia normativa:</b> {normReference.trim() || "—"}
        </div>
      </div>

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
          Deténgase y busque ayuda si alguno de los controles/acciones anteriores no se ha
          implementado
        </div>
      </div>

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
            <b>Firma:</b>{" "}
            {supervisorSignature ? (
              <img
                src={supervisorSignature}
                alt="Firma supervisor"
                style={{ maxHeight: "50px", width: "auto", objectFit: "contain" }}
              />
            ) : (
              "—"
            )}
          </div>
        </div>

        <div className="mt-3 font-semibold">Persona que aprueba el ATS</div>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <div>
            <b>Nombre:</b> {approverName || "—"}
          </div>
          <div>
            <b>Firma:</b>{" "}
            {approverSignature ? (
              <img
                src={approverSignature}
                alt="Firma aprobador"
                style={{ maxHeight: "50px", width: "auto", objectFit: "contain" }}
              />
            ) : (
              "Pendiente por aprobación remota"
            )}
          </div>
        </div>

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
                  <li key={i}>{String(s?.step || "").trim() || `Paso ${i + 1}`}</li>
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
      </div>

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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
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
        </div>

        <div className="mt-3">
          <SignaturePadField
            label="Firma del supervisor"
            value={supervisorSignature}
            onChange={setSupervisorSignature}
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
        <div className="grid grid-cols-1 gap-2 mt-2">
          <input
            placeholder="Nombre"
            value={approverName}
            onChange={(e) => setApproverName(e.target.value)}
            className="border p-2 rounded"
          />
        </div>

        <div className="mt-3 border rounded p-3 bg-neutral-50">
          <div className="text-sm font-medium">Firma del aprobador</div>
          <div className="text-sm text-neutral-600 mt-1">
            La firma del aprobador se realiza únicamente desde el link de aprobación remota.
          </div>

          {approverSignature ? (
            <div className="mt-3 border rounded p-2 bg-white">
              <div className="text-xs text-neutral-600 mb-2">Firma registrada</div>
              <img
                src={approverSignature}
                alt="Firma del aprobador"
                className="max-h-[100px] w-auto object-contain"
              />
            </div>
          ) : (
            <div className="mt-3 text-xs text-neutral-500">
              Aún no se ha registrado la firma remota del aprobador.
            </div>
          )}
        </div>
      </div>
    </section>

    {savedAtsId && supervisorSignature && (
      <section className="no-print border rounded p-4 space-y-3 bg-blue-50 border-blue-200">
        <div className="font-semibold">Aprobación remota</div>
        <div className="text-sm text-neutral-700">
          Después de guardar y firmar como supervisor, puedes generar un link para que el aprobador firme desde otro dispositivo o ubicación.
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handlePrepareApproverLink}
            disabled={preparingApproverLink}
            className="px-4 py-2 bg-black text-white rounded disabled:opacity-50"
          >
            {preparingApproverLink ? "Generando link..." : "Generar link para aprobador"}
          </button>

          <button
            type="button"
            onClick={copyApproverLink}
            disabled={!approverLink}
            className="px-4 py-2 border rounded disabled:opacity-50"
          >
            Copiar link
          </button>

          <button
            type="button"
            onClick={sendApproverLinkByWhatsApp}
            disabled={!approverLink}
            className="px-4 py-2 border rounded disabled:opacity-50"
          >
            Enviar por WhatsApp
          </button>

          <button
            type="button"
            onClick={refreshSavedATS}
            disabled={!savedAtsId}
            className="px-4 py-2 border rounded disabled:opacity-50"
          >
            Refrescar ATS
          </button>
        </div>

        {approverLink && (
          <div className="border rounded bg-white p-3 text-sm break-all">
            {approverLink}
          </div>
        )}
      </section>
    )}

    <section className="no-print border rounded p-4 space-y-3 bg-neutral-50">
      <div className="font-semibold">Acceso restringido</div>
      <div className="text-sm text-neutral-600">
        El historial y las estadísticas del ATS requieren contraseña.
      </div>

      {!adminUnlocked ? (
        <div className="flex flex-col md:flex-row gap-2 md:items-center">
          <input
            type="password"
            placeholder="Ingrese contraseña"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            className="border p-2 rounded md:w-[320px]"
          />

          <button
            type="button"
            onClick={handleUnlockAdminSections}
            className="px-4 py-2 bg-black text-white rounded"
          >
            Desbloquear
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-green-700 font-medium">
            ✅ Acceso habilitado a historial y estadísticas
          </div>

          <button
            type="button"
            onClick={() => {
              setAdminUnlocked(false);
              setAdminPassword("");
              setAdminAuthError(null);
              setAtsHistory([]);
            }}
            className="px-4 py-2 border rounded"
          >
            Bloquear nuevamente
          </button>
        </div>
      )}

      {adminAuthError && (
        <div className="text-sm text-red-700">{adminAuthError}</div>
      )}
    </section>

    {adminUnlocked && (
      <section className="no-print border rounded p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold">Historial de ATS guardados</div>
            <div className="text-sm text-neutral-600">
              Últimos registros almacenados en Supabase
            </div>
          </div>

          <button
            type="button"
            onClick={loadATSHistory}
            disabled={loadingHistory}
            className="px-4 py-2 border rounded disabled:opacity-50"
          >
            {loadingHistory ? "Actualizando..." : "Actualizar"}
          </button>
        </div>

        {loadingHistory ? (
          <div className="text-sm text-neutral-600">Cargando historial...</div>
        ) : atsHistory.length === 0 ? (
          <div className="text-sm text-neutral-600">No hay ATS guardados todavía.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border rounded text-sm">
              <thead className="bg-neutral-100">
                <tr>
                  <th className="text-left p-2 border-b">Fecha guardado</th>
                  <th className="text-left p-2 border-b">Trabajo</th>
                  <th className="text-left p-2 border-b">Empresa</th>
                  <th className="text-left p-2 border-b">Ubicación</th>
                  <th className="text-left p-2 border-b">Stop Work</th>
                  <th className="text-left p-2 border-b">Peligros</th>
                  <th className="text-left p-2 border-b">Controles</th>
                </tr>
              </thead>
              <tbody>
                {atsHistory.map((item) => (
                  <tr key={item.id} className="border-b">
                    <td className="p-2">
                      {item.created_at ? new Date(item.created_at).toLocaleString() : "—"}
                    </td>
                    <td className="p-2">{item.job_title || "—"}</td>
                    <td className="p-2">{item.company || "—"}</td>
                    <td className="p-2">{item.location || "—"}</td>
                    <td className="p-2">{item.stop_work_decision || "—"}</td>
                    <td className="p-2">{item.hazards_count ?? 0}</td>
                    <td className="p-2">{item.controls_count ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    )}

    {atsResult && (
      <div className="no-print border-t pt-6 flex justify-end gap-3">
        <button
          type="button"
          onClick={handleSaveATS}
          disabled={savingATS}
          className="px-6 py-2 border rounded disabled:opacity-50"
        >
          {savingATS ? "Guardando..." : "Guardar ATS"}
        </button>

        <button
          type="button"
          onClick={refreshSavedATS}
          disabled={!savedAtsId}
          className="px-6 py-2 border rounded disabled:opacity-50"
        >
          Refrescar ATS
        </button>

        <button
          type="button"
          onClick={() => handlePrintToPdf()}
          className="px-6 py-2 bg-black text-white rounded"
        >
          Descargar PDF
        </button>
      </div>
    )}
  </div>
);
}