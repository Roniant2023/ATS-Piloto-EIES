"use client";

import React, { useEffect, useState } from "react";
import SignaturePadField from "../../../components/SignaturePadField";

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

export default function ApprovalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const [token, setToken] = useState("");
  const [approverName, setApproverName] = useState("");
  const [approverSignature, setApproverSignature] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [uiError, setUiError] = useState<string | null>(null);
  const [uiInfo, setUiInfo] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [atsPreview, setAtsPreview] = useState<any>(null);
  const [linkInfo, setLinkInfo] = useState<any>(null);

  const [otp, setOtp] = useState("");
  const [sendingOtp, setSendingOtp] = useState(false);
  const [validatingOtp, setValidatingOtp] = useState(false);
  const [otpValidated, setOtpValidated] = useState(false);

  useEffect(() => {
    let active = true;

    async function init() {
      try {
        const resolved = await params;
        if (!active) return;

        const tk = resolved?.token || "";
        setToken(tk);

        if (!tk) {
          setUiError("Token inválido.");
          setLoadingPreview(false);
          return;
        }

        const res = await fetch(`/api/get-approval-preview?token=${tk}`, {
          method: "GET",
          cache: "no-store",
        });

        const text = await res.text();
        let parsed: any = null;

        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }

        if (!res.ok || !parsed?.ok) {
          setUiError(parsed?.error || `Error cargando ATS (HTTP ${res.status}).`);
          setLoadingPreview(false);
          return;
        }

        const atsJson = parsed?.ats_record?.ats_json || null;
        setAtsPreview(atsJson);
        setLinkInfo(parsed?.approval_link || null);
        setOtpValidated(!!parsed?.approval_link?.access_validated);

        const suggestedApproverName =
          parsed?.approval_link?.approver_name ||
          atsJson?.estrella_format?.authorizations?.approver?.name ||
          "";

        if (suggestedApproverName) {
          setApproverName(suggestedApproverName);
        }
      } catch (err: any) {
        setUiError(String(err?.message || err));
      } finally {
        if (active) setLoadingPreview(false);
      }
    }

    init();

    return () => {
      active = false;
    };
  }, [params]);

  async function handleSendOtp() {
    setUiError(null);
    setUiInfo(null);

    if (!token) {
      setUiError("Token inválido.");
      return;
    }

    setSendingOtp(true);

    try {
      const res = await fetch("/api/send-approval-otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token }),
      });

      const text = await res.text();
      let parsed: any = null;

      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }

      if (!res.ok || !parsed?.ok) {
        setUiError(parsed?.error || `Error enviando OTP (HTTP ${res.status}).`);
        return;
      }

      setUiInfo("✅ Te enviamos un código de verificación al correo del aprobador.");
    } catch (err: any) {
      setUiError(String(err?.message || err));
    } finally {
      setSendingOtp(false);
    }
  }

  async function handleValidateOtp() {
    setUiError(null);
    setUiInfo(null);

    if (!token) {
      setUiError("Token inválido.");
      return;
    }

    if (!otp.trim()) {
      setUiError("Debes ingresar el código OTP.");
      return;
    }

    setValidatingOtp(true);

    try {
      const res = await fetch("/api/validate-approval-otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token,
          otp: otp.trim(),
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
        setUiError(parsed?.error || `Error validando OTP (HTTP ${res.status}).`);
        return;
      }

      setOtpValidated(true);
      setUiInfo("✅ Código validado correctamente. Ya puedes firmar.");
    } catch (err: any) {
      setUiError(String(err?.message || err));
    } finally {
      setValidatingOtp(false);
    }
  }

  async function handleApprove() {
    setUiError(null);
    setUiInfo(null);

    if (!token) {
      setUiError("Token inválido.");
      return;
    }

    if (!otpValidated) {
      setUiError("Primero debes validar el código OTP.");
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

  const hazards = uniqueNonEmpty(atsPreview?.hazards);
  const controls = uniqueNonEmpty([
    ...(atsPreview?.controls?.engineering || []),
    ...(atsPreview?.controls?.administrative || []),
    ...(atsPreview?.controls?.ppe || []),
  ]);
  const steps = Array.isArray(atsPreview?.steps) ? atsPreview.steps : [];

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Firma de aprobación ATS</h1>
        <div className="text-sm text-neutral-600">
          Revisa el ATS antes de registrar la aprobación remota.
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

      {loadingPreview ? (
        <section className="border rounded p-4 bg-white">
          <div className="text-sm text-neutral-600">Cargando ATS...</div>
        </section>
      ) : atsPreview ? (
        <section className="border rounded p-4 bg-white space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs text-neutral-500">ATS asociado al link</div>
              <div className="text-lg font-semibold">
                {atsPreview?.meta?.title || "ATS"}
              </div>
              <div className="text-sm text-neutral-700 mt-1">
                {atsPreview?.meta?.company ? `${atsPreview.meta.company} — ` : ""}
                {atsPreview?.meta?.location || ""}
                {atsPreview?.meta?.date ? ` — ${atsPreview.meta.date}` : ""}
                {atsPreview?.meta?.shift ? ` — ${atsPreview.meta.shift}` : ""}
              </div>
            </div>

            <div className="text-sm text-neutral-700">
              Estado link:{" "}
              <b>{linkInfo?.status === "signed" ? "Firmado" : "Pendiente"}</b>
            </div>
          </div>

          <div className="border rounded p-3 bg-blue-50">
            <div className="font-medium mb-2">Validación de acceso</div>
            <div className="text-sm text-neutral-700">
              Para firmar este ATS primero debes validar un código OTP enviado al correo del aprobador.
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleSendOtp}
                disabled={sendingOtp || otpValidated}
                className="px-4 py-2 bg-black text-white rounded disabled:opacity-50"
              >
                {sendingOtp ? "Enviando OTP..." : otpValidated ? "OTP validado" : "Enviar OTP al correo"}
              </button>
            </div>

            {!otpValidated && (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
                <input
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  placeholder="Ingrese el código OTP"
                  className="border p-2 rounded"
                />
                <button
                  type="button"
                  onClick={handleValidateOtp}
                  disabled={validatingOtp}
                  className="px-4 py-2 border rounded disabled:opacity-50"
                >
                  {validatingOtp ? "Validando..." : "Validar OTP"}
                </button>
              </div>
            )}

            {otpValidated && (
              <div className="mt-3 text-sm text-green-700 font-medium">
                ✅ Acceso validado correctamente.
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border rounded p-3 bg-neutral-50">
              <div className="font-medium mb-2">Peligros identificados</div>
              {hazards.length ? (
                <ul className="list-disc pl-5 text-sm space-y-1">
                  {hazards.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-sm text-neutral-600">—</div>
              )}
            </div>

            <div className="border rounded p-3 bg-neutral-50">
              <div className="font-medium mb-2">Controles clave</div>
              {controls.length ? (
                <ul className="list-disc pl-5 text-sm space-y-1">
                  {controls.slice(0, 12).map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-sm text-neutral-600">—</div>
              )}
            </div>
          </div>

          <div className="border rounded p-3 bg-neutral-50">
            <div className="font-medium mb-2">Pasos del trabajo</div>
            {steps.length ? (
              <ol className="list-decimal pl-5 text-sm space-y-2">
                {steps.map((s: any, i: number) => (
                  <li key={i}>{String(s?.step || `Paso ${i + 1}`)}</li>
                ))}
              </ol>
            ) : (
              <div className="text-sm text-neutral-600">—</div>
            )}
          </div>

          <div className="border rounded p-3 bg-neutral-50">
            <div className="font-medium mb-2">Supervisor</div>
            <div className="text-sm">
              <div>
                <b>Nombre:</b>{" "}
                {atsPreview?.estrella_format?.authorizations?.supervisor?.name || "—"}
              </div>
              <div>
                <b>Función:</b>{" "}
                {atsPreview?.estrella_format?.authorizations?.supervisor?.role || "—"}
              </div>
            </div>

            {atsPreview?.estrella_format?.authorizations?.supervisor?.signature && (
              <div className="mt-3 border rounded p-2 bg-white inline-block">
                <div className="text-xs text-neutral-600 mb-2">Firma del supervisor</div>
                <img
                  src={atsPreview.estrella_format.authorizations.supervisor.signature}
                  alt="Firma supervisor"
                  className="max-h-[100px] w-auto object-contain"
                />
              </div>
            )}
          </div>
        </section>
      ) : null}

      {!done && !loadingPreview && atsPreview && otpValidated && (
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