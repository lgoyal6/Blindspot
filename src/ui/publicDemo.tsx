/**
 * Public entry for the saved Blindspot replay and report.
 * It reuses the fixture bridge and shared replay/metrics views, without dev tools.
 * All displayed evidence stays labeled as a fixture, never as a live robot run.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { CLAIM_BOUNDARY } from "../../shared/contracts";
import { createFixtureBridge } from "../mocks/createFixtureBridge";
import { ModeBadge } from "./components/Badges";
import { BlindspotApp } from "./BlindspotApp";
import { FixtureViewport } from "./devViewport";
import { MetricsPanel } from "./workspace/MetricsPanel";
import { PlaybackStrip } from "./workspace/PlaybackStrip";
import { ViewportShell } from "./workspace/ViewportShell";
import "../styles/public-demo.css";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/workspace.css";
import "../styles/controller.css";
import "../styles/report.css";

export function PublicDemo() {
  const [bridge] = useState(() => {
    const value = createFixtureBridge({
      publicOrigin: window.location.origin,
      authoringEnabled: false,
      initialPath: window.location.pathname,
      syncHistory: true,
    });
    value.dev.loadPreset("published");
    return value;
  });
  const state = useSyncExternalStore(bridge.subscribe, bridge.getState);

  useEffect(() => () => bridge.dispose(), [bridge]);

  if (state.route.kind === "report") {
    return (
      <>
        <nav className="bs-public-demo-nav" aria-label="Saved evidence navigation">
          <button type="button" className="bs-btn" onClick={() => bridge.actions.navigate("/")}>
            Return to saved replay
          </button>
        </nav>
        <BlindspotApp state={state} actions={bridge.actions} viewport={null} />
      </>
    );
  }

  if (state.route.kind !== "workspace") {
    return (
      <main className="bs-public-demo">
        <h1>Page not available in this saved demo</h1>
        <button type="button" className="bs-btn" onClick={() => bridge.actions.navigate("/")}>
          Return to saved replay
        </button>
      </main>
    );
  }

  return (
    <main className="bs-public-demo">
      <header className="bs-public-demo-header">
        <div>
          <p className="bs-public-demo-eyebrow">Saved replay · fixture data</p>
          <h1>Blindspot site review</h1>
          <p>Explore one recorded sample and its report. The controls below replay saved data.</p>
        </div>
        <ModeBadge mode="fixture" />
      </header>
      <p className="bs-public-demo-boundary">{CLAIM_BOUNDARY}</p>
      <p className="bs-public-demo-limit">
        Sample only. No live camera, robot, sensor, operator, or evaluation is connected.
      </p>
      <section className="bs-public-demo-context" aria-label="Saved sample context">
        <div><span>Site</span><strong>{state.world?.name ?? "Sample site"}</strong></div>
        <div><span>Scenario</span><strong>{state.scenario?.sentence ?? "Recorded sample scenario"}</strong></div>
        <div><span>Evidence</span><strong>Saved evaluation replay</strong></div>
      </section>
      <ViewportShell
        state={state}
        actions={bridge.actions}
        viewport={<FixtureViewport state={state} />}
      />
      <PlaybackStrip state={state} actions={bridge.actions} />
      <MetricsPanel state={state} />
      <nav className="bs-public-demo-nav" aria-label="Saved evidence navigation">
        <button
          type="button"
          className="bs-btn bs-btn--primary"
          onClick={() => bridge.actions.navigate("/reports/rpt-fixture-0001")}
        >
          Open saved sample report
        </button>
      </nav>
    </main>
  );
}
