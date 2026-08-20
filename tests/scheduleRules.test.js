import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateSchedule, expectedRestDays, listDates, workdaysInRange } from '../src/lib/scheduleRules.js'

test('当前月按剩余工作日比例四舍五入', () => {
  assert.equal(workdaysInRange('2026-08-01', '2026-08-31').length, 21)
  assert.equal(workdaysInRange('2026-08-19', '2026-08-31').length, 9)
  assert.equal(expectedRestDays(4, '2026-08-19', '2026-08-31', 2026, 8), 2)
})

test('日期范围包含首尾日期', () => {
  assert.deepEqual(listDates('2026-08-29', '2026-08-31'), ['2026-08-29', '2026-08-30', '2026-08-31'])
})

test('规则提示覆盖人数、月休、周末与连续休息', () => {
  const schedule = {
    year: 2026,
    month: 8,
    periodStart: '2026-08-28',
    periodEnd: '2026-08-31',
    rules: { dailyRestTarget: 0, monthlyRestDays: 4 },
    previousRestUserIds: [],
    members: [{
      id: 1,
      userId: 9,
      name: '测试护士',
      periodStart: '2026-08-28',
      periodEnd: '2026-08-31',
      entries: {
        '2026-08-28': 'rest',
        '2026-08-29': 'rest',
        '2026-08-30': 'day',
        '2026-08-31': 'rest',
      },
    }],
  }
  const codes = evaluateSchedule(schedule).map((warning) => warning.code)
  assert.ok(codes.includes('daily-rest-target'))
  assert.ok(codes.includes('monthly-rest-days'))
  assert.ok(codes.includes('weekend-rest'))
  assert.ok(codes.includes('consecutive-rest'))
})

test('跨月连续休息会产生提示', () => {
  const schedule = {
    year: 2026,
    month: 9,
    periodStart: '2026-09-01',
    periodEnd: '2026-09-02',
    rules: { dailyRestTarget: 1, monthlyRestDays: 4 },
    previousRestUserIds: [7],
    members: [{
      id: 1,
      userId: 7,
      name: '测试护士',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-02',
      entries: { '2026-09-01': 'rest', '2026-09-02': 'day' },
    }],
  }
  assert.ok(evaluateSchedule(schedule).some((warning) => warning.code === 'consecutive-rest'))
})
