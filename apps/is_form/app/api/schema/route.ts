import { NextResponse } from "next/server";
import { getSchemaFields } from "../../../src/lib/db";

export function GET() {
  try {
    const schema = getSchemaFields();
    return NextResponse.json({ schema });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load schema" },
      { status: 500 },
    );
  }
}
