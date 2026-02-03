export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fs from "fs";
import path from "path";

type Branding = {
  company?: string;
  project?: string;
  atsCode?: string;
};

function safeText(s: unknown) {
  return String(s ?? "")
    .replaceAll("☐", "[ ]")
    .replaceAll("•", "-");
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const ats = body?.ats ?? body;
    const branding: Branding = body?.branding ?? {};

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // ===== Layout =====
    const marginX = 40;
    const topMargin = 50;
    const bottomMargin = 60;
    const lineGap = 4;

    const pageSize = { width: 595.28, height: 841.89 }; // A4
    let page = pdfDoc.addPage([pageSize.width, pageSize.height]);
    let y = pageSize.height - topMargin;

    const maxWidth = pageSize.width - marginX * 2;

    const newPage = () => {
      page = pdfDoc.addPage([pageSize.width, pageSize.height]);
      y = pageSize.height - topMargin;
    };

    const ensureSpace = (needed: number) => {
      if (y - needed < bottomMargin) newPage();
    };

    const wrapLines = (text: string, size: number, usedFont = font) => {
      const words = safeText(text).split(/\s+/).filter(Boolean);
      const lines: string[] = [];
      let line = "";

      for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        const width = usedFont.widthOfTextAtSize(test, size);
        if (width <= maxWidth) line = test;
        else {
          if (line) lines.push(line);
          line = w;
        }
      }
      if (line) lines.push(line);
      return lines;
    };

    const drawParagraph = (text: string, size = 10, usedFont = font, x = marginX) => {
      const lines = wrapLines(text, size, usedFont);
      const heightNeeded = lines.length * (size + lineGap);
      ensureSpace(heightNeeded);

      for (const ln of lines) {
        page.drawText(ln, { x, y, size, font: usedFont, color: rgb(0, 0, 0) });
        y -= size + lineGap;
      }
    };

    const drawLabelValue = (label: string, value: string) => {
      drawParagraph(label, 11, fontBold);
      drawParagraph(value, 10, font);
      y -= 6;
    };

    /* =========================
       HEADER CORPORATIVO (FIX)
       ========================= */
    const headerBlockHeight = 70; // reserva fija para logo+texto
    const headerTopY = pageSize.height - topMargin; // y inicial del bloque
    const headerBottomY = headerTopY - headerBlockHeight;

    // Logo (opcional)
    let drewLogo = false;
    const logoW = 120;
    const logoH = 40;

    try {
      const logoPath = path.join(process.cwd(), "public", "logo.png");
      if (fs.existsSync(logoPath)) {
        const logoBytes = fs.readFileSync(logoPath);
        const logoImg = await pdfDoc.embedPng(logoBytes);

        // Colocar el logo DENTRO del bloque, pegado arriba, sin tocar el texto
        page.drawImage(logoImg, {
          x: marginX,
          y: headerTopY - logoH, // parte superior del bloque
          width: logoW,
          height: logoH
        });
        drewLogo = true;
      }
    } catch {
      // silencioso
    }

    // Texto del header a la derecha del logo (si hay)
    const headerX = drewLogo ? marginX + logoW + 20 : marginX;
    const headerTextMaxWidth = pageSize.width - marginX - headerX;

    // Dibujar header con control de ancho (wrap) SIN afectar y global todavía
    const drawHeaderLine = (text: string, size: number, usedFont = fontBold, offsetY: number) => {
      const t = safeText(text);
      if (!t) return;

      // wrap con ancho del header
      const words = t.split(/\s+/).filter(Boolean);
      const lines: string[] = [];
      let line = "";

      for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        const width = usedFont.widthOfTextAtSize(test, size);
        if (width <= headerTextMaxWidth) line = test;
        else {
          if (line) lines.push(line);
          line = w;
        }
      }
      if (line) lines.push(line);

      // pintar líneas dentro del bloque
      let yy = headerTopY - offsetY;
      for (const ln of lines) {
        page.drawText(ln, { x: headerX, y: yy, size, font: usedFont, color: rgb(0, 0, 0) });
        yy -= size + 2;
      }
    };

    // Pintar líneas del header (sin traslape con logo)
    // offsetY: distancia desde la parte superior del bloque
    drawHeaderLine(branding.company ?? "", 11, fontBold, 2);
    drawHeaderLine(branding.project ? `Proyecto: ${branding.project}` : "", 10, font, 18);
    drawHeaderLine(branding.atsCode ? `Código ATS: ${branding.atsCode}` : "", 10, font, 32);

    // Línea separadora opcional debajo del header
    page.drawLine({
      start: { x: marginX, y: headerBottomY - 6 },
      end: { x: pageSize.width - marginX, y: headerBottomY - 6 },
      thickness: 1,
      color: rgb(0.85, 0.85, 0.85)
    });

    // Ahora sí: arrancamos el contenido debajo del bloque del header
    y = headerBottomY - 18;

    /* ===== Título principal ===== */
    drawParagraph("ANÁLISIS DE TRABAJO SEGURO (ATS)", 16, fontBold);
    y -= 8;

    /* ===== Meta ===== */
    drawParagraph(`Fecha: ${ats?.meta?.date ?? "N/A"}`, 10, font);
    drawParagraph(`Estado: ${(ats?.meta?.status ?? "N/A").toString().toUpperCase()}`, 10, font);
    y -= 10;

    /* ===== Condiciones ===== */
    drawParagraph("Condiciones del trabajo", 12, fontBold);
    drawParagraph(`Izaje: ${ats?.conditions?.lifting ? "Sí" : "No"}`, 10, font);
    drawParagraph(`Trabajo en caliente: ${ats?.conditions?.hot_work ? "Sí" : "No"}`, 10, font);
    drawParagraph(`Trabajo en alturas: ${ats?.conditions?.work_at_height ? "Sí" : "No"}`, 10, font);
    y -= 10;

    /* ===== Permisos ===== */
    drawParagraph("Permisos requeridos", 12, fontBold);
    (ats?.permits?.required ?? []).forEach((p: string) => drawParagraph(`- ${p}`, 10, font));
    y -= 10;

    /* ===== EPP ===== */
    drawParagraph("EPP obligatorio", 12, fontBold);
    (ats?.ppe?.mandatory ?? []).forEach((p: string) => drawParagraph(`- ${p}`, 10, font));
    y -= 10;

    /* ===== STOP WORK ===== */
    drawParagraph("Criterios STOP WORK", 12, fontBold);
    (ats?.risk_screening?.stop_work_triggers ?? []).forEach((s: string) =>
      drawParagraph(`- ${s}`, 10, font)
    );
    y -= 10;

    /* ===== Pasos ===== */
    drawParagraph("Pasos del trabajo", 12, fontBold);

    (ats?.steps ?? []).forEach((step: any) => {
      y -= 4;
      drawParagraph(`Paso ${step.step_no}: ${step.action}`, 11, fontBold);

      const hazards = Array.isArray(step.hazards) ? step.hazards.join(", ") : "";
      const risks = Array.isArray(step.risks) ? step.risks.join(", ") : "";
      const controls = Array.isArray(step.controls) ? step.controls.map((c: any) => c.text).join(" | ") : "";
      const verification = Array.isArray(step.verification) ? step.verification.join(", ") : "";

      if (hazards) drawLabelValue("Peligros", hazards);
      if (risks) drawLabelValue("Riesgos", risks);
      if (controls) drawLabelValue("Controles", controls);
      if (verification) drawLabelValue("Verificación", verification);
    });

    /* ===== Checklist en nueva página ===== */
    newPage();

    drawParagraph("Checklist - Antes", 12, fontBold);
    (ats?.checklists?.before ?? []).forEach((i: string) => drawParagraph(`[ ] ${i}`, 10, font));
    y -= 10;

    drawParagraph("Checklist - Durante", 12, fontBold);
    (ats?.checklists?.during ?? []).forEach((i: string) => drawParagraph(`[ ] ${i}`, 10, font));
    y -= 10;

    drawParagraph("Checklist - Después", 12, fontBold);
    (ats?.checklists?.after ?? []).forEach((i: string) => drawParagraph(`[ ] ${i}`, 10, font));
    y -= 20;

    /* ===== Firmas ===== */
    drawParagraph("__________________________        __________________________", 10, font);
    drawParagraph("Supervisor                          HSEQ", 10, font);

    /* ===== Pie de página (última página) ===== */
    page.drawText("Documento generado automáticamente por ATS Inteligente", {
      x: marginX,
      y: 30,
      size: 8,
      font,
      color: rgb(0.5, 0.5, 0.5)
    });

    const pdfBytes = await pdfDoc.save();

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="ATS.pdf"',
        "Cache-Control": "no-store"
      }
    });
  } catch (err: any) {
    console.error("PDF HEADER FIX ERROR:", err);
    return NextResponse.json(
      { error: "Error generando PDF", details: String(err?.message || err) },
      { status: 500 }
    );
  }
}