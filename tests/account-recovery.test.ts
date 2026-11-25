import { tmpdir } from "node:os";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  readAccount,
  AccountReadError,
  headlessCodexEnv,
  resolveExecutable,
} from "../server/account.ts";
test("account transport times out, tolerates closed connections and recovers without changing authentication", async () => {
  const dir = mkdtempSync(`${tmpdir()}/cdxscope-account-`),
    cli = join(dir, "fixture.mjs");
  const previous = process.env.CDXSCOPE_CODEX;
  process.env.CDXSCOPE_CODEX = cli;
  const script = (body: string) => {
    writeFileSync(cli, "#!/usr/bin/env node\n" + body);
    chmodSync(cli, 0o700);
  };
  try {
    // Network-shaped failures are transient so the collector retries next minute instead of backing off.
    const transient = (pattern: RegExp) => (e: unknown) =>
      e instanceof AccountReadError && e.transient && pattern.test(e.message);
    script("setInterval(()=>{},1000);");
    await assert.rejects(readAccount(300), transient(/timed out/));
    script("process.exit(0);");
    await assert.rejects(readAccount(3000), transient(/closed/));
    script(
      `import{createInterface}from'node:readline';createInterface({input:process.stdin}).on('line',l=>{const m=JSON.parse(l);if(m.id===1)console.log(JSON.stringify({id:1,result:{}}));if(m.id===2)console.log(JSON.stringify({id:2,error:{message:'PRIVATE_AUTH_DETAIL'}}));});`,
    );
    await assert.rejects(
      readAccount(3000),
      (e) =>
        transient(/sign in/i)(e) &&
        !(e as Error).message.includes("PRIVATE_AUTH_DETAIL"),
    );
    // Explicit signed-out / auth-required responses return kind="auth" without leaking raw details.
    script(
      `import{createInterface}from'node:readline';createInterface({input:process.stdin}).on('line',l=>{const m=JSON.parse(l);if(m.id===1)console.log(JSON.stringify({id:1,result:{}}));if(m.id===2)console.log(JSON.stringify({id:2,error:{code:401,message:'Unauthorized: user SECRET_EMAIL not signed in'}}));});`,
    );
    await assert.rejects(
      readAccount(3000),
      (e) =>
        e instanceof AccountReadError &&
        e.kind === "auth" &&
        !e.transient &&
        !e.message.includes("SECRET_EMAIL"),
    );
    // A missing CLI will not fix itself, so it keeps the longer backoff.
    await assert.rejects(
      readAccount(3000, join(dir, "missing-codex")),
      (e) => e instanceof AccountReadError && !e.transient,
    );
    // Recovered fixture also verifies stripped headless env vars reach the spawned child.
    script(
      `import{createInterface}from'node:readline';createInterface({input:process.stdin}).on('line',l=>{const m=JSON.parse(l);if(m.id===1)console.log(JSON.stringify({id:1,result:{}}));if(m.id===2)console.log(JSON.stringify({id:2,result:{fixture:'recovered',noBrowser:process.env.NO_BROWSER,browser:process.env.BROWSER,ci:process.env.CI,noninteractive:process.env.NONINTERACTIVE,display:process.env.DISPLAY??null}}));});`,
    );
    assert.deepEqual(await readAccount(3000), {
      fixture: "recovered",
      noBrowser: "1",
      browser: "",
      ci: "true",
      noninteractive: "1",
      display: null,
    });
  } finally {
    if (previous === undefined) delete process.env.CDXSCOPE_CODEX;
    else process.env.CDXSCOPE_CODEX = previous;
  }
});

test("DNS pre-flight skips spawning codex when offline and headless env strips browser hooks", async () => {
  const dir = mkdtempSync(`${tmpdir()}/cdxscope-preflight-`),
    cli = join(dir, "should-not-run.mjs"),
    marker = join(dir, "spawned.txt");
  writeFileSync(
    cli,
    `#!/usr/bin/env node\nimport{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(marker)},'ran');`,
  );
  chmodSync(cli, 0o700);
  await assert.rejects(
    readAccount(3000, cli, { preflight: async () => false }),
    (e) => e instanceof AccountReadError && e.kind === "offline" && e.transient,
  );
  assert.equal(
    existsSync(marker),
    false,
    "offline pre-flight must skip spawning codex altogether",
  );

  const env = headlessCodexEnv(
    {
      HOME: "/Users/test",
      BROWSER: "/usr/bin/open",
      DISPLAY: ":0",
      PATH: "/usr/bin:/bin:/opt/homebrew/bin",
    },
    "/opt/homebrew/bin",
  );
  assert.equal(env.NO_BROWSER, "1");
  assert.equal(env.BROWSER, "");
  assert.equal(env.CI, "true");
  assert.equal(env.NONINTERACTIVE, "1");
  assert.equal(env.DISPLAY, undefined);
  assert.ok(!env.PATH?.split(":").includes("/usr/bin"));
  assert.equal(
    headlessCodexEnv({ HOME: "/Users/test" }, "/usr/bin").PATH,
    "",
  );
  assert.equal(resolveExecutable("should-not-run.mjs", dir, dir), cli);
});
