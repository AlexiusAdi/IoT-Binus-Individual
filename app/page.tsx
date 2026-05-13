"use client";

import { useState, useEffect, useCallback } from "react";
import { toast, Toaster } from "sonner";
import { supabase } from "@/lib/supabase";

// ── Types ──────────────────────────────────────────────────────────────────
type RoomState = "IDLE" | "OCCUPIED" | "WARNING" | "DANGER";

interface SensorData {
  state: RoomState;
  temperature: number;
  humidity: number;
  gas: number;
  gasBar: number;
  light: number;
  isDark: boolean;
  motion: boolean;
  occupied: boolean;
  motionLed: boolean;
  roomLight: boolean;
  buzzer: boolean;
  timestamp: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────
const STATE_CONFIG: Record<
  RoomState,
  { bg: string; text: string; dot: string; label: string }
> = {
  IDLE: {
    bg: "bg-slate-100",
    text: "text-slate-500",
    dot: "bg-slate-400",
    label: "Idle",
  },
  OCCUPIED: {
    bg: "bg-sage-100",
    text: "text-sage-700",
    dot: "bg-sage-500",
    label: "Occupied",
  },
  WARNING: {
    bg: "bg-amber-50",
    text: "text-amber-700",
    dot: "bg-amber-400",
    label: "Warning",
  },
  DANGER: {
    bg: "bg-rose-50",
    text: "text-rose-700",
    dot: "bg-rose-500",
    label: "Danger",
  },
};

function timeStr() {
  return new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ── Mini sparkline (SVG) ───────────────────────────────────────────────────
function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 120,
    h = 36;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="opacity-70">
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Gauge arc ─────────────────────────────────────────────────────────────
function GaugeArc({
  value,
  max,
  color,
}: {
  value: number;
  max: number;
  color: string;
}) {
  const pct = Math.min(value / max, 1);
  const r = 44,
    cx = 52,
    cy = 52;
  const startAngle = -210,
    endAngle = 30;
  const totalAngle = endAngle - startAngle;
  const angle = startAngle + totalAngle * pct;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const arcX = (a: number) => cx + r * Math.cos(toRad(a));
  const arcY = (a: number) => cy + r * Math.sin(toRad(a));
  const largeArc = totalAngle * pct > 180 ? 1 : 0;
  const bgLarge = totalAngle > 180 ? 1 : 0;
  return (
    <svg width="104" height="72" viewBox="0 0 104 72">
      <path
        d={`M ${arcX(startAngle)} ${arcY(startAngle)} A ${r} ${r} 0 ${bgLarge} 1 ${arcX(endAngle)} ${arcY(endAngle)}`}
        fill="none"
        stroke="#e2e8f0"
        strokeWidth="8"
        strokeLinecap="round"
      />
      {pct > 0 && (
        <path
          d={`M ${arcX(startAngle)} ${arcY(startAngle)} A ${r} ${r} 0 ${largeArc} 1 ${arcX(angle)} ${arcY(angle)}`}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

// ── Gas bar indicator ──────────────────────────────────────────────────────
function GasBar({ level }: { level: number }) {
  const colors = [
    "bg-emerald-300",
    "bg-lime-300",
    "bg-yellow-300",
    "bg-orange-400",
    "bg-rose-400",
  ];
  return (
    <div className="flex gap-1.5 items-end h-8">
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          className={`rounded-sm transition-all duration-500 ${i < level ? colors[i] : "bg-slate-200"}`}
          style={{ width: 14, height: 8 + i * 5 }}
        />
      ))}
    </div>
  );
}

// ── Status banner shown when ESP32 hasn't posted yet ──────────────────────
function WaitingBanner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f7f5f2]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-sage border-t-transparent animate-spin" />
        <p className="text-sm text-slate-400 font-medium tracking-wide">
          Waiting for ESP32 data…
        </p>
        <p className="text-xs text-slate-300">
          Make sure the ESP32 is running and pointing at this server.
        </p>
      </div>
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────
export default function Dashboard() {
  const [data, setData] = useState<SensorData | null>(null);
  const [history, setHistory] = useState<SensorData[]>([]);
  const [lastState, setLastState] = useState<RoomState | null>(null);
  // "waiting" = no data from ESP32 yet; "live" = receiving real data; "error" = fetch failed
  const [feedStatus, setFeedStatus] = useState<"waiting" | "live" | "error">(
    "waiting",
  );

  const pushAlert = useCallback(
    (message: string, type: "danger" | "warning" | "info") => {
      if (type === "danger") {
        toast.error(message, {
          description: timeStr(),
          duration: 8000,
          icon: "🚨",
        });
      } else if (type === "warning") {
        toast.warning(message, {
          description: timeStr(),
          duration: 6000,
          icon: "⚠️",
        });
      } else {
        toast.info(message, {
          description: timeStr(),
          duration: 4000,
          icon: "ℹ️",
        });
      }
    },
    [],
  );

  useEffect(() => {
    // Initial fetch for latest + history
    const loadInitialData = async () => {
      try {
        const res = await fetch("/api/sensor");

        if (!res.ok) {
          setFeedStatus("error");
          return;
        }

        const json = await res.json();

        const formattedHistory: SensorData[] = (json.history || []).map(
          (row: any) => ({
            state: row.state,
            temperature: row.temperature,
            humidity: row.humidity,
            gas: row.gas,
            gasBar: row.gas_bar,
            light: row.light,
            isDark: row.is_dark,
            motion: row.motion,
            occupied: row.occupied,
            motionLed: row.motion_led,
            roomLight: row.room_light,
            buzzer: row.buzzer,
            timestamp: row.created_at,
          }),
        );

        if (formattedHistory.length > 0) {
          setHistory(formattedHistory);

          setData(formattedHistory[formattedHistory.length - 1]);

          setFeedStatus("live");
        }
      } catch (err) {
        console.error(err);
        setFeedStatus("error");
      }
    };

    loadInitialData();

    // Realtime subscription
    const channel = supabase
      .channel("sensor-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "sensor_data",
        },
        (payload) => {
          const row = payload.new;

          const normalised: SensorData = {
            state: row.state,
            temperature: row.temperature,
            humidity: row.humidity,
            gas: row.gas,
            gasBar: row.gas_bar,
            light: row.light,
            isDark: row.is_dark,
            motion: row.motion,
            occupied: row.occupied,
            motionLed: row.motion_led,
            roomLight: row.room_light,
            buzzer: row.buzzer,
            timestamp: row.created_at,
          };

          setFeedStatus("live");

          setData(normalised);

          setHistory((prev) => [...prev.slice(-29), normalised]);

          // Alerts
          setLastState((prev) => {
            if (prev !== normalised.state) {
              if (normalised.state === "DANGER") {
                pushAlert("⚡ DANGER — Gas or high temp detected!", "danger");
              }

              if (normalised.state === "WARNING") {
                pushAlert("Room conditions need attention", "warning");
              }

              if (normalised.state === "OCCUPIED" && prev === "IDLE") {
                pushAlert("Occupancy detected — lights on", "info");
              }
            }

            return normalised.state;
          });
        },
      )
      .subscribe((status) => {
        console.log("Realtime:", status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [pushAlert]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!data) return;

      const lastSeen = new Date(data.timestamp).getTime();

      const isOffline = Date.now() - lastSeen > 10000;

      if (isOffline) {
        setFeedStatus("waiting");
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [data]);

  // ── Render guards ──
  if (feedStatus === "waiting" || !data) return <WaitingBanner />;

  if (feedStatus === "error")
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f7f5f2]">
        <p className="text-sm text-rose-400 font-medium">
          ⚠️ Could not reach /api/sensor — check your deployment.
        </p>
      </div>
    );

  const stateConf = STATE_CONFIG[data.state];
  const tempHistory = history.map((h) => h.temperature);
  const humidHistory = history.map((h) => h.humidity);
  const gasHistory = history.map((h) => h.gas);

  return (
    <div className="min-h-screen bg-[#f7f5f2] font-body">
      <Toaster
        position="top-right"
        richColors
        expand
        toastOptions={{
          style: { fontFamily: "'DM Sans', sans-serif", borderRadius: "16px" },
        }}
      />
      {/* ── Global styles ── */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Serif+Display&display=swap');
        .font-body    { font-family: 'DM Sans', sans-serif; }
        .font-display { font-family: 'DM Serif Display', serif; }
        :root {
          --sage: #7c9e87;
          --sage-light: #eef4f0;
          --peach: #e8a598;
          --cream: #f7f5f2;
          --card: #ffffff;
        }
        .bg-sage-100  { background: var(--sage-light); }
        .text-sage-700 { color: #4a7259; }
        .bg-sage-500  { background: var(--sage); }
        .border-sage  { border-color: var(--sage); }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.5; transform: scale(1.3); }
        }
        .animate-pulse-dot { animation: pulse-dot 1.6s ease-in-out infinite; }
      `}</style>

      {/* ── Header ── */}
      <header className="bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-slate-800 leading-none">
            Smart Home Monitor
          </h1>
          <p className="text-xs text-slate-400 mt-1 tracking-wide">
            Safety & Occupancy Dashboard
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Live indicator */}
          <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-dot" />
            Live
          </span>
          {/* State badge */}
          <span
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold ${stateConf.bg} ${stateConf.text}`}
          >
            <span
              className={`w-2 h-2 rounded-full ${stateConf.dot} ${data.state === "DANGER" ? "animate-pulse-dot" : ""}`}
            />
            {stateConf.label}
          </span>
          <span className="text-xs text-slate-300 tabular-nums">
            {timeStr()}
          </span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-5">
        {/* ── Top row: temp + humidity + gas ── */}
        <div className="grid grid-cols-3 gap-4">
          {/* Temperature */}
          <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-widest">
                Temp
              </span>
              <span className="text-lg">🌡️</span>
            </div>
            <div className="flex items-end gap-1 mt-2">
              <span
                className={`font-display text-4xl leading-none ${data.temperature > 35 ? "text-rose-500" : data.temperature > 28 ? "text-amber-500" : "text-slate-700"}`}
              >
                {data.temperature.toFixed(2)}
              </span>
              <span className="text-slate-400 text-sm mb-1">°C</span>
            </div>
            <div className="mt-3">
              <GaugeArc
                value={data.temperature}
                max={50}
                color={
                  data.temperature > 35
                    ? "#f43f5e"
                    : data.temperature > 28
                      ? "#f59e0b"
                      : "#7c9e87"
                }
              />
            </div>
            <div className="mt-1">
              <Sparkline
                values={tempHistory}
                color={data.temperature > 35 ? "#f43f5e" : "#7c9e87"}
              />
            </div>
          </div>

          {/* Humidity */}
          <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-widest">
                Humidity
              </span>
              <span className="text-lg">💧</span>
            </div>
            <div className="flex items-end gap-1 mt-2">
              <span
                className={`font-display text-4xl leading-none ${data.humidity > 80 ? "text-blue-500" : "text-slate-700"}`}
              >
                {data.humidity}
              </span>
              <span className="text-slate-400 text-sm mb-1">%</span>
            </div>
            <div className="mt-4 space-y-1.5">
              <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                <div
                  className="h-2 rounded-full transition-all duration-700"
                  style={{
                    width: `${data.humidity.toFixed(2)}%`,
                    background: data.humidity > 80 ? "#3b82f6" : "#7c9e87",
                  }}
                />
              </div>
              <p className="text-xs text-slate-400">
                {data.humidity > 80
                  ? "High — ventilate room"
                  : "Comfortable range"}
              </p>
            </div>
            <div className="mt-3">
              <Sparkline values={humidHistory} color="#60a5fa" />
            </div>
          </div>

          {/* Gas */}
          <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-widest">
                Gas Level
              </span>
              <span className="text-lg">💨</span>
            </div>
            <div className="flex items-end gap-1 mt-2">
              <span
                className={`font-display text-4xl leading-none ${data.gas > 2000 ? "text-rose-500" : data.gas > 1000 ? "text-amber-500" : "text-slate-700"}`}
              >
                {data.gas}
              </span>
              <span className="text-slate-400 text-sm mb-1">ppm</span>
            </div>
            <div className="mt-4">
              <GasBar level={data.gasBar} />
              <p className="text-xs text-slate-400 mt-2">
                {data.gasBar === 0
                  ? "Clean air"
                  : data.gasBar <= 2
                    ? "Trace detected"
                    : data.gasBar <= 3
                      ? "Moderate — monitor"
                      : "⚠️ Dangerous — alert!"}
              </p>
            </div>
            <div className="mt-2">
              <Sparkline
                values={gasHistory}
                color={data.gas > 2000 ? "#f43f5e" : "#f59e0b"}
              />
            </div>
          </div>
        </div>

        {/* ── Second row: occupancy + light + actuators ── */}
        <div className="grid grid-cols-3 gap-4">
          {/* Occupancy */}
          <div
            className={`rounded-3xl p-5 shadow-sm border transition-colors duration-700 ${data.occupied ? "bg-[#eef4f0] border-[#c4daca]" : "bg-white border-slate-100"}`}
          >
            <span className="text-xs font-medium text-slate-400 uppercase tracking-widest">
              Occupancy
            </span>
            <div className="mt-4 flex items-center gap-3">
              <div
                className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl transition-all duration-500 ${data.occupied ? "bg-white shadow-sm" : "bg-slate-100"}`}
              >
                {data.occupied ? "🧑" : "🪑"}
              </div>
              <div>
                <p
                  className={`font-semibold text-lg leading-tight ${data.occupied ? "text-[#4a7259]" : "text-slate-400"}`}
                >
                  {data.occupied ? "Occupied" : "Empty"}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {data.motion ? "Motion now" : "No motion"}
                </p>
              </div>
            </div>
          </div>

          {/* Light */}
          <div
            className={`rounded-3xl p-5 shadow-sm border transition-colors duration-700 ${data.isDark ? "bg-slate-800 border-slate-700" : "bg-amber-50 border-amber-100"}`}
          >
            <span
              className={`text-xs font-medium uppercase tracking-widest ${data.isDark ? "text-slate-400" : "text-amber-600"}`}
            >
              Ambient Light
            </span>
            <div className="mt-3 flex items-center gap-3">
              <span className="text-3xl">{data.isDark ? "🌙" : "☀️"}</span>
              <div>
                <p
                  className={`font-display text-2xl ${data.isDark ? "text-white" : "text-amber-700"}`}
                >
                  {data.light}
                </p>
                <p
                  className={`text-xs mt-0.5 ${data.isDark ? "text-slate-400" : "text-amber-500"}`}
                >
                  {data.isDark ? "Low light" : "Well lit"}
                </p>
              </div>
            </div>
            <div
              className={`mt-3 text-xs font-medium px-3 py-1.5 rounded-xl inline-block ${data.roomLight ? "bg-amber-200 text-amber-800" : data.isDark ? "bg-slate-700 text-slate-400" : "bg-amber-100 text-amber-600"}`}
            >
              Room light {data.roomLight ? "ON — auto" : "OFF"}
            </div>
          </div>

          {/* Actuators status */}
          <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-widest">
              Actuators
            </span>
            <div className="mt-3 space-y-2.5">
              {[
                {
                  label: "Motion LED",
                  on: data.motionLed,
                  icon: "💡",
                  onColor: "bg-blue-100 text-blue-700",
                },
                {
                  label: "Room Light",
                  on: data.roomLight,
                  icon: "🔆",
                  onColor: "bg-amber-100 text-amber-700",
                },
                {
                  label: "Buzzer",
                  on: data.buzzer,
                  icon: "🔔",
                  onColor: "bg-rose-100 text-rose-700",
                },
              ].map(({ label, on, icon, onColor }) => (
                <div key={label} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{icon}</span>
                    <span className="text-sm text-slate-600">{label}</span>
                  </div>
                  <span
                    className={`text-xs font-semibold px-2.5 py-1 rounded-full ${on ? onColor : "bg-slate-100 text-slate-400"}`}
                  >
                    {on ? "ON" : "OFF"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── History log ── */}
        <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-widest">
              Recent Readings
            </span>
            <span className="text-xs text-slate-300">
              {history.length} samples
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-400 border-b border-slate-100">
                  {[
                    "Time",
                    "State",
                    "Temp",
                    "Humidity",
                    "Gas",
                    "Motion",
                    "Buzzer",
                  ].map((h) => (
                    <th key={h} className="text-left pb-2 pr-4 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...history]
                  .reverse()
                  .slice(0, 8)
                  .map((row, i) => {
                    const sc = STATE_CONFIG[row.state];
                    return (
                      <tr
                        key={i}
                        className="border-b border-slate-50 last:border-0"
                      >
                        <td className="py-2 pr-4 text-slate-400 tabular-nums text-xs">
                          {new Date(row.timestamp).toLocaleTimeString("en-US", {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </td>
                        <td className="py-2 pr-4">
                          <span
                            className={`text-xs font-semibold px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}
                          >
                            {row.state}
                          </span>
                        </td>
                        <td
                          className={`py-2 pr-4 tabular-nums font-medium ${row.temperature > 35 ? "text-rose-500" : "text-slate-700"}`}
                        >
                          {row.temperature}°C
                        </td>
                        <td
                          className={`py-2 pr-4 tabular-nums ${row.humidity > 80 ? "text-blue-500" : "text-slate-600"}`}
                        >
                          {row.humidity}%
                        </td>
                        <td
                          className={`py-2 pr-4 tabular-nums ${row.gas > 2000 ? "text-rose-500" : "text-slate-600"}`}
                        >
                          {row.gas}
                        </td>
                        <td className="py-2 pr-4">
                          <span
                            className={`text-xs ${row.motion ? "text-[#4a7259] font-semibold" : "text-slate-400"}`}
                          >
                            {row.motion ? "Yes" : "No"}
                          </span>
                        </td>
                        <td className="py-2">
                          <span
                            className={`text-xs ${row.buzzer ? "text-rose-500 font-semibold" : "text-slate-400"}`}
                          >
                            {row.buzzer ? "🔔 ON" : "—"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-center text-xs text-slate-300 pb-4">
          Smart Home Safety & Occupancy Monitoring · Updates every 2s
        </p>
      </main>
    </div>
  );
}
