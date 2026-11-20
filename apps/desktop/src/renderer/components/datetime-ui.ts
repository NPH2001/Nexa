/** Ngày giờ đầy đủ `HH:mm dd/mm/yyyy` theo giờ máy, cho các ô chi tiết (cam kết, lịch sử hoạt động). */
export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
