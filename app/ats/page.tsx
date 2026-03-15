// app/ats/page.tsx
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
  normative_refs?: Array<{
    standard: string;
    clause?: string | null;
    note?: string | null;
    url?: string | null;
  }>;
  recommendations?: Array<{
    topic: string;
    recommendation: string;
    based_on: Array<{ standard: string; clause?: string | null }>;
    verification: "ok" | "requires_verification";
  }>;
};

/* =========================
   HELPERS
========================= */
function safeArray<T = any>(x: any): T[] {
  return Array.isArray(x) ? x : [];
}

function uniqueStrings(arr: any[]): string[] {
  return Array.from(
    new Set(
      safeArray(arr)
        .map((x) => String(x ?? "").trim())
        .filter(Boolean)
    )
  );
}

function splitLines(text: string): string[] {
  return String(text || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function readJsonFromText(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {}

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const chunk = text.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(chunk);
    } catch {}
  }

  return null;
}

function fileToText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function normalizeNormativeRefs(text: string) {
  return uniqueStrings(splitLines(text)).map((standard) => ({
    standard,
    clause: null,
    note: null,
    url: null,
  }));
}

function normsToDisplay(norms: any[]): string[] {
  return uniqueStrings(
    safeArray(norms).map((n) => {
      if (typeof n === "string") return n;
      const standard = String(n?.standard || "").trim();
      const clause = String(n?.clause || "").trim();
      return clause ? `${standard} - ${clause}` : standard;
    })
  );
}

function parseProcedureObject(raw: any, fileName: string): ProcedureRef {
  return {
    ...raw,
    title:
      raw?.title ||
      raw?.nombre ||
      raw?.procedure ||
      raw?.document ||
      fileName,
    code: raw?.code || raw?.codigo || raw?.id || "N/A",
    origin: raw?.origin || fileName,
    parseable: typeof raw?.parseable === "boolean" ? raw.parseable : true,
  };
}

function yes(v: any): boolean {
  return v === true || v === "true" || v === "sí" || v === "si" || v === "yes";
}

/* =========================
   COMPONENTE
========================= */
export default function ATSPage() {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: "ATS_Inteligente",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rawResponse, setRawResponse] = useState("");

  const [company, setCompany] = useState("Estrella International Energy Services");
  const [jobTitle, setJobTitle] = useState("Análisis de Trabajo Seguro");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [shift, setShift] = useState("Día");

  const [timeOfDay, setTimeOfDay] = useState("");
  const [weather, setWeather] = useState("");
  const [temperatureC, setTemperatureC] = useState("");
  const [humidityPct, setHumidityPct] = useState("");
  const [wind, setWind] = useState("");
  const [lighting, setLighting] = useState("");
  const [terrain, setTerrain] = useState("");
  const [visibility, setVisibility] = useState("");

  const [hazardsText, setHazardsText] = useState("");
  const [engineeringText, setEngineeringText] = useState("");
  const [administrativeText, setAdministrativeText] = useState("");
  const [ppeText, setPpeText] = useState("");
  const [stepsText, setStepsText] = useState("");
  const [normativeRefsText, setNormativeRefsText] = useState("");

  const [lifting, setLifting] = useState(false);
  const [hotWork, setHotWork] = useState(false);
  const [workAtHeight, setWorkAtHeight] = useState(false);
  const [confinedSpace, setConfinedSpace] = useState(false);
  const [highPressure, setHighPressure] = useState(false);

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

  const environment: Environment = useMemo(
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
    [timeOfDay, weather, temperatureC, humidityPct, wind, lighting, terrain, visibility]
  );

  const hazards = useMemo(() => uniqueStrings(splitLines(hazardsText)), [hazardsText]);

  const baseControls = useMemo(
    () => ({
      engineering: uniqueStrings(splitLines(engineeringText)),
      administrative: uniqueStrings(splitLines(administrativeText)),
      ppe: uniqueStrings(splitLines(ppeText)),
    }),
    [engineeringText, administrativeText, ppeText]
  );

  const steps = useMemo(
    () =>
      splitLines(stepsText).map((step) => ({
        step,
        hazards: [],
        controls: [],
      })),
    [stepsText]
  );

  const normativeRefs = useMemo(
    () => normalizeNormativeRefs(normativeRefsText),
    [normativeRefsText]
  );

  const checklistPreview = useMemo(() => {
    const missing: string[] = [];
    const critical_fails: string[] = [];
    const actions: ATSChecklistAction[] = [];

    if (!permitApproved) {
      missing.push("Permiso aprobado");
      actions.push({
        priority: "critical",
        category: "administrative",
        action: "Gestionar y aprobar el permiso de trabajo antes de iniciar.",
        evidence: ["Permiso firmado y vigente"],
      });
    }

    if (!ppeVerified) {
      missing.push("EPP verificado");
    }
    if (!toolsInspected) {
      missing.push("Herramientas inspeccionadas");
    }
    if (!areaDelimited) {
      missing.push("Área delimitada");
    }

    if (workAtHeight && !rescuePlan) {
      critical_fails.push("Trabajo en alturas sin plan de rescate");
    }
    if (workAtHeight && !certifiedPersonnel) {
      critical_fails.push("Trabajo en alturas con personal no certificado");
    }
    if (confinedSpace && !gasTestOk) {
      critical_fails.push("Espacio confinado sin prueba de gases aceptable");
    }
    if (confinedSpace && !rescuePlan) {
      critical_fails.push("Espacio confinado sin plan de rescate");
    }
    if (lifting && !certifiedPersonnel) {
      critical_fails.push("Izaje con personal no competente/certificado");
    }
    if (highPressure && !isolated) {
      critical_fails.push("Sistema de alta presión sin aislamiento verificado");
    }

    let decision_hint: ATSChecklistDecisionHint = "CONTINUE";
    if (critical_fails.length > 0) decision_hint = "STOP";
    else if (missing.length > 0) decision_hint = "REVIEW_REQUIRED";

    return {
      decision_hint,
      missing: uniqueStrings(missing),
      critical_fails: uniqueStrings(critical_fails),
      derived_controls: {
        engineering: [],
        administrative: [],
        ppe: [],
      },
      actions,
      snapshot: {
        lifting,
        hotWork,
        workAtHeight,
        confinedSpace,
        highPressure,
        permitApproved,
        isolated,
        gasTestOk,
        rescuePlan,
        certifiedPersonnel,
        ppeVerified,
        toolsInspected,
        areaDelimited,
        weatherOk,
      },
    } satisfies ATSChecklistActions;
  }, [
    lifting,
    hotWork,
    workAtHeight,
    confinedSpace,
    highPressure,
    permitApproved,
    isolated,
    gasTestOk,
    rescuePlan,
    certifiedPersonnel,
    ppeVerified,
    toolsInspected,
    areaDelimited,
    weatherOk,
  ]);

  async function handleProcedureUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    setProcedureFiles(files);

    if (!files.length) {
      setProcedureResults([]);
      return;
    }

    const results: ProcedureResult[] = [];

    for (const file of files) {
      try {
        const text = await fileToText(file);
        const maybeJson = readJsonFromText(text);

        if (maybeJson && typeof maybeJson === "object") {
          results.push({
            ok: true,
            fileName: file.name,
            procedure: parseProcedureObject(maybeJson, file.name),
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
      } catch (err: any) {
        results.push({
          ok: false,
          fileName: file.name,
          error: "No fue posible leer el archivo",
          details: String(err?.message || err || ""),
        });
      }
    }

    setProcedureResults(results);
  }

  async function generateATS() {
    setLoading(true);
    setError("");
    setAtsResult(null);

    try {
      const procedures = procedureResults
        .filter((r) => r.ok && r.procedure)
        .map((r) => r.procedure as ProcedureRef);

      const payload = {
        jobTitle: jobTitle.trim(),
        company: company.trim(),
        location: location.trim(),
        date,
        shift: shift.trim(),
        lifting,
        hotWork,
        workAtHeight,
        confinedSpace,
        highPressure,
        environment,
        hazards,
        controls: baseControls,
        steps,
        procedure_refs: procedures,
        normative_refs: normativeRefs,
        checklist: checklistPreview.snapshot,
      };

      const res = await fetch("/api/generate-ats", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      setRawResponse(text);

      const data = readJsonFromText(text);

      if (!res.ok) {
        throw new Error(data?.details || data?.error || text || "Error generando ATS");
      }

      setAtsResult(data?.ats || data || null);
    } catch (err: any) {
      setError(String(err?.message || err || "Error inesperado"));
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setError("");
    setRawResponse("");
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
    setEngineeringText("");
    setAdministrativeText("");
    setPpeText("");
    setStepsText("");
    setNormativeRefsText("");

    setLifting(false);
    setHotWork(false);
    setWorkAtHeight(false);
    setConfinedSpace(false);
    setHighPressure(false);

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

  const stopBadgeClass =
    atsResult?.stop_work?.decision === "STOP"
      ? "bg-red-100 text-red-800 border-red-300"
      : atsResult?.stop_work?.decision === "REVIEW_REQUIRED"
      ? "bg-yellow-100 text-yellow-800 border-yellow-300"
      : "bg-green-100 text-green-800 border-green-300";

  const normsForView = useMemo(() => {
    const fromInput = normsToDisplay(normativeRefs);
    const fromResult = normsToDisplay(atsResult?.normative_refs || []);
    return uniqueStrings([...fromInput, ...fromResult]);
  }, [normativeRefs, atsResult]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold">ATS Inteligente</h1>
            <p className="text-sm text-slate-600">
              Generación de análisis de trabajo seguro con soporte de IA.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={generateATS}
              disabled={loading}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-slate-800 disabled:opacity-60"
            >
              {loading ? "Generando..." : "Generar ATS"}
            </button>

            <button
              onClick={resetForm}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Limpiar
            </button>

            <button
              onClick={() => handlePrint?.()}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Imprimir / PDF
            </button>
          </div>
        </div>

        {error ? (
          <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
            <strong>Error:</strong> {error}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="space-y-6 xl:col-span-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold">1. Datos generales</h2>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Empresa" value={company} onChange={setCompany} />
                <Field label="Título / trabajo" value={jobTitle} onChange={setJobTitle} />
                <Field label="Ubicación" value={location} onChange={setLocation} placeholder="Campo / locación / área" />

                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Fecha</span>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Turno</span>
                  <select
                    value={shift}
                    onChange={(e) => setShift(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="Día">Día</option>
                    <option value="Noche">Noche</option>
                    <option value="Mixto">Mixto</option>
                  </select>
                </label>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold">2. Condiciones del entorno</h2>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Field label="Hora del día" value={timeOfDay} onChange={setTimeOfDay} placeholder="Mañana / tarde / noche" />
                <Field label="Clima" value={weather} onChange={setWeather} placeholder="Soleado / lluvia / tormenta" />
                <Field label="Temperatura °C" value={temperatureC} onChange={setTemperatureC} type="number" />
                <Field label="Humedad %" value={humidityPct} onChange={setHumidityPct} type="number" />
                <Field label="Viento" value={wind} onChange={setWind} placeholder="Bajo / moderado / fuerte" />
                <Field label="Iluminación" value={lighting} onChange={setLighting} placeholder="Adecuada / deficiente" />
                <Field label="Terreno" value={terrain} onChange={setTerrain} placeholder="Estable / irregular / fangoso" />
                <Field label="Visibilidad" value={visibility} onChange={setVisibility} placeholder="Buena / limitada" />
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold">3. Peligros, controles y pasos</h2>

              <div className="grid grid-cols-1 gap-4">
                <TextArea
                  label="Peligros identificados"
                  value={hazardsText}
                  onChange={setHazardsText}
                  rows={5}
                  placeholder={`Un peligro por línea
Caída de altura
Caída de objetos
Atrapamiento
Líneas presurizadas`}
                />

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <TextArea
                    label="Controles de ingeniería"
                    value={engineeringText}
                    onChange={setEngineeringText}
                    rows={6}
                    placeholder="Un control por línea"
                  />
                  <TextArea
                    label="Controles administrativos"
                    value={administrativeText}
                    onChange={setAdministrativeText}
                    rows={6}
                    placeholder="Un control por línea"
                  />
                  <TextArea
                    label="EPP"
                    value={ppeText}
                    onChange={setPpeText}
                    rows={6}
                    placeholder="Un EPP por línea"
                  />
                </div>

                <TextArea
                  label="Pasos de la tarea"
                  value={stepsText}
                  onChange={setStepsText}
                  rows={5}
                  placeholder={`Un paso por línea
Inspección del área
Aseguramiento del equipo
Ejecución de la tarea
Cierre y orden del área`}
                />

                <TextArea
                  label="Referencias normativas / procedimientos"
                  value={normativeRefsText}
                  onChange={setNormativeRefsText}
                  rows={4}
                  placeholder={`Una referencia por línea
Resolución 4272 de 2021
ISO 45001
Procedimiento de trabajo en alturas`}
                />
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold">4. Actividades y checklist crítico</h2>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div>
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">
                    Actividades
                  </h3>
                  <div className="grid grid-cols-1 gap-2">
                    <Check label="Izaje" checked={lifting} onChange={setLifting} />
                    <Check label="Trabajo en caliente" checked={hotWork} onChange={setHotWork} />
                    <Check label="Trabajo en alturas" checked={workAtHeight} onChange={setWorkAtHeight} />
                    <Check label="Espacios confinados" checked={confinedSpace} onChange={setConfinedSpace} />
                    <Check label="Altas presiones" checked={highPressure} onChange={setHighPressure} />
                  </div>
                </div>

                <div>
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">
                    Verificaciones previas
                  </h3>
                  <div className="grid grid-cols-1 gap-2">
                    <Check label="Permiso aprobado" checked={permitApproved} onChange={setPermitApproved} />
                    <Check label="Aislamiento verificado" checked={isolated} onChange={setIsolated} />
                    <Check label="Prueba de gases aceptable" checked={gasTestOk} onChange={setGasTestOk} />
                    <Check label="Plan de rescate disponible" checked={rescuePlan} onChange={setRescuePlan} />
                    <Check label="Personal certificado" checked={certifiedPersonnel} onChange={setCertifiedPersonnel} />
                    <Check label="EPP verificado" checked={ppeVerified} onChange={setPpeVerified} />
                    <Check label="Herramientas inspeccionadas" checked={toolsInspected} onChange={setToolsInspected} />
                    <Check label="Área delimitada" checked={areaDelimited} onChange={setAreaDelimited} />
                    <Check label="Condiciones climáticas aceptables" checked={weatherOk} onChange={setWeatherOk} />
                  </div>
                </div>
              </div>
            </section>

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

                {procedureFiles.length > 0 ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="mb-2 text-sm font-medium text-slate-700">Archivos cargados:</p>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
                      {procedureFiles.map((file) => (
                        <li key={`${file.name}-${file.size}`}>{file.name}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {procedureResults.length > 0 ? (
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

              {checklistPreview.critical_fails.length > 0 ? (
                <div className="mb-4">
                  <h3 className="mb-2 text-sm font-semibold text-red-700">Fallas críticas</h3>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {checklistPreview.critical_fails.map((item, idx) => (
                      <li key={`${item}-${idx}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {checklistPreview.missing.length > 0 ? (
                <div className="mb-4">
                  <h3 className="mb-2 text-sm font-semibold text-yellow-700">Pendientes</h3>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {checklistPreview.missing.map((item, idx) => (
                      <li key={`${item}-${idx}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold">Resumen rápido</h2>

              <div className="space-y-3 text-sm text-slate-700">
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <strong>Peligros:</strong> {hazards.length}
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <strong>Controles ingeniería:</strong> {baseControls.engineering.length}
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <strong>Controles administrativos:</strong> {baseControls.administrative.length}
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <strong>EPP:</strong> {baseControls.ppe.length}
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <strong>Pasos:</strong> {steps.length}
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <strong>Procedimientos cargados:</strong> {procedureResults.length}
                </div>
              </div>
            </section>
          </div>
        </div>

        {atsResult ? (
          <div className="mt-6" ref={printRef}>
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="text-2xl font-bold">{atsResult.meta.title}</h2>
                  <p className="text-sm text-slate-600">{atsResult.meta.company}</p>
                </div>

                <div>
                  <span
                    className={`inline-flex rounded-full border px-4 py-2 text-sm font-bold ${stopBadgeClass}`}
                  >
                    {atsResult.stop_work.decision}
                  </span>
                </div>
              </div>

              <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Info title="Ubicación" value={atsResult.meta.location || "-"} />
                <Info title="Fecha" value={atsResult.meta.date || "-"} />
                <Info title="Turno" value={atsResult.meta.shift || "-"} />
                <Info title="Hora del día" value={atsResult.environment?.timeOfDay || "-"} />
              </div>

              <Section title="Decisión Stop Work">
                <p className="mb-3 text-sm text-slate-700">
                  <strong>Razonamiento:</strong> {atsResult.stop_work.rationale}
                </p>

                {atsResult.stop_work.auto_triggers?.length ? (
                  <>
                    <h4 className="mb-1 text-sm font-semibold text-red-700">Disparadores automáticos</h4>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                      {atsResult.stop_work.auto_triggers.map((item, idx) => (
                        <li key={`${item}-${idx}`}>{item}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </Section>

              <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Section title="Peligros identificados">
                  {atsResult.hazards?.length ? (
                    <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                      {atsResult.hazards.map((hazard, idx) => (
                        <li key={`${hazard}-${idx}`}>{hazard}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-slate-500">No se registraron peligros.</p>
                  )}
                </Section>

                <Section title="Condiciones del entorno">
                  <div className="grid grid-cols-1 gap-2 text-sm text-slate-700 md:grid-cols-2">
                    <div><strong>Clima:</strong> {atsResult.environment?.weather || "-"}</div>
                    <div><strong>Temperatura:</strong> {atsResult.environment?.temperatureC ?? "-"}</div>
                    <div><strong>Humedad:</strong> {atsResult.environment?.humidityPct ?? "-"}</div>
                    <div><strong>Viento:</strong> {atsResult.environment?.wind || "-"}</div>
                    <div><strong>Iluminación:</strong> {atsResult.environment?.lighting || "-"}</div>
                    <div><strong>Terreno:</strong> {atsResult.environment?.terrain || "-"}</div>
                    <div><strong>Visibilidad:</strong> {atsResult.environment?.visibility || "-"}</div>
                  </div>
                </Section>
              </div>

              <Section title="Controles consolidados">
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <ListCard title="Ingeniería" items={atsResult.controls.engineering} />
                  <ListCard title="Administrativos" items={atsResult.controls.administrative} />
                  <ListCard title="EPP" items={atsResult.controls.ppe} />
                </div>
              </Section>

              <Section title="Pasos de la tarea">
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
                            <td className="px-3 py-2">{step.hazards?.join(", ") || "-"}</td>
                            <td className="px-3 py-2">{step.controls?.join(", ") || "-"}</td>
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
              </Section>

              <Section title="Procedimientos aplicados">
                {atsResult.procedure_influence?.applied?.length ? (
                  <ul className="space-y-2 text-sm text-slate-700">
                    {atsResult.procedure_influence.applied.map((p, idx) => (
                      <li key={`${p.code}-${idx}`} className="rounded-lg bg-slate-50 px-3 py-2">
                        <div className="font-medium">{p.title}</div>
                        <div className="text-xs text-slate-500">
                          Código: {p.code} · Origen: {p.origin}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">No hay procedimientos aplicados.</p>
                )}
              </Section>

              <Section title="Resultado del checklist">
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
                  <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {atsResult.checklist_actions.critical_fails.map((item, idx) => (
                      <li key={`${item}-${idx}`}>{item}</li>
                    ))}
                  </ul>
                ) : null}

                {atsResult.checklist_actions?.missing?.length ? (
                  <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {atsResult.checklist_actions.missing.map((item, idx) => (
                      <li key={`${item}-${idx}`}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </Section>

              <Section title="Referencias normativas usadas">
                {normsForView.length ? (
                  <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {normsForView.map((item, idx) => (
                      <li key={`${item}-${idx}`}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">No se registraron referencias normativas.</p>
                )}
              </Section>

              {rawResponse ? (
                <Section title="Respuesta cruda del backend">
                  <div className="overflow-auto rounded-xl border border-slate-200 bg-slate-950 p-4">
                    <pre className="whitespace-pre-wrap break-words text-xs text-slate-100">
{rawResponse}
                    </pre>
                  </div>
                </Section>
              ) : null}
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* =========================
   SUBCOMPONENTES
========================= */
function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  rows,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
      />
    </label>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4"
      />
      <span className="text-sm">{label}</span>
    </label>
  );
}

function Info({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 text-sm">
      <div className="font-semibold text-slate-700">{title}</div>
      <div>{value}</div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <h3 className="mb-2 text-lg font-semibold">{title}</h3>
      <div className="rounded-xl border border-slate-200 p-4">{children}</div>
    </div>
  );
}

function ListCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <h4 className="mb-2 font-semibold text-slate-800">{title}</h4>
      {items?.length ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          {items.map((item, idx) => (
            <li key={`${item}-${idx}`}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">Sin registros.</p>
      )}
    </div>
  );
}