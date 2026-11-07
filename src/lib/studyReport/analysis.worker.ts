/// <reference lib="webworker" />
import { analyzeStudyReport } from "./model";

type AnalysisInput = Parameters<typeof analyzeStudyReport>[0];

/** Large studies test thousands of provider features, which would otherwise freeze the page. */
self.onmessage = (event: MessageEvent<AnalysisInput>) => {
  try {
    self.postMessage({ ok: true, result: analyzeStudyReport(event.data) });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : "Report analysis failed.",
    });
  }
};
