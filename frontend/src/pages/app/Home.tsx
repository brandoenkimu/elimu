import { Link } from 'react-router-dom';
import { ActivityIcon, AwardIcon, BookIcon, CapIcon, ChatIcon, ClipboardIcon, LayersIcon, TimerIcon, UserCheckIcon, UsersIcon } from '../../components/icons';
import { Badge, Card, Empty, ErrorNote, Loading, Stat } from '../../components/ui';
import { dateTime, relative } from '../../lib/format';
import type { AdminStats, ClassInfo } from '../../lib/types';
import { useGet } from '../../lib/useApi';
import { useSession } from '../../state/session';

interface StudentHome {
  upcoming: { id: string; title: string; kind: string; dueAt: string | null; offeringId: string; unitCode: string; status: string }[];
  liveCheckins: { id: string; title: string; closesAt: string; offeringId: string; unitCode: string }[];
  recentResults: { id: string; title: string; offeringId: string; unitCode: string; score: number; maxScore: number }[];
}
interface LecturerHome {
  toMark: { id: string; title: string; offeringId: string; unitCode: string; pending: number }[];
  liveSessions: { id: string; title: string; closesAt: string; offeringId: string; unitCode: string }[];
}
type ClassesRes = { classes: ClassInfo[]; term: { name: string; registrationOpen: boolean; evaluationOpen: boolean } | null };

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

export function ClassCard({ c, lecturer }: { c: ClassInfo; lecturer?: boolean }) {
  return (
    <Link to={`/app/classes/${c.id}`} className="class-card">
      <div className="row"><span className="code-chip">{c.unitCode}</span><span className="spacer" /><Badge tone={c.isCurrentTerm ? 'accent' : 'neutral'}>{c.isCurrentTerm ? 'This semester' : c.termName}</Badge></div>
      <h3>{c.unitName}</h3>
      <div className="meta">
        <span>Year {c.yearOfStudy}, Sem {c.semester}</span>
        {lecturer ? <span>{c.enrolled} student{c.enrolled === 1 ? '' : 's'}</span> : c.lecturerName && <span>{c.lecturerTitle ? `${c.lecturerTitle} ` : ''}{c.lecturerName}</span>}
      </div>
    </Link>
  );
}

function StudentDashboard() {
  const { user } = useSession();
  const home = useGet<StudentHome>('/home');
  const classes = useGet<ClassesRes>('/classes');
  const reg = classes.data?.term?.registrationOpen;
  const mine = (classes.data?.classes ?? []).filter((c) => c.isCurrentTerm);
  const needsUnits = !classes.loading && mine.length === 0;

  return (
    <>
      <div className="hello">
        <div><h1>{greeting()}, {user!.displayName.split(' ')[0]}.</h1><p>{user!.courseName ? `${user!.courseName}, Year ${user!.yearOfStudy ?? 1}` : 'Welcome to Elimu.'}{classes.data?.term ? ` · ${classes.data.term.name}` : ''}</p></div>
        <Link className="btn primary" to="/app/messages"><ChatIcon /> Open messages</Link>
      </div>

      {!user!.courseId && <div className="banner"><div><b>Choose your course</b><p>Add your course in your profile so you can register for units.</p></div><Link className="btn primary" to="/app/settings/profile">Go to profile</Link></div>}
      {user!.courseId && needsUnits && reg && (
        <div className="banner"><div><b>Register your units for {classes.data?.term?.name}</b><p>Registration is open. Pick the units you are taking to join their class groups.</p></div><Link className="btn primary" to="/app/registration">Register units</Link></div>
      )}
      {home.data?.liveCheckins.map((l) => (
        <div className="banner" key={l.id}><div><b>Check-in is open for {l.unitCode}</b><p>{l.title}, closes {relative(l.closesAt)}.</p></div><Link className="btn primary" to={`/app/classes/${l.offeringId}?tab=attendance`}><TimerIcon /> Check in</Link></div>
      ))}
      {classes.data?.term?.evaluationOpen && mine.length > 0 && (
        <div className="banner"><div><b>Unit evaluations are open</b><p>Tell us how your units went. Your lecturer will not see your name.</p></div><Link className="btn" to="/app/classes">Choose a unit</Link></div>
      )}

      <div className="two-col">
        <div>
          <div className="section-title"><h2>Your units</h2><Link to="/app/classes" className="link">See all</Link></div>
          {classes.loading ? <Loading /> : classes.error ? <ErrorNote onRetry={classes.reload}>{classes.error}</ErrorNote> : mine.length === 0 ? (
            <Card><Empty title="No units yet" icon={<BookIcon />} action={reg ? <Link className="btn primary" to="/app/registration">Register units</Link> : undefined}>You are not registered for any units this semester.{reg ? '' : ' Registration will open when your administrator starts it.'}</Empty></Card>
          ) : <div className="grid auto">{mine.map((c) => <ClassCard key={c.id} c={c} />)}</div>}
        </div>
        <div>
          <div className="section-title"><h2>Coming up</h2></div>
          <Card>
            {home.loading ? <Loading /> : (home.data?.upcoming.length ?? 0) === 0 ? <p className="muted">Nothing due. Enjoy the quiet.</p> : (
              <div className="list">
                {home.data!.upcoming.map((a) => (
                  <Link key={a.id} className="list-item" to={`/app/classes/${a.offeringId}/work/${a.id}`}>
                    <span className="code-chip">{a.unitCode}</span>
                    <span className="list-main"><b>{a.title}</b><span>{a.dueAt ? `Due ${dateTime(a.dueAt)} · ${relative(a.dueAt)}` : 'No deadline'}</span></span>
                    {a.status === 'in_progress' ? <Badge tone="warn">In progress</Badge> : <Badge tone="accent">{a.kind === 'exam' ? 'Exam' : 'Assignment'}</Badge>}
                  </Link>
                ))}
              </div>
            )}
          </Card>
          <div className="section-title"><h2>Recent results</h2><Link to="/app/grades" className="link">All results</Link></div>
          <Card>
            {(home.data?.recentResults.length ?? 0) === 0 ? <p className="muted">Results appear here when your lecturers release them.</p> : (
              <div className="list">
                {home.data!.recentResults.map((r) => (
                  <Link key={r.id} className="list-item" to={`/app/classes/${r.offeringId}/work/${r.id}`}>
                    <span className="code-chip">{r.unitCode}</span><span className="list-main"><b>{r.title}</b></span>
                    <b className="num">{r.score}/{r.maxScore}</b>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function LecturerDashboard() {
  const { user } = useSession();
  const home = useGet<LecturerHome>('/home');
  const classes = useGet<ClassesRes>('/classes');
  const mine = (classes.data?.classes ?? []).filter((c) => c.isCurrentTerm);
  const students = mine.reduce((n, c) => n + c.enrolled, 0);
  return (
    <>
      <div className="hello">
        <div><h1>{greeting()}, {user!.title ? `${user!.title} ` : ''}{user!.displayName.split(' ').slice(-1)[0]}.</h1><p>{user!.department ?? 'Lecturer'}{classes.data?.term ? ` · ${classes.data.term.name}` : ''}</p></div>
        <Link className="btn primary" to="/app/classes"><BookIcon /> My classes</Link>
      </div>
      <div className="grid cols-3" style={{ marginBottom: 24 }}>
        <Stat label="Classes this semester" value={mine.length} icon={<LayersIcon />} />
        <Stat label="Registered students" value={students} icon={<UsersIcon />} />
        <Stat label="Submissions to mark" value={(home.data?.toMark ?? []).reduce((n, x) => n + Number(x.pending), 0)} icon={<ClipboardIcon />} />
      </div>
      {home.data?.liveSessions.map((l) => (
        <div className="banner" key={l.id}><div><b>Check-in running for {l.unitCode}</b><p>{l.title}, closes {relative(l.closesAt)}.</p></div><Link className="btn primary" to={`/app/classes/${l.offeringId}?tab=attendance`}>Open</Link></div>
      ))}
      <div className="two-col">
        <div>
          <div className="section-title"><h2>Your classes</h2></div>
          {classes.loading ? <Loading /> : classes.error ? <ErrorNote onRetry={classes.reload}>{classes.error}</ErrorNote> : mine.length === 0 ? (
            <Card><Empty title="No classes assigned yet" icon={<BookIcon />}>An administrator assigns you to units each semester. They will appear here.</Empty></Card>
          ) : <div className="grid auto">{mine.map((c) => <ClassCard key={c.id} c={c} lecturer />)}</div>}
        </div>
        <div>
          <div className="section-title"><h2>Waiting to be marked</h2></div>
          <Card>
            {(home.data?.toMark.length ?? 0) === 0 ? <p className="muted">Nothing waiting. You are all caught up.</p> : (
              <div className="list">
                {home.data!.toMark.map((m) => (
                  <Link key={m.id} className="list-item" to={`/app/classes/${m.offeringId}/work/${m.id}`}>
                    <span className="code-chip">{m.unitCode}</span><span className="list-main"><b>{m.title}</b></span><Badge tone="warn">{m.pending} to mark</Badge>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function AdminDashboard() {
  const { user } = useSession();
  const stats = useGet<AdminStats>('/admin/stats');
  const s = stats.data;
  return (
    <>
      <div className="hello"><div><h1>{greeting()}, {user!.displayName.split(' ')[0]}.</h1><p>Institution overview</p></div></div>
      {stats.loading ? <Loading /> : stats.error ? <ErrorNote onRetry={stats.reload}>{stats.error}</ErrorNote> : s && (
        <>
          {s.pendingApprovals > 0 && <div className="banner"><div><b>{s.pendingApprovals} account{s.pendingApprovals === 1 ? '' : 's'} waiting for approval</b><p>New lecturers need your approval before they can sign in.</p></div><Link className="btn primary" to="/app/admin/approvals">Review</Link></div>}
          {s.classesWithoutLecturer > 0 && <div className="banner"><div><b>{s.classesWithoutLecturer} class{s.classesWithoutLecturer === 1 ? ' has' : 'es have'} no lecturer this semester</b><p>Assign a lecturer so students can be taught and graded.</p></div><Link className="btn" to="/app/admin/classes">Assign</Link></div>}
          <div className="admin-grid">
            <Stat label="Students" value={s.students} icon={<CapIcon />} />
            <Stat label="Lecturers" value={s.lecturers} icon={<UsersIcon />} />
            <Stat label="Courses" value={s.courses} hint={`${s.units} units`} icon={<BookIcon />} />
            <Stat label="Classes this semester" value={s.classesThisTerm} hint={`${s.registrationsThisTerm} registrations`} icon={<LayersIcon />} />
            <Stat label="Published coursework" value={s.publishedAssessments} icon={<ClipboardIcon />} />
            <Stat label="Submissions" value={s.submissions} icon={<AwardIcon />} />
            <Stat label="Messages (24 h)" value={s.messagesToday} icon={<ChatIcon />} />
            <Stat label="Suspended accounts" value={s.suspended} icon={<UserCheckIcon />} />
          </div>
          <div className="section-title"><h2>Jump to</h2></div>
          <div className="grid cols-3">
            {[['/app/admin/users', 'Manage users', 'Create, approve, suspend and change roles', <UsersIcon key="u" />], ['/app/admin/courses', 'Courses and units', 'Years, semesters and credit hours', <BookIcon key="b" />], ['/app/admin/classes', 'Classes and lecturers', 'Schedule units and assign lecturers', <LayersIcon key="l" />], ['/app/admin/reports', 'Reports and exports', 'Student and lecturer lists', <ClipboardIcon key="c" />], ['/app/admin/audit', 'Activity log', 'Every administrative change', <ActivityIcon key="a" />], ['/app/admin/terms', 'Semesters', 'Open registration and evaluations', <TimerIcon key="t" />]].map(([to, t, d, i]) => (
              <Link key={String(to)} to={String(to)} className="class-card"><span className="stat-icon">{i}</span><h3>{t as string}</h3><p className="muted">{d as string}</p></Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}

export default function Home() {
  const { user } = useSession();
  if (!user) return null;
  return user.role === 'admin' ? <AdminDashboard /> : user.role === 'lecturer' ? <LecturerDashboard /> : <StudentDashboard />;
}

