import { Link } from 'react-router-dom';
import { ArrowRight, AwardIcon, CapIcon, CheckIcon, ChatIcon, ClipboardIcon, ShieldIcon, StarIcon, TimerIcon, UserPlusIcon, UsersIcon, ActivityIcon, LockIcon } from '../../components/icons';
import { Mark } from '../../components/icons';
import { ThemeMenu } from '../../components/ThemeMenu';
import { useSession } from '../../state/session';

export function Brand({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="brand" aria-label="Elimu home">
      <Mark size={34} />
      <span className="brand-name">Elimu</span>
    </Link>
  );
}

const FEATURES = [
  { icon: <ChatIcon />, title: 'Class chats that just exist', body: 'Your lecturer opens a group for the unit and everyone registered is in. Plus study groups you can start yourself.' },
  { icon: <UserPlusIcon />, title: 'Connect, then talk', body: 'Send a request to a coursemate or lecturer, the way you would on any social network. Chat privately once it is accepted.' },
  { icon: <ClipboardIcon />, title: 'Assignments and online exams', body: 'Multiple choice, typed answers or file uploads. Timed exams with a visible clock and automatic marking where you want it.' },
  { icon: <TimerIcon />, title: 'Attendance in ten seconds', body: 'The lecturer shows a short code in class. Students enter it and they are marked present. No paper register.' },
  { icon: <AwardIcon />, title: 'Marks released when ready', body: 'Lecturers decide when results become visible. Students see marks only after they are released, never half-finished.' },
  { icon: <StarIcon />, title: 'Honest unit feedback', body: 'End-of-unit evaluations are confidential, and lecturers only see them once enough students have replied.' },
];

const CHECK = <CheckIcon width={16} height={16} />;

export default function Landing() {
  const { status } = useSession();
  const authed = status === 'authed';
  return (
    <div className="lp">
      <a className="skip" href="#main">Skip to content</a>
      <header className="lp-nav">
        <div className="lp-wrap">
          <Brand />
          <nav className="lp-links" aria-label="Sections">
            <a href="#features">Features</a>
            <a href="#portals">Who it is for</a>
            <a href="#how">How it works</a>
            <a href="#trust">Privacy</a>
          </nav>
          <div className="right">
            <ThemeMenu />
            {authed ? (
              <Link className="btn primary" to="/app">Open Elimu</Link>
            ) : (
              <>
                <Link className="btn ghost" to="/login">Sign in</Link>
                <Link className="btn primary" to="/register">Get started</Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="main">
        <section className="hero">
          <div className="lp-wrap hero-grid">
            <div>
              <span className="eyebrow">Your campus, in one place</span>
              <h1>Learn together, <em>wherever</em> the semester takes you.</h1>
              <p className="lede">
                Elimu brings your classes, conversations, coursework and results into one calm space, so students spend less time chasing
                notices and lecturers spend less time on admin.
              </p>
              <div className="hero-cta">
                <Link className="btn primary btn-lg" to={authed ? '/app' : '/register'}>{authed ? 'Go to your dashboard' : 'Create your account'} <ArrowRight /></Link>
                {!authed && <Link className="btn btn-lg" to="/login">I already have an account</Link>}
              </div>
              <div className="hero-note">
                <span>{CHECK} Free for students</span>
                <span>{CHECK} Works on your phone</span>
                <span>{CHECK} Your marks stay private</span>
              </div>
            </div>

            <div className="preview" aria-hidden="true">
              <div className="pv-window">
                <div className="pv-bar">
                  <span className="avatar square tone-1" style={{ width: 30, height: 30, fontSize: 12 }}>DB</span>
                  <b>CSC201 · Databases</b>
                  <span className="badge-pill bp-accent tag">Class chat</span>
                </div>
                <div className="pv-body">
                  <div className="pv-msg"><span className="avatar tone-0" style={{ width: 30, height: 30, fontSize: 11 }}>JK</span><div><small>Dr. Kamau</small><p>Remember tomorrow’s lab starts at 8. Bring your ER diagrams.</p></div></div>
                  <div className="pv-msg"><span className="avatar tone-5" style={{ width: 30, height: 30, fontSize: 11 }}>AW</span><div><small>Amina</small><p>Will the CAT cover normalisation too?</p></div></div>
                  <div className="pv-msg me"><div><p>Yes, up to 3NF. Notes are in Materials.</p></div></div>
                </div>
              </div>
              <div className="pv-card pv-a"><span className="ic"><TimerIcon /></span><div><b>Check-in is open</b><span className="sub">Enter the code on the screen</span></div></div>
              <div className="pv-card pv-b"><span className="ic"><AwardIcon /></span><div><b>Results released</b><span className="sub">CAT 1 is ready to view</span></div></div>
              <span className="pv-label">Illustration of the app</span>
            </div>
          </div>
        </section>

        <section className="section alt" id="features">
          <div className="lp-wrap">
            <div className="sec-head">
              <span className="eyebrow">Everything for the semester</span>
              <h2>The tools you were juggling, finally in one place.</h2>
              <p>Built around how a real class runs: register your units, join the conversation, hand in work, get your marks.</p>
            </div>
            <div className="features">
              {FEATURES.map((f) => (
                <article className="feat" key={f.title}>
                  <div className="ic">{f.icon}</div>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="portals">
          <div className="lp-wrap">
            <div className="sec-head">
              <span className="eyebrow">Three portals, one account system</span>
              <h2>Made for each person on campus.</h2>
              <p>You sign in once and land in the right place for your role.</p>
            </div>
            <div className="portals">
              <article className="portal">
                <span className="role-tag lecturer" style={{ position: 'relative' }}>Students</span>
                <h3>Everything for your units</h3>
                <ul>
                  <li>{CHECK}<span>Register for your semester’s units in a few taps</span></li>
                  <li>{CHECK}<span>Join class groups and message lecturers and coursemates</span></li>
                  <li>{CHECK}<span>Sit exams, upload assignments, mark your attendance</span></li>
                  <li>{CHECK}<span>See released marks, grades and your attendance record</span></li>
                </ul>
              </article>
              <article className="portal">
                <span className="role-tag lecturer" style={{ position: 'relative' }}>Lecturers</span>
                <h3>Teach, don’t chase</h3>
                <ul>
                  <li>{CHECK}<span>Start a class group and share notes and announcements</span></li>
                  <li>{CHECK}<span>Set exams with auto-marked multiple choice and typed questions</span></li>
                  <li>{CHECK}<span>Print or export the class list for every unit you teach</span></li>
                  <li>{CHECK}<span>Choose when marks are revealed to students</span></li>
                </ul>
              </article>
              <article className="portal">
                <span className="role-tag admin" style={{ position: 'relative' }}>Administrators</span>
                <h3>Run the whole institution</h3>
                <ul>
                  <li>{CHECK}<span>Set up courses, units, years and semesters</span></li>
                  <li>{CHECK}<span>Approve accounts and assign lecturers to classes</span></li>
                  <li>{CHECK}<span>Track student and staff numbers and registrations</span></li>
                  <li>{CHECK}<span>A full activity log of every administrative change</span></li>
                </ul>
              </article>
            </div>
          </div>
        </section>

        <section className="section alt" id="how">
          <div className="lp-wrap">
            <div className="sec-head">
              <span className="eyebrow">Getting started</span>
              <h2>From sign-up to your first class in minutes.</h2>
            </div>
            <div className="steps">
              <div className="step"><h3>Create your account</h3><p>Use your registration or staff number. Students pick their course and year; lecturers are approved by an administrator.</p></div>
              <div className="step"><h3>Register your units</h3><p>When registration is open, choose the units you are taking this semester. You join each class group automatically.</p></div>
              <div className="step"><h3>Learn, submit, check in</h3><p>Chat, take exams, hand in assignments and mark attendance, all from the same place.</p></div>
            </div>
          </div>
        </section>

        <section className="section" id="trust">
          <div className="lp-wrap trust">
            <div className="sec-head" style={{ marginBottom: 0 }}>
              <span className="eyebrow">Privacy and trust</span>
              <h2>Careful with your data, by design.</h2>
              <p>Education records are personal. Elimu is built so the right people see the right things, and nobody else.</p>
            </div>
            <div className="trust-list">
              <div className="trust-item"><span className="ic"><LockIcon /></span><div><b>Secure sign-in</b><p>Passwords are stored with modern one-way hashing, sessions renew safely, and you can sign out of every device.</p></div></div>
              <div className="trust-item"><span className="ic"><ShieldIcon /></span><div><b>Role-based access</b><p>Students, lecturers and administrators each see only what their role allows. Lecturers see only their own classes.</p></div></div>
              <div className="trust-item"><span className="ic"><UsersIcon /></span><div><b>Confidential evaluations</b><p>Feedback on a unit is never tied to a name, and is hidden until enough students have responded.</p></div></div>
              <div className="trust-item"><span className="ic"><ActivityIcon /></span><div><b>Always there when you need it</b><p>Elimu is built to stay available through busy deadlines and exam windows.</p></div></div>
            </div>
          </div>
        </section>

        <section className="section" style={{ paddingTop: 0 }}>
          <div className="lp-wrap">
            <div className="cta-band">
              <h2>Ready to make this semester easier?</h2>
              <p>Join your classmates and lecturers on Elimu today.</p>
              <div className="row" style={{ justifyContent: 'center' }}>
                <Link className="btn btn-lg" to={authed ? '/app' : '/register'}>{authed ? 'Open Elimu' : 'Create your account'}</Link>
                {!authed && <Link className="btn ghost btn-lg" to="/login">Sign in</Link>}
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap">
          <div><Brand /><p style={{ marginTop: 10, maxWidth: '36ch' }}>Learn together. A platform for students, lecturers and administrators.</p></div>
          <nav aria-label="Footer">
            <Link to="/login">Sign in</Link>
            <Link to="/register">Create account</Link>
            <Link to="/forgot">Forgot password</Link>
          </nav>
          <p className="faint"><CapIcon width={15} height={15} style={{ display: 'inline', verticalAlign: '-2px' }} /> © {new Date().getFullYear()} Elimu</p>
        </div>
      </footer>
    </div>
  );
}
