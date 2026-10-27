import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { AuthUser } from '../common/types';
import { DatabaseService } from '../database/database.service';

/** What the dashboard needs in one call, shaped by role. */
@Controller('home')
@UseGuards(AuthGuard)
export class HomeController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async home(@CurrentUser() user: AuthUser) {
    if (user.role === 'student') {
      const [upcoming, live, results] = await Promise.all([
        this.db.query(
          `SELECT a.id, a.title, a.kind, a.due_at AS "dueAt", a.opens_at AS "opensAt", a.offering_id AS "offeringId",
                  un.code AS "unitCode", COALESCE(s.status, 'not_started') AS status
             FROM assessments a
             JOIN offerings o ON o.id = a.offering_id AND EXISTS (SELECT 1 FROM terms t WHERE t.id = o.term_id AND t.is_current)
             JOIN units un ON un.id = o.unit_id
             JOIN enrolments e ON e.offering_id = o.id AND e.student_id = $1 AND e.status = 'enrolled'
             LEFT JOIN submissions s ON s.assessment_id = a.id AND s.student_id = $1
            WHERE a.status = 'published' AND (s.status IS NULL OR s.status = 'in_progress')
              AND (a.due_at IS NULL OR a.due_at > now() - interval '3 days')
            ORDER BY a.due_at NULLS LAST LIMIT 8`,
          [user.id],
        ),
        this.db.query(
          `SELECT s.id, s.title, s.closes_at AS "closesAt", o.id AS "offeringId", un.code AS "unitCode"
             FROM attendance_sessions s
             JOIN offerings o ON o.id = s.offering_id JOIN units un ON un.id = o.unit_id
             JOIN enrolments e ON e.offering_id = o.id AND e.student_id = $1 AND e.status = 'enrolled'
            WHERE s.closes_at > now() AND s.opens_at <= now()
              AND NOT EXISTS (SELECT 1 FROM attendance_records r WHERE r.session_id = s.id AND r.student_id = $1)`,
          [user.id],
        ),
        this.db.query(
          `SELECT a.id, a.title, a.offering_id AS "offeringId", un.code AS "unitCode", s.score, a.max_score AS "maxScore", s.graded_at AS "gradedAt"
             FROM submissions s JOIN assessments a ON a.id = s.assessment_id AND a.results_released
             JOIN offerings o ON o.id = a.offering_id JOIN units un ON un.id = o.unit_id
            WHERE s.student_id = $1 AND s.status = 'graded' ORDER BY s.graded_at DESC NULLS LAST LIMIT 5`,
          [user.id],
        ),
      ]);
      return { upcoming: upcoming.rows, liveCheckins: live.rows, recentResults: results.rows };
    }

    if (user.role === 'lecturer') {
      const [toMark, live] = await Promise.all([
        this.db.query(
          `SELECT a.id, a.title, a.offering_id AS "offeringId", un.code AS "unitCode",
                  count(*) FILTER (WHERE s.status = 'submitted') AS pending
             FROM assessments a
             JOIN offerings o ON o.id = a.offering_id AND o.lecturer_id = $1
             JOIN units un ON un.id = o.unit_id
             JOIN submissions s ON s.assessment_id = a.id
            WHERE a.status <> 'draft'
            GROUP BY a.id, un.code, a.title, a.offering_id
           HAVING count(*) FILTER (WHERE s.status = 'submitted') > 0
            ORDER BY pending DESC LIMIT 8`,
          [user.id],
        ),
        this.db.query(
          `SELECT s.id, s.title, s.closes_at AS "closesAt", o.id AS "offeringId", un.code AS "unitCode"
             FROM attendance_sessions s JOIN offerings o ON o.id = s.offering_id AND o.lecturer_id = $1
             JOIN units un ON un.id = o.unit_id WHERE s.closes_at > now()`,
          [user.id],
        ),
      ]);
      return { toMark: toMark.rows, liveSessions: live.rows };
    }
    return {};
  }
}
