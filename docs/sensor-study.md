# Sensor-simulation study

This study freezes engine, sensor-model, oracle and scene-generator versions, input geometry, seeds and factor settings. It evaluates the actual analytic sampler and controller against a separately derived continuous geometry oracle. Deterministic null, off-route and occlusion scenes are controls. Zero stereo baseline, unit mistakes, mismatched versions and changed scene exports are rejected.

Run the existing package test/typecheck/build scripts, with at most two test workers. Bundle `scripts/evaluate-matrix.ts` with the installed esbuild and pass `--out PRIVATE_DIR --lock-only` before running the same command without `--lock-only`. Retained raw records cannot be overwritten. `--reconstruct` recomputes summaries from those records and checks their canonical hash against the original two-pass repeatability receipt. Runtime samples remain measurements from the original run.

The locked detection grid contains four diameters, three resolutions and three width thresholds across 40 geometries, for 1,440 cells. Twelve tuning geometries use separate seeds from 28 held-out geometries. Repeating all cells produced byte-identical deterministic results. Multiple factor cells share a geometry, so cell-level Wilson intervals are only an IID reference, not independent evidence. The report adds counts and intervals using each family/seed geometry as a unit, and retains the small finite synthetic-generator scope.

Held-out results contain 440 in-time and 269 sensor/geometry-limited cases, plus 11 boundary exclusions, 144 null cells and 144 off-route cells. The evaluator agrees with the declared visibility model on those classified cells. This is different from controller success: 33 held-out cells have a reactive-controller miss even though the oracle says the cable is visible in time. Null scenes produce no stops. The observed maximum detection-range lag in held-out cells is about 74 mm. Keep those limitations alongside visibility agreement.

## Reactive-controller misses

`--diagnose-reactive` reads the retained raw records (it does not rerun the study) and, for every reactive miss, recomputes the controller's obstacle-gap estimate at its braking decision and compares it with the oracle's true distance to first contact. All 33 held-out misses come from 5 oblique or partially occluded geometries. In every one, braking starts with less room than the 0.71 m stopping corridor: the controller's estimate, built from 25 sparse cable samples on a 25 mm occupancy grid and refreshed every 50 ms, overestimates the remaining gap by 17 to 149 mm and drops below the corridor 64 to 244 mm late. The resulting 84 to 269 mm shortfall always exceeds the 80 mm clearance margin. `src/engine/sensor-study.test.ts` pins one case so a controller change shows up. The fix belongs to the engine owner (for example, a corridor term for sensing-period travel plus contact-geometry estimation error, or denser in-corridor samples) and has not been made here.

## Sensor seam conformance

`EvaluationOptions.sample` is the engine's existing swappable sensor seam: the analytic sampler in Node and the GPU `DepthSensor` in the browser. The conformance suite runs the production analytic sampler through that seam, requires it to match the built-in default, and shows that two broken samplers (width threshold ignored, empty frames) are caught as false alerts and algorithmic misses. The production GPU `DepthSensor` was also exercised through this seam in headless Chromium using ANGLE Metal on an Apple M3 Pro. The finite raster check used all 40 synthetic geometries, diameters of 8/32 mm, resolutions of 160/640 px and a one-pixel width threshold, for 160 cells. Its evaluator and oracle classifications matched the corresponding analytic cells, with no algorithmic visibility misses or false alerts among the classified cells. The 112 held-out cells included two boundary exclusions and four reactive-controller misses. Detection ranges can differ under raster sampling; this is classification agreement, not byte-identical sensor output. It does not calibrate a physical camera.

## Explicitly unperformed dimensions

The current production sampler is an ideal-depth projected-width approximation. Stereo baseline therefore does not change its detector decisions. Baselines of 60/120 mm are reported through the analytic disparity diagnostic, not counted as two independent detector arms. A calibrated depth-noise/disparity-estimation model is required before claiming baseline-dependent detection quality. The original four-factor detector ambition remains partial on that axis.

The calibration residuals are mathematical round trips inside the same simulation, not camera calibration measurements. No real camera calibration, physical obstacle test or collision-avoidance certification was performed. Real-camera work requires a calibrated device, known dimensions and authorized collection. No paid 3D asset provider, Convex deployment or live service is needed for this local study.

## Person B bounded-disparity supplement, October 15, 2026

The opt-in `bounded-disparity-3` model makes the 60/120 mm baseline an actual detector input. It uses `Z = fx * B / d`, nearest quarter-pixel disparity quantization, a declared 0.25 px matching-error allowance and the resulting 0.375 px total disparity bound. Returns are rejected when the depth interval exceeds 0.25 m or the sensor range. This is a synthetic uncertainty allowance. It does not inject sampled matching noise, perform binocular image matching or calibrate a camera.

`boundedStereoSampler` wraps the analytic sampler, while `DepthSensor` accepts an explicit stereo option for real proxy-depth captures. Both retain width, field-of-view and occlusion gates and attach perceived spatial support. Bounded mode samples cables at intervals of at most 5 mm, rejects cables requiring more than 4,096 subdivisions, and traverses diagnostics in 5 mm steps. The original ideal-depth path retains its 25 cable samples and 25 mm traversal. Dense samples are cached under the documented immutable-scenario assumption.

The optional `conservative-v2` controller computes capsule-front clearance from accepted perceived points and their support, then includes the 70 ms sensing/integration horizon before the existing latency and braking terms. Truth geometry remains confined to collision/oracle and false-stop scoring. Model and controller identities are recorded separately. These choices do not establish collision avoidance.

### Frozen v3 study and adverse results

The v3 protocol was locked before collection after v2 exposed sampling-aliasing and version-identity defects. Three unchanged regression assertions actually failed on v2 and passed after the repair. V2 evidence remains separate: eight visibility disagreements per new-model held-out arm, 24 visible-in-time collisions under conservative control, and 360 versus 84 false-stop events. Those diagnosis-exposed cases are regression evidence for v3.

V3 used tuning seeds 17001/17002 and held-out seeds 18001 through 18004 from the same generator and families. It checked actual non-null geometry exclusion against original and v2-exposed inputs. There are 34 geometry cases but 29 distinct cable/box clusters, including 28 held-out cases and 25 held-out clusters. Identical null scenes share one cluster. Across all arms the complete grid has 2,040 cells. Both bounded-model controller arms use identical sensor inputs and settings.

| Held-out bounded-model outcome | Legacy control | Conservative control |
| --- | ---: | ---: |
| Matched cells | 672 | 672 |
| Total collisions | 96 | 94 |
| Visible-in-time reactive collisions | 20 | 19 |
| False-stop events | 95 | 318 |

The new model had zero visibility-oracle disagreements on this finite grid. Geometry-cluster paired bootstrap intervals, using 10,000 replicates, were [-0.01, 0] for collision-event differences and [0.228333, 0.516667] for false-stop-event differences, measured as conservative minus legacy events per cell after averaging within each geometry. These are not conditional false-stop percentages. The collision interval includes zero and false stops increased substantially. There is no convincing controller-superiority result. The denser bounded path also uses more computation than legacy; this study makes no equal-compute or speed-improvement claim.

Reconstruction reproduced the full summary exactly, and a prescribed 24-cell rerun reproduced deterministic digests. All 1,440 original legacy cells also reproduced their original digest, including the original 33 misses. Running conservative control on those old 33 produced 24 collisions and nine false stops, under the old ideal-depth model. That is historical regression evidence only.

### Reproduction and source boundaries

`scripts/evaluate-stereo.ts` requires `--protocol` and `--out`. Bundle it with the installed esbuild for Node ESM. First invoke it with `--lock-only`, then execute the same inputs without that flag, then use `--reconstruct`. Each output directory is immutable; reconstruction rejects changed critical implementation hashes.

```sh
study_out="$(mktemp -d)"
./node_modules/.bin/esbuild scripts/evaluate-stereo.ts --bundle --platform=node --format=esm --outfile="$study_out/evaluate.mjs"
node "$study_out/evaluate.mjs" --protocol docs/studies/stereo-v3-protocol.json --out "$study_out/records" --lock-only
node "$study_out/evaluate.mjs" --protocol docs/studies/stereo-v3-protocol.json --out "$study_out/records"
node "$study_out/evaluate.mjs" --protocol docs/studies/stereo-v3-protocol.json --out "$study_out/records" --reconstruct
```

 The portable protocol in `docs/studies/stereo-v3-protocol.json` preserves the executed grid and numeric parameters, removes a private provenance path and corrects descriptive arm labels. It is a new input identity and does not replace the original frozen protocol.

The original protocol SHA-256 is `51dd8ae7aa238992d3a3e484ea645f4ff88165288735648d722a15ca2dcf7086`; the raw-results SHA-256 is `d854aef7658b957c29cd419a76cd59fd090b2acc3860c6a4016893aa75915e85`. Erratum: the frozen protocol's unused `arms[1].model` and `arms[2].model` descriptors still say `bounded-disparity-2`. Its execution-driving `versions.new_model`, source and all 1,632 bounded-model rows say `bounded-disparity-3`. Original protocol/data bytes were retained unchanged with a separate hash-bound erratum.

The measured source is preserved in the engine and study-driver commits before the formatting-only successor. Only `stereo-model.ts` and `stereo-oracle.ts` were subsequently formatted and given three-line module headers. Canonical comment-free emitted JavaScript was byte-identical before and after formatting. Reconstruct the original evidence at the measured checkpoint; the successor still correctly fails the original critical-source hash gate.


### Real WebGL subset and retained harness failure

The first v3 browser harness crashed after 27 completion milestones and persisted no per-cell outcomes. Its page-crash state and failed execution were retained. The cause remains unverified; retaining dense playback clouds was a resource risk, not a proven out-of-memory diagnosis.

A separately versioned replacement streamed every cell immediately and used the existing progress callback to rebind only playback-frame point references. It never cleared the sensor-cloud arrays or changed sensor/controller inputs. It completed 64 actual WebGL cells on ANGLE Metal / Apple M3 Pro: 56 seed18001 prospective-conformance cells and eight explicitly retrospective seed16004 regression cells, plus 16 known-depth planes, visible/occluded controls and zero-baseline rejection. Maximum proxy planar depth error was 2.714e-7 m; the occlusion pair retained 1,119 versus zero cable returns.

All 56 analytic outputs matched their immutable study cells with maximum numeric difference zero. Raster and analytic visibility classifications agreed across all 64 cells, with zero oracle disagreements, but controller outcomes were not identical. In the 56 prospective-conformance cells, raster had eight collisions, four visible-in-time collisions and 20 false-stop events, versus seven, three and 27 for analytic. Twelve complete outcome objects differed. Both methods collided in all eight exposed regression cells despite in-time visibility. Those failures remain recorded; visibility fidelity does not establish successful reactive control.

The final local checks cover 99 tests, application typechecks, strict standalone study-driver typechecking and the production Vite build. Four isolated semantic mutants, ignoring width, baseline, depth uncertainty or spatial support, failed meaningful assertions after the same 15-test baseline passed. One earlier full-suite UI async timeout remains unexplained and may be related; matched base/current focused runs passed, and subsequent complete runs passed.

### Remaining boundaries

The experiment uses a single central proxy visibility approximation and a finite synthetic generator with four held-out seeds per family. It is not evidence of real-site generalization, stereo correspondence quality, named-camera calibration, hardware timing, physical collision avoidance, safety certification or external adoption. No provider, Convex, UI, shared-contract or deployment change was part of this fork-only supplement. The full physical and external contract remains partial.
