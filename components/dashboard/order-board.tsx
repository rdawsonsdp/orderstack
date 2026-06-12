"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatCents } from "@/lib/menu-types";
import type { OrderStatus } from "@/lib/orders/state-machine";

export interface BoardOrder {
  id: string;
  order_number: number;
  status: OrderStatus;
  type: "pickup" | "delivery";
  placed_at: string | null;
  promised_at: string | null;
  scheduled_for: string | null;
  total_cents: number;
  special_instructions: string | null;
  created_at: string;
  customers: { name: string; phone: string | null } | null;
  order_items: {
    id: string;
    name_snapshot: string;
    qty: number;
    notes: string | null;
    order_item_modifiers: { name_snapshot: string }[];
  }[];
}

const READY_IN_OPTIONS = [10, 15, 20, 30, 45] as const;
/** Countdown turns red (and pulses) inside this window. */
const URGENT_MS = 5 * 60_000;

/**
 * New-order alert sounds, synthesized via WebAudio (no assets). Each entry is
 * a list of notes: [startSec, freqHz, durSec, wave]. Volume scales the master
 * gain 0–1; kitchens crank it, offices mute it.
 */
const SOUND_TYPES = {
  chime: {
    label: "Chime",
    notes: [
      [0, 660, 0.18, "sine"],
      [0.2, 880, 0.18, "sine"],
      [0.4, 1100, 0.18, "sine"],
    ],
  },
  bell: {
    label: "Bell",
    notes: [
      [0, 1320, 0.5, "sine"],
      [0, 1980, 0.35, "sine"],
      [0.45, 1100, 0.7, "sine"],
      [0.45, 1650, 0.45, "sine"],
    ],
  },
  buzzer: {
    label: "Buzzer",
    notes: [
      [0, 220, 0.35, "square"],
      [0.45, 220, 0.35, "square"],
    ],
  },
  alarm: {
    label: "Alarm (loud)",
    notes: [
      [0, 880, 0.15, "square"],
      [0.2, 880, 0.15, "square"],
      [0.4, 880, 0.15, "square"],
      [0.7, 1175, 0.15, "square"],
      [0.9, 1175, 0.15, "square"],
      [1.1, 1175, 0.15, "square"],
    ],
  },
} as const;

type SoundType = keyof typeof SOUND_TYPES;

interface SoundSettings {
  type: SoundType;
  volume: number; // 0–1
}

const DEFAULT_SOUND: SoundSettings = { type: "chime", volume: 0.6 };

function playAlert({ type, volume }: SoundSettings) {
  if (volume <= 0) return;
  try {
    const ctx = new AudioContext();
    const sound = SOUND_TYPES[type] ?? SOUND_TYPES.chime;
    // Square waves are perceptually much louder than sines — tame them so
    // the volume slider feels consistent across types.
    for (const [start, freq, dur, wave] of sound.notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = wave as OscillatorType;
      osc.frequency.value = freq;
      const peak = Math.max(0.0001, volume * (wave === "square" ? 0.35 : 0.8));
      gain.gain.setValueAtTime(peak, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur + 0.05);
    }
  } catch {
    /* audio blocked until first user interaction — title flash still fires */
  }
}

export function OrderBoard({
  restaurantId,
  restaurantName,
  initialOrders,
}: {
  restaurantId: string;
  restaurantName: string;
  initialOrders: BoardOrder[];
}) {
  const [orders, setOrders] = useState<BoardOrder[]>(initialOrders);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const supabaseRef = useRef(createClient());

  // Sound settings: persisted per restaurant; read through a ref so the
  // realtime callback always plays the current choice (no stale closure).
  const soundKey = `orderstack-sound-${restaurantId}`;
  const [sound, setSound] = useState<SoundSettings>(DEFAULT_SOUND);
  const [soundOpen, setSoundOpen] = useState(false);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  useEffect(() => {
    try {
      const saved = localStorage.getItem(soundKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.type in SOUND_TYPES && typeof parsed.volume === "number") {
          setSound({ type: parsed.type, volume: parsed.volume });
        }
      }
    } catch {
      /* corrupted settings — defaults */
    }
  }, [soundKey]);
  const updateSound = (patch: Partial<SoundSettings>) => {
    setSound((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(soundKey, JSON.stringify(next));
      return next;
    });
  };

  // One clock drives every countdown on the board.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const refetch = useCallback(async () => {
    const { data } = await supabaseRef.current
      .from("orders")
      .select(
        `id, order_number, status, type, placed_at, promised_at, scheduled_for,
         total_cents, special_instructions, created_at,
         customers (name, phone),
         order_items (id, name_snapshot, qty, notes,
           order_item_modifiers (name_snapshot))`
      )
      .eq("restaurant_id", restaurantId)
      .in("status", [
        "placed",
        "accepted",
        "preparing",
        "ready",
        "completed",
        "rejected",
      ])
      .order("created_at", { ascending: false })
      .limit(60);
    if (data) setOrders(data as unknown as BoardOrder[]);
  }, [restaurantId]);

  // Realtime: any orders change for this restaurant refreshes the board.
  // A 15s poll backs it up in case the socket drops on a sleepy tablet.
  useEffect(() => {
    const supabase = supabaseRef.current;
    const channel = supabase
      .channel(`orders-${restaurantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        (payload) => {
          const isNewOrder =
            payload.eventType === "INSERT" ||
            (payload.eventType === "UPDATE" &&
              (payload.new as { status?: string }).status === "placed" &&
              (payload.old as { status?: string }).status === "pending_payment");
          if (isNewOrder) {
            playAlert(soundRef.current);
            setFlash(true);
            setTimeout(() => setFlash(false), 3000);
          }
          refetch();
        }
      )
      .subscribe();

    const poll = setInterval(refetch, 15000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [restaurantId, refetch]);

  // Tab title flash so a backgrounded tablet still shows the new order.
  useEffect(() => {
    if (!flash) {
      document.title = `Orders — ${restaurantName}`;
      return;
    }
    const id = setInterval(() => {
      document.title =
        document.title === "🔔 New order!"
          ? `Orders — ${restaurantName}`
          : "🔔 New order!";
    }, 600);
    return () => clearInterval(id);
  }, [flash, restaurantName]);

  async function transition(order: BoardOrder, to: OrderStatus, promisedAt?: Date) {
    setError(null);
    const res = await fetch(`/api/orders/${order.id}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: to,
        ...(promisedAt && { promisedAt: promisedAt.toISOString() }),
      }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        message?: string;
        error?: string;
      } | null;
      setError(
        `Order #${order.order_number}: ${
          data?.message ?? data?.error ?? `transition failed (${res.status})`
        }`
      );
      return;
    }
    refetch();
  }

  const cols: {
    title: string;
    statuses: OrderStatus[];
    bar: string;
  }[] = [
    { title: "NEW", statuses: ["placed"], bar: "bg-amber-500" },
    { title: "COOKING", statuses: ["accepted", "preparing"], bar: "bg-blue-600" },
    { title: "READY", statuses: ["ready"], bar: "bg-green-600" },
  ];
  const finished = orders
    .filter((o) => o.status === "completed" || o.status === "rejected")
    .slice(0, 8);

  return (
    <main
      className={`mx-auto max-w-7xl px-4 py-6 transition-colors ${
        flash ? "bg-amber-100" : ""
      }`}
    >
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-3xl font-extrabold tracking-tight">Live orders</h1>
        <div className="flex items-center gap-3">
          <div className="relative">
            <button
              onClick={() => setSoundOpen((o) => !o)}
              className="rounded-lg border-2 border-black/10 bg-white px-4 py-2 text-lg font-bold hover:bg-gray-50"
              title="Alert sound settings"
            >
              {sound.volume === 0 ? "🔇" : "🔊"}{" "}
              <span className="text-sm text-gray-500">
                {SOUND_TYPES[sound.type].label}
              </span>
            </button>
            {soundOpen && (
              <div className="absolute right-0 top-full z-30 mt-2 w-72 rounded-xl border-2 border-black/10 bg-white p-4 shadow-xl">
                <p className="mb-2 text-sm font-bold uppercase tracking-wide text-gray-500">
                  New-order alert
                </p>
                <div className="mb-3 grid grid-cols-2 gap-2">
                  {(
                    Object.entries(SOUND_TYPES) as [
                      SoundType,
                      (typeof SOUND_TYPES)[SoundType],
                    ][]
                  ).map(([key, def]) => (
                    <button
                      key={key}
                      onClick={() => {
                        updateSound({ type: key });
                        playAlert({ type: key, volume: soundRef.current.volume });
                      }}
                      className={`rounded-lg border-2 px-3 py-2 text-base font-bold ${
                        sound.type === key
                          ? "border-(--accent) bg-(--accent)/10"
                          : "border-black/10 hover:bg-gray-50"
                      }`}
                    >
                      {def.label}
                    </button>
                  ))}
                </div>
                <label className="mb-1 block text-sm font-bold uppercase tracking-wide text-gray-500">
                  Volume {sound.volume === 0 ? "(muted)" : `${Math.round(sound.volume * 100)}%`}
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(sound.volume * 100)}
                  onChange={(e) => updateSound({ volume: Number(e.target.value) / 100 })}
                  onMouseUp={() => playAlert(soundRef.current)}
                  onTouchEnd={() => playAlert(soundRef.current)}
                  className="w-full accent-(--accent)"
                />
                <button
                  onClick={() => playAlert(soundRef.current)}
                  className="mt-3 w-full rounded-lg bg-gray-900 py-2 text-base font-bold text-white hover:bg-black"
                >
                  ▶ Test sound
                </button>
              </div>
            )}
          </div>
          <span className="text-2xl font-bold tabular-nums text-gray-500">
            {new Date(now).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        </div>
      </div>
      {error && (
        <p className="mb-4 rounded-lg bg-red-50 p-4 text-lg font-semibold text-red-700">
          {error}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        {cols.map((col) => {
          const colOrders = orders.filter((o) => col.statuses.includes(o.status));
          return (
            <section
              key={col.title}
              className="overflow-hidden rounded-2xl bg-gray-100 shadow-sm"
            >
              <h2
                className={`${col.bar} px-4 py-3 text-2xl font-black tracking-wide text-white`}
              >
                {col.title}
                <span className="ml-3 rounded-full bg-white/25 px-3 py-0.5 text-xl tabular-nums">
                  {colOrders.length}
                </span>
              </h2>
              <div className="p-3">
                {colOrders.length === 0 && (
                  <p className="px-1 py-4 text-center text-lg text-gray-400">
                    No orders
                  </p>
                )}
                {colOrders.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    now={now}
                    onTransition={transition}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {finished.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-lg font-bold text-gray-500">Recent</h2>
          <div className="flex flex-wrap gap-2">
            {finished.map((o) => (
              <Link
                key={o.id}
                href={`/dashboard/orders/${o.id}`}
                className={`rounded-full px-4 py-2 text-base font-semibold hover:ring-2 hover:ring-black/10 ${
                  o.status === "completed"
                    ? "bg-green-100 text-green-800"
                    : "bg-red-100 text-red-700"
                }`}
              >
                #{o.order_number} {o.status} · {formatCents(o.total_cents)} ›
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

/** "Today 5:30 PM" / "Tomorrow 11:00 AM" / "Saturday 12:15 PM" */
function formatScheduled(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const diffDays = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  const dayLabel =
    diffDays === 0
      ? "Today"
      : diffDays === 1
        ? "Tomorrow"
        : d.toLocaleDateString("en-US", { weekday: "long" });
  return `${dayLabel} ${d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

/**
 * The chef's number: countdown to the promised time, readable across the
 * kitchen. Red + pulsing inside 5 minutes, "LATE" when past. New orders
 * (no promise yet) count UP since they were placed — unless they're
 * scheduled pre-orders, which count DOWN to their scheduled time instead.
 */
function PromiseTimer({ order, now }: { order: BoardOrder; now: number }) {
  const target =
    order.status === "placed"
      ? order.scheduled_for // pre-order: count down to the scheduled time
      : order.promised_at;
  if (target) {
    const label = order.status === "placed" ? "TO SCHEDULED" : "TO PROMISE";
    const remaining = new Date(target).getTime() - now;
    const mins = Math.ceil(Math.abs(remaining) / 60_000);
    // Pre-orders can be hours/days out — keep the big number readable.
    const big =
      mins < 100
        ? `${mins}m`
        : mins < 48 * 60
          ? `${Math.round(mins / 60)}h`
          : `${Math.round(mins / (24 * 60))}d`;
    if (remaining < 0) {
      return (
        <div className="animate-pulse rounded-xl bg-red-600 px-4 py-2 text-center text-white">
          <div className="text-4xl font-black leading-none tabular-nums">
            {big}
          </div>
          <div className="text-sm font-bold">LATE</div>
        </div>
      );
    }
    const urgent = remaining <= URGENT_MS;
    return (
      <div
        className={`rounded-xl px-4 py-2 text-center ${
          urgent ? "animate-pulse bg-red-600 text-white" : "bg-gray-900 text-white"
        }`}
      >
        <div className="text-4xl font-black leading-none tabular-nums">{big}</div>
        <div className="text-sm font-bold">{urgent ? "DUE SOON" : label}</div>
      </div>
    );
  }

  // No promise yet (NEW column): how long the customer has been waiting.
  const waited = Math.floor(
    (now - new Date(order.placed_at ?? order.created_at).getTime()) / 60_000
  );
  const urgent = waited >= 5;
  return (
    <div
      className={`rounded-xl px-4 py-2 text-center ${
        urgent ? "animate-pulse bg-red-600 text-white" : "bg-amber-500 text-white"
      }`}
    >
      <div className="text-4xl font-black leading-none tabular-nums">{waited}m</div>
      <div className="text-sm font-bold">WAITING</div>
    </div>
  );
}

function OrderCard({
  order,
  now,
  onTransition,
}: {
  order: BoardOrder;
  now: number;
  onTransition: (order: BoardOrder, to: OrderStatus, promisedAt?: Date) => void;
}) {
  const [accepting, setAccepting] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const placedTime = new Date(order.placed_at ?? order.created_at).toLocaleTimeString(
    "en-US",
    { hour: "numeric", minute: "2-digit" }
  );

  return (
    <article className="mb-4 rounded-xl border-2 border-black/10 bg-white p-4 shadow">
      <header className="mb-2 flex items-start justify-between gap-3">
        <div>
          <Link
            href={`/dashboard/orders/${order.id}`}
            className="text-4xl font-black leading-none hover:underline"
            style={{ color: "var(--accent)" }}
          >
            #{order.order_number}
          </Link>
          <p className="mt-1 text-lg font-semibold text-gray-700">
            {order.customers?.name ?? "Guest"}
          </p>
          <p className="text-sm tabular-nums text-gray-500">
            {placedTime} · {formatCents(order.total_cents)}
            {order.customers?.phone && <> · {order.customers.phone}</>}
          </p>
          <a
            href={`/dashboard/print/${order.id}`}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block rounded-md border border-black/15 px-3 py-1 text-sm font-bold text-gray-600 hover:bg-gray-50"
          >
            🖨 Print
          </a>
        </div>
        <div className="flex flex-col items-end gap-2">
          {order.scheduled_for && (
            <span className="rounded-lg bg-purple-600 px-3 py-1.5 text-sm font-black tracking-wide text-white">
              ⏰ SCHEDULED {formatScheduled(order.scheduled_for)}
            </span>
          )}
          <PromiseTimer order={order} now={now} />
        </div>
      </header>

      <ul className="mb-3 space-y-1.5">
        {order.order_items.map((item) => (
          <li key={item.id} className="text-xl leading-snug">
            <span className="font-black" style={{ color: "var(--accent)" }}>
              {item.qty}×
            </span>{" "}
            <span className="font-bold">{item.name_snapshot}</span>
            {item.order_item_modifiers.length > 0 && (
              <div className="pl-7 text-base font-medium text-gray-600">
                {item.order_item_modifiers.map((m) => m.name_snapshot).join(" · ")}
              </div>
            )}
            {item.notes && (
              <p className="pl-7 text-base font-semibold text-amber-700">
                “{item.notes}”
              </p>
            )}
          </li>
        ))}
      </ul>
      {order.special_instructions && (
        <p className="mb-3 rounded-lg bg-amber-50 p-3 text-base font-semibold text-amber-800">
          “{order.special_instructions}”
        </p>
      )}

      {order.status === "placed" &&
        (accepting ? (
          <div>
            <p className="mb-2 text-lg font-bold text-gray-700">Ready in…</p>
            <div className="grid grid-cols-3 gap-2">
              {READY_IN_OPTIONS.map((min) => (
                <button
                  key={min}
                  onClick={() =>
                    onTransition(order, "accepted", new Date(Date.now() + min * 60_000))
                  }
                  className="rounded-lg bg-green-600 py-4 text-2xl font-black text-white hover:bg-green-700"
                >
                  {min}m
                </button>
              ))}
              <button
                onClick={() => setAccepting(false)}
                className="rounded-lg py-4 text-lg font-bold text-gray-500"
              >
                Back
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => setAccepting(true)}
              className="flex-[2] rounded-lg bg-green-600 py-4 text-2xl font-black text-white hover:bg-green-700"
            >
              ACCEPT
            </button>
            <button
              onClick={() => {
                if (confirmReject) onTransition(order, "rejected");
                else {
                  setConfirmReject(true);
                  setTimeout(() => setConfirmReject(false), 4000);
                }
              }}
              className={`flex-1 rounded-lg border-2 py-4 text-lg font-black ${
                confirmReject
                  ? "border-red-600 bg-red-600 text-white"
                  : "border-red-300 text-red-600 hover:bg-red-50"
              }`}
            >
              {confirmReject ? "SURE?" : "Reject"}
            </button>
          </div>
        ))}

      {(order.status === "accepted" || order.status === "preparing") && (
        <button
          onClick={() => onTransition(order, "ready")}
          className="w-full rounded-lg bg-blue-600 py-4 text-2xl font-black text-white hover:bg-blue-700"
        >
          MARK READY
        </button>
      )}

      {order.status === "ready" && (
        <button
          onClick={() => onTransition(order, "completed")}
          className="w-full rounded-lg bg-gray-900 py-4 text-2xl font-black text-white hover:bg-black"
        >
          PICKED UP
        </button>
      )}
    </article>
  );
}
