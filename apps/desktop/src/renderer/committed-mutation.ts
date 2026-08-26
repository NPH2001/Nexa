/**
 * Giữ ranh giới commit của thao tác không hoàn tác tách khỏi bước đọc lại dữ liệu.
 * Refresh thất bại không được biến một mutation đã commit thành thông báo "thất bại".
 */
export async function commitThenRefresh(options: {
  commit: () => Promise<unknown>
  onCommitted: () => void
  refresh: () => Promise<unknown>
  onRefreshError: (error: unknown) => void
}): Promise<void> {
  await options.commit()
  options.onCommitted()
  try {
    await options.refresh()
  } catch (error) {
    options.onRefreshError(error)
  }
}
