const $ = (id: string) => document.getElementById(id)!;
let worker: Worker | undefined, timer: ReturnType<typeof setTimeout>;
const read = (id: string) => ($(id) as HTMLInputElement).value;
function clear(message: string) { worker?.terminate(); clearTimeout(timer); $('status').textContent = message; $('outcome').textContent = ''; $('details').textContent = ''; ($('run') as HTMLButtonElement).disabled = false; }
$('form').addEventListener('input', () => clear('Inputs changed. Run the simulation again.'));
$('form').addEventListener('submit', (event) => {
  event.preventDefault(); clear('Running the source sensor and controller...'); ($('run') as HTMLButtonElement).disabled = true;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  timer = setTimeout(() => clear('Simulation exceeded 15 seconds. Worker stopped; no result is available.'), 15000);
  worker.onmessage = ({ data }) => {
    worker?.terminate(); clearTimeout(timer); ($('run') as HTMLButtonElement).disabled = false;
    if (data.error) { clear(data.error); return; }
    $('status').textContent = `Simulated outcome: ${data.outcome.termination}`;
    $('outcome').textContent = `Collisions: ${data.outcome.collisions}. False stops: ${data.outcome.falseStopEvents}. Route completed: ${data.outcome.routeCompletionPercent.toFixed(1)}%.`;
    $('details').textContent = JSON.stringify(data, null, 2);
  };
  worker.onerror = () => clear('Simulation failed. No result is available.');
  worker.postMessage({ family: read('family'), seed: Number(read('seed')), resolution: Number(read('resolution')), diameter: Number(read('diameter')), controller: read('controller') });
});
