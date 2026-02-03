"use client";

import { useMemo, useState } from "react";

export default function ATSPage() {
  const [lifting, setLifting] = useState(false);
  const [hotWork, setHotWork] = useState(false);
  const [workAtHeight, setWorkAtHeight] = useState(false);

  const [procedureFile, setProcedureFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<string>("Selecciona un archivo PDF/DOCX.");
  const [processing, setProcessing] = useState(false);

  // Para “limpiar” el input visualmente al quitar archivo:
  const inputKey = useMemo(() => String(procedureFile ? procedureFile.name : "no-file"), [procedureFile]);

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] || null;

    setProcedureFile(f);

    if (!f) {
      setMsg("No se seleccionó archivo.");
      return;
    }

    setMsg(`✅ Archivo seleccionado: ${f.name} (${(f.size / 1024 / 1024).toFixed(2)} MB)`);
    console.log("FILE SELECTED:", { name: f.name, type: f.type, size: f.size });
  }

  function clearFile() {
    setProcedureFile(null);
    setMsg("Archivo removido. Selecciona un PDF/DOCX.");
  }

  async function processProcedure() {
    if (!procedureFile) {
      setMsg("❌ No hay archivo seleccionado. Primero elige un PDF/DOCX.");
      return;
    }

    setProcessing(true);
    setMsg("⏳ Enviando archivo a /api/procedure-brief ...");

    try {
      const fd = new FormData();
      fd.append("file", procedureFile);

      // Opcional (si tu endpoint lo usa, si no, no afecta)
      fd.append("origin", "Corporativo");
      fd.append("title", procedureFile.name.replace(/\.[^.]+$/, ""));
      fd.append("code", "");

      const res = await fetch("/api/procedure-brief", {
        method: "POST",
        body: fd,
      });

      const text = await res.text();
      console.log("procedure-brief status:", res.status);
      console.log("procedure-brief raw:", text);

      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch {
        // si no es JSON, igual lo mostramos abajo
      }

      if (!res.ok) {
        setMsg(`❌ Error HTTP ${res.status}: ${data?.details || data?.error || text}`);
        setProcessing(false);
        return;
      }

      // Si todo OK:
      if (data?.procedure_ref) {
        setMsg("✅ Procedimiento procesado. (procedure_ref recibido)");
        console.log("procedure_ref:", data.procedure_ref);
      } else {
        setMsg("⚠️ Respondió OK pero no vino procedure_ref. Revisa consola.");
      }

      setProcessing(false);
    } catch (err: any) {
      console.error(err);
      setMsg("❌ Error de red llamando al backend.");
      setProcessing(false);
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 980, margin: "0 auto", fontFamily: "Arial, sans-serif" }}>
      <div style={{ background: "yellow", padding: 10, fontWeight: 900, borderRadius: 10 }}>
        ATS /ats — UI UPLOAD (OK)
      </div>

      <div style={{ marginTop: 10, padding: 10, borderRadius: 10, border: "1px solid #b9d8ff", background: "#eef6ff" }}>
        {msg}
      </div>

      <section style={{ marginTop: 14, padding: 14, borderRadius: 12, border: "1px solid #ddd" }}>
        <h2 style={{ marginTop: 0 }}>1) Condiciones</h2>

        <label style={{ display: "block", marginBottom: 6 }}>
          <input type="checkbox" checked={lifting} onChange={(e) => setLifting(e.target.checked)} /> Izaje
        </label>

        <label style={{ display: "block", marginBottom: 6 }}>
          <input type="checkbox" checked={hotWork} onChange={(e) => setHotWork(e.target.checked)} /> Trabajo en caliente
        </label>

        <label style={{ display: "block" }}>
          <input type="checkbox" checked={workAtHeight} onChange={(e) => setWorkAtHeight(e.target.checked)} /> Trabajo en alturas
        </label>
      </section>

      <section style={{ marginTop: 14, padding: 14, borderRadius: 12, border: "1px solid #ddd" }}>
        <h2 style={{ marginTop: 0 }}>2) Procedimiento (PDF/DOCX)</h2>

        <input
          key={inputKey}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={onPickFile}
        />

        <div style={{ marginTop: 10, fontSize: 13 }}>
          <b>Archivo:</b> {procedureFile ? procedureFile.name : "(ninguno)"}
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={processProcedure}
            disabled={!procedureFile || processing}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #111",
              background: !procedureFile ? "#ddd" : "#111",
              color: !procedureFile ? "#666" : "#fff",
              cursor: !procedureFile ? "not-allowed" : "pointer",
            }}
          >
            {processing ? "Procesando..." : "Procesar procedimiento"}
          </button>

          <button
            type="button"
            onClick={clearFile}
            disabled={!procedureFile || processing}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #ccc",
              background: "#f5f5f5",
              cursor: !procedureFile ? "not-allowed" : "pointer",
            }}
          >
            Quitar archivo
          </button>
        </div>
      </section>
    </main>
  );
}
