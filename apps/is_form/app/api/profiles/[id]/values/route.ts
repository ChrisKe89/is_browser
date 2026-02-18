import { NextResponse } from "next/server";
import {
  getProfileById,
  getProfileValues,
  upsertProfileValues,
} from "../../../../../src/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  try {
    const { id } = await params;
    const profile = getProfileById(id);
    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }
    const values = getProfileValues(id);
    return NextResponse.json({ profile, values });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load values" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const profile = getProfileById(id);
    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }
    const body = (await request.json()) as { values?: Record<string, unknown> };
    if (!body.values || typeof body.values !== "object") {
      return NextResponse.json({ error: "values object is required" }, { status: 400 });
    }
    const upserted = upsertProfileValues(id, body.values);
    const updatedProfile = getProfileById(id);
    return NextResponse.json({ upserted, profile: updatedProfile ?? profile });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save values" },
      { status: 500 },
    );
  }
}
