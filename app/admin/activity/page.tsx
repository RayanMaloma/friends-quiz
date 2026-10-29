"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/client/api";
import type { CatalogEntry } from "@/lib/catalog";
import type { SessionDetail } from "@/lib/server/activity";
import { Spinner } from "@/components/ui";
import { Modal, Segmented } from "@/components/admin/ui";

interface Overview {
  users: number;
  sessions: number;
  active: number;
  completed: number;
}

interface Account {
  id: string;
  email: string;
  role: "user" | "super_admin";
  created_at: string;
  last_sign_in_at: string | null;
  session_count: number;
}

interface SessionRow {
  id: string;
  code: string;
  kind: string;
  game_key: string | null;
  title: string | null;
  emoji: string | null;
  state: State;
  owner_email: string | null;
  player_count: number;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

type State = "lobby" | "playing" | "completed" | "cancelled" | "expired";

const STATES: Record<State, { label: string; cls: string }> = {
  lobby: { label: "انتظار", cls: "bg-sky/20 text-sky" },
  playing: { label: "جارية", cls: "bg-sun/20 text-sun" },
  completed: { label: "مكتملة", cls: "bg-mint/20 text-mint" },
  cancelled: { label: "ملغاة", cls: "bg-pink/20 text-pink" },
  expired: { label: "منتهية", cls: "bg-mute/20 text-mute" },
};

const EVENTS: Record<string, string> = {
  session_created: "إنشاء",
  session_started: "بدء",
  session_completed: "اكتمال",
  session_cancelled: "إلغاء",
};

function when(iso: string | null, withTime = true): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ar-SA-u-nu-latn-ca-gregory", {
    day: "numeric",
    month: "short",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : { year: "numeric" }),
  });
}

interface Filters {
  gameKey: string;
  state: string;
  from: string;
  to: string;
  owner: string;
}

const NO_FILTERS: Filters = { gameKey: "", state: "", from: "", to: "", owner: "" };

export default function ActivityPage() {
  const [tab, setTab] = useState<"sessions" | "accounts">("sessions");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(async (f: Filters) => {
    setSessions(null);
    const res = await api<{ sessions: SessionRow[] }>("/api/admin", { action: "listActivitySessions", filters: f });
    if (res.ok) setSessions(res.sessions);
    else setError(errorMessage(res.error));
  }, []);

  const loadAll = useCallback(async () => {
    const [ov, acc, cat] = await Promise.all([
      api<{ overview: Overview }>("/api/admin", { action: "activityOverview" }),
      api<{ accounts: Account[] }>("/api/admin", { action: "listAccounts" }),
      api<{ catalog: CatalogEntry[] }>("/api/admin", { action: "catalog" }),
    ]);
    if (ov.ok) setOverview(ov.overview);
    else setError(errorMessage(ov.error));
    if (acc.ok) setAccounts(acc.accounts);
    if (cat.ok) setCatalog(cat.catalog);
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadAll);
  }, [loadAll]);

  useEffect(() => {
    void Promise.resolve().then(() => loadSessions(filters));
  }, [filters, loadSessions]);

  async function openDetail(id: string) {
    const res = await api<{ detail: SessionDetail }>("/api/admin", { action: "sessionDetail", id });
    if (res.ok) setDetail(res.detail);
    else setError(errorMessage(res.error));
  }

  async function sessionAction(action: "endSession" | "deleteSession", id: string) {
    if (action === "deleteSession" && !window.confirm("حذف الجلسة نهائيًا؟")) return;
    const res = await api("/api/admin", { action, id });
    if (!res.ok) return setError(errorMessage(res.error));
    setDetail(null);
    await Promise.all([loadAll(), loadSessions(filters)]);
  }

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const filtered = Object.values(filters).some(Boolean);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-4xl">النشاط</h1>
      {error && <p className="admin-alert px-3 py-2 font-bold">{error}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="المستخدمين" value={overview?.users} />
        <Metric label="الجلسات" value={overview?.sessions} />
        <Metric label="نشطة" value={overview?.active} />
        <Metric label="مكتملة" value={overview?.completed} />
      </div>

      <Segmented
        value={tab}
        onChange={setTab}
        size="sm"
        options={[
          { value: "sessions", label: "الجلسات" },
          { value: "accounts", label: `الحسابات${accounts ? ` (${accounts.length})` : ""}` },
        ]}
      />

      {tab === "sessions" ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <select className="ainput" value={filters.gameKey} onChange={(e) => set({ gameKey: e.target.value })} aria-label="اللعبة">
              <option value="">كل الألعاب</option>
              {catalog.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.title}
                </option>
              ))}
            </select>
            <select className="ainput" value={filters.state} onChange={(e) => set({ state: e.target.value })} aria-label="الحالة">
              <option value="">كل الحالات</option>
              {(Object.keys(STATES) as State[]).map((s) => (
                <option key={s} value={s}>
                  {STATES[s].label}
                </option>
              ))}
            </select>
            <select className="ainput" value={filters.owner} onChange={(e) => set({ owner: e.target.value })} aria-label="المنشئ">
              <option value="">كل المنشئين</option>
              <option value="none">كلمة مرور اللوحة</option>
              {accounts?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.email}
                </option>
              ))}
            </select>
            <input className="ainput" type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} aria-label="من" title="من" />
            <input className="ainput" type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} aria-label="إلى" title="إلى" />
            <button className="abtn" disabled={!filtered} onClick={() => setFilters(NO_FILTERS)}>
              مسح
            </button>
          </div>

          <div className="panel overflow-x-auto">
            {sessions === null ? (
              <Spinner className="mx-auto my-10 size-7 text-ink" />
            ) : sessions.length === 0 ? (
              <p className="py-10 text-center font-bold text-mute">لا توجد جلسات</p>
            ) : (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>اللعبة</th>
                    <th>المنشئ</th>
                    <th>الإنشاء</th>
                    <th>الحالة</th>
                    <th>الرمز</th>
                    <th>اللاعبين</th>
                    <th>البدء</th>
                    <th>النهاية</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id} data-clickable onClick={() => openDetail(s.id)}>
                      <td>
                        {s.emoji} {s.title}
                      </td>
                      <td dir="ltr" className="text-end">{s.owner_email ?? <span className="text-mute">—</span>}</td>
                      <td>{when(s.created_at)}</td>
                      <td>
                        <StateTag state={s.state} />
                      </td>
                      <td dir="ltr" className="text-end font-mono">{s.code}</td>
                      <td>{s.player_count}</td>
                      <td>{when(s.started_at)}</td>
                      <td>{when(s.ended_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        <div className="panel overflow-x-auto">
          {accounts === null ? (
            <Spinner className="mx-auto my-10 size-7 text-ink" />
          ) : accounts.length === 0 ? (
            <p className="py-10 text-center font-bold text-mute">لا توجد حسابات</p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>البريد</th>
                  <th>التسجيل</th>
                  <th>آخر دخول</th>
                  <th>الجلسات</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr
                    key={a.id}
                    data-clickable
                    onClick={() => {
                      setFilters({ ...NO_FILTERS, owner: a.id });
                      setTab("sessions");
                    }}
                  >
                    <td dir="ltr" className="text-end">
                      {a.role === "super_admin" && <span className="me-2 text-sun">★</span>}
                      {a.email}
                    </td>
                    <td>{when(a.created_at, false)}</td>
                    <td>{when(a.last_sign_in_at)}</td>
                    <td>{a.session_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {detail && <DetailModal detail={detail} onClose={() => setDetail(null)} onAction={sessionAction} />}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="panel flex flex-col gap-1 px-4 py-3">
      <span className="text-xs font-black text-mute">{label}</span>
      <span className="font-display text-3xl tabular-nums">{value ?? "—"}</span>
    </div>
  );
}

function StateTag({ state }: { state: State }) {
  const s = STATES[state] ?? STATES.expired;
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-black ${s.cls}`}>{s.label}</span>;
}

function DetailModal({
  detail: d,
  onClose,
  onAction,
}: {
  detail: SessionDetail;
  onClose: () => void;
  onAction: (action: "endSession" | "deleteSession", id: string) => void;
}) {
  const open = d.state === "lobby" || d.state === "playing";
  const rows: [string, React.ReactNode][] = [
    ["الحالة", <StateTag key="s" state={d.state as State} />],
    ["الرمز", <span key="c" dir="ltr" className="font-mono">{d.code}</span>],
    ["المنشئ", <span key="o" dir="ltr">{d.ownerEmail ?? "—"}</span>],
    ["الإنشاء", when(d.createdAt)],
    ["البدء", when(d.startedAt)],
    ["النهاية", when(d.finishedAt ?? d.completedAt)],
    ...(d.result ? ([["النتيجة", d.result]] as [string, string][]) : []),
    ...d.settings,
  ];
  return (
    <Modal title={`${d.emoji} ${d.title}`} onClose={onClose} wide>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3 border-b border-[var(--admin-line)] py-1.5 text-sm">
            <dt className="font-black text-mute">{k}</dt>
            <dd className="font-bold">{v}</dd>
          </div>
        ))}
      </dl>

      {d.questions && (
        <section className="flex flex-col gap-2">
          <h3 className="font-display text-xl">الأسئلة ({d.questions.length})</h3>
          <ol className="flex max-h-64 list-decimal flex-col gap-1 overflow-y-auto ps-6 text-sm font-bold">
            {d.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="font-display text-xl">اللاعبين ({d.players.length})</h3>
        {d.players.length === 0 ? (
          <p className="text-sm font-bold text-mute">—</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {d.players.map((p, i) => (
              <span key={i} className={`rounded-full border border-[var(--admin-line-hi)] px-2.5 py-0.5 text-sm font-bold ${p.active ? "" : "opacity-50"}`}>
                {p.name}
              </span>
            ))}
          </div>
        )}
      </section>

      {d.events.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="font-display text-xl">السجل</h3>
          <ul className="flex flex-col gap-0.5 text-sm font-bold">
            {d.events.map((e, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span>{EVENTS[e.kind] ?? e.kind}</span>
                <span className="text-mute">{when(e.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex justify-end gap-2">
        {open && (
          <button className="abtn" onClick={() => onAction("endSession", d.id)}>
            إنهاء
          </button>
        )}
        <button className="abtn abtn-danger" onClick={() => onAction("deleteSession", d.id)}>
          حذف
        </button>
      </div>
    </Modal>
  );
}
