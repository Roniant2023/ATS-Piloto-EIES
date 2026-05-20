"use client";

import { useEffect, useState, use } from "react";
import { createClient } from "@supabase/supabase-js";
import SignaturePadField from "../../../components/SignaturePadField";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

type Props = {
  params: Promise<{
    token: string;
  }>;
};

export default function ExecutantSignPage({ params }: Props) {
  const { token } = use(params);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [recordId, setRecordId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [signature, setSignature] = useState("");

  const [signed, setSigned] = useState(false);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadRecord();
  }, []);

  async function loadRecord() {
  try {
    setLoading(true);
    setError(null);

    const res = await fetch("/api/get-executant-signature", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token }),
    });

    const json = await res.json();

    if (!res.ok) {
      setError(json.error || "Error consultando firma.");
      return;
    }

    const data = json.data;

    if (!data) {
      setError("Link inválido o expirado.");
      return;
    }

    setRecordId(data.id);

    if (data.name) setName(data.name);
    if (data.role) setRole(data.role);
    if (data.document_id) setDocumentId(data.document_id);

    if (data.signature_data) {
      setSignature(data.signature_data);
    }

    if (data.status === "signed") {
      setSigned(true);
    }
  } catch (err: any) {
    setError(err?.message || "Error cargando firma.");
  } finally {
    setLoading(false);
  }
}  async function handleSign() {
    try {
      setSaving(true);
      setError(null);

      if (!name.trim()) {
        setError("Nombre requerido.");
        return;
      }

      if (!signature) {
        setError("Firma requerida.");
        return;
      }

      const res = await fetch("/api/sign-executant", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    token,
    name,
    role,
    documentId,
    signature,
  }),
});

const json = await res.json();

if (!res.ok || !json?.ok) {
  setError(json?.error || "Error guardando firma.");
  return;
}
   

      setSigned(true);
    } catch (err: any) {
      setError(err?.message || "Error guardando firma.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        Cargando...
      </div>
    );
  }

  if (signed) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="border rounded p-6 max-w-md w-full bg-white">
          <div className="text-xl font-semibold text-green-700">
            ✅ Firma registrada
          </div>

          <div className="mt-2 text-sm text-neutral-700">
            Gracias. Tu firma fue registrada correctamente en el ATS.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-100 p-6 flex items-center justify-center">
      <div className="bg-white border rounded p-6 w-full max-w-xl space-y-4">
        <div>
          <div className="text-xl font-semibold">
            Firma de ejecutante
          </div>

          <div className="text-sm text-neutral-600 mt-1">
            Completa la información y registra tu firma.
          </div>
        </div>

        {error && (
          <div className="border border-red-300 bg-red-50 text-red-700 p-3 rounded text-sm">
            {error}
          </div>
        )}

        <input
          type="text"
          placeholder="Nombre completo"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="border p-2 rounded w-full"
        />

        <input
          type="text"
          placeholder="Cargo / Rol"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="border p-2 rounded w-full"
        />

        <input
          type="text"
          placeholder="Documento"
          value={documentId}
          onChange={(e) => setDocumentId(e.target.value)}
          className="border p-2 rounded w-full"
        />

        <SignaturePadField
          label="Firma"
          value={signature}
          onChange={setSignature}
        />

        <button
          type="button"
          onClick={handleSign}
          disabled={saving}
          className="w-full bg-black text-white py-3 rounded disabled:opacity-50"
        >
          {saving ? "Guardando..." : "Firmar ATS"}
        </button>
      </div>
    </div>
  );
}