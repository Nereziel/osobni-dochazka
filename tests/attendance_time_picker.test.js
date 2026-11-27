import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { ATTENDANCE_HOURS, ATTENDANCE_MINUTES, isAttendanceTimeSlot, roundAttendanceTime } from '../src/utils/time.js';

describe('Five-minute selection controls', () => {
  it('offers 24 hours and exactly twelve five-minute choices', () => {
    expect(ATTENDANCE_HOURS).toHaveLength(24);
    expect(ATTENDANCE_HOURS[0]).toBe('00');
    expect(ATTENDANCE_HOURS[23]).toBe('23');
    expect(ATTENDANCE_MINUTES).toEqual(['00','05','10','15','20','25','30','35','40','45','50','55']);
    for (const hour of ATTENDANCE_HOURS) {
      for (const minute of ATTENDANCE_MINUTES) {
        expect(isAttendanceTimeSlot(hour + ':' + minute)).toBe(true);
      }
    }
    expect(isAttendanceTimeSlot('07:13')).toBe(false);
    expect(isAttendanceTimeSlot('24:00')).toBe(false);
    expect(isAttendanceTimeSlot('')).toBe(false);
    expect(roundAttendanceTime('07:13')).toBe('07:15');
  });

  it('uses the same constrained selector for both quick actions', () => {
    const component = fs.readFileSync('src/components/Attendance/AttendanceTimePicker.vue', 'utf8');
    const dashboard = fs.readFileSync('src/views/DashboardView.vue', 'utf8');
    expect(component).toContain('<select v-model="hour"');
    expect(component).toContain('<select v-model="minute"');
    expect(component).toContain('v-for="m in ATTENDANCE_MINUTES"');
    expect(component).not.toContain('type="time"');
    expect(dashboard.match(/<AttendanceTimePicker/g)).toHaveLength(2);
    expect(dashboard).toContain('if (!isAttendanceTimeSlot(selectedArrivalTime.value)) return;');
    expect(dashboard).toContain('if (!isAttendanceTimeSlot(selectedDepartureTime.value)) return;');
  });
});
