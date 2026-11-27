import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { applyQuickDeparture, findActiveShiftRecord } from '../src/utils/attendance.js';
import { timeToMinutes } from '../src/utils/time.js';

const read = (filename) => fs.readFileSync(path.resolve(filename), 'utf8');

describe('Quick departure at a selected time', () => {
  it('offers a separate time picker and requires confirmation before writing', () => {
    const dashboard = read('src/views/DashboardView.vue');
    expect(dashboard).toContain('<strong>Odchod teď</strong>');
    expect(dashboard).toContain('<strong>Odchod v</strong>');
    expect(dashboard).toContain('@click="openDepartureTimePicker"');
    expect(dashboard).toContain('v-if="showDepartureTimePicker"');
    expect(dashboard).toContain('id="quick-departure-picker"');
    expect(dashboard).toContain('v-model="selectedDepartureTime"');
    expect(dashboard).toContain('<AttendanceTimePicker');
    expect(dashboard).toContain('label="Čas odchodu"');
    expect(dashboard).toContain('@submit.prevent="confirmDepartureTime"');
    expect(dashboard).toContain("if (!isAttendanceTimeSlot(selectedDepartureTime.value)) return;");
    expect(dashboard).toContain("emit('quick-departure-at', selectedDepartureTime.value)");
    expect(dashboard).toContain('showDepartureTimePicker.value = false;');
    expect(dashboard).toContain('showArrivalTimePicker.value = false;');
    expect(dashboard).toContain('showDepartureTimePicker.value = false;\n  showArrivalTimePicker.value = true;');
    expect(dashboard).toContain('showArrivalTimePicker.value = false;\n  showDepartureTimePicker.value = true;');
  });

  it('saves the chosen time through the existing sync-safe quick change, preferring an open shift', () => {
    const app = read('src/App.vue');
    expect(app).toContain('@quick-departure-at="handleQuickDepartureAt"');
    expect(app).toContain('async function handleQuickDepartureAt(time) {');
    expect(app).toContain('if (timeToMinutes(time) === null)');
    expect(app).toContain('applyQuickDeparture(d, time, hours.start);');
    expect(app).toContain("`Odchod v ${result.end} zaznamenán`, { preferOpenShift: true }");
  });

  it('retains an existing arrival, absence interval, notes and the recorded day', () => {
    const day = {
      date: '2026-11-18', type: 'doctor',
      start: '09:30', end: '',
      doctorFullDay: false, doctorStart: '07:00', doctorEnd: '09:00',
      note: 'Lékař'
    };
    expect(timeToMinutes('16:25')).toBe(985);
    applyQuickDeparture(day, '16:25', '06:30');
    expect(day).toMatchObject({
      date: '2026-11-18', type: 'doctor', start: '09:30', end: '16:25',
      doctorStart: '07:00', doctorEnd: '09:00', note: 'Lékař'
    });
    expect(timeToMinutes('24:01')).toBeNull();
    expect(timeToMinutes('')).toBeNull();
  });

  it('ends an overnight shift against its start date, not the day after midnight', () => {
    const yesterday = { date: '2026-11-17', type: 'work', start: '22:15', end: '' };
    const today = { date: '2026-11-18', type: 'work', start: '07:00', end: '' };
    const now = new Date(2026, 10, 18, 0, 40);
    const day = findActiveShiftRecord(new Map([
      [yesterday.date, yesterday],
      [today.date, today]
    ]), now);
    expect(day).toBe(yesterday);
    applyQuickDeparture(day, '00:35', '06:30');
    expect(yesterday).toMatchObject({ date: '2026-11-17', start: '22:15', end: '00:35' });
    expect(today.end).toBe('');
  });
});
