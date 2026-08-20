#!/usr/bin/env node
// @ts-nocheck

const DEFAULT_ANSWERS = {
  cookVolume: "2",
  heating: "pressure_ih",
  budget: "10to20k",
  priority: "taste",
  installWidth: "free",
};

function parseArgs(argv) {
  const args = { baseUrl: "http://127.0.0.1:8787", mode: "match", category: "rice-cooker" };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--base-url") args.baseUrl = argv[++i];
    else if (value === "--mode") args.mode = argv[++i];
    else if (value === "--category") args.category = argv[++i];
    else if (value === "--answers") args.answers = JSON.parse(argv[++i]);
    else if (value === "--go-url") args.goUrl = argv[++i];
    else if (value === "--help") args.help = true;
    else throw new Error(`unknown argument: ${value}`);
  }
  return args;
}

function usage() {
  console.log(
    `Usage: node scripts/production-smoke.mjs [options]\n\nOptions:\n  --base-url URL       Production or local Worker URL\n  --category KEY       Category key (default: rice-cooker)\n  --mode match|no-match  Diagnosis expectation (default: match)\n  --answers JSON       Override diagnosis answers\n  --go-url URL         Optional active-offer redirect URL to smoke-test\n`
  );
}

async function requestJson(baseUrl, pathname, init = {}) {
  const response = await fetch(new URL(pathname, baseUrl), {
    ...init,
    headers: { accept: "application/json", ...(init.headers ?? {}) },
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    // Keep the status useful even when an upstream returns non-JSON.
  }
  return { response, body };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();
  const baseUrl = new URL(args.baseUrl);
  const answers = args.answers ?? DEFAULT_ANSWERS;
  const checks = [];

  const health = await requestJson(baseUrl, "/api/health");
  assert(health.response.status === 200, `/api/health expected 200, got ${health.response.status}`);
  checks.push("health=200");

  const ready = await requestJson(baseUrl, "/api/ready");
  assert(ready.response.status === 200, `/api/ready expected 200, got ${ready.response.status}`);
  assert(ready.body?.ok === true, "/api/ready body.ok is not true");
  checks.push("ready=200");

  const config = await requestJson(
    baseUrl,
    `/api/config?category=${encodeURIComponent(args.category)}`
  );
  assert(config.response.status === 200, `/api/config expected 200, got ${config.response.status}`);
  assert(config.body?.categoryKey === args.category, "config categoryKey mismatch");
  assert(config.body?.questions?.length > 0, "config has no questions");
  checks.push(`config=${config.body.questions.length} questions`);

  const evaluate = await requestJson(baseUrl, "/api/diagnosis/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ categoryKey: args.category, answers }),
  });
  assert(
    evaluate.response.status === 200,
    `/api/diagnosis/evaluate expected 200, got ${evaluate.response.status}`
  );
  const expectedMatch = args.mode === "match";
  if (expectedMatch) {
    assert(evaluate.body?.matchedCount > 0, "match fixture returned zero candidates");
    assert(evaluate.body?.noMatch === false, "match fixture was marked noMatch");
  } else {
    assert(evaluate.body?.noMatch === true, "no-match fixture was not marked noMatch");
  }
  checks.push(`diagnosis=${expectedMatch ? "match" : "no-match"}`);

  if (args.goUrl) {
    const goResponse = await fetch(new URL(args.goUrl, baseUrl), { redirect: "manual" });
    assert(
      [301, 302, 303, 307, 308].includes(goResponse.status),
      `/go expected redirect, got ${goResponse.status}`
    );
    checks.push(`go=${goResponse.status}`);
  } else {
    checks.push("go=not-run(no active offer token supplied)");
  }

  console.log(
    JSON.stringify({ ok: true, baseUrl: baseUrl.origin, category: args.category, checks }, null, 2)
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })
  );
  process.exitCode = 1;
});
