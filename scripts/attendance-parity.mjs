// Generate synthetic PostgreSQL assertions using the actual JS attendance functions.
import { dayMetrics, isCompletedDay, DEFAULT_SETTINGS } from '../src/utils/attendance.js';
import { dayRowForSupabase } from '../src/services/sync.js';

const day = { date: '2026-11-23', type: 'work', start: '07:00', end: '15:30', breakMinutes: 30 };
const cases = [
  ['ordinary shift', {}],
  ['night shift', { start: '22:00', end: '06:30' }],
  ['open shift', { end: '' }],
  ['future shift', { date: '2026-11-30' }],
  ['manual break', { manualBreak: true, breakMinutes: 45 }],
  ['break threshold', { end: '13:00' }],
  ['half vacation', { type: 'halfVacation', end: '11:00' }],
  ['odd target half vacation', { type: 'halfVacation', end: '11:00' }, { dailyTargetMinutes: 481 }],
  ['doctor inside shift', { type: 'doctor', doctorStart: '09:00', doctorEnd: '11:00' }],
  ['doctor overnight', { type: 'doctor', start: '22:00', end: '06:30', doctorStart: '23:30', doctorEnd: '01:00' }],
  ['doctor only', { type: 'doctor', start: '', end: '', doctorStart: '09:00', doctorEnd: '11:00' }],
  ['doctor all day', { type: 'doctor', start: '', end: '', doctorFullDay: true }],
  ['other absence only', { type: 'other', start: '', end: '', otherMinutes: 180 }],
  ['holiday absence', { date: '2026-11-17', type: 'vacation', start: '', end: '' }],
  ['Easter Friday', { date: '2026-04-03' }],
  ['working holiday', { date: '2026-11-17' }, { workOnHolidays: true }],
  ['Saturday overtime', { date: '2026-11-21' }],
  ['custom weekend', { date: '2026-11-21' }, { workDays: [1,2,3,4,5,6], weekendCustomHours: true, weekendTargetMinutes: 360 }],
  ['deleted day', { deletedAt: '2026-11-23T18:00:00Z' }],
  ['sick leave', { type: 'sick', start: '', end: '' }],
  ['compensatory leave', { type: 'compTime', start: '', end: '' }]
];
const sql = value => "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
const today = '2026-11-27';
console.log('begin;');
for (const [label, override, settingsOverride = {}] of cases) {
  const record = { ...day, ...override };
  const settings = { ...DEFAULT_SETTINGS, ...settingsOverride };
  const metrics = dayMetrics(record, settings);
  const expected = { worked_minutes: metrics.worked, credited_minutes: metrics.credited, target_minutes: metrics.target, balance_minutes: metrics.balance, break_minutes: metrics.breakMinutes };
  const row = dayRowForSupabase(record, 'user:parity_fixture', settings);
  const args = [sql(row), 'array[' + settings.workDays.join(',') + ']', settings.workOnHolidays, settings.weekendCustomHours, settings.weekendTargetMinutes, settings.dailyTargetMinutes, settings.breakAfterMinutes, settings.breakMinutes].join(', ');
  const complete = isCompletedDay(record, record.date, today);
  console.log(`do $$ begin
    if public.attendance_metrics_for_schedule(${args}) is distinct from ${sql(expected)} then
      raise exception 'JS/SQL metrics mismatch: ${label}';
    end if;
    if public.attendance_day_is_complete(${sql(row)}, '${today}'::date) is distinct from ${complete} then
      raise exception 'JS/SQL completion mismatch: ${label}';
    end if;
  end; $$;`);
}
console.log('rollback;');
