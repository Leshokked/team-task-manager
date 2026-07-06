import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useMemo, useState } from "react";

import {
  addCheckItem,
  addComment,
  addTask,
  deleteTask,
  getBoard,
  getCounts,
  getTaskDetail,
  reassign,
  setDay,
  setPrio,
  setStatus,
  startNewWeek,
  toggleCheckItem,
  type Task,
} from "../lib/api/board.functions";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "9 Birds — Team Board" }] }),
  component: App,
});

/* ---------- constants ---------- */
const PEOPLE: Record<string, { key: string; name: string; color: string }> = {
  CN: { key: "carlos", name: "Carlos", color: "#2E6EDD" },
  BR: { key: "brandon", name: "Brandon", color: "#6B4F3A" },
  AN: { key: "angela", name: "Angela", color: "#7A8450" },
  RY: { key: "riley", name: "Riley", color: "#5B6B8C" },
  JS: { key: "jess", name: "Jess", color: "#4A7C7E" },
};
const INITIALS: Record<string, string> = { carlos: "CN", brandon: "BR", angela: "AN", riley: "RY", jess: "JS" };
const COLUMNS = [
  { id: "todo", name: "To Do · This Week", color: "#969188" },
  { id: "progress", name: "In Progress", color: "#2E6EDD" },
  { id: "review", name: "In Review", color: "#B5842B" },
  { id: "done", name: "Done", color: "#3C8C5F" },
];
const COL_NAME: Record<string, string> = { todo: "To Do", progress: "In Progress", review: "In Review", done: "Done" };
const COL_COLOR: Record<string, string> = { todo: "#969188", progress: "#2E6EDD", review: "#B5842B", done: "#3C8C5F" };
const BRAND_COLORS: Record<string, string> = {
  "9 birds": "#2E6EDD", "9 birds creative": "#2E6EDD", auteur: "#8C7A55", cmd: "#6B4F3A",
  "coffee machine depot": "#6B4F3A", "jurassic magic": "#2E8B6F", convi: "#2E8B6F", "jm/convi": "#2E8B6F",
  markibar: "#A65A3C", "markibar usa": "#A65A3C", bronco: "#C07A2D", "lost explorer": "#4A6C6F",
  "second layer": "#3A3A44", "re/creation cafe": "#7A9E5E", admin: "#969188", cdll: "#7A5C58", "cout de la liberte": "#7A5C58", "since 1976": "#4E6E58",
};
const FALLBACK = ["#2E6EDD", "#8C7A55", "#2E8B6F", "#6B4FA0", "#C07A2D", "#4A7C7E", "#A65A3C", "#5B6B8C"];
function brandColor(b?: string | null): string {
  if (!b) return "#969188";
  const k = b.trim().toLowerCase();
  if (BRAND_COLORS[k]) return BRAND_COLORS[k];
  let h = 0;
  for (const c of k) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length];
}
const DAY_OFFSET: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const PRIOS = ["urgent", "high", "medium", "low"];

function dueInfo(week: string, day: string): { label: string; state: string } {
  if (!week || !day || day === "Any") return { label: "This week", state: "" };
  const [y, m, d] = week.split("-").map(Number);
  const date = new Date(y, m - 1, d + (DAY_OFFSET[day] ?? 0));
  const label = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const state = date < today ? "over" : date.getTime() === today.getTime() ? "today" : "";
  return { label, state };
}

/* ---------- icons ---------- */
const I = {
  board: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="18" rx="1.5" /><rect x="14" y="3" width="7" height="11" rx="1.5" /></svg>,
  mine: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>,
  cal: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>,
  rep: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="M18 9l-5 5-3-3-4 4" /></svg>,
  list: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>,
  search: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>,
  plus: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>,
  check: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>,
  x: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>,
  chat: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>,
  bell: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>,
  bird: <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12c3-6 15-6 18 0-3 6-15 6-18 0Z" /><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" /></svg>,
};

function Avatar({ initials, size = "" }: { initials: string; size?: string }) {
  const p = PEOPLE[initials];
  if (!p) return null;
  return (
    <div className={`avatar ${size}`} style={{ background: p.color }} title={p.name}>
      {initials}
    </div>
  );
}

/* ---------- app ---------- */
function App() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["board"],
    queryFn: () => getBoard(),
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });
  const week = data?.week ?? "";
  const { data: counts } = useQuery({
    queryKey: ["counts"],
    queryFn: () => getCounts(),
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });
  const checkMap = useMemo(() => {
    const m: Record<string, { total: number; done: number }> = {};
    (counts?.checks ?? []).forEach((c) => { m[c.task_id] = { total: c.total, done: c.done ?? 0 }; });
    return m;
  }, [counts]);
  const commentMap = useMemo(() => {
    const m: Record<string, number> = {};
    (counts?.comments ?? []).forEach((c) => { m[c.task_id] = c.n; });
    return m;
  }, [counts]);
  const [me, setMe] = useState("");
  const [view, setView] = useState("board");
  const [vmode, setVmode] = useState("board");
  const [fWho, setFWho] = useState<string | null>(null);
  const [fPrio, setFPrio] = useState("all");
  const [qtext, setQtext] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState("");
  const [pending, setPending] = useState<Record<string, Partial<Task>>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("nb-me");
    if (stored) setMe(stored);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        document.getElementById("boardSearch")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const tasks: Task[] = useMemo(() => {
    const base = (data?.tasks ?? []) as Task[];
    return base.map((t) => (pending[t.id] ? { ...t, ...pending[t.id] } : t));
  }, [data, pending]);

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2600);
  }
  function refetch() {
    void qc.invalidateQueries({ queryKey: ["board"] });
    void qc.invalidateQueries({ queryKey: ["counts"] });
  }
  function patch(id: string, p: Partial<Task>) {
    setPending((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }));
  }
  async function doStatus(t: Task, status: string) {
    patch(t.id, { status });
    await setStatus({ data: { id: t.id, status: status as never, by: me } });
    refetch();
  }
  async function doMove(t: Task, personKey: string) {
    patch(t.id, { person: personKey });
    await reassign({ data: { id: t.id, person: personKey as never, by: me } });
    refetch();
    flash(`Moved to ${PEOPLE[INITIALS[personKey]].name}`);
  }

  const visible = (t: Task) => {
    const okW = !fWho || INITIALS[t.person] === fWho;
    const okP = fPrio === "all" || (t.prio || "medium") === fPrio;
    const okQ =
      !qtext ||
      (t.title + " " + t.brand + " " + (PEOPLE[INITIALS[t.person]]?.name ?? ""))
        .toLowerCase()
        .includes(qtext.toLowerCase());
    return okW && okP && okQ;
  };

  const open = tasks.filter((t) => t.status !== "done");
  const brands = useMemo(() => {
    const m = new Map<string, number>();
    open.forEach((t) => t.brand && m.set(t.brand, (m.get(t.brand) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [tasks]);

  const weekNum = week ? Math.ceil(((new Date(week).getTime() - new Date(new Date(week).getFullYear(), 0, 1).getTime()) / 864e5 + 1) / 7) : 0;
  const weekLabel = week
    ? `Week ${weekNum} · ${new Date(week + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
    : "Loading…";
  const titles: Record<string, [string, string]> = {
    board: ["Team Board", weekLabel],
    mine: ["My Tasks", `${me || "You"} · ${weekLabel}`],
    calendar: ["Calendar", weekLabel],
    reports: ["Reports", `${weekLabel} · workload and throughput`],
  };

  const openTask = tasks.find((t) => t.id === openId) ?? null;
  const mineTasks = tasks.filter((t) => PEOPLE[INITIALS[t.person]]?.name === me);

  return (
    <div className="app">
      {!me && <Gate onPick={(n) => { window.localStorage.setItem("nb-me", n); setMe(n); }} />}

      <aside className="side">
        <div className="brandmark">
          <div className="logo">{I.bird}</div>
          <div><b>9 Birds</b><span>Creative · Team</span></div>
        </div>
        <div className="navsec">
          {[
            ["board", "Board", I.board, String(open.length)],
            ["mine", "My Tasks", I.mine, String(mineTasks.filter((t) => t.status !== "done").length)],
            ["calendar", "Calendar", I.cal, ""],
            ["reports", "Reports", I.rep, ""],
          ].map(([id, label, icon, count]) => (
            <button key={id as string} className={`nav ${view === id ? "active" : ""}`} onClick={() => setView(id as string)}>
              {icon as React.ReactNode} {label as string}
              {count ? <span className="count tnum">{count as string}</span> : null}
            </button>
          ))}
        </div>
        <div className="navsec">
          <div className="label">Brands</div>
          {brands.map(([name, n]) => (
            <button key={name} className="brandrow" onClick={() => { setQtext(name); setView("board"); }}>
              <span className="dot" style={{ background: brandColor(name) }} /> {name}
              <span className="count tnum">{n}</span>
            </button>
          ))}
        </div>
        <div className="side-foot">
          <div className="avatar lg" style={{ background: me && Object.values(PEOPLE).find((p) => p.name === me)?.color || "#2E6EDD" }}>
            {me ? (Object.keys(PEOPLE).find((k) => PEOPLE[k].name === me) ?? "?") : "?"}
          </div>
          <div className="meta">
            <b>{me || "Pick your name"}</b><br />
            <span>{me === "Carlos" ? "Marketing Director" : "9 Birds Creative"}</span>
          </div>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div className="title">
            <h1>{titles[view][0]}</h1>
            <p>{titles[view][1]}</p>
          </div>
          <label className="search">
            {I.search}
            <input id="boardSearch" placeholder="Search tasks, brands, people" aria-label="Search" value={qtext} onChange={(e) => setQtext(e.target.value)} />
            <kbd>&#8984;K</kbd>
          </label>
          <div className="spacer" />
          {view === "board" && (
            <div className="segmented">
              <button className={`seg ${vmode === "board" ? "active" : ""}`} onClick={() => setVmode("board")}>{I.board}Board</button>
              <button className={`seg ${vmode === "list" ? "active" : ""}`} onClick={() => setVmode("list")}>{I.list}List</button>
            </div>
          )}
          <button className="iconbtn" aria-label="Notifications" onClick={() => {
            const over = tasks.filter((x) => x.status !== "done" && dueInfo(week, x.day).state === "over").length;
            const rev = tasks.filter((x) => x.status === "review").length;
            flash(over || rev ? `${over} overdue · ${rev} waiting in review` : "All clear — nothing overdue");
          }}>
            {tasks.some((x) => x.status !== "done" && dueInfo(week, x.day).state === "over") && <span className="badge" />}
            {I.bell}
          </button>
          {me === "Carlos" && (
            <button className="btn-ghost" onClick={() => {
              if (window.confirm("Start a new week? Everything unfinished carries over.")) {
                void startNewWeek({ data: { by: "Carlos" } }).then((r) => { refetch(); flash(`New week started — ${(r as { carried: number }).carried} carried over`); });
              }
            }}>New week ↻</button>
          )}
          <button className="btn-primary" onClick={() => setCreating(true)}>{I.plus}New task</button>
        </div>

        {(view === "board" || view === "mine") && (
          <div className="filterbar">
            <span className="flabel">Team</span>
            <div className="avstack">
              {Object.keys(PEOPLE).map((k) => (
                <div key={k} className={`avatar ${fWho && fWho !== k ? "dim" : ""}`} style={{ background: PEOPLE[k].color }} title={PEOPLE[k].name}
                  onClick={() => setFWho(fWho === k ? null : k)}>{k}</div>
              ))}
            </div>
            <div className="fdiv" />
            <span className="flabel">Filter</span>
            {["all", "urgent", "high"].map((p) => (
              <button key={p} className={`chip ${fPrio === p ? "on" : ""}`} onClick={() => setFPrio(p)}>
                {p !== "all" && <span className="dot" style={{ background: p === "urgent" ? "var(--crit)" : "var(--warn)" }} />}
                {p === "all" ? "All priorities" : p[0].toUpperCase() + p.slice(1)}
              </button>
            ))}
            {(fWho || fPrio !== "all" || qtext) && (
              <button className="clearfilter" onClick={() => { setFWho(null); setFPrio("all"); setQtext(""); }}>Clear filters ✕</button>
            )}
          </div>
        )}

        <div className="content">
          {view === "board" && (
            <section className="view active">
              <StatsStrip tasks={tasks} week={week} />
              {vmode === "board" ? (
                <div className="board">
                  {COLUMNS.map((col) => {
                    const items = [...tasks.filter((t) => t.status === col.id)].sort((a, b) => Number(visible(b)) - Number(visible(a)));
                    return (
                      <section key={col.id} className={`col ${col.id === "done" ? "done-col" : ""} ${overCol === col.id ? "dropping" : ""}`}
                        onDragOver={(e) => { e.preventDefault(); setOverCol(col.id); }}
                        onDragLeave={() => setOverCol((c) => (c === col.id ? null : c))}
                        onDrop={(e) => {
                          e.preventDefault(); setOverCol(null);
                          const id = e.dataTransfer.getData("text/task") || dragId;
                          const t = tasks.find((x) => x.id === id);
                          if (t && t.status !== col.id) { void doStatus(t, col.id); flash(`Moved to ${COL_NAME[col.id]}`); }
                        }}>
                        <div className="col-head">
                          <span className="swatch" style={{ background: col.color }} />
                          <h3>{col.name}</h3>
                          <span className="n tnum">{items.length}</span>
                          <button className="add" aria-label="Add" onClick={() => setCreating(true)}>{I.plus}</button>
                        </div>
                        <div className="col-body">
                          {items.map((t) => (
                            <Card key={t.id} t={t} week={week} dim={!visible(t)}
                              ck={checkMap[t.id]} cn={commentMap[t.id] ?? 0}
                              onOpen={() => setOpenId(t.id)}
                              onDragStart={(e) => { setDragId(t.id); e.dataTransfer.setData("text/task", t.id); e.dataTransfer.effectAllowed = "move"; }} />
                          ))}
                        </div>
                      </section>
                    );
                  })}
                </div>
              ) : (
                <ListView tasks={tasks} week={week} visible={visible} onOpen={setOpenId} grouped />
              )}
            </section>
          )}

          {view === "mine" && (
            <section className="view active">
              <div className="focus">
                <div>
                  <div className="fk">On your plate</div>
                  <div className="big tnum">{mineTasks.filter((t) => t.status !== "done").length}</div>
                </div>
                <div className="fdivv" />
                <div>
                  <div className="fk">This week</div>
                  <div className="ftxt">
                    You own <b>{mineTasks.filter((t) => t.status === "todo").length} to-dos</b>, <b>{mineTasks.filter((t) => t.status === "progress").length} in progress</b> and <b>{mineTasks.filter((t) => t.status === "review").length} in review</b>.
                    {mineTasks.some((t) => t.carry > 0 && t.status !== "done") ? " Carried-over items are marked ↩ — clear those first." : " Nothing carried over. Clean sheet."}
                  </div>
                </div>
              </div>
              {mineTasks.length ? (
                <ListView tasks={mineTasks} week={week} visible={visible} onOpen={setOpenId} grouped />
              ) : (
                <div className="panel">{me ? "Nothing assigned to you this week." : "Pick your name (left sidebar) to see your tasks."}</div>
              )}
            </section>
          )}

          {view === "calendar" && <CalendarView tasks={tasks} week={week} onOpen={setOpenId} />}
          {view === "reports" && <Reports tasks={tasks} throughput={data?.throughput ?? []} />}
        </div>
      </div>

      <div className={`scrim ${openTask || creating ? "open" : ""}`} onClick={() => { setOpenId(null); setCreating(false); }} />
      <Drawer t={openTask} week={week} me={me}
        onClose={() => setOpenId(null)}
        onStatus={(t, s) => { void doStatus(t, s); if (s === "done") flash("Task marked complete"); }}
        onMove={(t, p) => void doMove(t, p)}
        onPrio={(t, p) => { patch(t.id, { prio: p }); void setPrio({ data: { id: t.id, prio: p as never, by: me } }).then(refetch); }}
        onDay={(t, d) => { patch(t.id, { day: d }); void setDay({ data: { id: t.id, day: d as never, by: me } }).then(refetch); }}
        onDelete={(t) => { setOpenId(null); void deleteTask({ data: { id: t.id, by: me } }).then(() => { refetch(); flash("Task deleted"); }); }} />
      <CreateDrawer open={creating} me={me} onClose={() => setCreating(false)}
        onCreate={async (payload) => {
          await addTask({ data: { ...payload, by: me } as never });
          refetch();
          setCreating(false);
          flash(`Task added to To Do — ${payload.title.slice(0, 40)}`);
        }} />
      <div className={`toast ${toast ? "show" : ""}`}>{I.check}<span>{toast}</span></div>
    </div>
  );
}

/* ---------- pieces ---------- */
function Gate({ onPick }: { onPick: (n: string) => void }) {
  return (
    <div className="gate">
      <div className="gate-card">
        <div className="logo lg">{I.bird}</div>
        <h2>Who&rsquo;s checking in?</h2>
        <p>Everything you check off or move gets stamped with your name.</p>
        <div className="gate-names">
          {Object.keys(PEOPLE).map((k) => (
            <button key={k} onClick={() => onPick(PEOPLE[k].name)}>
              <span className="avatar sm" style={{ background: PEOPLE[k].color }}>{k}</span>
              {PEOPLE[k].name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatsStrip({ tasks, week }: { tasks: Task[]; week: string }) {
  const open = tasks.filter((t) => t.status !== "done");
  const overdue = open.filter((t) => dueInfo(week, t.day).state === "over").length;
  const done = tasks.filter((t) => t.status === "done").length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  return (
    <div className="stats">
      <div className="stat"><div className="k">Open this week</div><div className="v tnum">{open.length}</div><div className="bar"><i style={{ width: `${100 - pct}%`, background: "var(--accent)" }} /></div></div>
      <div className="stat"><div className="k">In progress</div><div className="v neutral tnum">{tasks.filter((t) => t.status === "progress").length}</div><div className="sub">Across {new Set(open.map((t) => t.brand).filter(Boolean)).size} brands</div></div>
      <div className="stat"><div className="k">Needs review</div><div className="v tnum" style={{ color: "var(--warn)" }}>{tasks.filter((t) => t.status === "review").length}</div><div className="sub">Waiting on sign-off</div></div>
      <div className="stat"><div className="k">Overdue</div><div className="v tnum" style={{ color: overdue ? "var(--crit)" : "var(--ink)" }}>{overdue}</div><div className="sub">{overdue ? <span className="trend down">needs attention</span> : "on schedule"}</div></div>
      <div className="stat"><div className="k">Done</div><div className="v neutral tnum">{done}</div><div className="sub"><span className="trend up">{pct}%</span> of the sheet</div></div>
    </div>
  );
}

function Card({ t, week, dim, ck, cn, onOpen, onDragStart }: {
  t: Task; week: string; dim: boolean; ck?: { total: number; done: number }; cn: number; onOpen: () => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const due = dueInfo(week, t.day);
  const prio = t.prio || "medium";
  return (
    <article className={`card p-${prio} ${t.status === "done" ? "done" : ""} ${dim ? "fade" : ""}`}
      draggable onDragStart={onDragStart} onClick={onOpen}>
      <div className="card-top">
        <span className="tag"><span className="dot" style={{ background: brandColor(t.brand) }} />{t.brand || "General"}</span>
        <span className={`prio ${prio}`}>{prio}</span>
      </div>
      <h4>{t.title}</h4>
      {ck && ck.total > 0 && (
        <div className="progress">
          <div className="ptop"><span>Checklist</span><span className="tnum">{ck.done}/{ck.total}</span></div>
          <div className="bar"><i style={{ width: `${Math.round((ck.done / ck.total) * 100)}%`, background: ck.done === ck.total ? "var(--good)" : "var(--accent)" }} /></div>
        </div>
      )}
      <div className="card-foot">
        <Avatar initials={INITIALS[t.person] ?? "CN"} />
        <span className={`due ${t.status === "done" ? "" : due.state}`}>{I.cal}{t.status === "done" ? "Done" : due.label}</span>
        <div className="metas">
          {cn > 0 && <span className="metaic">{I.chat}{cn}</span>}
          {t.carry > 0 && <span className="metaic carrytag">↩ ×{t.carry}</span>}
          {t.status === "done" && t.updated_by && <span className="metaic">✓ {t.updated_by}</span>}
        </div>
      </div>
    </article>
  );
}

function ListView({ tasks, week, visible, onOpen, grouped }: {
  tasks: Task[]; week: string; visible: (t: Task) => boolean; onOpen: (id: string) => void; grouped?: boolean;
}) {
  const groups = grouped ? COLUMNS : [{ id: "all", name: "All", color: "#969188" }];
  return (
    <div className="list">
      {groups.map((g) => {
        const items = [...(grouped ? tasks.filter((t) => t.status === g.id) : tasks)].sort((a, b) => Number(visible(b)) - Number(visible(a)));
        if (!items.length) return null;
        return (
          <React.Fragment key={g.id}>
            {grouped && (
              <div className="lgroup-head">
                <span className="swatch" style={{ background: g.color }} />
                <h3>{COL_NAME[g.id] ?? g.name}</h3>
                <span className="n tnum">{items.length}</span>
              </div>
            )}
            {items.map((t) => {
              const due = dueInfo(week, t.day);
              return (
                <div key={t.id} className={`lrow ${t.status === "done" ? "done" : ""} ${visible(t) ? "" : "fade"}`} onClick={() => onOpen(t.id)}>
                  <div className="lcheck">{t.status === "done" ? I.check : null}</div>
                  <div className="ltitle">
                    <span className="dot" style={{ background: brandColor(t.brand), width: 8, height: 8, borderRadius: "50%" }} />
                    <span className="tt">{t.title}</span>
                    {t.carry > 0 && <span className="metaic carrytag">↩ ×{t.carry}</span>}
                  </div>
                  <div className="lmeta"><Avatar initials={INITIALS[t.person]} size="sm" /> {PEOPLE[INITIALS[t.person]]?.name}</div>
                  <div className="lmeta"><span className={`prio ${t.prio || "medium"}`}>{t.prio || "medium"}</span></div>
                  <div className="lmeta" style={due.state === "over" ? { color: "var(--crit)" } : due.state === "today" ? { color: "var(--warn)" } : undefined}>{due.label}</div>
                  <div className="lmeta">{COL_NAME[t.status]}</div>
                </div>
              );
            })}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function CalendarView({ tasks, week, onOpen }: { tasks: Task[]; week: string; onOpen: (id: string) => void }) {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Any"];
  const now = new Date();
  const todayDow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][now.getDay()];
  return (
    <section className="view active">
      <div className="vhead"><h2>This week</h2><p>Tasks placed on their planned day · anything without a day sits in Anytime</p></div>
      <div className="cal">
        {days.map((d) => {
          const items = tasks.filter((t) => (t.day === d) || (d === "Any" && (!t.day || t.day === "Any")));
          const date = d !== "Any" && week ? dueInfo(week, d).label : "";
          return (
            <div key={d} className={`calday ${d === todayDow ? "today" : ""}`}>
              <div className="calhd"><span className="dow">{d === "Any" ? "Anytime" : d}</span><span className="dnum">{date}</span></div>
              {items.length ? items.map((t) => (
                <div key={t.id} className={`calchip ${t.status === "done" ? "chipdone" : ""}`} style={{ borderLeftColor: brandColor(t.brand) }} onClick={() => onOpen(t.id)}>
                  <span className="cb">{t.brand || PEOPLE[INITIALS[t.person]]?.name}</span>
                  <span className="ct">{t.title}</span>
                </div>
              )) : <div className="calempty">—</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Reports({ tasks, throughput }: { tasks: Task[]; throughput: { week: string; n: number }[] }) {
  const open = tasks.filter((t) => t.status !== "done");
  const byBrand = new Map<string, number>();
  open.forEach((t) => byBrand.set(t.brand || "General", (byBrand.get(t.brand || "General") ?? 0) + 1));
  const brands = [...byBrand.entries()].sort((a, b) => b[1] - a[1]);
  const bMax = Math.max(1, ...brands.map((b) => b[1]));
  const byPerson = new Map<string, number>();
  open.forEach((t) => byPerson.set(t.person, (byPerson.get(t.person) ?? 0) + 1));
  const pMax = Math.max(1, ...byPerson.values());
  const st = ["todo", "progress", "review"].map((k) => ({ k, n: tasks.filter((t) => t.status === k).length }));
  const stTotal = Math.max(1, st.reduce((a, b) => a + b.n, 0));
  const tMax = Math.max(1, ...throughput.map((w) => w.n));
  return (
    <section className="view active">
      <div className="vhead"><h2>Team reports</h2><p>Live workload, capacity, and throughput across all brands</p></div>
      <div className="rgrid">
        <div className="panel">
          <h3>Open workload by brand</h3><p className="psub">Active tasks not yet done</p>
          {brands.map(([name, n]) => (
            <div key={name} className="hbar">
              <div className="hlabel"><span className="dot" style={{ background: brandColor(name) }} />{name}</div>
              <div className="htrack"><i style={{ width: `${(n / bMax) * 100}%`, background: brandColor(name) }} /></div>
              <div className="hval tnum">{n}</div>
            </div>
          ))}
        </div>
        <div className="panel">
          <h3>Team capacity</h3><p className="psub">Open tasks per person</p>
          {Object.keys(PEOPLE).map((k) => {
            const n = byPerson.get(PEOPLE[k].key) ?? 0;
            return (
              <div key={k} className="cap">
                <div className="who"><Avatar initials={k} size="sm" />{PEOPLE[k].name}</div>
                <div className="ctrack"><i style={{ width: `${(n / pMax) * 100}%`, background: PEOPLE[k].color }} /></div>
                <div className="cn tnum">{n} open</div>
              </div>
            );
          })}
        </div>
        <div className="panel wide">
          <h3>Throughput</h3><p className="psub">Tasks completed per week</p>
          <div className="cols">
            {throughput.length ? throughput.map((w, i) => (
              <div key={w.week} className="colw">
                <div className={`cbar ${i === throughput.length - 1 ? "" : "muted"}`} style={{ height: `${(w.n / tMax) * 100}%` }}><span className="tnum">{w.n}</span></div>
                <div className="clab">{new Date(w.week + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
              </div>
            )) : <div className="calempty" style={{ width: "100%" }}>Completions will chart here week by week.</div>}
          </div>
        </div>
        <div className="panel wide">
          <h3>Status distribution</h3><p className="psub">Where the {tasks.length} tasks on this week&rsquo;s sheet sit right now</p>
          <div className="stacked">{st.map((s) => (<i key={s.k} style={{ width: `${(s.n / stTotal) * 100}%`, background: COL_COLOR[s.k] }} />))}</div>
          <div className="legend">{st.map((s) => (<span key={s.k}><span className="sw" style={{ background: COL_COLOR[s.k] }} />{COL_NAME[s.k]} · {s.n}</span>))}</div>
        </div>
      </div>
    </section>
  );
}

function Drawer({ t, week, me, onClose, onStatus, onMove, onPrio, onDay, onDelete }: {
  t: Task | null; week: string; me: string; onClose: () => void;
  onStatus: (t: Task, s: string) => void; onMove: (t: Task, p: string) => void;
  onPrio: (t: Task, p: string) => void; onDay: (t: Task, d: string) => void; onDelete: (t: Task) => void;
}) {
  const qc = useQueryClient();
  const { data: detail } = useQuery({
    queryKey: ["detail", t?.id],
    queryFn: () => getTaskDetail({ data: { id: t!.id } }),
    enabled: !!t,
  });
  const [newItem, setNewItem] = useState("");
  const [newComment, setNewComment] = useState("");
  function refreshDetail() {
    void qc.invalidateQueries({ queryKey: ["detail", t?.id] });
    void qc.invalidateQueries({ queryKey: ["counts"] });
  }
  if (!t) return <aside className="drawer" aria-hidden="true" />;
  const due = dueInfo(week, t.day);
  const sc = COL_COLOR[t.status];
  const meInitial = Object.keys(PEOPLE).find((k) => PEOPLE[k].name === me) ?? "CN";
  const checklist = detail?.checklist ?? [];
  const comments = detail?.comments ?? [];
  return (
    <aside className="drawer open" aria-hidden="false">
      <div className="dr-head">
        <span className="tag"><span className="dot" style={{ background: brandColor(t.brand) }} />{t.brand || "General"}</span>
        <button className="dr-close" aria-label="Close" onClick={onClose}>{I.x}</button>
      </div>
      <div className="dr-body">
        <h2>{t.title}</h2>
        <div className="dr-props">
          <span className="pk">Status</span>
          <span className="pv">
            <span className="dot" style={{ background: sc, width: 8, height: 8 }} />
            <select className="propsel" value={t.status} onChange={(e) => onStatus(t, e.target.value)}>
              {COLUMNS.map((c) => (<option key={c.id} value={c.id}>{COL_NAME[c.id]}</option>))}
            </select>
          </span>
          <span className="pk">Assignee</span>
          <span className="pv">
            <Avatar initials={INITIALS[t.person]} size="sm" />
            <select className="propsel" value={t.person} onChange={(e) => onMove(t, e.target.value)}>
              {Object.keys(PEOPLE).map((k) => (<option key={k} value={PEOPLE[k].key}>{PEOPLE[k].name}</option>))}
            </select>
          </span>
          <span className="pk">Priority</span>
          <span className="pv">
            <select className={`propsel prio ${t.prio || "medium"}`} value={t.prio || "medium"} onChange={(e) => onPrio(t, e.target.value)}>
              {PRIOS.map((p) => (<option key={p} value={p}>{p}</option>))}
            </select>
          </span>
          <span className="pk">Day</span>
          <span className="pv">
            <select className="propsel" value={t.day || "Any"} onChange={(e) => onDay(t, e.target.value)}>
              {["Any", "Mon", "Tue", "Wed", "Thu", "Fri"].map((d) => (<option key={d} value={d}>{d === "Any" ? "Anytime this week" : `${d} · ${dueInfo(week, d).label}`}</option>))}
            </select>
            {due.state === "over" && t.status !== "done" ? <span style={{ color: "var(--crit)", fontSize: 12, fontWeight: 700 }}>overdue</span> : null}
          </span>
          {t.carry > 0 && (<><span className="pk">History</span><span className="pv">↩ carried over ×{t.carry}</span></>)}
          {t.updated_by && (<><span className="pk">Last touched</span><span className="pv">{t.updated_by}</span></>)}
        </div>
        <div>
          <div className="dsec-t">Checklist · {checklist.filter((c) => c.done).length}/{checklist.length}</div>
          {checklist.map((c) => (
            <div key={c.id} className={`checkrow ${c.done ? "on" : ""}`}
              onClick={() => { void toggleCheckItem({ data: { id: c.id, done: !c.done } }).then(refreshDetail); }}>
              <span className="cbx">{c.done ? I.check : null}</span>
              <span>{c.label}</span>
            </div>
          ))}
          <div className="checkadd">
            <input value={newItem} placeholder="Add a checklist step…"
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newItem.trim()) {
                  void addCheckItem({ data: { task_id: t.id, label: newItem.trim() } }).then(() => { setNewItem(""); refreshDetail(); });
                }
              }} />
          </div>
        </div>
        <div>
          <div className="dsec-t">Activity</div>
          {comments.length === 0 && <p className="psub" style={{ marginBottom: 10 }}>No comments yet.</p>}
          {comments.map((c) => {
            const ini = Object.keys(PEOPLE).find((k) => PEOPLE[k].name === c.author) ?? "CN";
            return (
              <div key={c.id} className="comment">
                <Avatar initials={ini} size="sm" />
                <div>
                  <div className="cbubble"><div className="cwho">{c.author}</div>{c.body}</div>
                  <div className="ctime">{new Date(c.created_at.replace(" ", "T") + "Z").toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
                </div>
              </div>
            );
          })}
          <div className="commentadd">
            <Avatar initials={meInitial} size="sm" />
            <input value={newComment} placeholder="Write a comment…"
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newComment.trim() && me) {
                  void addComment({ data: { task_id: t.id, author: me, body: newComment.trim() } }).then(() => { setNewComment(""); refreshDetail(); });
                }
              }} />
          </div>
        </div>
      </div>
      <div className="dr-foot">
        {t.status !== "done" ? (
          <button className="btn-primary" onClick={() => onStatus(t, "done")}>{I.check}Mark complete</button>
        ) : (
          <button className="btn-ghost" style={{ flex: 1 }} onClick={() => onStatus(t, "todo")}>Reopen</button>
        )}
        {me === "Carlos" && <button className="btn-ghost" onClick={() => { if (window.confirm("Delete this task?")) onDelete(t); }}>Delete</button>}
      </div>
    </aside>
  );
}

function CreateDrawer({ open, me, onClose, onCreate }: {
  open: boolean; me: string; onClose: () => void;
  onCreate: (p: { person: string; title: string; brand: string; day: string; prio: string }) => void | Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [brand, setBrand] = useState("");
  const [person, setPerson] = useState("brandon");
  const [day, setDayV] = useState("Any");
  const [prio, setPrioV] = useState("medium");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setTitle(""); setBrand(""); setBusy(false); } }, [open]);
  if (!open) return <aside className="drawer" aria-hidden="true" />;
  return (
    <aside className="drawer open" aria-hidden="false">
      <div className="dr-head">
        <span className="tag">New task</span>
        <button className="dr-close" aria-label="Close" onClick={onClose}>{I.x}</button>
      </div>
      <div className="dr-body">
        <input className="biginput" autoFocus placeholder="What needs to happen?" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="dr-props">
          <span className="pk">Assignee</span>
          <span className="pv"><select className="propsel" value={person} onChange={(e) => setPerson(e.target.value)}>{Object.keys(PEOPLE).map((k) => (<option key={k} value={PEOPLE[k].key}>{PEOPLE[k].name}</option>))}</select></span>
          <span className="pk">Brand</span>
          <span className="pv"><input className="propsel" style={{ width: "100%" }} placeholder="AUTEUR, CMD, MarkiBar…" value={brand} onChange={(e) => setBrand(e.target.value)} /></span>
          <span className="pk">Day</span>
          <span className="pv"><select className="propsel" value={day} onChange={(e) => setDayV(e.target.value)}>{["Any", "Mon", "Tue", "Wed", "Thu", "Fri"].map((d) => (<option key={d}>{d}</option>))}</select></span>
          <span className="pk">Priority</span>
          <span className="pv"><select className="propsel" value={prio} onChange={(e) => setPrioV(e.target.value)}>{PRIOS.map((p) => (<option key={p}>{p}</option>))}</select></span>
        </div>
      </div>
      <div className="dr-foot">
        <button className="btn-primary" disabled={busy} onClick={async () => {
          if (!title.trim() || busy) return;
          setBusy(true);
          try { await onCreate({ person, title: title.trim(), brand: brand.trim(), day, prio }); } finally { setBusy(false); }
        }}>{I.plus}{busy ? "Adding…" : "Add task"}</button>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </aside>
  );
}
