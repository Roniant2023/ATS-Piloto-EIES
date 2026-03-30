"use client";

import React, { useEffect, useRef, useState } from "react";
import SignatureCanvas from "react-signature-canvas";

type SignaturePadFieldProps = {
  label: string;
  value: string;
  onChange: (dataUrl: string) => void;
};

export default function SignaturePadField({
  label,
  value,
  onChange,
}: SignaturePadFieldProps) {
  const sigRef = useRef<SignatureCanvas | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [canvasWidth, setCanvasWidth] = useState(500);

  useEffect(() => {
    setIsReady(true);
  }, []);

  useEffect(() => {
    function updateCanvasSize() {
      if (!containerRef.current) return;
      const width = Math.max(320, Math.floor(containerRef.current.offsetWidth));
      setCanvasWidth(width);
    }

    updateCanvasSize();
    window.addEventListener("resize", updateCanvasSize);

    return () => {
      window.removeEventListener("resize", updateCanvasSize);
    };
  }, []);

  function handleClear() {
    sigRef.current?.clear();
    onChange("");
  }

  function handleSave() {
    if (!sigRef.current || sigRef.current.isEmpty()) {
      onChange("");
      return;
    }

    const dataUrl = sigRef.current.toDataURL("image/png");
    onChange(dataUrl);
  }

  return (
    <div className="border rounded p-3 space-y-3 bg-white">
      <div className="font-medium text-sm">{label}</div>

      <div
        ref={containerRef}
        className="border rounded bg-white overflow-hidden w-full"
      >
        {isReady && (
          <SignatureCanvas
            key={canvasWidth}
            ref={sigRef}
            penColor="black"
            canvasProps={{
              width: canvasWidth,
              height: 180,
              className: "block w-full h-[180px]",
            }}
          />
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleSave}
          className="px-3 py-2 bg-black text-white rounded text-sm"
        >
          Guardar firma
        </button>

        <button
          type="button"
          onClick={handleClear}
          className="px-3 py-2 border rounded text-sm"
        >
          Limpiar
        </button>
      </div>

      {value ? (
        <div className="border rounded p-2 bg-neutral-50">
          <div className="text-xs text-neutral-600 mb-2">Vista previa</div>
          <img
            src={value}
            alt="Firma capturada"
            className="max-h-[100px] w-auto object-contain"
          />
        </div>
      ) : (
        <div className="text-xs text-neutral-500">
          No hay firma guardada todavía.
        </div>
      )}
    </div>
  );
}