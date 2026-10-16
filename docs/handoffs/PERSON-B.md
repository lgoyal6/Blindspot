# Person B handoff

Status: verified engine/runtime/backend implementation, with real Marble and Convex evidence. P0 is incomplete because the Tripo account has no available credits; the current bulk obstacle is explicitly labeled as a development proxy. Mint is A's pending asset. Public frontend hosting/origin is C's release step.

- Branch: `person-b`, isolated checkout `/private/tmp/blindspot-person-b`. Person A's original checkout was preserved.
- A0 baseline: `713a33d5a46574d0b6bb6eab41847dd2753fecae`, plus `1a62bfb`.
- Final tested implementation commit: `2712a059def3fe9743374cf6a8132c598e9d259f`. The following evidence/handoff commit changes documentation only. The user directly authorized committing and pushing `person-b`.
- Frozen shared contracts: unchanged. No root manifest, lockfile, UI or Person C entry changes.

## Delivered behavior

`src/runtime/index.ts` exports `RuntimeRoot`, `useBlindspot()` and lazy `BlindspotViewport`. The bridge owns local authoring, routes, Convex subscriptions, owner execution, controller presets, calibration, durable uploads, immutable publication and recorded playback. C composes these exports with A's UI; no missing adapter is delegated to C.

The engine renders real Marble SPZ appearance and registered GLB proxy geometry separately. Two exact procedural cable instances and one bulk box have declared dimensions. A metric vertical capsule follows the ground route. Actual GPU depth/ID pixels and occlusion-tested analytical cable samples drive occupancy, latency, finite braking and bounded swept collision. Full-route diagnostic coverage is independent of the reactive pass. All generated/demo assumptions remain visible.

Convex implements capabilities, a 15-second single-operator lease, lease epochs, idempotent config/run requests, stale-version fencing, immutable versioned data, owned upload URLs and actual asset checksum validation. Reports contain complete snapshots and explicit assumptions. Provider keys stay local; only capability hashes are persisted. Phones submit bounded presets and never call paid APIs.

## Reproduction commands

Run from the checkout root unless a command uses `--prefix`. The recorded toolchain was Node 26.8.1 with the pinned A0 dependencies.

```sh
npm ci
npm --prefix services/provider ci
npm --prefix services/provider run cache:restore
BLINDSPOT_ENV_FILE=/Users/lakshgoyal/Downloads/Blindspot.env npm --prefix services/provider run preflight
```

`cache:restore` verifies and copies the included generated world, preview, collider and completed accepted job. It makes zero paid requests and preserves an existing calibration. `preflight` prints access/credit booleans only.

For a new operator cache, initialize the authorized dev session. The default seed requires a real Tripo asset. The explicit proxy flag enables only the incomplete-integration test shown in this handoff:

```sh
BLINDSPOT_ENV_FILE=/Users/lakshgoyal/Downloads/Blindspot.env npm --prefix services/provider run seed:demo -- --development-proxy
BLINDSPOT_ENV_FILE=/Users/lakshgoyal/Downloads/Blindspot.env npm --prefix services/provider run dev
```

In a second terminal:

```sh
VITE_AUTHORING_ENABLED=true VITE_CONVEX_URL=https://standing-pony-711.convex.cloud ./node_modules/.bin/vite --mode engine --config src/runtime/vite.config.ts
```

Open `http://localhost:5173/engine.html`. Use this exact hostname because the local provider origin is `http://localhost:5173`. B's Vite config adds the protected `/api/local` proxy while preserving A's root config. It also works with C's composed entry in the default mode once that entry exists.

When Tripo credits become available, the operator can explicitly prepare the bounded cache and upgrade the existing proxy session:

```sh
BLINDSPOT_ENV_FILE=/Users/lakshgoyal/Downloads/Blindspot.env npm --prefix services/provider run cache:demo -- --generate
BLINDSPOT_ENV_FILE=/Users/lakshgoyal/Downloads/Blindspot.env npm --prefix services/provider run seed:demo
```

The completed Marble task is reused. Accepted running tasks are polled instead of resubmitted. There is a finite four-generation local budget. Restart the provider and operator after upgrading. Actual Tripo export/rendering remains unverified until a generation succeeds; never mark the proxy as Tripo.

The current deployment is already installed. Only the backend owner should deploy changes:

```sh
BLINDSPOT_ENV_FILE=/Users/lakshgoyal/Downloads/Blindspot.env npm --prefix services/provider run deploy:dev
```

This command checks the credential targets `standing-pony-711`, uses `convex dev --once`, and exits. It does not upload World Labs, Tripo or model credentials.

C sets `VITE_PUBLIC_APP_ORIGIN` to the real deployed HTTPS app origin on the operator and frontend. Until then the bridge returns null public share links and disables UI publication. The local controller-test button is a development harness convenience, not a hosted QR claim. For backend verification independently of frontend hosting:

```sh
BLINDSPOT_ENV_FILE=/Users/lakshgoyal/Downloads/Blindspot.env npm --prefix services/provider run publish:demo
npm --prefix services/provider run verify:report -- 2befc0cd-7508-47f2-9e07-641a2bfc0478 9d91af1f106f9c028c05fbec2262c24f892f2445d61bb3b15694184d1465e6b2
```

The public report verifier reads no env file and sends no credentials. Publication saves its sanitized result in the ignored local cache. The publisher accepts an optional explicit completed run ID for comparison snapshots.

## Fresh checks and real results

```sh
npm run typecheck
npm test
npm run build:engine
npm --prefix services/provider run typecheck
npm --prefix services/provider test
npm --prefix services/provider run test:backend
```

Actual results: root/runtime 3 tests, provider/engine 17 tests, backend 22 tests, all passing. Both typechecks and the production engine build pass. The static GPU probe reports a 2 m plane error of approximately 0.000000362 m and confirms floor exclusion at display pixel ratio 1.5. The lazy viewport bundle is about 2.03 MB gzip, including Spark; the harness entry is about 87 KB gzip.

Real baseline: 2/3 diagnostic encounters detected in time, 66.7% coverage; 8 mm cable first detected and braking requested at 2640 ms; collision at 2971 ms. Higher resolution on identical geometry: 3/3, 100%; first cable detection 2040 ms, braking 2340 ms, stop 3340 ms, zero collisions, one near miss and zero false stops. Stop/no-stop denominators are preserved, including null false-stop rate for the baseline.

Two browser tabs verified controller config 4, one operator execution and matching requested/completed version 4. Sentence authoring advanced the same scenario to version 3 and completed config 5. Reports retained their earlier snapshots. With the local provider stopped and the operator workspace closed, the direct report route loaded and the controller displayed `Waiting for operator`.

Detailed traces, public asset checksums, immutable report JSON and test scope are in `docs/evidence/b/`. Real cached artifacts and their provenance are in `public/demo/`. A value-based scan of candidate files and built browser assets found no supplied API keys or raw owner/controller capabilities.

## Stable identifiers

- Convex dev: `standing-pony-711`.
- Session: `2f1bc296-abfc-4442-ac2e-71a27eb77451`.
- Marble operation: `9faf42c4-d429-4e5c-871a-427caaa2aed2`.
- Marble world: `6fc7e2f0-a62a-4dcf-990b-b94d9cd2e1b5`.
- Baseline run: `jh751ksk7cjsthc9v8kqt4s2g98dtr9q`.
- Higher-resolution run: `jh74wjms48dcah9an7jvq3r9pd8dth1h`.
- Baseline report: `2befc0cd-7508-47f2-9e07-641a2bfc0478`.
- Higher-resolution report: `4b305fa2-c750-4876-8486-3a0e35d745a1`.

No raw capabilities are included. Keep `.local/provider/bootstrap.json` private and ignored. Do not copy it into public assets, evidence or browser build configuration.

## Calibration and limitations

Raw scale is 1.2551026, ground offset 0.8235686. The separately stored SPZ and collider matrices convert the inspected raw frame once. Floor, shelving overlay, axes and a 1 m ruler were inspected. The reference is assumed and scale stays estimated. A verified registration label never means a physical measurement or safety certification.

Tripo authenticated but had no available credits on the final live preflight. The engine uses an explicitly named development box, and reports include that limitation. The Tripo adapter, cache, library and GLB path are implemented, but real generation and rendering are unverified. Two procedural cables are intentional requirements, not observed site hazards. The warehouse and preview are AI-generated. No real venue photo was supplied. The phone-controlled results are simulations, not hardware measurements.

Mint is A's pending asset; the robot is currently procedural. The viewport consumes `platform.visualAsset` when supplied while retaining an independent physical capsule. Runtime model credentials/model configuration were not established; authoring uses the required labeled preset fallback. No runtime model ID or model output is invented. Photo generation, unknown provider frame conventions and external hosted-phone flow remain unverified. New worlds remain blocked until registration is inspected and calibration confirmed.

## Backend freeze and C handoff

Backend implementation is frozen at `213ab41`, included in the tested implementation commit above. The final one-shot deploy completed successfully; no persistent Convex watcher was started. The local provider was stopped for the offline report check. C becomes backend owner only after taking this handoff; keep all other `convex dev` watchers stopped before any C deployment. Use the one-shot command, never competing continuous deployers.

C's next work is composition/release: combine A's UI with these runtime exports, retain the local-service proxy for the operator, configure the deployed app origin and verify the hosted QR/report URLs. C must not fabricate missing Tripo/Mint evidence. B must finish the real Tripo asset validation once account credits are available. No provider credentials should be moved to Convex env settings, hosting, CI or public `VITE_*` variables.

## Fork-only offline Person B supplement, October 15, 2026

The owner explicitly authorized this Person B work in the `lgoyal6/Blindspot` fork, on `build/blindspot-sensor-control` from `b7bce7e566c4c779851161c736eb9f6ddaf1d929`. This supplement adds the opt-in bounded-disparity sensor and perceived-support controller described in `docs/sensor-study.md`. It does not change the historical provider/deployment evidence above or complete its remaining service/physical gates.

Measured implementation checkpoints: `d59f0b8` adds the model, controller, adapters and regression tests; `006fb6c` adds the locked study driver. A subsequent formatting-only commit changes only the two new stereo modules, with identical canonical emitted JavaScript. The shared contract, UI, package manifests/lockfiles, providers and Convex remain unchanged.

The 2,040-cell v3 study reconstructed exactly, including a deterministic 24-cell replay. New-model visibility agreement had zero errors, but held-out conservative control retained 94 collisions, including 19 visible-in-time reactive collisions, and 318 false-stop events across 672 matched cells. Legacy control on the same bounded-model inputs had 96 collisions, 20 visible-in-time reactive collisions and 95 false stops. The geometry-cluster collision interval includes zero. This is not a controller-superiority or safety result. Preserve the adverse v2 results and original historical 33 misses alongside these findings.

The portable protocol and CLI support new runs in separate immutable output directories. The original frozen protocol has an explicit arm-label erratum: unused descriptive fields say model2, while the execution-driving version, actual source and bounded raw records say model3. Original protocol/data and measured source are retained unchanged. Source-hash reconstruction must use the measured checkpoint, not bypass the gate after formatting.

Current release process: the coordinator performs a distinct final source/outcome review and owns the merge after current-head CI. The exact next action is that review and eligible rebase merge in the owner's fork. Physical calibration, device tests, provider/deployment work and external consumers remain separate gates.

The replacement streamed WebGL check completed 64 cells, 16 planes and occlusion/invalid-baseline controls after preserving the first harness's page crash and missing outcomes. Visibility classifications matched across methods, but in the 56 prospective cells raster had eight collisions and 20 false stops versus seven and 27 analytic. All eight exposed regression cells collided under both methods. See the sensor-study document for exact scope, hashes and the failed-harness limitation.

Verification commands: `npm test -- --maxWorkers=2 --no-file-parallelism`, `npm run typecheck`, `npm run build`, plus strict standalone TypeScript checking of `scripts/evaluate-stereo.ts` with ES2023, ESNext/bundler modules, DOM/Node types and unchecked-index access enabled. The resulting suite has 99 tests. No physical/provider work was performed by this supplement.
