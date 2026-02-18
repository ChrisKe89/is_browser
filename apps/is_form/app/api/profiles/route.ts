import { NextResponse } from "next/server";
import { createProfile, listProfiles } from "../../../src/lib/db";

export function GET() {
  try {
    return NextResponse.json({ profiles: listProfiles() });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list profiles" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { account?: string; name?: string | null };
    const account = body.account?.trim() ?? "";
    if (!account) {
      return NextResponse.json({ error: "Account is required" }, { status: 400 });
    }
    const profile = createProfile(account, body.name ?? undefined);
    return NextResponse.json({ profile }, { status: 201 });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create profile" },
      { status: 500 },
    );
  }
}
