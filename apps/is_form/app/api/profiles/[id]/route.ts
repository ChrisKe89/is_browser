import { NextResponse } from "next/server";
import { getProfileById, updateProfile } from "../../../../src/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  try {
    const { id } = await params;
    const profile = getProfileById(id);
    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }
    return NextResponse.json({ profile });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load profile" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const existing = getProfileById(id);
    if (!existing) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    const body = (await request.json()) as { account?: string; name?: string | null };
    const account = body.account?.trim() ?? "";
    if (!account) {
      return NextResponse.json({ error: "Account is required" }, { status: 400 });
    }

    const profile = updateProfile(id, {
      account,
      name: body.name === undefined ? existing.name : body.name,
    });

    return NextResponse.json({ profile });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update profile" },
      { status: 500 },
    );
  }
}
