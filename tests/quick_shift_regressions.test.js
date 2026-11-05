import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as attendance from '../src/utils/attendance.js';
import { todayKey } from '../src/utils/dates.js';

vi.mock('../src/services/indexedDb.js', () => ({
  getUserDays: vi.fn(async () => []),
  putUserDay: vi.fn(async () => {}),
  deleteUserDay: vi.fn(async () => {}),
  enqueueSyncAction: vi.fn(async () => {})
}));

describe('Quick clock actions retain existing day meaning', () => {
  it('keeps a partial doctor absence when arriving and leaving via buttons', () => {
    expect(attendance.applyQuickArrival).toBeTypeOf('function');
    expect(attendance.applyQuickDeparture).toBeTypeOf('function');

    const day = {
      date: '2026-11-05', type: 'doctor',
      start: '', end: '', doctorFullDay: false,
      doctorStart: '08:00', doctorEnd: '10:00',
      manualBreak: true, breakMinutes: 30,
      note: 'Propustka'
    };

    attendance.applyQuickArrival(day, '10:15');
    expect(day).toMatchObject({
      type: 'doctor', start: '10:15', end: '',
      doctorFullDay: false, doctorStart: '08:00', doctorEnd: '10:00',
      manualBreak: true, note: 'Propustka'
    });

    attendance.applyQuickDeparture(day, '16:45', '06:30');
    expect(day).toMatchObject({
      type: 'doctor', start: '10:15', end: '16:45',
      doctorStart: '08:00', doctorEnd: '10:00',
      manualBreak: true
    });
    const metrics = attendance.dayMetrics(day, attendance.DEFAULT_SETTINGS);
    expect(metrics.credited).toBe(120);
    expect(metrics.worked).toBe(360);
  });

  it.each(['homeOffice', 'businessTrip', 'halfVacation', 'other'])(
    'retains working day type %s on quick clock-in', (type) => {
      const day = { type, start: '', end: '' };
      attendance.applyQuickArrival(day, '07:30');
      expect(day.type).toBe(type);
      expect(day.start).toBe('07:30');
      expect(day.end).toBe('');
    }
  );

  it('converts full-day doctor to partial doctor when work actually starts', () => {
    const day = { type: 'doctor', doctorFullDay: true, start: '', end: '' };
    attendance.applyQuickArrival(day, '11:00');
    expect(day.type).toBe('doctor');
    expect(day.doctorFullDay).toBe(false);
  });

  it('changes non-working vacation to work when clocking in', () => {
    const day = { type: 'vacation', start: '', end: '' };
    attendance.applyQuickArrival(day, '07:00');
    expect(day.type).toBe('work');
  });
});

it('wires quick-action buttons through the preserving mutators', () => {
  const app = fs.readFileSync(path.resolve('src/App.vue'), 'utf8');
  expect(app).toContain('applyQuickArrival(d, formatClock())');
  expect(app).toContain('applyQuickDeparture(d, formatClock(), hours.start)');
});

describe('Manual open shift and stopwatch', () => {
  it('treats a manually saved arrival with no departure as the active shift', async () => {
    const { useAttendance } = await import('../src/composables/useAttendance.js');
    const model = useAttendance();
    await model.loadRecords(null);
    const date = todayKey();
    await model.saveDay({
      date, type: 'work', start: '06:30', end: '',
      manualBreak: false, breakMinutes: 30
    }, null, attendance.DEFAULT_SETTINGS, true);
    expect(model.todayRecord.value?.date).toBe(date);
    expect(model.activeShift.value).toMatchObject({
      isActive: true, startTime: '06:30', type: 'work'
    });
  });

  it('shows the active-shift banner outside the dashboard too', () => {
    const app = fs.readFileSync(path.resolve('src/App.vue'), 'utf8');
    const dashboard = fs.readFileSync(path.resolve('src/views/DashboardView.vue'), 'utf8');
    const main = app.split('<main class="win11-content-area">')[1]?.split('</main>')[0] || '';
    const bannerIndex = main.indexOf('<ActiveShiftBanner');
    const dashboardIndex = main.indexOf('<DashboardView');

    expect(bannerIndex).toBeGreaterThan(-1);
    expect(bannerIndex).toBeLessThan(dashboardIndex);
    expect(main).toContain(':active-shift="activeShift"');
    expect(main).toContain('@end-shift="handleQuickDeparture"');
    expect(dashboard).not.toContain('<ActiveShiftBanner');
  });
});
