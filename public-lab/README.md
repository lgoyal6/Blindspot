# Bounded synthetic sensor lab

Build from the repository root without changing the shared package configuration:

```sh
npm ci
npx vite build --config public-lab/vite.config.ts
```

Deploy public-lab-dist as a static site. The dedicated worker imports the owning
scene generator, bounded disparity model, evaluate function and controller.
It accepts one allowlisted scene, bounded seed, resolution, diameter and named
controller, and is stopped after 15 seconds. It uses no provider, backend,
calibrated camera, image correspondence or physical device.

These are visitor scenarios, not a new frozen comparison. Collision and false
stop results are both shown. The earlier adverse comparison remains explicit.
