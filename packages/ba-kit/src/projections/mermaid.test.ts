import { describe, expect, it } from 'vitest'
import { renderMermaid } from './mermaid.js'
import { makeFlowStep, makeModel, makeUseCase } from '../testing.js'

describe('sơ đồ Mermaid', () => {
  it('vẽ node theo đúng hình dạng của từng loại bước', () => {
    const { code } = renderMermaid(
      makeModel([
        makeFlowStep({ id: 's', label: 'Bắt đầu', kind: 'start', ordinal: 0 }),
        makeFlowStep({ id: 'd', label: 'Còn hàng?', kind: 'decision', ordinal: 1 }),
        makeFlowStep({ id: 'p', label: 'Tạo đơn', kind: 'step', ordinal: 2 }),
        makeFlowStep({ id: 'e', label: 'Kết thúc', kind: 'end', ordinal: 3 }),
      ]),
    )

    expect(code).toContain('n_s(["Bắt đầu"])')
    expect(code).toContain('n_d{"Còn hàng?"}')
    expect(code).toContain('n_p["Tạo đơn"]')
    expect(code).toContain('n_e(["Kết thúc"])')
  })

  it('vẽ cạnh theo link next và giữ nhãn nhánh', () => {
    const { code, edgeCount } = renderMermaid(
      makeModel(
        [
          makeFlowStep({ id: 'd', label: 'Còn hàng?', kind: 'decision', ordinal: 0 }),
          makeFlowStep({ id: 'p', label: 'Tạo đơn', ordinal: 1 }),
        ],
        [{ from: 'd', to: 'p', kind: 'next', label: 'còn hàng' }],
      ),
    )

    expect(code).toContain('n_d -->|"còn hàng"| n_p')
    expect(edgeCount).toBe(1)
  })

  it('bỏ cạnh trỏ tới bước không tồn tại', () => {
    const { edgeCount } = renderMermaid(
      makeModel([makeFlowStep({ id: 'a' })], [{ from: 'a', to: 'khong-co', kind: 'next' }]),
    )
    expect(edgeCount).toBe(0)
  })

  it('chỉ đọc cạnh next, không đọc covers', () => {
    const { edgeCount } = renderMermaid(
      makeModel(
        [makeFlowStep({ id: 'a' }), makeUseCase({ id: 'uc-1' })],
        [{ from: 'uc-1', to: 'a', kind: 'covers' }],
      ),
    )
    expect(edgeCount).toBe(0)
  })

  it('chỉ ra bước rời rạc thay vì im lặng vẽ ra một sơ đồ vụn', () => {
    const { isolatedSteps } = renderMermaid(
      makeModel(
        [
          makeFlowStep({ id: 'a', label: 'Một', ordinal: 0 }),
          makeFlowStep({ id: 'b', label: 'Hai', ordinal: 1 }),
          makeFlowStep({ id: 'c', label: 'Ba', ordinal: 2 }),
        ],
        [{ from: 'a', to: 'b', kind: 'next' }],
      ),
    )
    expect(isolatedSteps).toEqual(['c'])
  })

  it('thoát dấu nháy kép thay vì xoá — nhãn không được đổi nghĩa', () => {
    const { code } = renderMermaid(
      makeModel([makeFlowStep({ id: 'a', label: 'Nhập trường "Mã đơn"' })]),
    )
    expect(code).toContain(`n_a["Nhập trường 'Mã đơn'"]`)
  })

  it('id có ký tự lạ vẫn cho ra node id hợp lệ', () => {
    const { code } = renderMermaid(makeModel([makeFlowStep({ id: 's0-fs.1', label: 'Bước' })]))
    expect(code).toContain('n_s0_fs_1["Bước"]')
  })

  it('mô hình không có bước nào vẫn ra sơ đồ rỗng hợp lệ', () => {
    const { code, stepCount } = renderMermaid(makeModel([]))
    expect(code.trim()).toBe('flowchart TD')
    expect(stepCount).toBe(0)
  })
})
