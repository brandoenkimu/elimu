-- 002: academic structure, roles and account status, connections and direct
-- messages, files, coursework, grading, attendance, evaluations, audit trail.
-- Idempotent: safe to run more than once, and safe on top of 001.

-- ---------------------------------------------------------------- academic structure

CREATE TABLE IF NOT EXISTS courses (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  code                varchar(16)  NOT NULL,
  name                varchar(120) NOT NULL,
  department          varchar(100) NOT NULL DEFAULT '',
  duration_years      smallint     NOT NULL DEFAULT 4,
  semesters_per_year  smallint     NOT NULL DEFAULT 2,
  active              boolean      NOT NULL DEFAULT true,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT courses_duration_valid  CHECK (duration_years BETWEEN 1 AND 7),
  CONSTRAINT courses_semesters_valid CHECK (semesters_per_year BETWEEN 1 AND 3)
);
CREATE UNIQUE INDEX IF NOT EXISTS courses_code_key ON courses (upper(code));

CREATE TABLE IF NOT EXISTS units (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id      uuid         NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  code           varchar(16)  NOT NULL,
  name           varchar(140) NOT NULL,
  year_of_study  smallint     NOT NULL,
  semester       smallint     NOT NULL,
  credit_hours   smallint     NOT NULL DEFAULT 3,
  description    varchar(600) NOT NULL DEFAULT '',
  active         boolean      NOT NULL DEFAULT true,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT units_year_valid     CHECK (year_of_study BETWEEN 1 AND 7),
  CONSTRAINT units_semester_valid CHECK (semester BETWEEN 1 AND 3),
  CONSTRAINT units_credit_valid   CHECK (credit_hours BETWEEN 1 AND 30)
);
CREATE UNIQUE INDEX IF NOT EXISTS units_code_key   ON units (upper(code));
CREATE INDEX        IF NOT EXISTS units_course_idx ON units (course_id, year_of_study, semester);

CREATE TABLE IF NOT EXISTS terms (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name               varchar(60) NOT NULL,
  academic_year      varchar(9)  NOT NULL,
  semester           smallint    NOT NULL,
  starts_on          date,
  ends_on            date,
  registration_open  boolean     NOT NULL DEFAULT false,
  evaluation_open    boolean     NOT NULL DEFAULT false,
  is_current         boolean     NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT terms_semester_valid CHECK (semester BETWEEN 1 AND 3)
);
CREATE UNIQUE INDEX IF NOT EXISTS terms_year_semester_key ON terms (academic_year, semester);
CREATE UNIQUE INDEX IF NOT EXISTS terms_one_current_key   ON terms (is_current) WHERE is_current;

-- An offering is "this unit, taught this term, by this lecturer".
CREATE TABLE IF NOT EXISTS offerings (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id      uuid        NOT NULL REFERENCES units (id) ON DELETE CASCADE,
  term_id      uuid        NOT NULL REFERENCES terms (id) ON DELETE CASCADE,
  lecturer_id  uuid        REFERENCES users (id) ON DELETE SET NULL,
  capacity     integer,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offerings_capacity_valid CHECK (capacity IS NULL OR capacity > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS offerings_unit_term_key ON offerings (unit_id, term_id);
CREATE INDEX        IF NOT EXISTS offerings_lecturer_idx  ON offerings (lecturer_id);
CREATE INDEX        IF NOT EXISTS offerings_term_idx      ON offerings (term_id);

CREATE TABLE IF NOT EXISTS enrolments (
  offering_id  uuid        NOT NULL REFERENCES offerings (id) ON DELETE CASCADE,
  student_id   uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status       varchar(10) NOT NULL DEFAULT 'enrolled',
  enrolled_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (offering_id, student_id),
  CONSTRAINT enrolments_status_valid CHECK (status IN ('enrolled', 'dropped'))
);
CREATE INDEX IF NOT EXISTS enrolments_student_idx ON enrolments (student_id, status);

-- ---------------------------------------------------------------- users

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_valid;
ALTER TABLE users ADD  CONSTRAINT users_role_valid CHECK (role IN ('student', 'lecturer', 'admin'));

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS status               varchar(10)  NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS reg_number           varchar(32),
  ADD COLUMN IF NOT EXISTS staff_number         varchar(32),
  ADD COLUMN IF NOT EXISTS course_id            uuid,
  ADD COLUMN IF NOT EXISTS year_of_study        smallint,
  ADD COLUMN IF NOT EXISTS department           varchar(100),
  ADD COLUMN IF NOT EXISTS title                varchar(24),
  ADD COLUMN IF NOT EXISTS phone                varchar(24),
  ADD COLUMN IF NOT EXISTS bio                  varchar(500) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS office               varchar(100),
  ADD COLUMN IF NOT EXISTS office_hours         varchar(200),
  ADD COLUMN IF NOT EXISTS preferences          jsonb        NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS must_change_password boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_login_at        timestamptz;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_valid;
ALTER TABLE users ADD  CONSTRAINT users_status_valid CHECK (status IN ('active', 'pending', 'suspended'));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_course_fk') THEN
    ALTER TABLE users ADD CONSTRAINT users_course_fk
      FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_reg_number_key   ON users (upper(reg_number))   WHERE reg_number   IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_staff_number_key ON users (upper(staff_number)) WHERE staff_number IS NOT NULL;
CREATE INDEX        IF NOT EXISTS users_role_status_idx  ON users (role, status);

-- Remember-me: a non-persistent login gets a browser-session cookie and a 24 h server-side lifetime.
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS persistent boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS password_resets (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  char(64)    NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS password_resets_hash_key ON password_resets (token_hash);
CREATE INDEX        IF NOT EXISTS password_resets_user_idx ON password_resets (user_id);

-- ---------------------------------------------------------------- conversations: groups, classes, direct

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS kind        varchar(8) NOT NULL DEFAULT 'group',
  ADD COLUMN IF NOT EXISTS offering_id uuid,
  ADD COLUMN IF NOT EXISTS direct_key  varchar(73);

ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_kind_valid;
ALTER TABLE conversations ADD  CONSTRAINT conversations_kind_valid CHECK (kind IN ('group', 'class', 'direct'));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_offering_fk') THEN
    ALTER TABLE conversations ADD CONSTRAINT conversations_offering_fk
      FOREIGN KEY (offering_id) REFERENCES offerings (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_direct_key ON conversations (direct_key) WHERE direct_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS conversations_class_key  ON conversations (offering_id) WHERE kind = 'class';

-- ---------------------------------------------------------------- connections (friend-style requests)

CREATE TABLE IF NOT EXISTS connections (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id  uuid         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  addressee_id  uuid         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status        varchar(10)  NOT NULL DEFAULT 'pending',
  note          varchar(200) NOT NULL DEFAULT '',
  created_at    timestamptz  NOT NULL DEFAULT now(),
  responded_at  timestamptz,
  CONSTRAINT connections_status_valid CHECK (status IN ('pending', 'accepted', 'declined', 'blocked')),
  CONSTRAINT connections_not_self     CHECK (requester_id <> addressee_id)
);
-- One row per pair, whichever way round the request went.
CREATE UNIQUE INDEX IF NOT EXISTS connections_pair_key
  ON connections ((LEAST(requester_id, addressee_id)), (GREATEST(requester_id, addressee_id)));
CREATE INDEX IF NOT EXISTS connections_addressee_idx ON connections (addressee_id, status);
CREATE INDEX IF NOT EXISTS connections_requester_idx ON connections (requester_id, status);

-- ---------------------------------------------------------------- notifications

CREATE TABLE IF NOT EXISTS notifications (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type        varchar(32)  NOT NULL,
  title       varchar(140) NOT NULL,
  body        varchar(300) NOT NULL DEFAULT '',
  data        jsonb        NOT NULL DEFAULT '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

-- ---------------------------------------------------------------- files (stored in PostgreSQL so all nodes see them)

CREATE TABLE IF NOT EXISTS files (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name        varchar(200) NOT NULL,
  mime        varchar(100) NOT NULL,
  size        integer      NOT NULL,
  sha256      char(64)     NOT NULL,
  data        bytea        NOT NULL,
  attached    boolean      NOT NULL DEFAULT false,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT files_size_valid CHECK (size BETWEEN 1 AND 10485760)
);
CREATE INDEX IF NOT EXISTS files_owner_idx   ON files (owner_id);
CREATE INDEX IF NOT EXISTS files_cleanup_idx ON files (created_at) WHERE NOT attached;

CREATE TABLE IF NOT EXISTS materials (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id  uuid         NOT NULL REFERENCES offerings (id) ON DELETE CASCADE,
  title        varchar(140) NOT NULL,
  description  varchar(500) NOT NULL DEFAULT '',
  file_id      uuid         NOT NULL REFERENCES files (id) ON DELETE CASCADE,
  created_by   uuid         NOT NULL REFERENCES users (id),
  created_at   timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS materials_offering_idx ON materials (offering_id, created_at DESC);

CREATE TABLE IF NOT EXISTS announcements (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id  uuid         NOT NULL REFERENCES offerings (id) ON DELETE CASCADE,
  title        varchar(140) NOT NULL,
  body         varchar(2000) NOT NULL,
  created_by   uuid         NOT NULL REFERENCES users (id),
  created_at   timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS announcements_offering_idx ON announcements (offering_id, created_at DESC);

-- ---------------------------------------------------------------- coursework

CREATE TABLE IF NOT EXISTS assessments (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id       uuid          NOT NULL REFERENCES offerings (id) ON DELETE CASCADE,
  created_by        uuid          NOT NULL REFERENCES users (id),
  kind              varchar(10)   NOT NULL,
  title             varchar(140)  NOT NULL,
  instructions      varchar(5000) NOT NULL DEFAULT '',
  status            varchar(10)   NOT NULL DEFAULT 'draft',
  opens_at          timestamptz,
  due_at            timestamptz,
  duration_min      smallint,
  max_score         numeric(7,2)  NOT NULL DEFAULT 100,
  weight            numeric(5,2)  NOT NULL DEFAULT 0,
  allow_file        boolean       NOT NULL DEFAULT true,
  allow_text        boolean       NOT NULL DEFAULT true,
  brief_file_id     uuid          REFERENCES files (id) ON DELETE SET NULL,
  auto_mark         boolean       NOT NULL DEFAULT true,
  results_released  boolean       NOT NULL DEFAULT false,
  show_answers      boolean       NOT NULL DEFAULT false,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT assessments_kind_valid     CHECK (kind IN ('assignment', 'exam')),
  CONSTRAINT assessments_status_valid   CHECK (status IN ('draft', 'published', 'closed')),
  CONSTRAINT assessments_max_valid      CHECK (max_score > 0 AND max_score <= 1000),
  CONSTRAINT assessments_weight_valid   CHECK (weight >= 0 AND weight <= 100),
  CONSTRAINT assessments_duration_valid CHECK (duration_min IS NULL OR duration_min BETWEEN 1 AND 600)
);
CREATE INDEX IF NOT EXISTS assessments_offering_idx ON assessments (offering_id, created_at DESC);

CREATE TABLE IF NOT EXISTS questions (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id  uuid          NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
  position       smallint      NOT NULL,
  kind           varchar(4)    NOT NULL,
  prompt         varchar(2000) NOT NULL,
  points         numeric(6,2)  NOT NULL DEFAULT 1,
  options        jsonb,
  correct_key    char(1),
  model_answer   varchar(2000) NOT NULL DEFAULT '',
  CONSTRAINT questions_kind_valid   CHECK (kind IN ('mcq', 'text')),
  CONSTRAINT questions_points_valid CHECK (points >= 0 AND points <= 1000)
);
CREATE INDEX IF NOT EXISTS questions_assessment_idx ON questions (assessment_id, position);

CREATE TABLE IF NOT EXISTS submissions (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id  uuid          NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
  student_id     uuid          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status         varchar(12)   NOT NULL DEFAULT 'in_progress',
  started_at     timestamptz   NOT NULL DEFAULT now(),
  submitted_at   timestamptz,
  text_answer    varchar(20000) NOT NULL DEFAULT '',
  is_late        boolean       NOT NULL DEFAULT false,
  score          numeric(7,2),
  mcq_score      numeric(7,2),
  feedback       varchar(4000) NOT NULL DEFAULT '',
  graded_by      uuid          REFERENCES users (id) ON DELETE SET NULL,
  graded_at      timestamptz,
  CONSTRAINT submissions_status_valid CHECK (status IN ('in_progress', 'submitted', 'graded'))
);
CREATE UNIQUE INDEX IF NOT EXISTS submissions_unique_key  ON submissions (assessment_id, student_id);
CREATE INDEX        IF NOT EXISTS submissions_student_idx ON submissions (student_id);

CREATE TABLE IF NOT EXISTS submission_files (
  submission_id  uuid NOT NULL REFERENCES submissions (id) ON DELETE CASCADE,
  file_id        uuid NOT NULL REFERENCES files (id) ON DELETE CASCADE,
  PRIMARY KEY (submission_id, file_id)
);

CREATE TABLE IF NOT EXISTS answers (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id  uuid          NOT NULL REFERENCES submissions (id) ON DELETE CASCADE,
  question_id    uuid          NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  choice_key     char(1),
  text_answer    varchar(10000) NOT NULL DEFAULT '',
  score          numeric(6,2),
  feedback       varchar(2000) NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS answers_unique_key ON answers (submission_id, question_id);

-- ---------------------------------------------------------------- attendance

CREATE TABLE IF NOT EXISTS attendance_sessions (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id  uuid         NOT NULL REFERENCES offerings (id) ON DELETE CASCADE,
  title        varchar(100) NOT NULL,
  code         varchar(8)   NOT NULL,
  opens_at     timestamptz  NOT NULL,
  closes_at    timestamptz  NOT NULL,
  created_by   uuid         NOT NULL REFERENCES users (id),
  created_at   timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT attendance_window_valid CHECK (closes_at > opens_at)
);
CREATE INDEX IF NOT EXISTS attendance_sessions_offering_idx ON attendance_sessions (offering_id, opens_at DESC);

CREATE TABLE IF NOT EXISTS attendance_records (
  session_id     uuid        NOT NULL REFERENCES attendance_sessions (id) ON DELETE CASCADE,
  student_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  checked_in_at  timestamptz NOT NULL DEFAULT now(),
  method         varchar(8)  NOT NULL DEFAULT 'code',
  PRIMARY KEY (session_id, student_id),
  CONSTRAINT attendance_method_valid CHECK (method IN ('code', 'manual'))
);

-- ---------------------------------------------------------------- unit evaluations (anonymous to lecturers)

CREATE TABLE IF NOT EXISTS evaluations (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id  uuid          NOT NULL REFERENCES offerings (id) ON DELETE CASCADE,
  student_id   uuid          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  ratings      jsonb         NOT NULL,
  comment      varchar(1000) NOT NULL DEFAULT '',
  created_at   timestamptz   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS evaluations_unique_key ON evaluations (offering_id, student_id);

-- ---------------------------------------------------------------- audit trail

CREATE TABLE IF NOT EXISTS audit_log (
  id           bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id     uuid         REFERENCES users (id) ON DELETE SET NULL,
  actor_name   varchar(80)  NOT NULL DEFAULT '',
  action       varchar(60)  NOT NULL,
  target_type  varchar(30)  NOT NULL DEFAULT '',
  target_id    varchar(64)  NOT NULL DEFAULT '',
  detail       jsonb        NOT NULL DEFAULT '{}'::jsonb,
  ip           varchar(64)  NOT NULL DEFAULT '',
  created_at   timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log (created_at DESC);
