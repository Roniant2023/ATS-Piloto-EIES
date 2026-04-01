import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

export const runtime = "nodejs";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRole) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const token = String(body?.token || "").trim();

    if (!token) {
      return NextResponse.json(
        { ok: false, error: "token es requerido." },
        { status: 400 }
      );
    }

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json(
        { ok: false, error: "Falta RESEND_API_KEY." },
        { status: 500 }
      );
    }

    const fromEmail = process.env.RESEND_FROM_EMAIL || "ATS <onboarding@resend.dev>";

    const supabase = getSupabaseAdmin();
    const resend = new Resend(process.env.RESEND_API_KEY);

    const { data: linkRow, error: linkError } = await supabase
      .from("ats_approval_links")
      .select("*")
      .eq("token", token)
      .maybeSingle();

    if (linkError) {
      return NextResponse.json(
        { ok: false, error: linkError.message },
        { status: 500 }
      );
    }

    if (!linkRow) {
      return NextResponse.json(
        { ok: false, error: "Link no encontrado." },
        { status: 404 }
      );
    }

    if (linkRow.status === "signed") {
      return NextResponse.json(
        { ok: false, error: "Este link ya fue utilizado." },
        { status: 400 }
      );
    }

    if (linkRow.expires_at && new Date(linkRow.expires_at).getTime() < Date.now()) {
      return NextResponse.json(
        { ok: false, error: "El link expiró." },
        { status: 400 }
      );
    }

    if (!linkRow.approver_email) {
      return NextResponse.json(
        { ok: false, error: "El aprobador no tiene correo configurado." },
        { status: 400 }
      );
    }

    const otp = generateOtp();
    const otpExpiresAt = new Date(Date.now() + 1000 * 60 * 10).toISOString();

    const { error: updateError } = await supabase
      .from("ats_approval_links")
      .update({
        otp_code: otp,
        otp_expires_at: otpExpiresAt,
        otp_sent_at: new Date().toISOString(),
        access_validated: false,
      })
      .eq("id", linkRow.id);

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: updateError.message },
        { status: 500 }
      );
    }

    const approverName = linkRow.approver_name || "Aprobador";

    const emailRes = await resend.emails.send({
      from: fromEmail,
      to: [linkRow.approver_email],
      subject: "Código de verificación para aprobación de ATS",
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.5;">
          <h2>Código de verificación ATS</h2>
          <p>Hola ${approverName},</p>
          <p>Tu código de verificación para aprobar el ATS es:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 4px; margin: 16px 0;">
            ${otp}
          </div>
          <p>Este código vence en 10 minutos.</p>
          <p>Si no solicitaste esta validación, puedes ignorar este correo.</p>
        </div>
      `,
    });

    if ((emailRes as any)?.error) {
      return NextResponse.json(
        {
          ok: false,
          error: (emailRes as any).error.message || "No se pudo enviar el correo.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "OTP enviado correctamente al correo del aprobador.",
      otp_expires_at: otpExpiresAt,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}