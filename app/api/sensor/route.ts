import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const { error } = await supabase.from("sensor_data").insert({
      state: body.state,
      temperature: body.temperature,
      humidity: body.humidity,
      gas: body.gas,
      gas_bar: body.gasBar,
      light: body.light,
      is_dark: body.isDark,
      motion: body.motion,
      occupied: body.occupied,
      motion_led: body.motionLed,
      room_light: body.roomLight,
      buzzer: body.buzzer,
    });

    if (error) {
      console.error(error);

      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
    });
  } catch (err) {
    console.error(err);

    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
}

export async function GET() {
  const { data, error } = await supabase
    .from("sensor_data")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    console.error(error);

    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    latest: data?.[0] ?? null,
    history: data ?? [],
  });
}
