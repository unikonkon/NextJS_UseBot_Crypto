import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "app/getData/data/dataShowUI");

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const file = searchParams.get("file");

  // List mode: return available CSV files
  if (!file) {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        return NextResponse.json([]);
      }
      const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".csv")).sort();
      return NextResponse.json(files);
    } catch {
      return NextResponse.json({ error: "Failed to list files" }, { status: 500 });
    }
  }

  // Read mode: return CSV content as text
  const safeName = path.basename(file);
  const filePath = path.join(DATA_DIR, safeName);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return new NextResponse(content, {
      headers: { "Content-Type": "text/csv; charset=utf-8" },
    });
  } catch {
    return NextResponse.json({ error: "Failed to read file" }, { status: 500 });
  }
}
