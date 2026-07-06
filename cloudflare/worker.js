/**
 * 9 Birds — Team Task Board
 * Single-file Cloudflare Worker: serves the app HTML at "/" and a JSON API under "/api".
 * Backed by a D1 database (binding: DB). No dependencies, no build step.
 */

const PEOPLE = ["brandon", "angela", "riley", "jess", "carlos"];
const NAMES = ["Carlos", "Brandon", "Angela", "Riley", "Jess"];
const STATUSES = ["todo", "progress", "review", "done"];
const PRIOS = ["urgent", "high", "medium", "low"];
const DAYS = ["Any", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;

const SEC_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://images.are.na https://d2w9rnfcy7mm78.cloudfront.net; connect-src 'self' https://api.are.na; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SEC_HEADERS },
  });
}
const bad = (error, status = 400) => json({ error }, status);

function str(v, max, min = 1) {
  return typeof v === "string" && v.trim().length >= min && v.length <= max ? v.trim() : null;
}
const by = (v) => (typeof v === "string" ? v.slice(0, 24) : "");
const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

async function readBody(request) {
  try {
    const b = await request.json();
    return b && typeof b === "object" ? b : {};
  } catch {
    return {};
  }
}

async function currentWeek(db) {
  const row = await db.prepare("SELECT value FROM meta WHERE key='current_week'").first();
  return row ? row.value : "";
}

async function getBoard(db) {
  const week = await currentWeek(db);
  const tasks = week
    ? (await db.prepare("SELECT * FROM tasks WHERE week=?1 ORDER BY sort, created_at").bind(week).all()).results || []
    : [];
  const checks =
    (await db.prepare("SELECT task_id, COUNT(*) AS total, SUM(done) AS done FROM checklist GROUP BY task_id").all())
      .results || [];
  const commentCounts =
    (await db.prepare("SELECT task_id, COUNT(*) AS n FROM comments GROUP BY task_id").all()).results || [];
  const throughput =
    (
      await db
        .prepare("SELECT week, COUNT(*) AS n FROM tasks WHERE status='done' GROUP BY week ORDER BY week DESC LIMIT 6")
        .all()
    ).results || [];
  return { week, tasks, checks, commentCounts, throughput: throughput.reverse() };
}

async function createTask(db, body) {
  const person = PEOPLE.includes(body.person) ? body.person : null;
  const title = str(body.title, 300);
  if (!person) return bad("person must be one of: " + PEOPLE.join(", "));
  if (!title) return bad("title is required (max 300 chars)");
  const brand = typeof body.brand === "string" ? body.brand.trim().slice(0, 60) : "";
  const day = DAYS.includes(body.day) ? body.day : "Any";
  const prio = PRIOS.includes(body.prio) ? body.prio : "medium";
  const week = await currentWeek(db);
  if (!week) return bad("No active week", 409);
  const id = newId();
  await db
    .prepare(
      "INSERT INTO tasks (id, week, person, title, brand, day, status, prio, carry, sort, updated_by) VALUES (?1,?2,?3,?4,?5,?6,'todo',?7,0,(SELECT COALESCE(MAX(sort),0)+1 FROM tasks WHERE week=?2),?8)",
    )
    .bind(id, week, person, title, brand, day, prio, by(body.by))
    .run();
  return json({ ok: true, id });
}

async function updateTask(db, id, body) {
  const sets = [];
  const binds = [];
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) return bad("status must be one of: " + STATUSES.join(", "));
    sets.push("status=?" + (binds.push(body.status), binds.length));
  }
  if (body.person !== undefined) {
    if (!PEOPLE.includes(body.person)) return bad("person must be one of: " + PEOPLE.join(", "));
    sets.push("person=?" + (binds.push(body.person), binds.length));
  }
  if (body.prio !== undefined) {
    if (!PRIOS.includes(body.prio)) return bad("prio must be one of: " + PRIOS.join(", "));
    sets.push("prio=?" + (binds.push(body.prio), binds.length));
  }
  if (body.day !== undefined) {
    if (!DAYS.includes(body.day)) return bad("day must be one of: " + DAYS.join(", "));
    sets.push("day=?" + (binds.push(body.day), binds.length));
  }
  if (!sets.length) return bad("Nothing to update — send status, person, prio and/or day");
  sets.push("updated_by=?" + (binds.push(by(body.by)), binds.length));
  sets.push("updated_at=datetime('now')");
  binds.push(id);
  const r = await db
    .prepare("UPDATE tasks SET " + sets.join(", ") + " WHERE id=?" + binds.length)
    .bind(...binds)
    .run();
  if (!r.meta.changes) return bad("Task not found", 404);
  return json({ ok: true });
}

async function rollWeek(db) {
  const week = await currentWeek(db);
  if (!week) return bad("No active week", 409);
  // Next week = this Monday if the board week is stale, otherwise board week + 7 days.
  const cur = new Date(week + "T12:00:00Z");
  const todayMon = new Date();
  const dow = (todayMon.getUTCDay() + 6) % 7;
  todayMon.setUTCDate(todayMon.getUTCDate() - dow);
  const nextDate = todayMon.toISOString().slice(0, 10) > week ? todayMon : new Date(cur.getTime() + 7 * 864e5);
  const next = nextDate.toISOString().slice(0, 10);
  const unfinished =
    (await db.prepare("SELECT * FROM tasks WHERE week=?1 AND status!='done'").bind(week).all()).results || [];
  const stmts = unfinished.map((t) =>
    db
      .prepare(
        "INSERT INTO tasks (id, week, person, title, brand, day, status, prio, carry, sort, updated_by) VALUES (?1,?2,?3,?4,?5,?6,'todo',?7,?8,?9,'Carlos')",
      )
      .bind(newId(), next, t.person, t.title, t.brand, t.day, t.prio || "medium", (t.carry || 0) + 1, t.sort),
  );
  stmts.push(db.prepare("UPDATE meta SET value=?1 WHERE key='current_week'").bind(next));
  await db.batch(stmts);
  return json({ ok: true, week: next, carried: unfinished.length });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method;
    const db = env.DB;

    try {
      if (path === "/" && method === "GET") {
        return new Response(PAGE, {
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...SEC_HEADERS },
        });
      }

      if (!path.startsWith("/api")) return bad("Not found", 404);
      if (!db) return bad("Database not provisioned", 503);

      if (path === "/api/board" && method === "GET") return json(await getBoard(db));

      if (path === "/api/tasks" && method === "POST") return createTask(db, await readBody(request));

      let m;
      if ((m = path.match(/^\/api\/tasks\/([^/]+)$/)) && (method === "PATCH" || method === "POST")) {
        const id = m[1];
        if (!ID_RE.test(id)) return bad("Invalid id");
        return updateTask(db, id, await readBody(request));
      }

      if ((m = path.match(/^\/api\/tasks\/([^/]+)\/delete$/)) && method === "POST") {
        const id = m[1];
        if (!ID_RE.test(id)) return bad("Invalid id");
        const body = await readBody(request);
        if (body.by !== "Carlos") return bad("Only Carlos can delete tasks", 403);
        const r = await db.prepare("DELETE FROM tasks WHERE id=?1").bind(id).run();
        await db.prepare("DELETE FROM checklist WHERE task_id=?1").bind(id).run();
        await db.prepare("DELETE FROM comments WHERE task_id=?1").bind(id).run();
        if (!r.meta.changes) return bad("Task not found", 404);
        return json({ ok: true });
      }

      if ((m = path.match(/^\/api\/tasks\/([^/]+)\/detail$/)) && method === "GET") {
        const id = m[1];
        if (!ID_RE.test(id)) return bad("Invalid id");
        const checklist =
          (await db.prepare("SELECT * FROM checklist WHERE task_id=?1 ORDER BY sort, id").bind(id).all()).results || [];
        const comments =
          (await db.prepare("SELECT * FROM comments WHERE task_id=?1 ORDER BY created_at").bind(id).all()).results || [];
        return json({ checklist, comments });
      }

      if (path === "/api/checklist" && method === "POST") {
        const body = await readBody(request);
        const taskId = typeof body.task_id === "string" && ID_RE.test(body.task_id) ? body.task_id : null;
        const label = str(body.label, 200);
        if (!taskId) return bad("Invalid task_id");
        if (!label) return bad("label is required (max 200 chars)");
        const id = newId();
        await db
          .prepare(
            "INSERT INTO checklist (id, task_id, label, sort) VALUES (?1,?2,?3,(SELECT COALESCE(MAX(sort),0)+1 FROM checklist WHERE task_id=?2))",
          )
          .bind(id, taskId, label)
          .run();
        return json({ ok: true, id });
      }

      if ((m = path.match(/^\/api\/checklist\/([^/]+)\/toggle$/)) && method === "POST") {
        const id = m[1];
        if (!ID_RE.test(id)) return bad("Invalid id");
        const body = await readBody(request);
        const r = await db.prepare("UPDATE checklist SET done=?1 WHERE id=?2").bind(body.done ? 1 : 0, id).run();
        if (!r.meta.changes) return bad("Checklist item not found", 404);
        return json({ ok: true });
      }

      if (path === "/api/comments" && method === "POST") {
        const body = await readBody(request);
        const taskId = typeof body.task_id === "string" && ID_RE.test(body.task_id) ? body.task_id : null;
        const author = NAMES.includes(body.author) ? body.author : null;
        const text = str(body.body, 1000);
        if (!taskId) return bad("Invalid task_id");
        if (!author) return bad("author must be one of: " + NAMES.join(", "));
        if (!text) return bad("body is required (max 1000 chars)");
        const id = newId();
        await db
          .prepare("INSERT INTO comments (id, task_id, author, body) VALUES (?1,?2,?3,?4)")
          .bind(id, taskId, author, text)
          .run();
        return json({ ok: true, id });
      }

      if (path === "/api/week/roll" && method === "POST") {
        const body = await readBody(request);
        if (body.by !== "Carlos") return bad("Only Carlos can roll the week", 403);
        return rollWeek(db);
      }

      return bad("Not found", 404);
    } catch (e) {
      return bad("Server error: " + (e && e.message ? e.message : "unknown"), 500);
    }
  },
};

/* ============================================================
   The app — a single HTML page (design ported from index.html,
   demo data replaced with live /api calls).
   ============================================================ */
const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>9 Birds Creative — Team Task Manager</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Archivo:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<meta name="description" content="The 9 Birds Creative team task manager — a Kanban board across every brand, a focused single-task view, and filter-by-teammate. Built in the 9 Birds visual identity.">
<style>
  :root{
    /* 9 Birds brand system */
    --ink:#242422; --ink-soft:#57534C; --ink-faint:#969188;
    --canvas:#EDEDEB; --surface:#F8F8F8; --surface-2:#F0F0EE;
    --border:#E0DDD5; --border-soft:#E8E6DF;
    --dark:#141413; --dark-2:#242422; --on-dark:#EDEDEB; --on-dark-soft:#9E9A90;
    --accent:#2E6EDD; --accent-2:#0069FF; --accent-wash:#E7EEFC; --accent-dark:#85A9F2;
    --good:#3C8C5F; --good-wash:#E4F0E8;
    --warn:#B5842B; --warn-wash:#F3ECDD;
    --crit:#C0392B; --crit-wash:#F3E2DF;
    --shadow-sm:0 1px 2px rgba(36,36,34,.04);
    --shadow-md:0 14px 40px -18px rgba(36,36,34,.28);
    --r:8px;
    --grid:rgba(36,36,34,.055);
    --grid-dark:rgba(255,255,255,.05);
    --serif:"Fraunces",Georgia,"Times New Roman",serif;
    --sans:"Archivo","Helvetica Neue",Arial,system-ui,sans-serif;
    --mono:"Space Mono",ui-monospace,"SF Mono",Menlo,monospace;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{font-family:var(--sans);color:var(--ink);background:var(--canvas);
    -webkit-font-smoothing:antialiased;font-size:14px;line-height:1.45}
  .tnum{font-variant-numeric:tabular-nums}
  button{font-family:inherit;cursor:pointer;border:none;background:none;color:inherit}
  svg{display:block}
  ::selection{background:var(--accent-wash)}
  h1,h2,h3,h4{letter-spacing:-.01em}

  .app{display:grid;grid-template-columns:250px 1fr;height:100vh;min-height:100dvh;overflow:hidden}

  /* ---------- sidebar (dark, editorial) ---------- */
  .side{background:var(--dark);color:var(--on-dark);display:flex;flex-direction:column;
    padding:20px 14px;gap:22px;overflow-y:auto}
  .brandmark{display:flex;align-items:center;gap:11px;padding:2px 6px}
  .logo{width:36px;height:36px;border-radius:9px;background:var(--accent);display:grid;place-items:center;color:#fff}
  .brandmark b{font-family:var(--serif);font-size:18px;font-weight:400;display:block;line-height:1;letter-spacing:0}
  .brandmark span{font-size:11px;color:var(--on-dark-soft);letter-spacing:.02em}

  .navsec{display:flex;flex-direction:column;gap:2px}
  .navsec .label{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;
    color:var(--on-dark-soft);padding:8px 8px 5px}
  .nav{display:flex;align-items:center;gap:11px;padding:9px 10px;border-radius:8px;color:var(--on-dark);
    font-weight:500;font-size:13.5px;transition:background .15s,color .15s;width:100%;text-align:left}
  .nav svg{width:17px;height:17px;flex:none;stroke-width:1.9}
  .nav:hover{background:rgba(255,255,255,.06)}
  .nav.active{background:rgba(46,110,221,.20);color:var(--accent-dark);font-weight:600}
  .nav .count{margin-left:auto;font-size:11px;color:var(--on-dark-soft);font-weight:600}
  .nav.active .count{color:var(--accent-dark)}

  .brandrow{display:flex;align-items:center;gap:11px;padding:7px 10px;border-radius:7px;color:var(--on-dark);
    font-size:12.5px;font-weight:500;width:100%;text-align:left;transition:background .15s;opacity:.9}
  .brandrow:hover{background:rgba(255,255,255,.06);opacity:1}
  .dot{width:9px;height:9px;border-radius:50%;flex:none}
  .brandrow .count{margin-left:auto;font-size:11px;color:var(--on-dark-soft)}

  .side-foot{margin-top:auto;display:flex;align-items:center;gap:11px;padding:12px 8px 4px;
    border-top:1px solid rgba(255,255,255,.09)}
  .side-foot .meta{font-size:12px;line-height:1.3}
  .side-foot .meta b{font-weight:600;font-size:12.5px}
  .side-foot .meta span{color:var(--on-dark-soft)}

  /* ---------- main ---------- */
  .main{display:flex;flex-direction:column;overflow:hidden;background:var(--canvas)}
  .topbar{display:flex;align-items:center;gap:14px;padding:15px 26px;background:var(--surface);
    border-bottom:1px solid var(--border);flex:none}
  .topbar .title h1{font-family:var(--serif);font-size:22px;font-weight:400;letter-spacing:0}
  .topbar .title p{font-size:12px;color:var(--ink-faint);margin-top:1px}
  .search{display:flex;align-items:center;gap:8px;background:var(--surface-2);border:1px solid transparent;
    border-radius:9px;padding:8px 12px;width:250px;margin-left:8px;transition:border-color .15s,background .15s}
  .search:focus-within{background:var(--surface);border-color:var(--border)}
  .search svg{width:16px;height:16px;color:var(--ink-faint);flex:none}
  .search input{border:none;background:none;outline:none;font-family:inherit;font-size:13.5px;width:100%;color:var(--ink)}
  .search input::placeholder{color:var(--ink-faint)}
  .search kbd{font-family:var(--mono);font-size:10.5px;color:var(--ink-faint);background:var(--surface);
    border:1px solid var(--border);border-radius:5px;padding:1px 5px}
  .spacer{margin-left:auto}

  .segmented{display:flex;background:var(--surface-2);border-radius:9px;padding:3px;gap:2px}
  .seg{display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:7px;font-size:12.5px;
    font-weight:600;color:var(--ink-soft);transition:all .15s}
  .seg svg{width:15px;height:15px;stroke-width:2}
  .seg.active{background:var(--surface);color:var(--ink);box-shadow:var(--shadow-sm)}
  .seg:not(.active):hover{color:var(--ink)}

  .iconbtn{width:38px;height:38px;border-radius:9px;display:grid;place-items:center;color:var(--ink-soft);
    background:var(--surface-2);transition:all .15s;position:relative}
  .iconbtn:hover{color:var(--ink);background:var(--border)}
  .iconbtn svg{width:18px;height:18px;stroke-width:1.9}
  .iconbtn .badge{position:absolute;top:7px;right:8px;width:7px;height:7px;border-radius:50%;
    background:var(--crit);border:2px solid var(--surface-2)}

  .btn-primary{display:flex;align-items:center;gap:7px;background:var(--accent);color:#fff;font-weight:600;
    font-size:13.5px;padding:9px 15px;border-radius:9px;box-shadow:var(--shadow-sm);transition:transform .12s,background .15s}
  .btn-primary svg{width:16px;height:16px;stroke-width:2.4}
  .btn-primary:hover{background:var(--accent-2)}
  .btn-primary:active{transform:translateY(1px)}

  /* ---------- filter bar ---------- */
  .filterbar{display:flex;align-items:center;gap:12px;padding:12px 26px;background:var(--surface);
    border-bottom:1px solid var(--border);flex:none;overflow-x:auto}
  .avstack{display:flex}
  .avstack .avatar{margin-left:-8px;border:2px solid var(--surface);cursor:pointer;transition:transform .12s}
  .avstack .avatar:first-child{margin-left:0}
  .avstack .avatar:hover{transform:translateY(-2px);z-index:2}
  .avstack .avatar.dim{opacity:.32}
  .fdiv{width:1px;height:22px;background:var(--border);flex:none}
  .flabel{font-size:10.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-faint)}
  .chip{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:500;color:var(--ink-soft);
    padding:6px 11px;border:1px solid var(--border);border-radius:20px;background:var(--surface);transition:all .15s;white-space:nowrap}
  .chip:hover{border-color:var(--ink-faint);color:var(--ink)}
  .chip.on{background:var(--accent-wash);border-color:transparent;color:var(--accent);font-weight:600}
  .chip .dot{width:8px;height:8px}
  .clearfilter{font-size:12px;color:var(--accent);font-weight:600;margin-left:auto;white-space:nowrap}

  .content{flex:1;overflow:auto;padding:20px 26px 34px}
  .view{display:none}
  .view.active{display:block}

  /* ---------- stats strip ---------- */
  .stats{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin-bottom:22px}
  .stat{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:15px 16px;
    display:flex;flex-direction:column;gap:9px;box-shadow:var(--shadow-sm)}
  .stat .k{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-faint)}
  .stat .v{font-family:var(--serif);font-size:30px;font-weight:400;line-height:1;color:var(--accent)}
  .stat .v.neutral{color:var(--ink)}
  .stat .sub{font-size:11.5px;color:var(--ink-faint);display:flex;align-items:center;gap:5px}
  .trend{display:inline-flex;align-items:center;gap:2px;font-weight:700;font-size:11px}
  .trend.up{color:var(--good)}
  .trend.down{color:var(--crit)}
  .bar{height:5px;border-radius:3px;background:var(--surface-2);overflow:hidden}
  .bar>i{display:block;height:100%;border-radius:3px}

  /* ---------- board ---------- */
  .board{display:grid;grid-template-columns:repeat(4,minmax(266px,1fr));gap:16px;align-items:start}
  .col{display:flex;flex-direction:column;gap:12px;min-width:0}
  .col-head{display:flex;align-items:center;gap:9px;padding:2px 4px}
  .col-head .swatch{width:9px;height:9px;border-radius:3px;flex:none}
  .col-head h3{font-size:13px;font-weight:700}
  .col-head .n{font-size:11px;font-weight:600;color:var(--ink-faint);background:var(--surface);
    border:1px solid var(--border);border-radius:20px;padding:1px 8px}
  .col-head .add{margin-left:auto;width:24px;height:24px;border-radius:7px;display:grid;place-items:center;
    color:var(--ink-faint);transition:all .15s}
  .col-head .add:hover{background:var(--surface);color:var(--ink)}
  .col-head .add svg{width:15px;height:15px;stroke-width:2.2}
  .col-body{display:flex;flex-direction:column;gap:10px}

  .card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:13px 14px;
    box-shadow:var(--shadow-sm);position:relative;overflow:hidden;cursor:pointer;
    transform-style:preserve-3d;transition:box-shadow .2s ease,transform .16s ease,border-color .2s ease}
  .card:hover{box-shadow:var(--shadow-md);border-color:var(--ink-faint)}
  .card.tilting{transition:box-shadow .2s ease,border-color .2s ease}
  .card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:transparent;z-index:2}
  .card.p-urgent::before{background:var(--crit)}
  .card.p-high::before{background:var(--warn)}
  .card::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:0;
    transition:opacity .25s ease;z-index:1;
    background:radial-gradient(340px circle at var(--gx,50%) var(--gy,50%), rgba(46,110,221,.16), transparent 62%)}
  .card:hover::after{opacity:1}
  .card-top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px}
  .tag{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:var(--ink-soft);
    background:var(--surface-2);border:1px solid var(--border-soft);border-radius:20px;padding:2px 9px 2px 7px}
  .prio{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:2px 8px;border-radius:5px;
    background:var(--surface-2);border:1px solid var(--border-soft)}
  .prio.urgent{color:var(--crit)}
  .prio.high{color:#96701F}
  .prio.medium{color:var(--accent)}
  .prio.low{color:var(--ink-faint)}
  .card h4{font-size:13.5px;font-weight:600;line-height:1.35;margin-bottom:11px;text-wrap:balance}
  .card.done h4{color:var(--ink-soft);text-decoration:line-through;text-decoration-color:var(--border)}

  .progress{margin-bottom:11px}
  .progress .ptop{display:flex;justify-content:space-between;font-size:11px;color:var(--ink-faint);margin-bottom:5px;font-weight:500}
  .card-foot{display:flex;align-items:center;gap:10px}
  .due{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;color:var(--ink-soft)}
  .due svg{width:13px;height:13px;stroke-width:2;color:var(--ink-faint)}
  .due.over{color:var(--crit)} .due.over svg{color:var(--crit)}
  .due.today{color:var(--warn)} .due.today svg{color:var(--warn)}
  .metas{display:flex;align-items:center;gap:11px;margin-left:auto}
  .metaic{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:600;color:var(--ink-faint)}
  .metaic svg{width:13px;height:13px;stroke-width:2}
  .avatar{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;color:#fff;
    font-size:10.5px;font-weight:700;flex:none}
  .avatar.sm{width:22px;height:22px;font-size:10px}
  .avatar.lg{width:32px;height:32px;font-size:12px}
  .col.done-col .card{background:var(--surface-2)}

  /* ---------- list view ---------- */
  .list{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);overflow:hidden;box-shadow:var(--shadow-sm)}
  .lgroup-head{display:flex;align-items:center;gap:9px;padding:11px 18px;background:var(--surface-2);
    border-bottom:1px solid var(--border);border-top:1px solid var(--border)}
  .lgroup-head:first-child{border-top:none}
  .lgroup-head .swatch{width:9px;height:9px;border-radius:3px}
  .lgroup-head h3{font-size:12px;font-weight:700}
  .lgroup-head .n{font-size:11px;color:var(--ink-faint);font-weight:600}
  .lrow{display:grid;grid-template-columns:20px 1fr 132px 104px 92px 76px;align-items:center;gap:14px;
    padding:11px 18px;border-bottom:1px solid var(--border-soft);transition:background .12s;cursor:pointer}
  .lrow:last-child{border-bottom:none}
  .lrow:hover{background:var(--surface-2)}
  .lcheck{width:17px;height:17px;border-radius:5px;border:1.5px solid var(--ink-faint);display:grid;place-items:center}
  .lrow.done .lcheck{background:var(--good);border-color:var(--good)}
  .lrow.done .lcheck svg{width:11px;height:11px;color:#fff;stroke-width:3}
  .ltitle{display:flex;align-items:center;gap:9px;min-width:0}
  .ltitle .tt{font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .lrow.done .ltitle .tt{color:var(--ink-soft);text-decoration:line-through;text-decoration-color:var(--border)}
  .lmeta{font-size:12px;color:var(--ink-soft);font-weight:500;display:flex;align-items:center;gap:6px}
  .hidden{display:none!important}
  .fade{opacity:.28;filter:saturate(.4)}

  /* ---------- section header (shared) ---------- */
  .vhead{margin-bottom:18px}
  .vhead h2{font-family:var(--serif);font-size:24px;font-weight:400}
  .vhead p{font-size:13px;color:var(--ink-faint);margin-top:3px}

  /* ---------- my tasks ---------- */
  .focus{background:var(--dark);color:var(--on-dark);border-radius:var(--r);padding:22px 24px;
    display:flex;align-items:center;gap:22px;margin-bottom:22px}
  .focus .big{font-family:var(--serif);font-size:44px;line-height:1;color:var(--accent-dark)}
  .focus .fk{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--on-dark-soft);margin-bottom:6px}
  .focus .ftxt{font-size:14px;line-height:1.55;max-width:520px}
  .focus .ftxt b{color:#fff}
  .fdivv{width:1px;align-self:stretch;background:rgba(255,255,255,.12)}

  /* ---------- calendar ---------- */
  .cal{display:grid;grid-template-columns:repeat(7,1fr);gap:12px}
  .calday{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);min-height:230px;
    padding:11px;display:flex;flex-direction:column;gap:8px;box-shadow:var(--shadow-sm)}
  .calday.today{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
  .calhd{display:flex;align-items:baseline;justify-content:space-between}
  .calhd .dow{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-faint)}
  .calhd .dnum{font-family:var(--serif);font-size:17px}
  .calday.today .dnum{color:var(--accent)}
  .calchip{border-left:3px solid var(--ink-faint);background:var(--surface-2);border-radius:6px;
    padding:6px 8px;font-size:11.5px;line-height:1.3;cursor:pointer;transition:transform .12s}
  .calchip:hover{transform:translateX(2px)}
  .calchip .cb{font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:.03em;color:var(--ink-faint);display:block;margin-bottom:2px}
  .calchip .ct{font-weight:600;color:var(--ink);display:block}
  .calempty{font-size:11px;color:var(--ink-faint);margin-top:auto;text-align:center;padding:8px 0}

  /* ---------- reports ---------- */
  .rgrid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .panel{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:20px;box-shadow:var(--shadow-sm)}
  .panel.wide{grid-column:1/-1}
  .panel h3{font-size:14px;font-weight:700;margin-bottom:3px}
  .panel .psub{font-size:12px;color:var(--ink-faint);margin-bottom:18px}
  .hbar{display:flex;align-items:center;gap:12px;margin-bottom:13px}
  .hbar .hlabel{width:150px;font-size:12.5px;font-weight:500;display:flex;align-items:center;gap:7px;flex:none}
  .hbar .htrack{flex:1;height:9px;background:var(--surface-2);border-radius:5px;overflow:hidden}
  .hbar .htrack i{display:block;height:100%;border-radius:5px}
  .hbar .hval{width:24px;text-align:right;font-size:12.5px;font-weight:700;color:var(--ink-soft)}
  .cols{display:flex;align-items:flex-end;gap:14px;height:180px;padding-top:10px}
  .colw{flex:1;display:flex;flex-direction:column;align-items:center;gap:8px;height:100%;justify-content:flex-end}
  .colw .cbar{width:100%;max-width:46px;border-radius:6px 6px 0 0;background:var(--accent);position:relative;transition:height .5s cubic-bezier(.2,.8,.2,1)}
  .colw .cbar.muted{background:var(--border)}
  .colw .cbar span{position:absolute;top:-20px;left:50%;transform:translateX(-50%);font-size:11.5px;font-weight:700;color:var(--ink-soft)}
  .colw .clab{font-size:11px;color:var(--ink-faint);font-weight:600}
  .stacked{display:flex;height:26px;border-radius:7px;overflow:hidden;margin-bottom:16px}
  .stacked i{height:100%}
  .legend{display:flex;gap:20px;flex-wrap:wrap}
  .legend span{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--ink-soft);font-weight:500}
  .legend .sw{width:11px;height:11px;border-radius:3px}
  .cap{display:flex;align-items:center;gap:12px;margin-bottom:14px}
  .cap .who{width:88px;display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:500;flex:none}
  .cap .ctrack{flex:1;height:22px;background:var(--surface-2);border-radius:6px;position:relative;overflow:hidden}
  .cap .ctrack i{display:block;height:100%;border-radius:6px;background:var(--accent)}
  .cap .cn{width:56px;text-align:right;font-size:12px;color:var(--ink-faint);font-weight:600}

  /* ---------- task view (focused single task) ---------- */
  .scrim{position:fixed;inset:0;background:rgba(20,20,19,.5);opacity:0;pointer-events:none;transition:opacity .25s;z-index:40}
  .scrim.open{opacity:1;pointer-events:auto}
  .drawer{position:fixed;inset:0;margin:auto;width:min(960px,94vw);height:min(88vh,780px);background:var(--surface);
    border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow-md);transform:scale(.97);opacity:0;
    pointer-events:none;transition:opacity .22s ease,transform .22s cubic-bezier(.3,.8,.3,1);z-index:41;
    display:flex;flex-direction:column;overflow:hidden}
  .drawer.open{transform:none;opacity:1;pointer-events:auto}
  .tv-head{display:flex;align-items:center;gap:12px;padding:15px 22px;border-bottom:1px solid var(--border);flex:none}
  .tv-crumb{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:var(--ink-faint)}
  .tv-crumb .sep{color:var(--border-strong,#CFC9BC)}
  .tv-crumb .dot{width:8px;height:8px}
  .tv-crumb b{color:var(--ink-soft);font-weight:600}
  .dr-close{width:32px;height:32px;border-radius:8px;display:grid;place-items:center;color:var(--ink-soft);transition:background .15s;margin-left:auto}
  .dr-close:hover{background:var(--surface-2)}
  .dr-close svg{width:18px;height:18px;stroke-width:2}
  .tv-body{flex:1;display:grid;grid-template-columns:1fr 300px;overflow:hidden}
  .tv-main{overflow-y:auto;padding:26px 30px;display:flex;flex-direction:column;gap:28px}
  .tv-main h2{font-family:var(--serif);font-size:27px;font-weight:400;line-height:1.2;text-wrap:balance}
  .tv-rail{border-left:1px solid var(--border);background:var(--surface-2);overflow-y:auto;padding:24px 22px;display:flex;flex-direction:column;gap:20px}
  .dsec-t{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-faint);margin-bottom:12px;
    display:flex;align-items:center;justify-content:space-between}
  .dr-desc{font-size:14px;line-height:1.65;color:var(--ink-soft)}
  .statuspill{display:inline-flex;align-items:center;gap:7px;font-size:11.5px;font-weight:700;padding:3px 11px;border-radius:20px;
    background:var(--surface);border:1px solid var(--border-soft)}
  /* subtasks */
  .subprog{display:flex;align-items:center;gap:12px;margin-bottom:8px}
  .subprog .bar{flex:1;height:6px}
  .subprog .sc{font-size:12px;font-weight:700;color:var(--ink-soft)}
  .checkrow{display:flex;align-items:center;gap:11px;padding:8px 0;font-size:13.5px;cursor:pointer;border-bottom:1px solid var(--border-soft)}
  .checkrow:hover .cbx{border-color:var(--accent)}
  .checkrow .cbx{width:18px;height:18px;border-radius:5px;border:1.5px solid var(--ink-faint);display:grid;place-items:center;flex:none;transition:all .12s}
  .checkrow.on .cbx{background:var(--good);border-color:var(--good)}
  .checkrow.on .cbx svg{width:11px;height:11px;color:#fff;stroke-width:3}
  .checkrow.on span{color:var(--ink-faint);text-decoration:line-through;text-decoration-color:var(--border-strong,#CFC9BC)}
  .addrow{display:flex;align-items:center;gap:11px;padding:9px 0;font-size:13px;color:var(--ink-faint);cursor:pointer}
  .addrow .cbx{width:18px;height:18px;border-radius:5px;border:1.5px dashed var(--ink-faint);display:grid;place-items:center;flex:none}
  .addrow:hover{color:var(--accent)}.addrow:hover .cbx{border-color:var(--accent)}
  /* attachments */
  .files{display:flex;flex-direction:column;gap:8px}
  .filechip{display:flex;align-items:center;gap:11px;padding:10px 13px;border:1px solid var(--border);border-radius:9px;
    background:var(--surface-2);font-size:12.5px;font-weight:500;cursor:pointer;transition:border-color .15s}
  .filechip:hover{border-color:var(--ink-faint)}
  .filechip svg{width:17px;height:17px;color:var(--ink-faint);flex:none}
  .filechip .fsz{margin-left:auto;color:var(--ink-faint);font-size:11.5px;font-weight:500}
  /* activity */
  .comment{display:flex;gap:11px;margin-bottom:16px}
  .comment .cbubble{background:var(--surface-2);border-radius:10px;padding:10px 13px;font-size:13.5px;line-height:1.55}
  .comment .cwho{font-weight:700;font-size:12px;margin-bottom:2px}
  .comment .ctime{font-size:11px;color:var(--ink-faint);margin-top:4px}
  .composer{display:flex;gap:11px;margin-top:4px}
  .composer .cin{flex:1;border:1px solid var(--border);border-radius:10px;background:var(--surface);padding:10px 13px;
    font-family:inherit;font-size:13.5px;color:var(--ink);resize:none;min-height:40px;line-height:1.5;outline:none;transition:border-color .15s}
  .composer .cin:focus{border-color:var(--accent)}
  .composer .cin::placeholder{color:var(--ink-faint)}
  /* rail */
  .rail-grp{display:flex;flex-direction:column;gap:7px}
  .rail-k{font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--ink-faint)}
  .rail-v{font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px}
  .rail-v svg{width:14px;height:14px;stroke-width:2;color:var(--ink-faint);flex:none}
  .rail-div{height:1px;background:var(--border)}
  .tv-actions{display:flex;flex-direction:column;gap:9px;margin-top:2px}
  .btn-primary.full,.btn-ghost.full{justify-content:center;width:100%}
  .btn-ghost{display:flex;align-items:center;gap:7px;padding:9px 15px;border-radius:9px;border:1px solid var(--border);
    font-weight:600;font-size:13px;color:var(--ink-soft);transition:all .15s}
  .btn-ghost:hover{background:var(--surface);color:var(--ink)}
  .btn-ghost svg{width:15px;height:15px;stroke-width:2}

  @keyframes pop{0%{transform:scale(.96);opacity:0}100%{transform:scale(1);opacity:1}}
  .justadded{animation:pop .28s ease}
  .toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);opacity:0;
    background:var(--dark);color:#fff;font-size:13px;font-weight:500;padding:11px 18px;border-radius:10px;
    box-shadow:var(--shadow-md);transition:transform .3s,opacity .3s;pointer-events:none;z-index:60;display:flex;align-items:center;gap:9px}
  .toast.show{transform:translateX(-50%) translateY(0);opacity:1}
  .toast svg{width:16px;height:16px;color:var(--accent-dark);stroke-width:2.4}

  @media (max-width:1180px){
    .app{grid-template-columns:1fr}.side{display:none}.stats{grid-template-columns:repeat(2,1fr)}
    .board{grid-auto-flow:column;grid-auto-columns:82%;grid-template-columns:none;overflow-x:auto;padding-bottom:10px}
    .rgrid{grid-template-columns:1fr}.cal{grid-template-columns:1fr;gap:10px}.calday{min-height:auto}.search{display:none}
    .drawer{height:92vh;border-radius:14px}
    .tv-body{grid-template-columns:1fr;overflow-y:auto}
    .tv-main,.tv-rail{overflow:visible}
    .tv-rail{border-left:none;border-top:1px solid var(--border)}
  }
  /* ============================================================
     AESTHETIC LAYER — "research surface" (Are.na-influenced)
     dot-grid, monospace micro-typography, index marks, crop ticks
     ============================================================ */

  /* -- dot-grid graph-paper surfaces (the star: board as a curated index) -- */
  .content{background-image:radial-gradient(var(--grid) 1px, transparent 1px);background-size:24px 24px;background-position:12px 12px}
  .side{background-image:radial-gradient(var(--grid-dark) 1px, transparent 1px);background-size:22px 22px}

  /* -- display type (Fraunces, optical) -- */
  .topbar .title h1,.vhead h2,.tv-main h2,.drawer h2,.dr-body h2{font-weight:500;letter-spacing:-.02em}
  .stat .v,.focus .big{font-weight:500;letter-spacing:-.025em}
  .brandmark b{font-size:20px;font-weight:500;letter-spacing:-.01em}

  /* -- monospace micro-typography (labels / data / metadata) -- */
  .flabel,.navsec .label,.stat .k,.dsec-t,.rail-k,.calhd .dow,
  .col-head .n,.nav .count,.brandrow .count,.due,.metaic,.progress .ptop,
  .cap .cn,.hbar .hval,.colw .clab,.comment .ctime,.calchip .cb,.search kbd,
  .stat .sub,.lmeta,.legend span,.chip,.seg,.statuspill,.tag,.prio,
  .clearfilter,.code,.colidx,.board-coord,.brandmark span,.subprog .sc,
  .col-head .add,.trend{font-family:var(--mono)}

  .flabel,.navsec .label,.stat .k,.dsec-t,.rail-k,.calhd .dow{letter-spacing:.11em}

  /* -- flatten the chrome: hairlines over fills, Are.na restraint -- */
  .tag{background:transparent;border:none;padding:0;color:var(--ink-soft);
    text-transform:uppercase;letter-spacing:.05em;font-size:10px;font-weight:400}
  .prio{background:transparent;border:none;padding:0;font-size:9.5px;letter-spacing:.06em}
  .card-top{margin-bottom:11px;justify-content:flex-start;gap:9px}
  .card-top .prio{margin-left:auto}
  .card-top .tag{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .code{font-size:10px;font-weight:700;letter-spacing:.02em;color:var(--accent)}
  .prio.medium{color:var(--ink-faint)}

  /* -- column index numbering (01–04): the recurring motif -- */
  .colidx{font-size:12px;font-weight:700;letter-spacing:.04em;color:var(--ink-faint);
    font-variant-numeric:tabular-nums}
  .col-head .swatch{width:6px;height:6px;border-radius:50%}

  /* -- crop-mark corner ticks on panels (design-tool micrograph) -- */
  .stat,.panel,.calday,.focus{position:relative}
  .stat::before,.panel::before,.focus::before{content:"";position:absolute;top:9px;right:9px;
    width:7px;height:7px;border-top:1px solid currentColor;border-right:1px solid currentColor;
    opacity:.28;pointer-events:none;color:var(--ink-faint)}
  .focus::before{color:var(--on-dark-soft);opacity:.5}

  /* -- board coordinate header (aspirational index line) -- */
  .board-coord{display:flex;align-items:center;gap:16px;padding:0 2px 14px;margin-bottom:18px;
    border-bottom:1px solid var(--border);font-family:var(--mono);text-transform:uppercase;
    letter-spacing:.1em;font-size:10px;color:var(--ink-faint)}
  .board-coord .lead{color:var(--accent);font-weight:700}
  .board-coord .cx{opacity:.8}
  .board-coord .cx:last-child{margin-left:auto}

  /* -- cards: flatter, precise -- */
  .card{box-shadow:none;border-radius:8px}
  .card:hover{box-shadow:var(--shadow-md)}
  .stat,.panel,.list,.calday,.drawer,.focus{box-shadow:none}

  /* -- topbar coordinate subtitle -- */
  .topbar .title p{font-family:var(--mono);text-transform:uppercase;letter-spacing:.09em;font-size:10px;margin-top:3px}
  .brandmark span{text-transform:uppercase;letter-spacing:.12em;font-size:9px}

  /* -- filter chips / segmented: outlined, mono -- */
  .chip{font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;border-radius:6px}
  .seg{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em}
  .col-head .n{border-radius:6px}

  /* -- Are.na-fed brand mark (rotating images from a board) -- */
  .logo{position:relative;overflow:hidden}
  .logo .logo-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .55s ease}
  .logo svg{position:relative;z-index:1;transition:opacity .4s ease}
  .logo.hasimg svg{opacity:0}
  .logo.hasimg{box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}

  /* -- load screen: Are.na image montage (~3s) -- */
  .splash{position:fixed;inset:0;z-index:200;background:var(--dark);display:flex;align-items:center;
    justify-content:center;overflow:hidden;transition:opacity .6s ease}
  .splash.done{opacity:0;pointer-events:none}
  .splash-img{position:absolute;inset:0;background-size:cover;background-position:center;opacity:.9}
  .splash-scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(20,20,19,.35),rgba(20,20,19,.78))}
  .splash-ui{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;gap:13px;text-align:center}
  .splash-mark{font-family:var(--serif);font-weight:500;font-size:46px;letter-spacing:-.02em;color:#fff;line-height:1}
  .splash-sub{font-family:var(--mono);text-transform:uppercase;letter-spacing:.36em;font-size:11px;
    color:rgba(255,255,255,.72);padding-left:.36em}
  .splash-bar{width:220px;height:2px;background:rgba(255,255,255,.18);border-radius:2px;overflow:hidden;margin-top:6px}
  .splash-bar>i{display:block;height:100%;width:0;background:var(--accent-dark)}
  .splash-myth{font-family:var(--mono);font-size:11.5px;line-height:1.55;letter-spacing:.01em;
    color:rgba(255,255,255,.72);max-width:360px;text-align:center;min-height:1.6em;transition:opacity .4s ease}
  .splash-myth::before{content:"myth · ";color:var(--accent-dark);opacity:.9}

  @media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}

  /* ---------- live-app additions ---------- */
  .gate{position:fixed;inset:0;background:rgba(20,20,19,.66);z-index:80;display:grid;place-items:center;backdrop-filter:blur(2px)}
  .gate-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:36px 40px;text-align:center;max-width:440px;box-shadow:var(--shadow-md)}
  .gate-card h2{font-family:var(--serif);font-size:24px;font-weight:500;margin-bottom:6px}
  .gate-card p{font-size:13px;color:var(--ink-faint);margin-bottom:4px}
  .gate .logo{margin:0 auto 16px;width:44px;height:44px}
  .gate-names{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:18px}
  .gate-names button{display:flex;align-items:center;gap:8px;border:1px solid var(--border);border-radius:10px;
    padding:9px 14px;font-weight:600;font-size:13.5px;background:var(--surface);transition:all .15s}
  .gate-names button:hover{border-color:var(--accent);color:var(--accent);transform:translateY(-1px)}
  .propsel{font-family:var(--sans);font-size:13px;font-weight:600;color:var(--ink);border:1px solid var(--border);
    border-radius:7px;background:var(--surface);padding:7px 9px;width:100%;outline:none;transition:border-color .15s}
  .propsel:focus{border-color:var(--accent)}
  .col.dropping{outline:2px dashed var(--accent);outline-offset:5px;border-radius:10px}
  .carrytag{color:var(--warn);font-weight:700}
  .biginput{font-family:var(--serif);font-size:26px;font-weight:500;border:none;outline:none;background:none;width:100%;
    color:var(--ink);padding:6px 0 12px;border-bottom:1px solid var(--border);letter-spacing:-.01em}
  .biginput:focus{border-bottom-color:var(--accent)}
  .biginput::placeholder{color:var(--ink-faint)}
  .checkadd input{width:100%;border:none;border-bottom:1px dashed var(--border);background:none;outline:none;
    font-family:var(--sans);font-size:13px;color:var(--ink);padding:9px 0}
  .checkadd input:focus{border-bottom-color:var(--accent)}
  .checkadd input::placeholder{color:var(--ink-faint)}
  .btn-ghost.danger:hover{color:var(--crit);border-color:var(--crit)}
</style>
</head>
<body>

<div class="splash" id="splash">
  <div class="splash-img" id="splashImg"></div>
  <div class="splash-scrim"></div>
  <div class="splash-ui">
    <div class="splash-mark">9 Birds</div>
    <div class="splash-sub">Team Board</div>
    <div class="splash-bar"><i id="splashBar"></i></div>
    <div class="splash-myth" id="splashMyth"></div>
  </div>
</div>

<div class="gate hidden" id="gate">
  <div class="gate-card">
    <div class="logo"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12c3-6 15-6 18 0-3 6-15 6-18 0Z"/><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/></svg></div>
    <h2>Who&rsquo;s checking in?</h2>
    <p>Everything you check off or move gets stamped with your name.</p>
    <div class="gate-names"></div>
  </div>
</div>

<div class="app">
  <aside class="side">
    <div class="brandmark">
      <div class="logo" id="brandLogo" title="Today’s image — Are.na"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12c3-6 15-6 18 0-3 6-15 6-18 0Z"/><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/></svg></div>
      <div><b>9 Birds</b><span>Creative — Team</span></div>
    </div>
    <div class="navsec" id="mainNav">
      <button class="nav active" data-view="board"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="18" rx="1.5"/><rect x="14" y="3" width="7" height="11" rx="1.5"/></svg> Board <span class="count tnum" id="navBoardCount"></span></button>
      <button class="nav" data-view="mine"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> My Tasks <span class="count tnum" id="navMineCount"></span></button>
      <button class="nav" data-view="calendar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg> Calendar</button>
      <button class="nav" data-view="reports"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18 9l-5 5-3-3-4 4"/></svg> Reports</button>
    </div>
    <div class="navsec">
      <div class="label">Brands</div>
      <div id="brandList"></div>
    </div>
    <div class="side-foot" id="meFoot"></div>
  </aside>

  <div class="main">
    <div class="topbar">
      <div class="title"><h1 id="vTitle">Team Board</h1><p id="vSub">Loading…</p></div>
      <label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg><input id="searchInput" placeholder="Search tasks, brands, people" aria-label="Search"><kbd>&#8984;K</kbd></label>
      <div class="spacer"></div>
      <div class="segmented" id="viewToggle">
        <button class="seg active" data-vmode="board"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="18" rx="1.5"/><rect x="14" y="3" width="7" height="11" rx="1.5"/></svg>Board</button>
        <button class="seg" data-vmode="list"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>List</button>
      </div>
      <button class="iconbtn" id="bellBtn" aria-label="Notifications"><span class="badge hidden" id="bellBadge"></span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg></button>
      <button class="btn-ghost hidden" id="newWeek">New week &#8635;</button>
      <button class="btn-primary" id="newTask"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>New task</button>
    </div>

    <div class="filterbar" id="filterbar">
      <span class="flabel">Team</span>
      <div class="avstack" id="avstack"></div>
      <div class="fdiv"></div>
      <span class="flabel">Filter</span>
      <button class="chip on" data-prio="all">All priorities</button>
      <button class="chip" data-prio="urgent"><span class="dot" style="background:var(--crit)"></span>Urgent</button>
      <button class="chip" data-prio="high"><span class="dot" style="background:var(--warn)"></span>High</button>
      <button class="clearfilter hidden" id="clearFilter">Clear filters &#10005;</button>
    </div>

    <div class="content">
      <!-- BOARD -->
      <section class="view active" id="view-board">
        <div class="board-coord" id="boardCoord"><span class="lead">Index</span><span class="cx">Loading…</span></div>
        <div class="stats" id="statsStrip"></div>
        <div class="board" id="boardView"></div>
        <div class="list hidden" id="listView"></div>
      </section>

      <!-- MY TASKS -->
      <section class="view" id="view-mine">
        <div class="focus">
          <div><div class="fk">On your plate</div><div class="big tnum" id="mineCount">0</div></div>
          <div class="fdivv"></div>
          <div><div class="fk">This week</div><div class="ftxt" id="mineTxt">Pick your name to see your tasks.</div></div>
        </div>
        <div class="list" id="mineView"></div>
      </section>

      <!-- CALENDAR -->
      <section class="view" id="view-calendar">
        <div class="vhead"><h2>This week</h2><p id="calSub">Loading…</p></div>
        <div class="cal" id="calView"></div>
      </section>

      <!-- REPORTS -->
      <section class="view" id="view-reports">
        <div class="vhead"><h2>Team reports</h2><p>Live workload, capacity, and throughput across all brands</p></div>
        <div class="rgrid">
          <div class="panel">
            <h3>Open workload by brand</h3><p class="psub">Active tasks not yet done</p>
            <div id="brandBars"></div>
          </div>
          <div class="panel">
            <h3>Team capacity</h3><p class="psub">Open tasks per person</p>
            <div id="capBars"></div>
          </div>
          <div class="panel wide">
            <h3>Throughput</h3><p class="psub">Tasks completed per week</p>
            <div class="cols" id="throughput"></div>
          </div>
          <div class="panel wide">
            <h3>Status distribution</h3><p class="psub" id="statusSub">Where the active tasks sit right now</p>
            <div class="stacked" id="statusBar"></div>
            <div class="legend" id="statusLegend"></div>
          </div>
        </div>
      </section>
    </div>
  </div>
</div>

<div class="scrim" id="scrim"></div>
<aside class="drawer" id="drawer" aria-hidden="true"></aside>
<div class="toast" id="toast"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg><span></span></div>

<script>
/* ---------- constants ---------- */
const PEOPLE={CN:{key:"carlos",name:"Carlos",color:"#2E6EDD"},BR:{key:"brandon",name:"Brandon",color:"#6B4F3A"},AN:{key:"angela",name:"Angela",color:"#7A8450"},RY:{key:"riley",name:"Riley",color:"#5B6B8C"},JS:{key:"jess",name:"Jess",color:"#4A7C7E"}};
const INITIALS={carlos:"CN",brandon:"BR",angela:"AN",riley:"RY",jess:"JS"};
const columns=[{id:"todo",name:"To Do · This Week",color:"#969188"},{id:"progress",name:"In Progress",color:"#2E6EDD"},{id:"review",name:"In Review",color:"#B5842B"},{id:"done",name:"Done",color:"#3C8C5F"}];
const colColor={todo:"#969188",progress:"#2E6EDD",review:"#B5842B",done:"#3C8C5F"};
const colName={todo:"To Do",progress:"In Progress",review:"In Review",done:"Done"};
const PRIOS=["urgent","high","medium","low"];
const BRAND_COLORS={"9 birds":"#2E6EDD","9 birds creative":"#2E6EDD","auteur":"#8C7A55","cmd":"#6B4F3A","coffee machine depot":"#6B4F3A","jurassic magic":"#2E8B6F","convi":"#2E8B6F","jm/convi":"#2E8B6F","jm · convi":"#2E8B6F","markibar":"#A65A3C","markibar usa":"#A65A3C","cout de la liberte":"#7A5C58","cdll":"#7A5C58","bronco":"#C07A2D","lost explorer":"#4A6C6F","second layer":"#3A3A44","re/creation cafe":"#7A9E5E","stanza":"#5B6B8C","admin":"#969188"};
const FALLBACK=["#2E6EDD","#8C7A55","#2E8B6F","#6B4FA0","#C07A2D","#4A7C7E","#A65A3C","#5B6B8C"];
function brandColor(b){
 if(!b)return"#969188";
 const k=b.trim().toLowerCase();
 if(BRAND_COLORS[k])return BRAND_COLORS[k];
 let h=0;for(const c of k)h=(h*31+c.charCodeAt(0))>>>0;
 return FALLBACK[h%FALLBACK.length];
}
const codeMap={"AUTEUR":"AUT","Coffee Machine Depot":"CMD","CMD":"CMD","MarkiBar":"MRK","Markibar USA":"MRK","JM/Convi":"JMC","Jurassic Magic":"JMC","Convi":"JMC","Lost Explorer":"LEX","Second Layer":"SL2","Re/creation Cafe":"RCC","9 Birds":"9BC","9 Birds Creative":"9BC","Bronco":"BRN","Admin":"ADM","Stanza":"STZ"};
const taskCode=t=>((codeMap[t.brand]||(t.brand||"GEN").slice(0,3).toUpperCase())+"·"+String(t.id).slice(0,3).toUpperCase());
const DAY_OFFSET={Mon:0,Tue:1,Wed:2,Thu:3,Fri:4,Sat:5,Sun:6};
const esc=v=>String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

const ic={
 cal:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
 chat:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
 check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
 x:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
 plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>'
};

/* ---------- state ---------- */
let S={week:"",tasks:[],checks:{},comments:{},throughput:[]};
let me=localStorage.getItem("nb-me")||"";
let view="board",vmode="board",fWho=null,fPrio="all",qtext="",dragId=null,openTaskId=null;

/* ---------- api ---------- */
async function api(path,opts){
 const r=await fetch(path,opts);
 if(!r.ok){let m="Request failed";try{m=(await r.json()).error||m}catch(e){}throw new Error(m)}
 return r.json();
}
const post=(path,body,method)=>api(path,{method:method||"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body||{})});

async function load(){
 try{
  const d=await api("/api/board");
  S.week=d.week;S.tasks=d.tasks||[];S.throughput=d.throughput||[];
  S.checks={};(d.checks||[]).forEach(c=>S.checks[c.task_id]={total:c.total,done:c.done||0});
  S.comments={};(d.commentCounts||[]).forEach(c=>S.comments[c.task_id]=c.n);
  renderAll();
 }catch(e){/* keep last good render */}
}

/* ---------- helpers ---------- */
function dueInfo(day){
 if(!S.week||!day||day==="Any")return{label:"This week",state:""};
 const p=S.week.split("-").map(Number);
 const date=new Date(p[0],p[1]-1,p[2]+(DAY_OFFSET[day]||0));
 const label=date.toLocaleDateString("en-US",{month:"short",day:"numeric"});
 const now=new Date(),today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
 const state=date<today?"over":date.getTime()===today.getTime()?"today":"";
 return{label,state};
}
const dueClass=s=>s==="over"?"over":s==="today"?"today":"";
const av=(w,cls)=>PEOPLE[w]?\`<div class="avatar \${cls||""}" style="background:\${PEOPLE[w].color}" title="\${PEOPLE[w].name}">\${w}</div>\`:"";
const pIni=t=>INITIALS[t.person]||"CN";
function visible(t){
 const okW=!fWho||pIni(t)===fWho;
 const okP=fPrio==="all"||(t.prio||"medium")===fPrio;
 const okQ=!qtext||((t.title+" "+(t.brand||"")+" "+(PEOPLE[pIni(t)]?PEOPLE[pIni(t)].name:"")).toLowerCase().includes(qtext.toLowerCase()));
 return okW&&okP&&okQ;
}
const sortVis=items=>items.slice().sort((a,b)=>Number(visible(b))-Number(visible(a)));
function weekNum(){
 if(!S.week)return 0;
 const d=new Date(S.week+"T12:00:00");
 return Math.ceil(((d.getTime()-new Date(d.getFullYear(),0,1).getTime())/864e5+1)/7);
}
function weekShort(){
 if(!S.week)return"…";
 const d=new Date(S.week+"T12:00:00");
 return String(d.getMonth()+1).padStart(2,"0")+"."+String(d.getDate()).padStart(2,"0")+"."+String(d.getFullYear()).slice(2);
}
const openTasks=()=>S.tasks.filter(t=>t.status!=="done");
const mineTasks=()=>S.tasks.filter(t=>PEOPLE[pIni(t)]&&PEOPLE[pIni(t)].name===me);

/* ---------- toast ---------- */
const toast=document.getElementById("toast");let tt;
function showToast(msg){toast.querySelector("span").textContent=msg;toast.classList.add("show");clearTimeout(tt);tt=setTimeout(()=>toast.classList.remove("show"),2600);}

/* ---------- cards / rows ---------- */
function taskCard(t){
 const ck=S.checks[t.id],cn=S.comments[t.id]||0,prio=t.prio||"medium";
 const due=dueInfo(t.day);
 let prog="";
 if(ck&&ck.total>0){
  const pct=Math.round(ck.done/ck.total*100),barC=ck.done===ck.total?"var(--good)":"var(--accent)";
  prog=\`<div class="progress"><div class="ptop"><span>Checklist</span><span class="tnum">\${ck.done}/\${ck.total}</span></div><div class="bar"><i style="width:\${pct}%;background:\${barC}"></i></div></div>\`;
 }
 return \`<article class="card p-\${prio} \${t.status==="done"?"done":""} \${visible(t)?"":"fade"}" draggable="true" data-id="\${esc(t.id)}">
  <div class="card-top"><span class="code">\${esc(taskCode(t))}</span><span class="tag"><span class="dot" style="background:\${brandColor(t.brand)}"></span>\${esc(t.brand||"General")}</span><span class="prio \${prio}">\${prio}</span></div>
  <h4>\${esc(t.title)}</h4>
  \${prog}
  <div class="card-foot">\${av(pIni(t))}<span class="due \${t.status==="done"?"":dueClass(due.state)}">\${ic.cal}\${t.status==="done"?"Done":due.label}</span>
   <div class="metas">\${cn?\`<span class="metaic">\${ic.chat}\${cn}</span>\`:""}\${t.carry>0?\`<span class="metaic carrytag">↩ ×\${t.carry}</span>\`:""}\${t.status==="done"&&t.updated_by?\`<span class="metaic">✓ \${esc(t.updated_by)}</span>\`:""}</div></div>
 </article>\`;
}
function listRow(t){
 const ck=S.checks[t.id],due=dueInfo(t.day),prio=t.prio||"medium";
 return \`<div class="lrow \${t.status==="done"?"done":""} \${visible(t)?"":"fade"}" data-id="\${esc(t.id)}">
  <div class="lcheck">\${t.status==="done"?ic.check:""}</div>
  <div class="ltitle"><span class="dot" style="background:\${brandColor(t.brand)};width:8px;height:8px;border-radius:50%"></span><span class="tt">\${esc(t.title)}</span>\${t.carry>0?\`<span class="metaic carrytag">↩ ×\${t.carry}</span>\`:""}</div>
  <div class="lmeta">\${av(pIni(t),"sm")} \${PEOPLE[pIni(t)]?PEOPLE[pIni(t)].name:""}</div>
  <div class="lmeta"><span class="prio \${prio}">\${prio}</span></div>
  <div class="lmeta" style="\${due.state==="over"&&t.status!=="done"?"color:var(--crit)":due.state==="today"?"color:var(--warn)":""}">\${due.label}</div>
  <div class="lmeta tnum">\${ck?ck.done+"/"+ck.total:colName[t.status]}</div></div>\`;
}

/* ---------- renders ---------- */
function renderSidebar(){
 const open=openTasks();
 document.getElementById("navBoardCount").textContent=open.length;
 document.getElementById("navMineCount").textContent=mineTasks().filter(t=>t.status!=="done").length;
 const m=new Map();
 open.forEach(t=>{if(t.brand)m.set(t.brand,(m.get(t.brand)||0)+1)});
 document.getElementById("brandList").innerHTML=[...m.entries()].sort((a,b)=>b[1]-a[1]).map(([name,n])=>
  \`<button class="brandrow" data-brand="\${esc(name)}"><span class="dot" style="background:\${brandColor(name)}"></span> \${esc(name)} <span class="count tnum">\${n}</span></button>\`).join("");
 const ini=Object.keys(PEOPLE).find(k=>PEOPLE[k].name===me);
 document.getElementById("meFoot").innerHTML=\`<div class="avatar lg" style="background:\${ini?PEOPLE[ini].color:"#2E6EDD"}">\${ini||"?"}</div>
  <div class="meta"><b>\${esc(me||"Pick your name")}</b><br><span>\${me==="Carlos"?"Marketing Director":"9 Birds Creative"}</span></div>\`;
}
function renderTopbar(){
 const wl=S.week?\`Wk.\${weekNum()} — \${weekShort()}\`:"Loading…";
 const titles={board:["Team Board",\`\${wl} — \${openTasks().length} active\`],mine:["My Tasks",\`\${me||"You"} — \${wl}\`],calendar:["Calendar",wl],reports:["Reports",\`\${wl} — team analytics\`]};
 document.getElementById("vTitle").textContent=titles[view][0];
 document.getElementById("vSub").textContent=titles[view][1];
 document.getElementById("newWeek").classList.toggle("hidden",me!=="Carlos");
 const over=S.tasks.filter(t=>t.status!=="done"&&dueInfo(t.day).state==="over").length;
 document.getElementById("bellBadge").classList.toggle("hidden",!over);
}
function renderStats(){
 const open=openTasks();
 const overdue=open.filter(t=>dueInfo(t.day).state==="over").length;
 const done=S.tasks.filter(t=>t.status==="done").length;
 const pct=S.tasks.length?Math.round(done/S.tasks.length*100):0;
 const nBrands=new Set(open.map(t=>t.brand).filter(Boolean)).size;
 document.getElementById("boardCoord").innerHTML=\`<span class="lead">Index</span><span class="cx">\${open.length} active · \${nBrands} brands</span><span class="cx">Wk.\${weekNum()} / \${weekShort()}</span>\`;
 document.getElementById("statsStrip").innerHTML=\`
  <div class="stat"><div class="k">Open this week</div><div class="v tnum">\${open.length}</div><div class="bar"><i style="width:\${100-pct}%;background:var(--accent)"></i></div></div>
  <div class="stat"><div class="k">In progress</div><div class="v neutral tnum">\${S.tasks.filter(t=>t.status==="progress").length}</div><div class="sub">Across \${nBrands} brands</div></div>
  <div class="stat"><div class="k">Needs review</div><div class="v tnum" style="color:var(--warn)">\${S.tasks.filter(t=>t.status==="review").length}</div><div class="sub">Waiting on sign-off</div></div>
  <div class="stat"><div class="k">Overdue</div><div class="v tnum" style="color:\${overdue?"var(--crit)":"var(--ink)"}">\${overdue}</div><div class="sub">\${overdue?'<span class="trend down">needs attention</span>':"on schedule"}</div></div>
  <div class="stat"><div class="k">Done</div><div class="v neutral tnum">\${done}</div><div class="sub"><span class="trend up">\${pct}%</span> of the sheet</div></div>\`;
}
function renderBoard(){
 document.getElementById("boardView").innerHTML=columns.map((col,ci)=>{
  const items=sortVis(S.tasks.filter(t=>t.status===col.id));
  return \`<section class="col \${col.id==="done"?"done-col":""}" data-col="\${col.id}">
   <div class="col-head"><span class="colidx">\${String(ci+1).padStart(2,"0")}</span><span class="swatch" style="background:\${col.color}"></span><h3>\${col.name}</h3><span class="n tnum">\${items.length}</span>
   <button class="add" data-addcol="\${col.id}" aria-label="Add">\${ic.plus}</button></div>
   <div class="col-body">\${items.map(taskCard).join("")}</div></section>\`;
 }).join("");
}
function renderList(el,items){
 el.innerHTML=columns.map(col=>{
  const its=sortVis(items.filter(t=>t.status===col.id));if(!its.length)return"";
  return \`<div class="lgroup-head"><span class="swatch" style="background:\${col.color}"></span><h3>\${colName[col.id]}</h3><span class="n tnum">\${its.length}</span></div>\${its.map(listRow).join("")}\`;
 }).join("")||\`<div class="lgroup-head"><h3>Nothing here yet</h3></div>\`;
}
function renderMine(){
 const mine=mineTasks();
 const openMine=mine.filter(t=>t.status!=="done");
 document.getElementById("mineCount").textContent=openMine.length;
 const carried=mine.some(t=>t.carry>0&&t.status!=="done");
 document.getElementById("mineTxt").innerHTML=me
  ?\`You own <b>\${mine.filter(t=>t.status==="todo").length} to-dos</b>, <b>\${mine.filter(t=>t.status==="progress").length} in progress</b> and <b>\${mine.filter(t=>t.status==="review").length} in review</b>.\${carried?" Carried-over items are marked ↩ — clear those first.":" Nothing carried over. Clean sheet."}\`
  :"Pick your name to see your tasks.";
 renderList(document.getElementById("mineView"),mine);
}
function renderCalendar(){
 const days=["Mon","Tue","Wed","Thu","Fri","Any"];
 const todayDow=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][new Date().getDay()];
 document.getElementById("calSub").textContent=S.week?\`Tasks placed on their planned day · week of \${new Date(S.week+"T12:00:00").toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}\`:"Loading…";
 document.getElementById("calView").innerHTML=days.map(d=>{
  const items=S.tasks.filter(t=>(t.day===d)||(d==="Any"&&(!t.day||t.day==="Any")));
  const date=d!=="Any"&&S.week?dueInfo(d).label:"";
  return \`<div class="calday \${d===todayDow?"today":""}"><div class="calhd"><span class="dow">\${d==="Any"?"Anytime":d}</span><span class="dnum">\${date}</span></div>
   \${items.length?items.map(t=>\`<div class="calchip" data-id="\${esc(t.id)}" style="border-left-color:\${brandColor(t.brand)};\${t.status==="done"?"opacity:.55":""}"><span class="cb">\${esc(t.brand||PEOPLE[pIni(t)].name)}</span><span class="ct">\${esc(t.title)}</span></div>\`).join(""):'<div class="calempty">—</div>'}</div>\`;
 }).join("");
}
function renderReports(){
 const open=openTasks();
 const byBrand=new Map();
 open.forEach(t=>byBrand.set(t.brand||"General",(byBrand.get(t.brand||"General")||0)+1));
 const brands=[...byBrand.entries()].sort((a,b)=>b[1]-a[1]);
 const bMax=Math.max(1,...brands.map(b=>b[1]));
 document.getElementById("brandBars").innerHTML=brands.map(([name,n])=>
  \`<div class="hbar"><div class="hlabel"><span class="dot" style="background:\${brandColor(name)}"></span>\${esc(name)}</div><div class="htrack"><i style="width:\${n/bMax*100}%;background:\${brandColor(name)}"></i></div><div class="hval tnum">\${n}</div></div>\`).join("")||'<p class="psub">No open tasks.</p>';
 const byPerson={};open.forEach(t=>byPerson[t.person]=(byPerson[t.person]||0)+1);
 const pMax=Math.max(1,...Object.values(byPerson).concat([0]));
 document.getElementById("capBars").innerHTML=Object.keys(PEOPLE).map(k=>{
  const n=byPerson[PEOPLE[k].key]||0;
  return \`<div class="cap"><div class="who">\${av(k,"sm")}\${PEOPLE[k].name}</div><div class="ctrack"><i style="width:\${n/pMax*100}%;background:\${PEOPLE[k].color}"></i></div><div class="cn tnum">\${n} open</div></div>\`;
 }).join("");
 const tp=S.throughput;
 const tMax=Math.max(1,...tp.map(w=>w.n));
 document.getElementById("throughput").innerHTML=tp.length?tp.map((w,i)=>
  \`<div class="colw"><div class="cbar \${i===tp.length-1?"":"muted"}" style="height:\${Math.max(4,w.n/tMax*100)}%"><span class="tnum">\${w.n}</span></div><div class="clab">\${new Date(w.week+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div></div>\`).join("")
  :'<div class="calempty" style="width:100%">Completions will chart here week by week.</div>';
 const st=["todo","progress","review"].map(k=>({k,n:S.tasks.filter(t=>t.status===k).length}));
 const total=Math.max(1,st.reduce((a,b)=>a+b.n,0));
 document.getElementById("statusBar").innerHTML=st.map(s=>\`<i style="width:\${s.n/total*100}%;background:\${colColor[s.k]}"></i>\`).join("");
 document.getElementById("statusLegend").innerHTML=st.map(s=>\`<span><span class="sw" style="background:\${colColor[s.k]}"></span>\${colName[s.k]} · \${s.n}</span>\`).join("");
 document.getElementById("statusSub").textContent=\`Where the \${S.tasks.length} tasks on this week's sheet sit right now\`;
}
function renderAll(){
 renderSidebar();renderTopbar();renderStats();renderBoard();
 renderList(document.getElementById("listView"),S.tasks);
 renderMine();renderCalendar();renderReports();
 document.getElementById("clearFilter").classList.toggle("hidden",!(fWho||fPrio!=="all"||qtext));
 document.querySelectorAll("#avstack .avatar").forEach(a=>a.classList.toggle("dim",!!(fWho&&a.dataset.who!==fWho)));
}

/* ---------- gate ---------- */
function renderGate(){
 const g=document.getElementById("gate");
 if(me){g.classList.add("hidden");return}
 g.classList.remove("hidden");
 g.querySelector(".gate-names").innerHTML=Object.keys(PEOPLE).map(k=>
  \`<button data-name="\${PEOPLE[k].name}"><span class="avatar sm" style="background:\${PEOPLE[k].color}">\${k}</span>\${PEOPLE[k].name}</button>\`).join("");
}
document.getElementById("gate").addEventListener("click",e=>{
 const b=e.target.closest("[data-name]");if(!b)return;
 me=b.dataset.name;localStorage.setItem("nb-me",me);
 renderGate();renderAll();showToast(\`Signed in as \${me}\`);
});

/* ---------- drawer (task detail) ---------- */
const drawer=document.getElementById("drawer"),scrim=document.getElementById("scrim");
function closeDrawer(){drawer.classList.remove("open");drawer.setAttribute("aria-hidden","true");scrim.classList.remove("open");openTaskId=null;}
scrim.addEventListener("click",closeDrawer);
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeDrawer();});

async function saveField(id,field,value){
 const body={by:me};body[field]=value;
 try{await post("/api/tasks/"+encodeURIComponent(id),body,"PATCH");await load();}
 catch(e){showToast(e.message);}
}
async function openDrawer(id){
 const t=S.tasks.find(x=>x.id===id);if(!t)return;
 openTaskId=id;
 let detail={checklist:[],comments:[]};
 try{detail=await api("/api/tasks/"+encodeURIComponent(id)+"/detail");}catch(e){}
 const cl=detail.checklist||[],cms=detail.comments||[];
 const nDone=cl.filter(c=>c.done).length;
 const due=dueInfo(t.day),sc=colColor[t.status],prio=t.prio||"medium";
 const meIni=Object.keys(PEOPLE).find(k=>PEOPLE[k].name===me)||"CN";
 drawer.innerHTML=\`
  <div class="tv-head">
   <div class="tv-crumb"><b>Board</b><span class="sep">›</span><span class="dot" style="background:\${brandColor(t.brand)}"></span>\${esc(t.brand||"General")}</div>
   <button class="dr-close" id="drClose" aria-label="Close">\${ic.x}</button>
  </div>
  <div class="tv-body">
   <div class="tv-main">
    <h2>\${esc(t.title)}</h2>
    <div>
     <div class="dsec-t"><span>Checklist</span><span style="font-weight:600;text-transform:none;letter-spacing:0">\${nDone}/\${cl.length}</span></div>
     \${cl.length?\`<div class="subprog"><div class="bar"><i style="width:\${cl.length?nDone/cl.length*100:0}%;background:\${nDone===cl.length?"var(--good)":"var(--accent)"}"></i></div><span class="sc tnum">\${nDone}/\${cl.length}</span></div>\`:""}
     <div id="subList">\${cl.map(c=>\`<div class="checkrow \${c.done?"on":""}" data-check="\${esc(c.id)}" data-done="\${c.done?1:0}"><span class="cbx">\${c.done?ic.check:""}</span><span>\${esc(c.label)}</span></div>\`).join("")}</div>
     <div class="checkadd"><input id="newCheck" placeholder="Add a checklist step…"></div>
    </div>
    <div>
     <div class="dsec-t"><span>Activity</span></div>
     <div id="cThread">\${cms.length?cms.map(c=>{
      const ini=Object.keys(PEOPLE).find(k=>PEOPLE[k].name===c.author)||"CN";
      let when="";try{when=new Date(c.created_at.replace(" ","T")+"Z").toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});}catch(e){}
      return \`<div class="comment">\${av(ini,"sm")}<div><div class="cbubble"><div class="cwho">\${esc(c.author)}</div>\${esc(c.body)}</div><div class="ctime">\${when}</div></div></div>\`;
     }).join(""):'<p class="dr-desc" style="font-size:13px;margin-bottom:12px">No comments yet.</p>'}</div>
     <div class="composer">\${av(meIni,"sm")}<textarea class="cin" id="cInput" placeholder="Write a comment…"></textarea></div>
     <div style="display:flex;justify-content:flex-end;margin-top:9px"><button class="btn-primary" id="cSend" style="padding:8px 14px">Comment</button></div>
    </div>
   </div>
   <div class="tv-rail">
    <div class="rail-grp"><span class="rail-k">Status</span>
     <select class="propsel" id="selStatus">\${columns.map(c=>\`<option value="\${c.id}" \${t.status===c.id?"selected":""}>\${colName[c.id]}</option>\`).join("")}</select></div>
    <div class="rail-grp"><span class="rail-k">Assignee</span>
     <select class="propsel" id="selPerson">\${Object.keys(PEOPLE).map(k=>\`<option value="\${PEOPLE[k].key}" \${t.person===PEOPLE[k].key?"selected":""}>\${PEOPLE[k].name}</option>\`).join("")}</select></div>
    <div class="rail-grp"><span class="rail-k">Priority</span>
     <select class="propsel" id="selPrio">\${PRIOS.map(p=>\`<option value="\${p}" \${prio===p?"selected":""}>\${p}</option>\`).join("")}</select></div>
    <div class="rail-grp"><span class="rail-k">Day</span>
     <select class="propsel" id="selDay">\${["Any","Mon","Tue","Wed","Thu","Fri"].map(d=>\`<option value="\${d}" \${(t.day||"Any")===d?"selected":""}>\${d==="Any"?"Anytime this week":d+" · "+dueInfo(d).label}</option>\`).join("")}</select>
     \${due.state==="over"&&t.status!=="done"?'<span style="color:var(--crit);font-size:11px;font-weight:700">overdue</span>':""}</div>
    <div class="rail-div"></div>
    <div class="rail-grp"><span class="rail-k">Brand</span><span class="rail-v"><span class="dot" style="background:\${brandColor(t.brand)}"></span>\${esc(t.brand||"General")}</span></div>
    \${t.carry>0?\`<div class="rail-grp"><span class="rail-k">History</span><span class="rail-v carrytag">↩ carried over ×\${t.carry}</span></div>\`:""}
    \${t.updated_by?\`<div class="rail-grp"><span class="rail-k">Last touched</span><span class="rail-v">\${esc(t.updated_by)}</span></div>\`:""}
    <div class="rail-div"></div>
    <div class="tv-actions">
     \${t.status!=="done"
      ?\`<button class="btn-primary full" id="drDone">\${ic.check}Mark complete</button>\`
      :\`<button class="btn-ghost full" id="drReopen">Reopen</button>\`}
     \${me==="Carlos"?\`<button class="btn-ghost full danger" id="drDelete">Delete</button>\`:""}
    </div>
   </div>
  </div>\`;
 drawer.classList.add("open");drawer.setAttribute("aria-hidden","false");scrim.classList.add("open");
 document.getElementById("drClose").onclick=closeDrawer;
 document.getElementById("selStatus").onchange=e=>{saveField(t.id,"status",e.target.value);if(e.target.value==="done")showToast("Task marked complete");};
 document.getElementById("selPerson").onchange=e=>{saveField(t.id,"person",e.target.value);const p=Object.keys(PEOPLE).find(k=>PEOPLE[k].key===e.target.value);showToast("Moved to "+(p?PEOPLE[p].name:e.target.value));};
 document.getElementById("selPrio").onchange=e=>saveField(t.id,"prio",e.target.value);
 document.getElementById("selDay").onchange=e=>saveField(t.id,"day",e.target.value);
 const done=document.getElementById("drDone");
 if(done)done.onclick=async()=>{await saveField(t.id,"status","done");closeDrawer();showToast("Task marked complete");};
 const reopen=document.getElementById("drReopen");
 if(reopen)reopen.onclick=async()=>{await saveField(t.id,"status","todo");closeDrawer();showToast("Task reopened");};
 const del=document.getElementById("drDelete");
 if(del)del.onclick=async()=>{
  if(!confirm("Delete this task?"))return;
  try{await post("/api/tasks/"+encodeURIComponent(t.id)+"/delete",{by:me});closeDrawer();await load();showToast("Task deleted");}
  catch(e){showToast(e.message);}
 };
 // checklist toggles
 drawer.querySelectorAll("#subList .checkrow").forEach(r=>r.addEventListener("click",async()=>{
  try{await post("/api/checklist/"+encodeURIComponent(r.dataset.check)+"/toggle",{done:r.dataset.done!=="1"});await load();openDrawer(t.id);}
  catch(e){showToast(e.message);}
 }));
 // add checklist item
 document.getElementById("newCheck").addEventListener("keydown",async e=>{
  const v=e.target.value.trim();
  if(e.key==="Enter"&&v){
   try{await post("/api/checklist",{task_id:t.id,label:v});await load();openDrawer(t.id);}
   catch(err){showToast(err.message);}
  }
 });
 // comments
 const send=document.getElementById("cSend"),inp=document.getElementById("cInput");
 const postComment=async()=>{
  const v=inp.value.trim();if(!v||!me)return;
  try{await post("/api/comments",{task_id:t.id,author:me,body:v});await load();openDrawer(t.id);}
  catch(e){showToast(e.message);}
 };
 send.onclick=postComment;
 inp.addEventListener("keydown",e=>{if(e.key==="Enter"&&(e.metaKey||e.ctrlKey))postComment();});
}

/* ---------- new task drawer ---------- */
function openCreate(){
 openTaskId=null;
 drawer.innerHTML=\`
  <div class="tv-head">
   <div class="tv-crumb"><b>Board</b><span class="sep">›</span>New task</div>
   <button class="dr-close" id="drClose" aria-label="Close">\${ic.x}</button>
  </div>
  <div class="tv-body">
   <div class="tv-main">
    <input class="biginput" id="ntTitle" placeholder="What needs to happen?" maxlength="300">
   </div>
   <div class="tv-rail">
    <div class="rail-grp"><span class="rail-k">Assignee</span>
     <select class="propsel" id="ntPerson">\${Object.keys(PEOPLE).map(k=>\`<option value="\${PEOPLE[k].key}" \${me===PEOPLE[k].name?"selected":""}>\${PEOPLE[k].name}</option>\`).join("")}</select></div>
    <div class="rail-grp"><span class="rail-k">Brand</span>
     <input class="propsel" id="ntBrand" placeholder="AUTEUR, CMD, MarkiBar…" maxlength="60"></div>
    <div class="rail-grp"><span class="rail-k">Day</span>
     <select class="propsel" id="ntDay">\${["Any","Mon","Tue","Wed","Thu","Fri"].map(d=>\`<option value="\${d}">\${d==="Any"?"Anytime this week":d}</option>\`).join("")}</select></div>
    <div class="rail-grp"><span class="rail-k">Priority</span>
     <select class="propsel" id="ntPrio">\${PRIOS.map(p=>\`<option value="\${p}" \${p==="medium"?"selected":""}>\${p}</option>\`).join("")}</select></div>
    <div class="rail-div"></div>
    <div class="tv-actions">
     <button class="btn-primary full" id="ntAdd">\${ic.plus}Add task</button>
     <button class="btn-ghost full" id="ntCancel">Cancel</button>
    </div>
   </div>
  </div>\`;
 drawer.classList.add("open");drawer.setAttribute("aria-hidden","false");scrim.classList.add("open");
 document.getElementById("drClose").onclick=closeDrawer;
 document.getElementById("ntCancel").onclick=closeDrawer;
 const title=document.getElementById("ntTitle");title.focus();
 const add=document.getElementById("ntAdd");
 add.onclick=async()=>{
  const v=title.value.trim();if(!v||add.disabled)return;
  add.disabled=true;add.innerHTML=ic.plus+"Adding…";
  try{
   await post("/api/tasks",{person:document.getElementById("ntPerson").value,title:v,brand:document.getElementById("ntBrand").value.trim(),day:document.getElementById("ntDay").value,prio:document.getElementById("ntPrio").value,by:me});
   await load(); // card appears before drawer closes
   closeDrawer();
   route("board");
   showToast("Task added to “To Do · This Week”");
   const first=document.querySelector('[data-col="todo"] .card');if(first)first.classList.add("justadded");
  }catch(e){add.disabled=false;add.innerHTML=ic.plus+"Add task";showToast(e.message);}
 };
 title.addEventListener("keydown",e=>{if(e.key==="Enter")add.onclick();});
}

/* ---------- routing / chrome ---------- */
function route(v){
 view=v;
 document.querySelectorAll("#mainNav .nav").forEach(n=>n.classList.toggle("active",n.dataset.view===v));
 document.querySelectorAll(".view").forEach(x=>x.classList.toggle("active",x.id==="view-"+v));
 document.getElementById("viewToggle").style.display=(v==="board")?"":"none";
 document.getElementById("filterbar").style.display=(v==="board"||v==="mine")?"":"none";
 renderTopbar();
}
document.querySelectorAll("#mainNav .nav").forEach(n=>n.addEventListener("click",()=>route(n.dataset.view)));
document.querySelectorAll("#viewToggle .seg").forEach(b=>b.addEventListener("click",()=>{
 document.querySelectorAll("#viewToggle .seg").forEach(x=>x.classList.remove("active"));b.classList.add("active");
 vmode=b.dataset.vmode;
 document.getElementById("boardView").classList.toggle("hidden",vmode!=="board");
 document.getElementById("listView").classList.toggle("hidden",vmode!=="list");
}));

// avatars filter
document.getElementById("avstack").innerHTML=Object.keys(PEOPLE).map(k=>\`<div class="avatar" style="background:\${PEOPLE[k].color}" data-who="\${k}" title="\${PEOPLE[k].name}">\${k}</div>\`).join("");
document.getElementById("avstack").addEventListener("click",e=>{
 const a=e.target.closest(".avatar");if(!a)return;
 fWho=fWho===a.dataset.who?null:a.dataset.who;renderAll();
});
document.querySelectorAll(".chip[data-prio]").forEach(c=>c.addEventListener("click",()=>{
 document.querySelectorAll(".chip[data-prio]").forEach(x=>x.classList.remove("on"));c.classList.add("on");
 fPrio=c.dataset.prio;renderAll();
}));
document.getElementById("clearFilter").addEventListener("click",()=>{
 fWho=null;fPrio="all";qtext="";document.getElementById("searchInput").value="";
 document.querySelectorAll(".chip[data-prio]").forEach(x=>x.classList.toggle("on",x.dataset.prio==="all"));
 renderAll();
});
document.getElementById("searchInput").addEventListener("input",e=>{qtext=e.target.value;renderAll();});
document.addEventListener("keydown",e=>{
 if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();document.getElementById("searchInput").focus();}
});

// clicks: cards, rows, calendar chips, brand rows, column add buttons
document.addEventListener("click",e=>{
 if(e.target.closest("#drawer"))return;
 const addBtn=e.target.closest("[data-addcol]");
 if(addBtn){openCreate();return}
 const brand=e.target.closest("[data-brand]");
 if(brand){qtext=brand.dataset.brand;document.getElementById("searchInput").value=qtext;route("board");renderAll();return}
 const hit=e.target.closest("[data-id]");
 if(hit)openDrawer(hit.dataset.id);
});

// drag and drop between columns
document.addEventListener("dragstart",e=>{
 const card=e.target.closest(".card");if(!card)return;
 dragId=card.dataset.id;
 e.dataTransfer.setData("text/task",dragId);e.dataTransfer.effectAllowed="move";
});
const boardEl=document.getElementById("boardView");
boardEl.addEventListener("dragover",e=>{
 const col=e.target.closest(".col");if(!col)return;
 e.preventDefault();
 document.querySelectorAll(".col").forEach(c=>c.classList.toggle("dropping",c===col));
});
boardEl.addEventListener("dragleave",e=>{
 const col=e.target.closest(".col");if(col&&!col.contains(e.relatedTarget))col.classList.remove("dropping");
});
boardEl.addEventListener("drop",async e=>{
 const col=e.target.closest(".col");if(!col)return;
 e.preventDefault();
 document.querySelectorAll(".col").forEach(c=>c.classList.remove("dropping"));
 const id=e.dataTransfer.getData("text/task")||dragId;
 const t=S.tasks.find(x=>x.id===id);
 if(t&&t.status!==col.dataset.col){
  t.status=col.dataset.col;renderBoard(); // optimistic
  await saveField(id,"status",col.dataset.col);
  showToast("Moved to "+colName[col.dataset.col]);
 }
});

// bell
document.getElementById("bellBtn").addEventListener("click",()=>{
 const over=S.tasks.filter(t=>t.status!=="done"&&dueInfo(t.day).state==="over").length;
 const rev=S.tasks.filter(t=>t.status==="review").length;
 showToast(over||rev?\`\${over} overdue · \${rev} waiting in review\`:"All clear — nothing overdue");
});
// new task
document.getElementById("newTask").addEventListener("click",openCreate);
// new week (Carlos only)
document.getElementById("newWeek").addEventListener("click",async()=>{
 if(me!=="Carlos")return;
 if(!confirm("Start a new week? Everything unfinished carries over."))return;
 try{const r=await post("/api/week/roll",{by:"Carlos"});await load();showToast(\`New week started — \${r.carried} carried over\`);}
 catch(e){showToast(e.message);}
});

/* ---------- boot ---------- */
renderGate();
renderAll();          // graceful empty state before first response
load();
setInterval(load,15000);
window.addEventListener("focus",load);

/* --- Are.na visuals: ~3s montage load screen + daily brand mark (one fetch) --- */
(function arenaVisuals(){
 const ARENA_BOARD = "bracket-bracket-asterisk-colon";   /* Are.na board (Elena Foraker) */
 const DUR = 3000;                                        /* load-screen duration (ms) */
 const HARD_LIMIT = 3500;                                 /* absolute overlay removal (ms) */
 const REDUCE = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
 const splash=document.getElementById("splash");
 const simg=document.getElementById("splashImg");
 const sbar=document.getElementById("splashBar");
 const logo=document.getElementById("brandLogo");
 const t0=(window.performance&&performance.now())?performance.now():Date.now();
 let montage=null, mythTimer=null;

 // Ted — the legend of a white Shih Tzu-Maltese who runs L.A.
 const MYTHS=[
  "Ted has never paid for parking in Silver Lake.",
  "Ted got into Soho House before you did.",
  "Ted turned down a Netflix deal — creative differences.",
  "Ted does not fetch. The ball comes back out of respect.",
  "Ted's groomer signed an NDA.",
  "Ted has been to Erewhon more times than you have.",
  "Ted walks himself. The leash is purely decorative.",
  "Ted has never been rained on. L.A. wouldn't dare.",
  "Ted invented the sad eyes. Everyone else is a cover band.",
  "Ted is on the list. Ted is always on the list.",
  "Ted knows a guy. Ted is the guy.",
  "Ted has strong opinions about oat milk.",
  "Ted was mistaken for a cloud and accepted the promotion.",
  "Ted ghosted a talent agent and slept great.",
  "Ted's paw print appreciates faster than L.A. real estate.",
  "Ted has a standing 7am at the dog park. Alone.",
  "Ted did not bark at the mailman — they reached an accord.",
  "Ted's fur comes with its own SPF.",
  "Ted never chases anything. Things arrive to Ted.",
  "Ted once out-negotiated a Beverly Hills realtor.",
  "Ted is fluent in three separate silences.",
  "Ted's Letterboxd is more respected than most critics'."
 ];
 const mythEl=document.getElementById("splashMyth");
 if(mythEl){
  let mi=Math.floor(Math.random()*MYTHS.length);
  mythEl.textContent=MYTHS[mi];
  mythTimer=setInterval(()=>{ mythEl.style.opacity="0";
    setTimeout(()=>{ mi=(mi+1)%MYTHS.length; mythEl.textContent=MYTHS[mi]; mythEl.style.opacity="1"; },300); },1600);
 }

 // progress bar 0 -> 100% over DUR
 const prog=setInterval(()=>{
  const now=(window.performance&&performance.now())?performance.now():Date.now();
  const p=Math.min(1,(now-t0)/DUR);
  if(sbar) sbar.style.width=(p*100)+"%";
  if(p>=1) clearInterval(prog);
 },60);

 function dismiss(){
  if(montage){ clearInterval(montage); montage=null; }
  if(mythTimer){ clearInterval(mythTimer); mythTimer=null; }
  if(splash){ splash.classList.add("done"); setTimeout(()=>{ splash.style.display="none"; },700); }
 }
 setTimeout(dismiss, DUR);            // guaranteed dismissal even if the Are.na fetch never resolves
 setTimeout(()=>{                     // hard removal — the overlay can never permanently block the app
  dismiss();
  if(splash && splash.parentNode) splash.parentNode.removeChild(splash);
 }, HARD_LIMIT);

 // brand-mark image element
 let limg=null;
 if(logo){ limg=document.createElement("img"); limg.className="logo-img"; limg.alt=""; limg.decoding="async"; logo.appendChild(limg); }

 fetch(\`https://api.are.na/v2/channels/\${ARENA_BOARD}?per=100&sort=position&direction=desc\`)
  .then(r=>r.ok?r.json():Promise.reject(r.status))
  .then(d=>{
   const urls=(d.contents||[])
     .map(b=>b.image && ((b.image.large||b.image.display||b.image.original||b.image.thumb||{}).url))
     .filter(Boolean);
   if(!urls.length) return;
   const pick=()=>urls[Math.floor(Math.random()*urls.length)];

   // daily brand mark
   if(limg){ const day=Math.floor(Date.now()/86400000); const u=urls[day%urls.length];
     const pre=new Image(); pre.onload=()=>{ limg.src=u; logo.classList.add("hasimg"); limg.style.opacity="1"; }; pre.src=u; }

   // splash montage — flicker random images until dismissed
   const swap=u=>{ const im=new Image(); im.onload=()=>{ if(simg && splash && !splash.classList.contains("done")) simg.style.backgroundImage=\`url("\${u}")\`; }; im.src=u; };
   swap(pick());
   if(!REDUCE) montage=setInterval(()=>swap(pick()), 200);
  })
  .catch(()=>{ /* splash still auto-dismisses on schedule; brand mark keeps the bird icon */ });
})();

</script>
</body>
</html>
`;
