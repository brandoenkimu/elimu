import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BackIcon, ChatIcon } from '../../../components/icons';
import { Badge, Button, ErrorNote, Loading, PageHeader, Tabs } from '../../../components/ui';
import { errorText, useGet } from '../../../lib/useApi';
import type { ClassInfo } from '../../../lib/types';
import { api } from '../../../lib/singletons';
import { useSession } from '../../../state/session';
import { useToast } from '../../../state/toast';
import AssessmentPage from './AssessmentPage';
import { AttendanceTab } from './AttendanceTab';
import { EvaluationTab } from './EvaluationTab';
import { GradesTab } from './GradesTab';
import { MaterialsTab } from './MaterialsTab';
import { RosterTab } from './RosterTab';
import { StreamTab } from './StreamTab';
import { WorkTab } from './WorkTab';

type TabId = 'stream' | 'materials' | 'work' | 'attendance' | 'grades' | 'people' | 'evaluation';

function ClassHome({ info }: { info: ClassInfo }) {
  const { user } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const staff = user!.role !== 'student';
  const tab = (params.get('tab') as TabId) || 'stream';
  const tabs: { id: TabId; label: string }[] = [
    { id: 'stream', label: 'Announcements' }, { id: 'materials', label: 'Materials' }, { id: 'work', label: 'Coursework' },
    { id: 'attendance', label: 'Attendance' }, { id: 'grades', label: staff ? 'Gradebook' : 'My grades' },
    ...(staff ? [{ id: 'people' as TabId, label: 'Students' }] : []), { id: 'evaluation', label: 'Evaluation' },
  ];
  const openChat = async () => {
    try {
      if (info.classChatId) { nav(`/app/messages/${info.classChatId}`); return; }
      const r = await api.post<{ conversation: { id: string } }>(`/classes/${info.id}/chat`);
      nav(`/app/messages/${r.conversation.id}`);
    } catch (e) { toast.show(errorText(e), 'bad'); }
  };
  return (
    <>
      <PageHeader
        back={<Link to="/app/classes" className="back"><BackIcon /> All classes</Link>}
        title={`${info.unitCode} · ${info.unitName}`}
        sub={<>{info.courseName} · Year {info.yearOfStudy}, Semester {info.semester} · {info.termName}{info.lecturerName ? ` · ${info.lecturerTitle ? info.lecturerTitle + ' ' : ''}${info.lecturerName}` : ''}</>}
        actions={<>{!info.isCurrentTerm && <Badge>Earlier semester</Badge>}{(info.classChatId || staff) && <Button onClick={openChat}><ChatIcon /> Class chat</Button>}</>}
      />
      <Tabs value={tab} tabs={tabs} onChange={(t) => setParams(t === 'stream' ? {} : { tab: t }, { replace: true })} />
      <div className="tab-panel">
        {tab === 'stream' && <StreamTab id={info.id} staff={staff} />}
        {tab === 'materials' && <MaterialsTab id={info.id} staff={staff} />}
        {tab === 'work' && <WorkTab id={info.id} staff={staff} />}
        {tab === 'attendance' && <AttendanceTab id={info.id} staff={staff} />}
        {tab === 'grades' && <GradesTab id={info.id} staff={staff} />}
        {tab === 'people' && staff && <RosterTab info={info} />}
        {tab === 'evaluation' && <EvaluationTab id={info.id} staff={staff} />}
      </div>
    </>
  );
}

export default function ClassPage() {
  const { id } = useParams();
  const res = useGet<{ class: ClassInfo }>(id ? `/classes/${id}` : null);
  if (res.loading) return <Loading />;
  if (res.error || !res.data) return <ErrorNote onRetry={res.reload}>{res.error ?? 'Class not found.'}</ErrorNote>;
  return (
    <Routes>
      <Route index element={<ClassHome info={res.data.class} />} />
      <Route path="work/:assessmentId" element={<AssessmentPage info={res.data.class} />} />
    </Routes>
  );
}
