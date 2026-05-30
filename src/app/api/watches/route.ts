import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { randomUUID } from "crypto";
import type { Watch } from "@/lib/types";

const kv = Redis.fromEnv();

const WATCHES_KEY = "slot-watches";

export async function GET() {
  const raw = (await kv.hgetall<Record<string, Watch>>(WATCHES_KEY)) ?? {};
  const watches: Watch[] = Object.values(raw);
  return NextResponse.json({ watches });
}

export async function POST(request: NextRequest) {
  const { watchSlot, forSlot, conditions } = await request.json();

  if (
    !watchSlot ||
    !forSlot ||
    !Array.isArray(conditions) ||
    conditions.length === 0
  ) {
    return NextResponse.json(
      { error: "watchSlot, forSlot, and conditions required" },
      { status: 400 },
    );
  }

  const watch: Watch = {
    id: crypto.randomUUID(),
    watchSlot,
    forSlot,
    conditions,
  };
  await kv.hset(WATCHES_KEY, { [watch.id]: watch });
  return NextResponse.json({ watch });
}

export async function DELETE(request: NextRequest) {
  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await kv.hdel(WATCHES_KEY, id);
  return NextResponse.json({ ok: true });
}
