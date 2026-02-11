import { readFileSync, writeFileSync } from "node:fs";

const INPUT = "tools/recordings/recorded-flow.ts";
const OUTPUT = "config/crawler-flows.json";

const SKIP_LABEL_RE = /save|apply|restart|cancel|close|disable|enable|start|ok|delete|reset|logout|log out|bb registration/i;

function parseLines(text) {
  const lines = text.split(/\r?\n/);
  const gotoRe = /page\.goto\('([^']+)'/;
  const roleRe = /page\.getByRole\('([^']+)', \{ name: '([^']+)'/;
  const steps = [];
  let startUrl = null;

  for (const line of lines) {
    const gotoMatch = line.match(gotoRe);
    if (gotoMatch) {
      startUrl = gotoMatch[1];
      steps.push({ action: "goto", url: startUrl });
      continue;
    }
    const roleMatch = line.match(roleRe);
    if (roleMatch) {
      const role = roleMatch[1];
      const name = roleMatch[2];
      if (SKIP_LABEL_RE.test(name)) continue;
      if (role === "menuitem" || role === "link" || role === "button") {
        steps.push({ action: "click", role, name });
      }
    }
  }

  return { startUrl, steps };
}

function splitByMenuitem(steps) {
  const flows = [];
  let current = null;
  let index = 1;

  for (const step of steps) {
    if (step.action === "goto") {
      continue;
    }
    if (step.role === "menuitem") {
      if (current && current.steps.length > 0) {
        flows.push(current);
      }
      current = {
        id: `recorded-flow-${String(index).padStart(2, "0")}`,
        title: step.name,
        startUrl: null,
        steps: [step],
        modalTriggers: []
      };
      index += 1;
      continue;
    }
    if (!current) {
      current = {
        id: `recorded-flow-${String(index).padStart(2, "0")}`,
        title: "Recorded Flow",
        startUrl: null,
        steps: [],
        modalTriggers: []
      };
      index += 1;
    }
    current.steps.push(step);
  }

  if (current && current.steps.length > 0) {
    flows.push(current);
  }

  return flows;
}

function main() {
  const input = readFileSync(INPUT, "utf8");
  const { startUrl, steps } = parseLines(input);
  const flows = splitByMenuitem(steps).map((flow) => ({
    ...flow,
    startUrl: startUrl ?? "https://192.168.0.107/home/index.html#hashHome"
  }));

  const output = { flows };
  writeFileSync(OUTPUT, JSON.stringify(output, null, 2), "utf8");
  console.log(`Wrote ${OUTPUT} with ${flows.length} flows.`);
}

main();
