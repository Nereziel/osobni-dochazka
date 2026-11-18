import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { applyQuickArrival } from '../src/utils/attendance.js';
import { timeToMinutes } from '../src/utils/time.js';

describe('Quick arrival at a selected time', () => {
  it('replaces the normal-hours action with a time picker and explicit confirmation', () => {
    const dashboard = fs.readFileSync(path.resolve('src/views/DashboardView.vue'), 'utf8');
    expect(dashboard).toContain('<strong>Příchod v</strong>');
    expect(dashboard).not.toContain('<strong>Běžná pracovní doba</strong>');
    expect(dashboard).toContain('@click="openArrivalTimePicker"');
    expect(dashboard).toContain('v-if="showArrivalTimePicker"');
    expect(dashboard).toContain('v-model="selectedArrivalTime"');
    expect(dashboard).toContain('type="time"');
    expect(dashboard).toContain('@submit.prevent="confirmArrivalTime"');
    expect(dashboard).toContain("if (timeToMinutes(selectedArrivalTime.value) === null) return;");
    expect(dashboard).toContain("emit('quick-arrival-at', selectedArrivalTime.value)");
    expect(dashboard).toContain('showArrivalTimePicker.value = false;');
  });

  it('wires selected time through the existing crash-safe quick change path', () => {
    const app = fs.readFileSync(path.resolve('src/App.vue'), 'utf8');
    expect(app).toContain('@quick-arrival-at="handleQuickArrivalAt"');
    expect(app).toContain('async function handleQuickArrivalAt(time) {');
    expect(app).toContain('if (timeToMinutes(time) === null)');
    expect(app).toContain('return executeQuickChange((d) => {\n    applyQuickArrival(d, time);');
    expect(app).not.toContain('handleQuickNormalHours');
  });

  it('stores only the chosen arrival and preserves doctor metadata and notes', () => {
    const day = {
      type: 'doctor',
      doctorFullDay: false,
      doctorStart: '08:00',
      doctorEnd: '09:00',
      start: '',
      end: '',
      note: 'Návštěva lékaře'
    };
    const chosenTime = '09:35';
    expect(timeToMinutes(chosenTime)).toBe(575);
    applyQuickArrival(day, chosenTime);
    expect(day).toMatchObject({
      type: 'doctor',
      start: '09:35',
      end: '',
      doctorStart: '08:00',
      doctorEnd: '09:00',
      note: 'Návštěva lékaře'
    });
    expect(timeToMinutes('25:00')).toBeNull();
    expect(timeToMinutes('')).toBeNull();
  });

  it('updates the displayed app version and date fallback consistently', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
    const lock = JSON.parse(fs.readFileSync(path.resolve('package-lock.json'), 'utf8'));
    const versionSource = fs.readFileSync(path.resolve('src/utils/version.js'), 'utf8');
    const manifest = JSON.parse(fs.readFileSync(path.resolve('.release-please-manifest.json'), 'utf8'));
    expect(pkg.version).toBe(manifest['.']);
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[''].version).toBe(pkg.version);
    expect(versionSource).toContain("'3.1.6'");
    expect(versionSource).toContain("'2026-11-18'");
  });
});
