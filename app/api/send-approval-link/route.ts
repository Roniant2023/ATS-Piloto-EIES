import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

export const runtime = "nodejs";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRole) {
    throw new Error("Faltan variables de Supabase");
  }

  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const token = String(body?.token || "").trim();

    if (!token) {
      return NextResponse.json(
        { ok: false, error: "token requerido" },
        { status: 400 }
      );
    }

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json(
        { ok: false, error: "Falta RESEND_API_KEY" },
        { status: 500 }
      );
    }

    const supabase = getSupabaseAdmin();
    const resend = new Resend(process.env.RESEND_API_KEY);

    const { data: linkRow, error } = await supabase
      .from("ats_approval_links")
      .select("*")
      .eq("token", token)
      .maybeSingle();

    if (error || !linkRow) {
      return NextResponse.json(
        { ok: false, error: "Link no encontrado" },
        { status: 404 }
      );
    }

    if (!linkRow.approver_email) {
      return NextResponse.json(
        { ok: false, error: "El aprobador no tiene correo" },
        { status: 400 }
      );
    }

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_VERCEL_URL ||
      "";

    if (!appUrl) {
      return NextResponse.json(
        { ok: false, error: "Falta NEXT_PUBLIC_APP_URL." },
        { status: 500 }
      );
    }

    const baseUrl = appUrl.startsWith("http")
      ? appUrl
      : `https://${appUrl}`;

    const approvalUrl = `${baseUrl}/ats/aprobar/${token}`;

    const emailRes = await resend.emails.send({
      from: "ATS <onboarding@resend.dev>",
      to: [linkRow.approver_email],
      subject: "Aprobación de ATS requerida",
      html: `
        <h2>Aprobación de ATS</h2>
        <p>Hola ${linkRow.approver_name || "Aprobador"},</p>
        <p>Tienes un ATS pendiente por aprobar.</p>

        <a href="${approvalUrl}" 
           style="display:inline-block;padding:12px 20px;background:#000;color:#fff;text-decoration:none;border-radius:6px;">
           Abrir ATS para aprobación
        </a>

        <p style="margin-top:16px;">
          Si no solicitaste esto, puedes ignorar el mensaje.
        </p>
      `,
    });

    if ((emailRes as any)?.error) {
      return NextResponse.json(
        { ok: false, error: "Error enviando correo" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Link enviado al correo del aprobador",
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 }
    );
  }
}