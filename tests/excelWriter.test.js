import assert from 'node:assert/strict'
import test from 'node:test'
import writeExcelFile from 'write-excel-file/node'

test('generates a valid xlsx workbook payload', async () => {
  const buffer = await writeExcelFile([
    [{ value: '护士排班表', fontWeight: 'bold' }],
    [{ value: '王芳' }, { value: '休息' }],
  ]).toBuffer()

  assert.ok(buffer.length > 100)
  assert.equal(buffer[0], 0x50)
  assert.equal(buffer[1], 0x4b)
})
