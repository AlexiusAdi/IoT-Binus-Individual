// app/api/sensor/route.ts
// ESP32 POSTs JSON here every 2 seconds
// Dashboard GETs the latest reading

import { NextRequest, NextResponse } from "next/server";

// In-memory store (swap for a DB like Supabase/Postgres in production)
let latestData: Record<string, unknown> | null = null;
const history: Record<string, unknown>[] = [];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const entry = { ...body, receivedAt: new Date().toISOString() };
    latestData = entry;
    history.push(entry);
    if (history.length > 100) history.shift(); // keep last 100
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
}

export async function GET() {
  if (!latestData) {
    return NextResponse.json({ error: "No data yet" }, { status: 503 });
  }
  return NextResponse.json({ latest: latestData, history: history.slice(-30) });
}
