"use client";

import React, { useState } from "react";
import SignaturePadField from "../../../components/SignaturePadField";

export default function ApprovalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = React.use(params);

  const [approverName, setApproverName] = useState("");
  const [approverSignature, setApproverSignature] = useState("");
  const [sending, setSending] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [uiInfo, setUiInfo] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleApprove() {
    setUiError(null);
    setUiInfo(null);

    if (!token) {
      setUiError("Token inválido.");
      return;
    }

    if (!approverSignature) {
      setUiError("Debes registrar la firma.");
      return;
    }

    setSending(true);

    try {
      const res = await fetch("/api/approve-by-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token,
          approver_name: approverName.trim(),
          approver_signature: approverSignature,
        }),
      });

      const text = await res.text();
      let parsed: any = null;

      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }

      if (!res.ok || !parsed?.ok) {
        setUiError(parsed?.error || `Error aprobando ATS (HTTP ${res.status}).`);
        return;
      }

      setDone(true);
      setUiInfo("✅ ATS aprobado correctamente.");
    } catch (err: any) {
      setUiError(String(err?.message || err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Firma de aprobación ATS</h1>
        <div className="text-sm text-neutral-600">
          Completa la firma para aprobar el ATS de forma remota.
        </div>
      </div>

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

      {!done && (
        <section className="border rounded p-4 space-y-4 bg-white">
          <div>
            <label className="block text-sm font-medium mb-1">Nombre del aprobador</label>
            <input
              value={approverName}
              onChange={(e) => setApproverName(e.target.value)}
              placeholder="Ingrese su nombre"
              className="border p-2 rounded w-full"
            />
          </div>

          <SignaturePadField
            label="Firma del aprobador"
            value={approverSignature}
            onChange={setApproverSignature}
          />

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleApprove}
              disabled={sending}
              className="px-5 py-2 bg-black text-white rounded disabled:opacity-50"
            >
              {sending ? "Enviando..." : "Firmar y aprobar"}
            </button>
          </div>
        </section>
      )}

      {done && (
        <section className="border rounded p-4 bg-green-50 border-green-200">
          <div className="font-semibold text-green-800">Aprobación registrada</div>
          <div className="text-sm text-green-700 mt-1">
            Ya puedes cerrar esta página.
          </div>
        </section>
      )}
    </div>
  );
}