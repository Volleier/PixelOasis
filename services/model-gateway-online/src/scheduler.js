import config from "./config.js";

const queue = [];
const controllers = new Map();
let active = 0;

export function enqueue(job, runner) {
  if (queue.some(item => item.job.id === job.id) || controllers.has(job.id)) return;
  queue.push({ job, runner });
  drain();
}

export function cancel(jobId) {
  const index = queue.findIndex(item => item.job.id === jobId);
  if (index !== -1) queue.splice(index, 1);
  const controller = controllers.get(jobId);
  if (controller) controller.abort();
  return index !== -1 || !!controller;
}

export function stats() { return { active, queued: queue.length, concurrency: config.concurrency }; }

function drain() {
  while (active < config.concurrency && queue.length > 0) {
    const item = queue.shift();
    const controller = new AbortController();
    controllers.set(item.job.id, controller);
    active++;
    Promise.resolve(item.runner(item.job, controller.signal)).finally(() => {
      controllers.delete(item.job.id);
      active--;
      drain();
    });
  }
}
