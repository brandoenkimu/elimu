import 'dotenv/config';
import { Client } from 'pg';
import { hashPassword } from '../src/common/password';

/**
 * Fills an EMPTY development database with sample data so every screen has something to show:
 * courses, units, a current semester with registration open, lecturers, students, classes,
 * a multiple-choice exam and an assignment. It refuses to run in production.
 *
 *   yarn seed:demo
 *
 * Every demo account shares one password, printed at the end. Never run this on a real system.
 */
const DEMO_PASSWORD = 'ElimuDemo2026';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed demo data when NODE_ENV=production.');
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }
  const db = new Client({ connectionString: url });
  await db.connect();
  const hash = await hashPassword(DEMO_PASSWORD);

  const one = async <T = { id: string }>(sql: string, params: unknown[] = []): Promise<T> => (await db.query(sql, params)).rows[0] as T;

  try {
    await db.query('BEGIN');

    // ---- programmes and units
    const programmes = [
      { code: 'BSC-CS', name: 'BSc Computer Science', dept: 'Computing', years: 4, sems: 2 },
      { code: 'BCOM', name: 'Bachelor of Commerce', dept: 'Business', years: 4, sems: 2 },
      { code: 'BSC-NUR', name: 'BSc Nursing', dept: 'Health Sciences', years: 4, sems: 3 },
    ];
    const courseIds: Record<string, string> = {};
    for (const p of programmes) {
      const r = await one(
        `INSERT INTO courses (code, name, department, duration_years, semesters_per_year) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (upper(code)) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [p.code, p.name, p.dept, p.years, p.sems],
      );
      courseIds[p.code] = r.id;
    }
    const units: [string, string, string, number, number][] = [
      ['BSC-CS', 'CSC101', 'Introduction to Programming', 1, 1],
      ['BSC-CS', 'CSC102', 'Discrete Mathematics', 1, 1],
      ['BSC-CS', 'CSC103', 'Computer Systems', 1, 1],
      ['BSC-CS', 'CSC111', 'Data Structures', 1, 2],
      ['BSC-CS', 'CSC201', 'Databases', 2, 1],
      ['BSC-CS', 'CSC202', 'Operating Systems', 2, 1],
      ['BCOM', 'BCM101', 'Principles of Accounting', 1, 1],
      ['BCOM', 'BCM102', 'Microeconomics', 1, 1],
      ['BCOM', 'BCM103', 'Business Communication', 1, 1],
      ['BSC-NUR', 'NUR101', 'Anatomy and Physiology I', 1, 1],
      ['BSC-NUR', 'NUR102', 'Fundamentals of Nursing', 1, 1],
    ];
    const unitIds: Record<string, string> = {};
    for (const [course, code, name, year, sem] of units) {
      const r = await one(
        `INSERT INTO units (course_id, code, name, year_of_study, semester) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (upper(code)) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [courseIds[course], code, name, year, sem],
      );
      unitIds[code] = r.id;
    }

    // ---- term
    const term = await one(
      `INSERT INTO terms (name, academic_year, semester, registration_open, evaluation_open, is_current)
       VALUES ('2026/2027 Semester 1', '2026/2027', 1, true, true, true)
       ON CONFLICT (academic_year, semester) DO UPDATE SET is_current = true, registration_open = true RETURNING id`,
    );

    // ---- people
    const person = async (email: string, name: string, role: string, extra: Record<string, unknown> = {}) => {
      const r = await one(
        `INSERT INTO users (email, display_name, password_hash, role, status, reg_number, staff_number, course_id, year_of_study, department, title)
         VALUES ($1,$2,$3,$4,'active',$5,$6,$7,$8,$9,$10)
         ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`,
        [email, name, hash, role, extra.reg ?? null, extra.staff ?? null, extra.course ?? null, extra.year ?? null, extra.dept ?? null, extra.title ?? null],
      );
      return r.id;
    };
    const lecturers = {
      kamau: await person('j.kamau@demo.elimu.test', 'James Kamau', 'lecturer', { staff: 'STF/001', dept: 'Computing', title: 'Dr.' }),
      achieng: await person('m.achieng@demo.elimu.test', 'Mercy Achieng', 'lecturer', { staff: 'STF/002', dept: 'Business', title: 'Prof.' }),
      otieno: await person('p.otieno@demo.elimu.test', 'Peter Otieno', 'lecturer', { staff: 'STF/003', dept: 'Health Sciences', title: 'Mr.' }),
    };
    const first = ['Amina', 'Brian', 'Cynthia', 'Daniel', 'Esther', 'Faith', 'Gideon', 'Hassan', 'Irene', 'Joel', 'Kevin', 'Lydia'];
    const last = ['Wanjiru', 'Mwangi', 'Njeri', 'Omondi', 'Chebet', 'Akinyi', 'Kiptoo', 'Ali', 'Wafula', 'Mutua', 'Otieno', 'Kamau'];
    const studentIds: { id: string; course: string }[] = [];
    for (let i = 0; i < first.length; i++) {
      const course = i < 6 ? 'BSC-CS' : i < 9 ? 'BCOM' : 'BSC-NUR';
      const id = await person(`${first[i].toLowerCase()}.${last[i].toLowerCase()}@demo.elimu.test`, `${first[i]} ${last[i]}`, 'student', {
        reg: `${course.split('-').pop()}/${String(1000 + i)}/26`, course: courseIds[course], year: 1,
      });
      studentIds.push({ id, course });
    }

    // ---- classes
    const offeringIds: Record<string, string> = {};
    const lecturerFor = (code: string) => (code.startsWith('CSC') ? lecturers.kamau : code.startsWith('BCM') ? lecturers.achieng : lecturers.otieno);
    for (const [, code] of units) {
      const r = await one(
        `INSERT INTO offerings (unit_id, term_id, lecturer_id) VALUES ($1,$2,$3)
         ON CONFLICT (unit_id, term_id) DO UPDATE SET lecturer_id = EXCLUDED.lecturer_id RETURNING id`,
        [unitIds[code], term.id, lecturerFor(code)],
      );
      offeringIds[code] = r.id;
    }
    for (const s of studentIds) {
      for (const [course, code, , year, sem] of units) {
        if (course === s.course && year === 1 && sem === 1) {
          await db.query(`INSERT INTO enrolments (offering_id, student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [offeringIds[code], s.id]);
        }
      }
    }

    // ---- sample coursework in CSC101
    const exists = await db.query(`SELECT 1 FROM assessments WHERE offering_id = $1`, [offeringIds.CSC101]);
    if (!exists.rowCount) {
      const exam = await one(
        `INSERT INTO assessments (offering_id, created_by, kind, title, instructions, status, duration_min, max_score, weight, auto_mark, allow_file, allow_text, opens_at)
         VALUES ($1,$2,'exam','CAT 1: Programming basics','Answer all questions. You have 30 minutes once you start.','published',30,30,20,true,false,false, now() - interval '1 day') RETURNING id`,
        [offeringIds.CSC101, lecturers.kamau],
      );
      const mcq: [string, string[], string][] = [
        ['Which keyword declares a constant in JavaScript?', ['var', 'let', 'const', 'static'], 'C'],
        ['What does CPU stand for?', ['Central Processing Unit', 'Computer Personal Unit', 'Core Program Utility', 'Central Program Unit'], 'A'],
        ['Which data structure works on a first-in, first-out basis?', ['Stack', 'Queue', 'Tree', 'Graph'], 'B'],
      ];
      for (let i = 0; i < mcq.length; i++) {
        await db.query(
          `INSERT INTO questions (assessment_id, position, kind, prompt, points, options, correct_key) VALUES ($1,$2,'mcq',$3,10,$4::jsonb,$5)`,
          [exam.id, i + 1, mcq[i][0], JSON.stringify(mcq[i][1]), mcq[i][2]],
        );
      }
      await db.query(
        `INSERT INTO assessments (offering_id, created_by, kind, title, instructions, status, due_at, max_score, weight, allow_file, allow_text, opens_at)
         VALUES ($1,$2,'assignment','Assignment 1: Flowcharts','Draw a flowchart for a program that finds the largest of three numbers. Upload a PDF or type your explanation.','published', now() + interval '7 days',20,10,true,true, now() - interval '1 day')`,
        [offeringIds.CSC101, lecturers.kamau],
      );
    }

    await db.query('COMMIT');
    console.log(`\nDemo data ready.\n\nAll demo accounts use the password: ${DEMO_PASSWORD}\n  Lecturer: j.kamau@demo.elimu.test\n  Student:  amina.wanjiru@demo.elimu.test\n\nCreate your administrator with:  yarn seed:admin you@example.com "Your Name"\n`);
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await db.end();
  }
}

main().catch((err: Error) => {
  console.error(`Seeding failed: ${err.message}`);
  process.exit(1);
});
