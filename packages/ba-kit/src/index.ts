/**
 * `@nexa/ba-kit` — logic thuần của Business Analyst workbench.
 *
 * Ranh giới của package này là một quyết định kiến trúc, không phải một quy ước (D9): không
 * import Electron, không import `@nexa/llm-client`, không import `@nexa/local-store`. Hàm nào cần
 * model, cần DB hay cần main process thì **không thuộc về đây**.
 *
 * Đổi lại, mọi thứ trong này test được bằng unit test thuần, chạy được không mạng, và cho ra cùng
 * một kết quả mỗi lần chạy. Đó là điều kiện để câu "tài liệu thiếu case nào" có một câu trả lời
 * kiểm chứng được thay vì một ý kiến. `boundary.test.ts` khẳng định ranh giới này.
 */

export * from './model.js'
export * from './text.js'
export * from './dedupe.js'
export * from './merge.js'
export * from './sections.js'
export * from './template.js'
export * from './normalize.js'
export * from './rulebook.js'
export * from './projections/error-codes.js'
export * from './projections/item-summary.js'
export * from './projections/markdown.js'
export * from './projections/mermaid.js'
export * from './projections/traceability.js'
export * from './review/types.js'
export * from './review/registry.js'
export * from './review/run.js'
export * from './review/apply.js'
