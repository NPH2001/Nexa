import { describe, expect, it } from 'vitest'
import { MAX_FILE_BLOCK_BYTES } from '@nexa/shared-types/renderer'
import {
  canDownloadFileBlock,
  describeOmittedBlocks,
  describeOversizeBlock,
  fileBlockIcon,
  fileBlockLabel,
  formatFileSize,
  formatLineCount,
} from './file-block-ui.js'

describe('canDownloadFileBlock', () => {
  it('không cho tải khi message còn đang stream hoặc chưa bắt đầu', () => {
    expect(canDownloadFileBlock('streaming')).toBe(false)
    expect(canDownloadFileBlock('pending')).toBe(false)
  })

  it('cho tải khi message đã xong, lỗi hoặc bị huỷ', () => {
    // Fence đã đóng thì nội dung khối đã đủ, kể cả khi phần văn xuôi sau đó bị lỗi giữa đường.
    expect(canDownloadFileBlock('complete')).toBe(true)
    expect(canDownloadFileBlock('error')).toBe(true)
    expect(canDownloadFileBlock('cancelled')).toBe(true)
  })
})

describe('nhãn hiển thị', () => {
  it('mỗi định dạng có nhãn và biểu tượng', () => {
    expect(fileBlockLabel('drawio')).toBe('Sơ đồ draw.io')
    expect(fileBlockLabel('csv')).toBe('CSV')
    expect(fileBlockIcon('drawio')).not.toBe('')
    expect(fileBlockIcon('txt')).not.toBe('')
  })

  it('format dung lượng theo bậc B/KB/MB', () => {
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(2048)).toBe('2 KB')
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB')
  })

  it('nội dung rỗng nói "trống" thay vì "0 dòng"', () => {
    expect(formatLineCount(0)).toBe('trống')
    expect(formatLineCount(1)).toBe('1 dòng')
    expect(formatLineCount(1200)).toContain('dòng')
  })

  it('lý do vượt trần nêu cả dung lượng khối và trần', () => {
    const reason = describeOversizeBlock(MAX_FILE_BLOCK_BYTES + 1)

    expect(reason).toContain(formatFileSize(MAX_FILE_BLOCK_BYTES))
    expect(reason).toContain('vượt trần')
  })

  it('nói rõ số khối chưa hiển thị', () => {
    expect(describeOmittedBlocks(3)).toContain('3')
  })
})
