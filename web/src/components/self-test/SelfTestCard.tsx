"use client";

import { useEffect, useRef, useState } from "react";
import { runSelfTest, type StepResult } from "@/lib/crypto";
import StepRow from "./StepRow";

type LoadState =
  | { kind: "loading" }
  | { kind: "results"; results: StepResult[] }
  | { kind: "fatal"; error: string };

export default function SelfTestCard() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  // `run` is invoked both from the mount effect below and from the "Uruchom
  // ponownie" retry button — a plain effect-local `cancelled` flag can't
  // cover the button-triggered call, so use a ref that tracks mount state
  // across both call sites and guard every post-await setState with it.
  const mountedRef = useRef(true);

  async function run() {
    setState({ kind: "loading" });
    try {
      const results = await runSelfTest();
      if (mountedRef.current) setState({ kind: "results", results });
    } catch (e) {
      if (mountedRef.current) {
        setState({
          kind: "fatal",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    run();
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.kind === "fatal") {
    return (
      <div className="rounded-box border border-base-300 bg-base-100 p-6">
        <h2 className="text-[20px] font-bold leading-[1.2]">Self-test nie przeszedł</h2>
        <p className="mt-2 text-base leading-[1.5]">
          {`Krok „initCrypto" zwrócił błąd: ${state.error}. Sprawdź konsolę przeglądarki.`}
        </p>
      </div>
    );
  }

  const results = state.kind === "results" ? state.results : [];
  const passedCount = results.filter((r) => r.ok).length;
  const allPassed = state.kind === "results" && passedCount === results.length;

  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-6">
      <h2 className="text-[20px] font-bold leading-[1.2]">Crypto Self-Test</h2>

      <div className="mt-4 flex flex-col divide-y divide-base-300">
        {state.kind === "loading" ? (
          <p className="py-2 text-sm text-base-content/60">Uruchamianie...</p>
        ) : (
          results.map((step) => <StepRow key={step.name} step={step} />)
        )}
      </div>

      {state.kind === "results" ? (
        <p className="mt-4 text-base leading-[1.5]">
          {allPassed
            ? `${passedCount}/5 kroków przeszło`
            : `${passedCount}/5 kroków przeszło — patrz błąd poniżej`}
        </p>
      ) : null}

      <button
        type="button"
        className="btn btn-sm btn-outline mt-4"
        onClick={run}
        disabled={state.kind === "loading"}
      >
        Uruchom ponownie
      </button>
    </div>
  );
}
