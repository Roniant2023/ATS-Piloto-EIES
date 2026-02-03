"use client";

export default function TestUI() {
  return (
    <main style={{ padding: 30, fontFamily: "Arial" }}>
      <div style={{ background: "yellow", padding: 12, fontWeight: 900 }}>
        TEST-UI VISIBLE ✅ (si ves esto, estás en el proyecto correcto)
      </div>

      <button
        style={{
          marginTop: 20,
          padding: "10px 14px",
          borderRadius: 8,
          border: "1px solid #333",
          cursor: "pointer"
        }}
        onClick={() => {
          alert("CLICK OK ✅");
          console.log("CLICK OK ✅");
        }}
      >
        Probar Click
      </button>
    </main>
  );
}