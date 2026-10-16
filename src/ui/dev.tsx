/**
 * Independent UI preview (ui.html / `npm run dev:ui`). Hosts BlindspotApp on
 * the deterministic fixture bridge: no credentials, no Convex, no engine.
 * Everything on this page is labeled fixture data. Person C's composed app
 * (index.html -> src/main.tsx) uses Person B's RuntimeRoot instead.
 */
import { StrictMode, useSyncExternalStore, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AppState } from "../../shared/contracts";
import { createFixtureBridge, type FixturePresetName } from "../mocks/createFixtureBridge";
import { BlindspotApp } from "./BlindspotApp";
import { FixtureViewport } from "./devViewport";

const bridge = createFixtureBridge({
  publicOrigin: import.meta.env.VITE_PUBLIC_APP_ORIGIN,
  authoringEnabled: import.meta.env.VITE_AUTHORING_ENABLED !== "false",
  initialPath: window.location.pathname,
  syncHistory: true,
});
// Public preview opens on a useful completed sample. Local UI development
// keeps the fresh-session state so each fixture can still be tested on demand.
const publicDemo = import.meta.env.VITE_AUTHORING_ENABLED === "false";
if (publicDemo && bridge.getState().route.kind === "workspace") {
  bridge.dev.loadPreset("completed-baseline");
}

const PRESETS: ReadonlyArray<{ name: FixturePresetName; label: string }> = [
  { name: "fresh", label: "Fresh session" },
  { name: "world-uncalibrated", label: "World needs calibration" },
  { name: "ready", label: "Ready (no run)" },
  { name: "completed-baseline", label: "Completed baseline run" },
  { name: "queued-from-phone", label: "Queued from phone (stale gauge)" },
  { name: "running", label: "Running" },
  { name: "published", label: "Published report" },
  { name: "incomplete-run", label: "Incomplete run (unknown encounter)" },
  { name: "no-stop-events", label: "Run with no stop events" },
  { name: "generation-failed", label: "Generation failed" },
  { name: "offline", label: "Offline" },
  { name: "controller-token-expired", label: "Controller token expired" },
];

const panelStyle: React.CSSProperties = {
  position: "fixed",
  right: 12,
  bottom: 12,
  zIndex: 90,
  background: "#111820",
  color: "#eef3f6",
  borderRadius: 12,
  border: "1px solid #25333d",
  padding: "10px 12px",
  maxWidth: 300,
  fontSize: 12,
  fontFamily: "var(--bs-font-mono)",
  boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
};

const devBtn: React.CSSProperties = {
  font: "inherit",
  color: "#eef3f6",
  background: "#1c2733",
  border: "1px solid #33424e",
  borderRadius: 6,
  padding: "4px 8px",
  cursor: "pointer",
  textAlign: "left",
};

function FixturePanel({ state }: { state: AppState }) {
  const [, forceRender] = useState(0);
  const win = window as { __BLINDSPOT_FORCE_NO_WEBGL?: boolean };
  return (
    <details className="bs-no-print" style={panelStyle}>
      <summary style={{ cursor: "pointer", fontWeight: 700 }}>
        {publicDemo ? "Sample controls (fixture data)" : "Fixture controls (dev preview only)"}
      </summary>
      {publicDemo && (
        <p style={{ margin: "8px 0 4px", lineHeight: 1.4 }}>
          Sample data only. No live robot, sensor, operator, or evaluation is connected.
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8, maxHeight: "60vh", overflowY: "auto" }}>
        <span style={{ opacity: 0.7 }}>{publicDemo ? "Load sample state" : "Load state"}</span>
        {PRESETS.map((preset) => (
          <button key={preset.name} type="button" style={devBtn} onClick={() => bridge.dev.loadPreset(preset.name)}>
            {preset.label}
          </button>
        ))}
        <span style={{ opacity: 0.7, marginTop: 6 }}>Fail next action</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(["authorScenario", "requestConfig", "startRun", "publishReport"] as const).map((action) => (
            <button key={action} type="button" style={devBtn} onClick={() => bridge.dev.failNext(action)}>
              {action}
            </button>
          ))}
        </div>
        <span style={{ opacity: 0.7, marginTop: 6 }}>Connection</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(["connected", "connecting", "offline"] as const).map((connection) => (
            <button
              key={connection}
              type="button"
              style={{ ...devBtn, outline: state.connection === connection ? "1px solid #7fd1cd" : "none" }}
              onClick={() => bridge.dev.setConnection(connection)}
            >
              {connection}
            </button>
          ))}
          <button type="button" style={devBtn} onClick={() => bridge.dev.setOperatorOnline(!state.session?.operatorOnline)}>
            operator: {state.session?.operatorOnline ? "online" : "offline"}
          </button>
        </div>
        <span style={{ opacity: 0.7, marginTop: 6 }}>Routes</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" style={devBtn} onClick={() => bridge.actions.navigate("/")}>
            workspace
          </button>
          <button type="button" style={devBtn} onClick={() => bridge.actions.navigate("/control/sess-fixture-01")}>
            controller
          </button>
          <button type="button" style={devBtn} onClick={() => bridge.actions.navigate("/reports/rpt-fixture-0001")}>
            report
          </button>
          <button type="button" style={devBtn} onClick={() => bridge.actions.navigate("/reports/rpt-unknown")}>
            report 404
          </button>
        </div>
        <button
          type="button"
          style={{ ...devBtn, marginTop: 6 }}
          onClick={() => {
            win.__BLINDSPOT_FORCE_NO_WEBGL = !win.__BLINDSPOT_FORCE_NO_WEBGL;
            forceRender((n) => n + 1);
          }}
        >
          simulate no WebGL: {win.__BLINDSPOT_FORCE_NO_WEBGL ? "on" : "off"}
        </button>
      </div>
    </details>
  );
}

function DevRoot() {
  const state = useSyncExternalStore(bridge.subscribe, bridge.getState);
  const viewport = state.route.kind === "workspace" ? <FixtureViewport state={state} /> : null;
  return (
    <>
      <BlindspotApp state={state} actions={bridge.actions} viewport={viewport} />
      <FixturePanel state={state} />
    </>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("ui.html is missing #root");
createRoot(container).render(
  <StrictMode>
    <DevRoot />
  </StrictMode>,
);
