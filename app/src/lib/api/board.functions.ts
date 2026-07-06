import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { bindings } from "../bindings.server";

function db() {
  const d = bindings().DB;
  if (!d) throw new Error("Database not provisioned");
  return d;
}

export type Task = {
  id: string;
  week: string;
  person: string;
  title: string;
  brand: string;
  day: string;
  status: string;
  prio: string;
  carry: number;
  sort: number;
  updated_by: string;
  updated_at: string;
};

const PEOPLE = ["brandon", "angela", "riley", "jess", "carlos"] as const;
const STATUSES = ["todo", "progress", "review", "done"] as const;
const PRIOS = ["urgent", "high", "medium", "low"] as const;
const DAYS = ["Any", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export const getBoard = createServerFn({ method: "GET" }).handler(async () => {
  const d = db();
  const wk = await d
    .prepare("SELECT value FROM meta WHERE key='current_week'")
    .first<{ value: string }>();
  const week = wk?.value ?? "";
  const tasks = week
    ? ((
        await d
          .prepare("SELECT * FROM tasks WHERE week=?1 ORDER BY sort, created_at")
          .bind(week)
          .all<Task>()
      ).results ?? [])
    : [];
  const throughput =
    (
      await d
        .prepare(
          "SELECT week, COUNT(*) AS n FROM tasks WHERE status='done' GROUP BY week ORDER BY week DESC LIMIT 6",
        )
        .all<{ week: string; n: number }>()
    ).results ?? [];
  return { week, tasks, throughput: throughput.reverse() };
});

export const setStatus = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({ id: z.string().min(1).max(64), status: z.enum(STATUSES), by: z.string().max(24).optional() }),
  )
  .handler(async ({ data }) => {
    await db()
      .prepare("UPDATE tasks SET status=?1, updated_by=?2, updated_at=datetime('now') WHERE id=?3")
      .bind(data.status, data.by ?? "", data.id)
      .run();
    return { ok: true };
  });

export const setPrio = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({ id: z.string().min(1).max(64), prio: z.enum(PRIOS), by: z.string().max(24).optional() }),
  )
  .handler(async ({ data }) => {
    await db()
      .prepare("UPDATE tasks SET prio=?1, updated_by=?2, updated_at=datetime('now') WHERE id=?3")
      .bind(data.prio, data.by ?? "", data.id)
      .run();
    return { ok: true };
  });

export const reassign = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({ id: z.string().min(1).max(64), person: z.enum(PEOPLE), by: z.string().max(24).optional() }),
  )
  .handler(async ({ data }) => {
    await db()
      .prepare("UPDATE tasks SET person=?1, updated_by=?2, updated_at=datetime('now') WHERE id=?3")
      .bind(data.person, data.by ?? "", data.id)
      .run();
    return { ok: true };
  });

export const setDay = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({ id: z.string().min(1).max(64), day: z.enum(DAYS), by: z.string().max(24).optional() }),
  )
  .handler(async ({ data }) => {
    await db()
      .prepare("UPDATE tasks SET day=?1, updated_by=?2, updated_at=datetime('now') WHERE id=?3")
      .bind(data.day, data.by ?? "", data.id)
      .run();
    return { ok: true };
  });

export const addTask = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      person: z.enum(PEOPLE),
      title: z.string().min(1).max(300),
      brand: z.string().max(60).optional(),
      day: z.enum(DAYS).optional(),
      prio: z.enum(PRIOS).optional(),
      by: z.string().max(24).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const d = db();
    const wk = await d
      .prepare("SELECT value FROM meta WHERE key='current_week'")
      .first<{ value: string }>();
    if (!wk?.value) throw new Error("No active week");
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    await d
      .prepare(
        "INSERT INTO tasks (id, week, person, title, brand, day, status, prio, carry, updated_by) VALUES (?1,?2,?3,?4,?5,?6,'todo',?7,0,?8)",
      )
      .bind(id, wk.value, data.person, data.title, data.brand ?? "", data.day ?? "Any", data.prio ?? "medium", data.by ?? "")
      .run();
    return { ok: true, id };
  });

export const deleteTask = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().min(1).max(64), by: z.string().max(24) }))
  .handler(async ({ data }) => {
    if (data.by !== "Carlos") throw new Error("Only Carlos can delete tasks");
    await db().prepare("DELETE FROM tasks WHERE id=?1").bind(data.id).run();
    return { ok: true };
  });

export const startNewWeek = createServerFn({ method: "POST" })
  .inputValidator(z.object({ by: z.string().max(24) }))
  .handler(async ({ data }) => {
    if (data.by !== "Carlos") throw new Error("Only Carlos can roll the week");
    const d = db();
    const wk = await d
      .prepare("SELECT value FROM meta WHERE key='current_week'")
      .first<{ value: string }>();
    if (!wk?.value) throw new Error("No active week");
    const cur = new Date(wk.value + "T12:00:00Z");
    const todayMon = new Date();
    const dow = (todayMon.getUTCDay() + 6) % 7;
    todayMon.setUTCDate(todayMon.getUTCDate() - dow);
    const nextDate =
      todayMon.toISOString().slice(0, 10) > wk.value ? todayMon : new Date(cur.getTime() + 7 * 864e5);
    const next = nextDate.toISOString().slice(0, 10);
    const unfinished =
      (
        await d.prepare("SELECT * FROM tasks WHERE week=?1 AND status!='done'").bind(wk.value).all<Task>()
      ).results ?? [];
    const stmts = unfinished.map((t) =>
      d
        .prepare(
          "INSERT INTO tasks (id, week, person, title, brand, day, status, prio, carry, sort, updated_by) VALUES (?1,?2,?3,?4,?5,?6,'todo',?7,?8,?9,'Carlos')",
        )
        .bind(
          crypto.randomUUID().replace(/-/g, "").slice(0, 12),
          next,
          t.person,
          t.title,
          t.brand,
          t.day,
          t.prio ?? "medium",
          (t.carry ?? 0) + 1,
          t.sort,
        ),
    );
    stmts.push(d.prepare("UPDATE meta SET value=?1 WHERE key='current_week'").bind(next));
    await d.batch(stmts);
    return { ok: true, week: next, carried: unfinished.length };
  });

export type CheckItem = { id: string; task_id: string; label: string; done: number; sort: number };
export type Comment = { id: string; task_id: string; author: string; body: string; created_at: string };

export const getCounts = createServerFn({ method: "GET" }).handler(async () => {
  const d = db();
  const checks =
    (
      await d
        .prepare("SELECT task_id, COUNT(*) AS total, SUM(done) AS done FROM checklist GROUP BY task_id")
        .all<{ task_id: string; total: number; done: number }>()
    ).results ?? [];
  const comments =
    (
      await d.prepare("SELECT task_id, COUNT(*) AS n FROM comments GROUP BY task_id").all<{ task_id: string; n: number }>()
    ).results ?? [];
  return { checks, comments };
});

export const getTaskDetail = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().min(1).max(64) }))
  .handler(async ({ data }) => {
    const d = db();
    const checklist =
      (
        await d.prepare("SELECT * FROM checklist WHERE task_id=?1 ORDER BY sort, id").bind(data.id).all<CheckItem>()
      ).results ?? [];
    const comments =
      (
        await d.prepare("SELECT * FROM comments WHERE task_id=?1 ORDER BY created_at").bind(data.id).all<Comment>()
      ).results ?? [];
    return { checklist, comments };
  });

export const addCheckItem = createServerFn({ method: "POST" })
  .inputValidator(z.object({ task_id: z.string().min(1).max(64), label: z.string().min(1).max(200) }))
  .handler(async ({ data }) => {
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    await db()
      .prepare("INSERT INTO checklist (id, task_id, label, sort) VALUES (?1,?2,?3,(SELECT COALESCE(MAX(sort),0)+1 FROM checklist WHERE task_id=?2))")
      .bind(id, data.task_id, data.label)
      .run();
    return { ok: true, id };
  });

export const toggleCheckItem = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().min(1).max(64), done: z.boolean() }))
  .handler(async ({ data }) => {
    await db().prepare("UPDATE checklist SET done=?1 WHERE id=?2").bind(data.done ? 1 : 0, data.id).run();
    return { ok: true };
  });

export const addComment = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({ task_id: z.string().min(1).max(64), author: z.string().min(1).max(24), body: z.string().min(1).max(1000) }),
  )
  .handler(async ({ data }) => {
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    await db()
      .prepare("INSERT INTO comments (id, task_id, author, body) VALUES (?1,?2,?3,?4)")
      .bind(id, data.task_id, data.author, data.body)
      .run();
    return { ok: true, id };
  });
