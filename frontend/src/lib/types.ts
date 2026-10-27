import type { Prefs } from './theme';

export type Role = 'student' | 'lecturer' | 'admin';
export type AccountStatus = 'active' | 'pending' | 'suspended';

/** The signed-in person, as the server describes them. */
export interface User {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: AccountStatus;
  mustChangePassword: boolean;
  regNumber: string | null;
  staffNumber: string | null;
  courseId: string | null;
  courseName: string | null;
  courseCode: string | null;
  yearOfStudy: number | null;
  department: string | null;
  title: string | null;
  phone: string | null;
  bio: string;
  office: string | null;
  officeHours: string | null;
  preferences: Partial<Prefs>;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuthPayload {
  accessToken: string;
  expiresInSec: number;
  user: User;
}

export type ConversationKind = 'group' | 'class' | 'direct';

export interface ConversationSummary {
  id: string;
  kind: ConversationKind;
  offeringId: string | null;
  name: string;
  description: string;
  myRole: 'owner' | 'member';
  inviteCode: string | null;
  memberCount: number;
  createdAt: string;
  peer: { id: string; displayName: string; role: string; title: string | null } | null;
  lastMessage: { id: string; seq: number; body: string; createdAt: string; senderName: string } | null;
}

export interface Member {
  id: string;
  displayName: string;
  role: Role;
  title: string | null;
  memberRole: 'owner' | 'member';
  joinedAt: string;
}

export interface WireMessage {
  id: string;
  seq: number;
  conversationId: string;
  clientMessageId: string;
  body: string;
  createdAt: string;
  originNode: string;
  sender: { id: string; displayName: string; role: string };
  replyTo: ReplyPreview | null;
  deleted: boolean;
  reactions: Reaction[];
}

export interface Reaction { emoji: string; userIds: string[] }

/** A short preview of the message being replied to. */
export interface ReplyPreview { id: string; senderId: string; senderName: string; body: string; deleted: boolean }

export type MessageStatus = 'sent' | 'sending' | 'failed';

export interface ChatMessage {
  id: string;
  seq: number | null;
  conversationId: string;
  clientMessageId: string;
  body: string;
  createdAt: string;
  originNode: string | null;
  senderId: string;
  senderName: string;
  senderRole: string;
  status: MessageStatus;
  attempts: number;
  error?: string;
  replyTo: ReplyPreview | null;
  deleted: boolean;
  reactions: Reaction[];
}

export type SendAck =
  | { ok: true; message: WireMessage; duplicate: boolean; delivery: 'cluster' | 'local'; node: string }
  | { ok: false; code: string; message: string; retryAfterSec?: number };

export type NodeStatus = 'healthy' | 'recovering' | 'unavailable' | 'unknown';

export interface NodeInfo {
  id: string;
  url: string;
  status: NodeStatus;
  latencyMs: number | null;
  connections: number | null;
  reason: string | null;
  lastChangeAt: string | null;
}

export type LinkState = 'connecting' | 'online' | 'reconnecting' | 'offline';

// ---------------------------------------------------------------- people

export type Relation = 'none' | 'friends' | 'incoming' | 'outgoing' | 'blocked_by_me' | 'blocked';

export interface PersonCard {
  id: string;
  displayName: string;
  role: 'student' | 'lecturer';
  title: string | null;
  department: string | null;
  courseName: string | null;
  yearOfStudy: number | null;
  relation?: Relation;
  connectionId?: string | null;
}

export interface ConnectionItem {
  id: string;
  status: 'pending' | 'accepted';
  direction: 'incoming' | 'outgoing';
  note: string;
  createdAt: string;
  user: PersonCard;
}

export interface PublicProfile extends PersonCard {
  bio: string;
  email: string | null;
  office: string | null;
  officeHours: string | null;
  memberSince: string;
  sharedClasses: { offeringId: string; unitCode: string; unitName: string }[];
  relation: Relation;
  connectionId: string | null;
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: { link?: string } & Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------- academics

export interface Course {
  id: string;
  code: string;
  name: string;
  department: string;
  durationYears: number;
  semestersPerYear: number;
  active?: boolean;
  unitCount?: number;
  studentCount?: number;
}

export interface Unit {
  id: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  code: string;
  name: string;
  yearOfStudy: number;
  semester: number;
  creditHours: number;
  description: string;
  active: boolean;
}

export interface Term {
  id: string;
  name: string;
  academicYear: string;
  semester: number;
  startsOn: string | null;
  endsOn: string | null;
  registrationOpen: boolean;
  evaluationOpen: boolean;
  isCurrent: boolean;
}

export interface ClassInfo {
  id: string;
  capacity: number | null;
  unitCode: string;
  unitName: string;
  yearOfStudy: number;
  semester: number;
  creditHours: number;
  description: string;
  courseId: string;
  courseName: string;
  termId: string;
  termName: string;
  isCurrentTerm: boolean;
  lecturerId: string | null;
  lecturerName: string | null;
  lecturerTitle: string | null;
  enrolled: number;
  classChatId: string | null;
  registered?: boolean;
}

export interface AdminOffering {
  id: string;
  capacity: number | null;
  unitId: string;
  termId: string;
  lecturerId: string | null;
  unitCode: string;
  unitName: string;
  yearOfStudy: number;
  semester: number;
  courseId: string;
  courseName: string;
  termName: string;
  lecturerName: string | null;
  staffNumber: string | null;
  enrolled: number;
}

export interface RegistrationOverview {
  term: { id: string; name: string; semester: number } | null;
  registrationOpen: boolean;
  hasCourse: boolean;
  yearOfStudy: number | null;
  offerings: ClassInfo[];
}

export interface RosterStudent {
  id: string;
  displayName: string;
  regNumber: string | null;
  email: string;
  yearOfStudy: number | null;
  courseName: string | null;
  enrolledAt: string;
}

// ---------------------------------------------------------------- coursework

export type AssessmentKind = 'assignment' | 'exam';
export type AssessmentStatus = 'draft' | 'published' | 'closed';

export interface AssessmentListItem {
  id: string;
  kind: AssessmentKind;
  title: string;
  status: AssessmentStatus;
  opensAt: string | null;
  dueAt: string | null;
  durationMin: number | null;
  maxScore: number;
  weight: number;
  questionCount: number;
  resultsReleased?: boolean;
  autoMark?: boolean;
  submitted?: number;
  graded?: number;
  mine?: { status: string; isLate: boolean | null; score: number | null } | null;
}

export interface Question {
  id: string;
  kind: 'mcq' | 'text';
  prompt: string;
  points: number;
  options: string[] | null;
  correctKey?: string | null;
  modelAnswer?: string;
}

export interface FileMeta { id: string; name: string; size: number; mime: string }

export interface MySubmission {
  id: string;
  status: 'in_progress' | 'submitted' | 'graded';
  startedAt: string;
  submittedAt: string | null;
  isLate: boolean;
  deadline: string | null;
  textAnswer: string;
  answers: Record<string, { choiceKey: string | null; textAnswer: string; score?: number | null; feedback?: string }>;
  files: FileMeta[];
  result: { score: number | null; maxScore: number; percent: number | null; letter: string | null; feedback: string } | null;
}

export interface AssessmentView {
  id: string;
  offeringId: string;
  kind: AssessmentKind;
  title: string;
  instructions: string;
  status: AssessmentStatus;
  opensAt: string | null;
  dueAt: string | null;
  durationMin: number | null;
  maxScore: number;
  weight: number;
  allowFile: boolean;
  allowText: boolean;
  brief: FileMeta | null;
  questionCount: number;
  totalPoints: number;
  teacher: boolean;
  autoMark?: boolean;
  showAnswers?: boolean;
  resultsReleased: boolean;
  questions: Question[];
  submission?: MySubmission | null;
}

export interface SubmissionRowT {
  studentId: string;
  studentName: string;
  regNumber: string | null;
  submissionId: string | null;
  status: 'not_started' | 'in_progress' | 'submitted' | 'graded';
  submittedAt: string | null;
  isLate: boolean | null;
  score: number | null;
  mcqScore: number | null;
}

export interface SubmissionDetail {
  id: string;
  assessmentId: string;
  assessmentTitle: string;
  maxScore: number;
  student: { id: string; name: string; regNumber: string | null };
  status: string;
  submittedAt: string | null;
  isLate: boolean;
  textAnswer: string;
  score: number | null;
  mcqScore: number | null;
  feedback: string;
  questions: (Question & { position: number })[];
  answers: Record<string, { choiceKey: string | null; textAnswer: string; score: number | null; feedback: string }>;
  files: FileMeta[];
}

export interface Weighted { earned: number; weightTotal: number; percent: number | null; letter: string | null }

export interface Gradebook {
  columns: { id: string; title: string; kind: string; maxScore: number; weight: number; released: boolean }[];
  students: {
    id: string; name: string; regNumber: string | null;
    scores: { assessmentId: string; score: number | null; status: string }[];
    total: Weighted; attendancePercent: number | null;
  }[];
}

export interface MyGrades {
  items: { assessmentId: string; title: string; kind: string; maxScore: number; weight: number; status: string; score: number | null; resultsReleased: boolean }[];
  total: Weighted;
  attendancePercent: number | null;
}

export interface AttendanceSessionT {
  id: string; title: string; opensAt: string; closesAt: string; live: boolean;
  code?: string | null; present?: number | boolean; total?: number; checkedInAt?: string | null;
}

export interface EvaluationStatus { open: boolean; submitted: boolean; questions: { key: string; label: string }[] }
export type EvaluationResults =
  | { insufficient: true; responses: number; enrolled: number; minimum: number }
  | { insufficient: false; responses: number; enrolled: number; minimum: number;
      summary: { key: string; label: string; average: number; distribution: number[] }[]; comments: string[] };

// ---------------------------------------------------------------- admin

export interface AdminUser {
  id: string; email: string; displayName: string; role: Role; status: AccountStatus;
  regNumber: string | null; staffNumber: string | null; courseId: string | null; courseName: string | null;
  yearOfStudy: number | null; department: string | null; title: string | null; createdAt: string; lastLoginAt: string | null;
}

export interface AdminStats {
  students: number; lecturers: number; admins: number; suspended: number; pendingApprovals: number;
  courses: number; units: number; classesThisTerm: number; registrationsThisTerm: number; classesWithoutLecturer: number;
  publishedAssessments: number; submissions: number; messagesToday: number;
}

export interface AuditEntry {
  id: number; actorName: string; action: string; targetType: string; targetId: string;
  detail: Record<string, unknown>; ip: string; createdAt: string;
}
