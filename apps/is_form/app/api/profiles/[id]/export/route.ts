import { NextResponse } from "next/server";
import { exportProfile } from "../../../../../src/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  try {
    const { id } = await params;
    const payload = exportProfile(id);
    return NextResponse.json(payload);
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Export failed" },
      { status: 404 },
    );
  }
}
