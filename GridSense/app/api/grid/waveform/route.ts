import { NextResponse } from "next/server";
import {
  getAvailableWaveformClasses,
  getWaveformDatasetMeta,
  getWaveformSample,
} from "@/lib/waveform-dataset";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const classNames = await getAvailableWaveformClasses();
    const { searchParams } = new URL(request.url);
    const requestedClass = searchParams.get("className");
    const random = searchParams.get("random") === "true";

    if (!requestedClass && !random) {
      const datasetMeta = await getWaveformDatasetMeta();

      return NextResponse.json({
        ok: true,
        data: datasetMeta,
        error: null,
      });
    }

    const resolvedClass =
      requestedClass ??
      classNames[Math.floor(Math.random() * classNames.length)];

    if (!classNames.includes(resolvedClass)) {
      return NextResponse.json(
        {
          ok: false,
          data: null,
          error: `Unknown className '${resolvedClass}'.`,
        },
        { status: 400 },
      );
    }

    const rawIndex = Number(searchParams.get("sampleIndex") ?? 0);
    const sample = await getWaveformSample({
      className: resolvedClass,
      sampleIndex: Number.isFinite(rawIndex) ? rawIndex : 0,
      random,
    });

    return NextResponse.json({
      ok: true,
      data: sample,
      error: null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        data: null,
        error: error instanceof Error ? error.message : "Failed to load waveform sample.",
      },
      { status: 500 },
    );
  }
}
