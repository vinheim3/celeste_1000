import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

const kv = Redis.fromEnv();

const NOTES_KEY = "slot-notes";

export async function POST(request: NextRequest) {
  const { slotName, note } = await request.json();

  if (!slotName || typeof slotName !== "string") {
    return NextResponse.json({ error: "slotName required" }, { status: 400 });
  }

  if (note) {
    await kv.hset(NOTES_KEY, { [slotName]: note });
  } else {
    await kv.hdel(NOTES_KEY, slotName);
  }

  return NextResponse.json({ ok: true });
}
