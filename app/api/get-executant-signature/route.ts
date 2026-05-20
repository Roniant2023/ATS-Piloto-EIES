import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const token = body?.token;

    if (!token) {
      return NextResponse.json(
        { error: "Token requerido." },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("ats_executant_signatures")
      .select("*")
      .eq("token", token)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      data,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Error interno." },
      { status: 500 }
    );
  }
}